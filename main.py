import os, io, time, zipfile, datetime, csv as csv_mod
from typing import Optional
import jwt
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

w            = WorkspaceClient()
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "")
JWT_SECRET   = os.environ.get("JWT_SECRET", "change-me")
APP_CATALOG  = os.environ.get("APP_CATALOG", "wag_file_transfer")
APP_SCHEMA   = os.environ.get("APP_SCHEMA", "config")


# ── helpers ──────────────────────────────────────────────────────────────────

def run_sql(stmt: str) -> list[dict]:
    r = w.statement_execution.execute_statement(
        statement=stmt, warehouse_id=WAREHOUSE_ID, wait_timeout="30s"
    )
    while r.status.state in (StatementState.PENDING, StatementState.RUNNING):
        time.sleep(1)
        r = w.statement_execution.get_statement(r.statement_id)
    if r.status.state != StatementState.SUCCEEDED:
        raise HTTPException(500, r.status.error.message)
    data = r.result.data_array or []
    cols = [c.name for c in r.manifest.schema.columns]
    return [dict(zip(cols, row)) for row in data]


def current_user(request: Request) -> dict:
    tok = request.headers.get("X-LB-Token", "")
    if not tok:
        raise HTTPException(401, "Unauthorized")
    try:
        return jwt.decode(tok, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")


def require_admin(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return user


def safe(value: str) -> str:
    # SQL is f-string interpolated; reject single quotes to block injection
    # via the free-text admin inputs (catalog/schema/volume/folder/names).
    if value is not None and "'" in value:
        raise HTTPException(400, "Single quotes are not allowed in this field")
    return value


def _principal_clause(uid: str, groups: list, prefix: str = "") -> str:
    # SQL predicate matching rows granted to this USER or any of their GROUPs.
    # prefix (e.g. 'p.') qualifies the columns when the query aliases the table.
    safe(uid)
    p = prefix
    parts = [f"({p}principal_type='USER' AND {p}principal_id='{uid}')"]
    if groups:
        for g in groups:
            safe(g)
        quoted = ",".join("'" + g + "'" for g in groups)
        parts.append(f"({p}principal_type='GROUP' AND {p}principal_id IN ({quoted}))")
    return "(" + " OR ".join(parts) + ")"


def _covers(scope: str, grant_folder: str, requested_folder: str) -> bool:
    # Does a grant on `grant_folder` with the given scope cover `requested_folder`?
    if scope == "VOLUME":
        return True                                  # whole volume
    if scope == "FOLDER_TREE":
        return requested_folder.startswith(grant_folder)  # folder + everything under it
    return requested_folder == grant_folder          # FOLDER: exact folder only


def resolve_perm(uid: str, groups: list, workspace_id: str, uc_catalog: str,
                 uc_schema: str, volume: str, folder: str) -> dict:
    # Find every grant the user (or their groups) has on this volume, then pick
    # one that COVERS the requested folder. Prefer DOWNLOAD over READ.
    rows = run_sql(f"""
        SELECT permission, scope, folder_path FROM {APP_CATALOG}.{APP_SCHEMA}.permissions
        WHERE {_principal_clause(uid, groups)} AND workspace_id = '{workspace_id}'
          AND uc_catalog = '{uc_catalog}' AND uc_schema = '{uc_schema}'
          AND volume = '{volume}'
    """)
    covering = [
        r for r in rows
        if _covers((r.get("scope") or "FOLDER"), r["folder_path"], folder)
    ]
    if not covering:
        raise HTTPException(403, "Access denied")
    # most permissive wins
    best = "DOWNLOAD" if any(r["permission"] == "DOWNLOAD" for r in covering) else "READ"
    return {"permission": best, "uc_catalog": uc_catalog, "uc_schema": uc_schema}


def vol_path(uc_catalog: str, uc_schema: str, volume: str,
             folder: str, filename: str = "") -> str:
    return f"/Volumes/{uc_catalog}/{uc_schema}/{volume}{folder}{filename}"


# ── auth ─────────────────────────────────────────────────────────────────────

TOKEN_TTL_SECONDS = 4 * 60 * 60   # 4h — group memberships are cached in the JWT
                                  # this long, so a group change propagates within ~4h.


def _workspace_url(request: Request) -> str:
    # Build a proper https:// base URL. DATABRICKS_HOST / X-Forwarded-Host often
    # arrive as a bare hostname (no scheme); urllib needs the scheme.
    host = os.environ.get("DATABRICKS_HOST", "").strip()
    if not host:
        host = request.headers.get("X-Forwarded-Host", "").strip()
    host = host.rstrip("/")
    if host and not host.startswith("http"):
        host = "https://" + host
    return host


def resolve_user_groups(request: Request) -> list:
    # Resolve the logged-in user's OWN group memberships from the forwarded
    # user token (downscoped, iam.current-user:read). Fail-safe: any problem
    # returns [] so login still succeeds and USER grants still work — group
    # grants simply won't resolve until this succeeds.
    tok = request.headers.get("X-Forwarded-Access-Token", "")
    if not tok:
        return []
    try:
        host = _workspace_url(request)
        import urllib.request, json as _json
        req = urllib.request.Request(
            f"{host}/api/2.0/preview/scim/v2/Me",
            headers={"Authorization": f"Bearer {tok}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        names = [g.get("display") for g in (data.get("groups") or []) if g.get("display")]
        # de-dupe, cap to keep the JWT small
        seen, out = set(), []
        for n in names:
            if n not in seen:
                seen.add(n); out.append(n)
            if len(out) >= 500:
                break
        return out
    except Exception:
        return []


@app.get("/api/me")
def me(request: Request):
    email = request.headers.get("X-Forwarded-Email", "")
    if not email:
        raise HTTPException(401, "No SSO identity — app must be opened as a Databricks App")
    safe(email)
    # Access is gated by the Databricks App "Can Use" grant (typically an AD
    # group) + the user's folder grants. The users table is NOT a login gate —
    # it only records who is an ADMIN and an optional display name. A user with
    # no users row logs in as a non-admin; their access comes from group grants.
    rows = run_sql(
        f"SELECT * FROM {APP_CATALOG}.{APP_SCHEMA}.users WHERE databricks_upn = '{email}'"
    )
    if rows:
        user = rows[0]
        user_id      = user["user_id"]
        display_name = user["display_name"]
        is_admin     = user["is_admin"] == "true"
    else:
        # Not provisioned individually — identify them by their email/SSO id.
        user_id      = email
        display_name = request.headers.get("X-Forwarded-Preferred-Username", "") or email
        is_admin     = False
        user = {"user_id": user_id, "display_name": display_name,
                "databricks_upn": email, "is_admin": str(is_admin).lower()}
    groups = resolve_user_groups(request)
    token = jwt.encode(
        {
            "user_id":      user_id,
            "display_name": display_name,
            "is_admin":     is_admin,
            "groups":       groups,
            "exp":          int(time.time()) + TOKEN_TTL_SECONDS,
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    return {"token": token, "user": user}


@app.get("/api/debug/whoami")
def debug_whoami(request: Request):
    # TEMPORARY diagnostic — shows exactly what the app can see about the caller,
    # so we can tell why group grants aren't resolving. Remove after debugging.
    tok = request.headers.get("X-Forwarded-Access-Token", "")
    result = {
        "email": request.headers.get("X-Forwarded-Email", ""),
        "has_forwarded_token": bool(tok),
        "resolved_groups": [],
        "scim_error": None,
        "scim_raw_group_count": 0,
    }
    if not tok:
        result["scim_error"] = "No X-Forwarded-Access-Token header (OBO not forwarding a user token)"
        return result
    try:
        host = _workspace_url(request)
        result["host_used"] = host
        import urllib.request, json as _json
        req = urllib.request.Request(
            f"{host}/api/2.0/preview/scim/v2/Me",
            headers={"Authorization": f"Bearer {tok}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        raw = data.get("groups") or []
        result["scim_raw_group_count"] = len(raw)
        result["resolved_groups"] = [g.get("display") for g in raw if g.get("display")]
    except Exception as e:
        result["scim_error"] = f"{type(e).__name__}: {e}"
    return result


# ── workspaces ────────────────────────────────────────────────────────────────

@app.get("/api/workspaces")
def get_workspaces(user: dict = Depends(current_user)):
    uid = user["user_id"]
    groups = user.get("groups") or []
    return run_sql(f"""
        SELECT DISTINCT w.workspace_id, w.display_name, w.host_url
        FROM {APP_CATALOG}.{APP_SCHEMA}.workspaces w
        JOIN {APP_CATALOG}.{APP_SCHEMA}.permissions p ON w.workspace_id = p.workspace_id
        WHERE {_principal_clause(uid, groups, prefix="p.")}
        ORDER BY w.display_name
    """)


# ── volumes ───────────────────────────────────────────────────────────────────

@app.get("/api/volumes")
def get_volumes(workspace_id: str, user: dict = Depends(current_user)):
    uid = user["user_id"]
    user_groups = user.get("groups") or []
    rows = run_sql(f"""
        SELECT uc_catalog, uc_schema, volume, folder_path, permission, scope
        FROM {APP_CATALOG}.{APP_SCHEMA}.permissions
        WHERE {_principal_clause(uid, user_groups)} AND workspace_id = '{workspace_id}'
        ORDER BY uc_catalog, uc_schema, volume, folder_path
    """)
    # group by (catalog, schema, volume) — a volume name can repeat across schemas
    groups: dict = {}
    for r in rows:
        key = (r["uc_catalog"], r["uc_schema"], r["volume"])
        if key not in groups:
            groups[key] = []
        groups[key].append({
            "folder": r["folder_path"],
            "permission": r["permission"],
            "scope": r.get("scope") or "FOLDER",
        })
    return [
        {"uc_catalog": cat, "uc_schema": sch, "volume": vol, "folders": folders}
        for (cat, sch, vol), folders in groups.items()
    ]


# ── browse (subfolder discovery for VOLUME / FOLDER_TREE scopes) ────────────────

@app.get("/api/browse")
def browse(workspace_id: str, uc_catalog: str, uc_schema: str, volume: str,
           folder: str, user: dict = Depends(current_user)):
    # Lists both subdirectories and files at `folder`, so the UI can navigate a
    # granted tree. resolve_perm enforces the scope covers this exact path.
    row = resolve_perm(user["user_id"], user.get("groups") or [], workspace_id, uc_catalog, uc_schema, volume, folder)
    path = vol_path(uc_catalog, uc_schema, volume, folder)
    entries = list(w.files.list_directory_contents(path))
    dirs = [
        {"name": e.name.rstrip("/"),
         "path": folder + e.name.rstrip("/") + "/"}
        for e in entries if e.is_directory
    ]
    files = [
        {"name": e.name, "size": e.file_size, "modified": e.last_modified}
        for e in entries if not e.is_directory
    ]
    return {"dirs": dirs, "files": files, "permission": row["permission"]}


# ── files ─────────────────────────────────────────────────────────────────────

@app.get("/api/files")
def list_files(workspace_id: str, uc_catalog: str, uc_schema: str, volume: str,
               folder: str, user: dict = Depends(current_user)):
    row = resolve_perm(user["user_id"], user.get("groups") or [], workspace_id, uc_catalog, uc_schema, volume, folder)
    path = vol_path(uc_catalog, uc_schema, volume, folder)
    entries = list(w.files.list_directory_contents(path))
    files = [
        {"name": e.name, "size": e.file_size, "modified": e.last_modified}
        for e in entries
        if not e.is_directory
    ]
    return {"files": files, "permission": row["permission"]}


@app.get("/api/download")
def download_file(
    workspace_id: str, uc_catalog: str, uc_schema: str, volume: str,
    folder: str, filename: str, user: dict = Depends(current_user)
):
    row = resolve_perm(user["user_id"], user.get("groups") or [], workspace_id, uc_catalog, uc_schema, volume, folder)
    if row["permission"] != "DOWNLOAD":
        raise HTTPException(403, "READ-only — download not permitted")
    path = vol_path(uc_catalog, uc_schema, volume, folder, filename)
    resp = w.files.download(path)
    return StreamingResponse(
        resp.contents,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class ZipBody(BaseModel):
    workspace_id: str
    uc_catalog: str
    uc_schema: str
    volume: str
    folder: str
    filenames: list[str]

@app.post("/api/download-zip")
def download_zip(body: ZipBody, user: dict = Depends(current_user)):
    row = resolve_perm(user["user_id"], user.get("groups") or [], body.workspace_id, body.uc_catalog,
                     body.uc_schema, body.volume, body.folder)
    if row["permission"] != "DOWNLOAD":
        raise HTTPException(403, "READ-only — download not permitted")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in body.filenames:
            path = vol_path(body.uc_catalog, body.uc_schema, body.volume, body.folder, fname)
            data = w.files.download(path)
            zf.writestr(fname, data.contents.read())
    buf.seek(0)

    folder_slug = body.folder.strip("/").replace("/", "_")
    date_str    = datetime.date.today().strftime("%Y%m%d")
    zip_name    = f"{folder_slug}_{date_str}.zip"

    return StreamingResponse(
        iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


# ── admin ─────────────────────────────────────────────────────────────────────

@app.get("/api/admin/permissions")
def admin_list_permissions(user: dict = Depends(require_admin)):
    return run_sql(f"""
        SELECT p.principal_type, p.principal_id,
               COALESCE(u.display_name, p.principal_id) AS display_name,
               u.databricks_upn, p.workspace_id,
               w.display_name AS workspace_name,
               p.uc_catalog, p.uc_schema, p.volume, p.folder_path, p.permission, p.scope,
               COALESCE(g.display_name, p.granted_by) AS granted_by, p.granted_at
        FROM {APP_CATALOG}.{APP_SCHEMA}.permissions p
        LEFT JOIN {APP_CATALOG}.{APP_SCHEMA}.users u
               ON p.principal_type = 'USER' AND p.principal_id = u.user_id
        JOIN {APP_CATALOG}.{APP_SCHEMA}.workspaces w ON p.workspace_id = w.workspace_id
        LEFT JOIN {APP_CATALOG}.{APP_SCHEMA}.users g ON p.granted_by = g.user_id
        ORDER BY display_name, p.workspace_id, p.uc_catalog, p.uc_schema, p.volume, p.folder_path
    """)


@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(require_admin)):
    return run_sql(
        f"SELECT user_id, display_name, databricks_upn, is_admin "
        f"FROM {APP_CATALOG}.{APP_SCHEMA}.users ORDER BY display_name"
    )


@app.get("/api/admin/workspaces")
def admin_list_workspaces(user: dict = Depends(require_admin)):
    return run_sql(f"SELECT * FROM {APP_CATALOG}.{APP_SCHEMA}.workspaces ORDER BY display_name")


class NewUser(BaseModel):
    display_name: str
    databricks_upn: str
    is_admin: bool = False

@app.post("/api/admin/user")
def add_user(body: NewUser, user: dict = Depends(require_admin)):
    name  = safe(body.display_name)
    email = safe(body.databricks_upn).strip()
    if not email:
        raise HTTPException(400, "Email is required")
    existing = run_sql(f"SELECT user_id FROM {APP_CATALOG}.{APP_SCHEMA}.users")
    existing_ids = {r["user_id"] for r in existing}
    uid  = email.split("@")[0].replace(".", "_").replace("-", "_")
    base = uid; n = 1
    while uid in existing_ids:
        uid = f"{base}_{n}"; n += 1
    is_admin = "true" if body.is_admin else "false"
    run_sql(
        f"INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.users VALUES "
        f"('{uid}','{name}','{email}',{is_admin})"
    )
    return {"ok": True, "user_id": uid}


class NewWorkspace(BaseModel):
    workspace_id: str
    display_name: str
    host_url: str

@app.post("/api/admin/workspace")
def add_workspace(body: NewWorkspace, user: dict = Depends(require_admin)):
    ws_id = safe(body.workspace_id).strip()
    name  = safe(body.display_name)
    host  = safe(body.host_url)
    if not ws_id:
        raise HTTPException(400, "Workspace id is required")
    dupe = run_sql(
        f"SELECT workspace_id FROM {APP_CATALOG}.{APP_SCHEMA}.workspaces "
        f"WHERE workspace_id = '{ws_id}'"
    )
    if dupe:
        raise HTTPException(400, f"Workspace '{ws_id}' already exists")
    run_sql(
        f"INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.workspaces VALUES "
        f"('{ws_id}','{name}','{host}')"
    )
    return {"ok": True}


class SetAdmin(BaseModel):
    user_id: str
    is_admin: bool

@app.put("/api/admin/user/admin")
def set_admin(body: SetAdmin, user: dict = Depends(require_admin)):
    uid      = safe(body.user_id)
    is_admin = "true" if body.is_admin else "false"
    run_sql(
        f"UPDATE {APP_CATALOG}.{APP_SCHEMA}.users SET is_admin={is_admin} "
        f"WHERE user_id='{uid}'"
    )
    return {"ok": True}


VALID_SCOPES = ("VOLUME", "FOLDER_TREE", "FOLDER")

def _is_admin_user(user_id: str) -> bool:
    rows = run_sql(
        f"SELECT is_admin FROM {APP_CATALOG}.{APP_SCHEMA}.users WHERE user_id = '{user_id}'"
    )
    return bool(rows) and str(rows[0]["is_admin"]).lower() == "true"


VALID_PRINCIPAL_TYPES = ("USER", "GROUP")

def _norm_principal(body) -> tuple:
    ptype = (body.principal_type or "USER").upper()
    if ptype not in VALID_PRINCIPAL_TYPES:
        raise HTTPException(400, f"Invalid principal_type: {body.principal_type}")
    pid = safe(body.principal_id)
    return ptype, pid


class PermRow(BaseModel):
    principal_type: str
    principal_id: str
    workspace_id: str
    uc_catalog: str
    uc_schema: str
    volume: str
    folder_path: str
    permission: str
    scope: str = "FOLDER"

@app.post("/api/admin/permission")
def add_permission(body: PermRow, user: dict = Depends(require_admin)):
    for field in (body.uc_catalog, body.uc_schema, body.volume, body.folder_path):
        safe(field)
    ptype, pid = _norm_principal(body)
    scope = (body.scope or "FOLDER").upper()
    if scope not in VALID_SCOPES:
        raise HTTPException(400, f"Invalid scope: {body.scope}")
    # VOLUME scope is USER-only, and only for admin users.
    if scope == "VOLUME":
        if ptype != "USER":
            raise HTTPException(403, "Whole-volume access can only be granted to an admin user, not a group")
        if not _is_admin_user(pid):
            raise HTTPException(403, "Whole-volume access can only be granted to admins")
    granter = user["user_id"]
    run_sql(f"""
        INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.permissions
        VALUES ('{ptype}','{pid}','{body.workspace_id}','{body.uc_catalog}','{body.uc_schema}',
                '{body.volume}','{body.folder_path}','{body.permission}','{granter}',current_timestamp(),'{scope}')
    """)
    return {"ok": True}


class UpdatePerm(BaseModel):
    principal_type: str
    principal_id: str
    workspace_id: str
    uc_catalog: str
    uc_schema: str
    volume: str
    folder_path: str
    permission: str
    scope: str = "FOLDER"

@app.put("/api/admin/permission")
def update_permission(body: UpdatePerm, user: dict = Depends(require_admin)):
    ptype, pid = _norm_principal(body)
    scope = (body.scope or "FOLDER").upper()
    if scope not in VALID_SCOPES:
        raise HTTPException(400, f"Invalid scope: {body.scope}")
    if scope == "VOLUME":
        if ptype != "USER":
            raise HTTPException(403, "Whole-volume access can only be granted to an admin user, not a group")
        if not _is_admin_user(pid):
            raise HTTPException(403, "Whole-volume access can only be granted to admins")
    granter = user["user_id"]
    run_sql(f"""
        UPDATE {APP_CATALOG}.{APP_SCHEMA}.permissions
        SET permission='{body.permission}', scope='{scope}', granted_by='{granter}', granted_at=current_timestamp()
        WHERE principal_type='{ptype}' AND principal_id='{pid}' AND workspace_id='{body.workspace_id}'
          AND uc_catalog='{body.uc_catalog}' AND uc_schema='{body.uc_schema}'
          AND volume='{body.volume}' AND folder_path='{body.folder_path}'
    """)
    return {"ok": True}


class DeletePerm(BaseModel):
    principal_type: str
    principal_id: str
    workspace_id: str
    uc_catalog: str
    uc_schema: str
    volume: str
    folder_path: str

@app.delete("/api/admin/permission")
def delete_permission(body: DeletePerm, user: dict = Depends(require_admin)):
    ptype, pid = _norm_principal(body)
    run_sql(f"""
        DELETE FROM {APP_CATALOG}.{APP_SCHEMA}.permissions
        WHERE principal_type='{ptype}' AND principal_id='{pid}' AND workspace_id='{body.workspace_id}'
          AND uc_catalog='{body.uc_catalog}' AND uc_schema='{body.uc_schema}'
          AND volume='{body.volume}' AND folder_path='{body.folder_path}'
    """)
    return {"ok": True}


# ── preview ───────────────────────────────────────────────────────────────────

@app.get("/api/preview")
def preview_file(
    workspace_id: str, uc_catalog: str, uc_schema: str, volume: str,
    folder: str, filename: str, user: dict = Depends(current_user)
):
    resolve_perm(user["user_id"], user.get("groups") or [], workspace_id, uc_catalog, uc_schema, volume, folder)
    path = vol_path(uc_catalog, uc_schema, volume, folder, filename)
    resp = w.files.download(path)
    content = resp.contents.read(1_048_576).decode("utf-8", errors="replace")
    return {"content": content, "filename": filename}


# ── bulk permissions ──────────────────────────────────────────────────────────

class BulkChange(BaseModel):
    principal_type: str = "USER"
    principal_id: str
    workspace_id: str
    uc_catalog: str
    uc_schema: str
    volume: str
    folder_path: str
    permission: Optional[str] = None

class BulkBody(BaseModel):
    changes: list[BulkChange]

@app.post("/api/admin/permissions/bulk")
def bulk_permissions(body: BulkBody, user: dict = Depends(require_admin)):
    if not body.changes:
        return {"ok": True, "applied": 0}
    for c in body.changes:
        safe(c.principal_id)
    conds = " OR ".join(
        f"(principal_type='{(c.principal_type or 'USER').upper()}' AND principal_id='{c.principal_id}'"
        f" AND workspace_id='{c.workspace_id}'"
        f" AND uc_catalog='{c.uc_catalog}' AND uc_schema='{c.uc_schema}'"
        f" AND volume='{c.volume}' AND folder_path='{c.folder_path}')"
        for c in body.changes
    )
    run_sql(f"DELETE FROM {APP_CATALOG}.{APP_SCHEMA}.permissions WHERE {conds}")
    to_add = [c for c in body.changes if c.permission]
    if to_add:
        granter = user["user_id"]
        vals = ", ".join(
            f"('{(c.principal_type or 'USER').upper()}','{c.principal_id}','{c.workspace_id}','{c.uc_catalog}','{c.uc_schema}',"
            f"'{c.volume}','{c.folder_path}','{c.permission}','{granter}',current_timestamp(),'FOLDER')"
            for c in to_add
        )
        run_sql(f"INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.permissions VALUES {vals}")
    return {"ok": True, "applied": len(body.changes)}


# ── CSV import ────────────────────────────────────────────────────────────────

@app.post("/api/admin/import")
async def import_csv(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    content = await file.read()
    text    = content.decode("utf-8-sig")
    rows    = list(csv_mod.DictReader(io.StringIO(text)))

    existing = {
        r["databricks_upn"]: r["user_id"]
        for r in run_sql(f"SELECT user_id, databricks_upn FROM {APP_CATALOG}.{APP_SCHEMA}.users")
    }
    existing_ids = set(existing.values())

    users_added = 0
    perm_rows   = []

    for row in rows:
        email      = (row.get("email") or "").strip()
        name       = (row.get("display_name") or "").strip()
        ws_id      = (row.get("workspace_id") or "").strip()
        uc_catalog = (row.get("uc_catalog") or "").strip()
        uc_schema  = (row.get("uc_schema") or "").strip()
        volume     = (row.get("volume") or "").strip()
        folder     = (row.get("folder_path") or "").strip()
        permission = (row.get("permission") or "").strip().upper()
        scope      = (row.get("scope") or "FOLDER").strip().upper() or "FOLDER"
        # Optional principal columns. Default USER (email-based). A GROUP row uses
        # the group name (from `principal_id` or `group`) as the principal, and
        # does NOT provision a user.
        ptype      = (row.get("principal_type") or "USER").strip().upper() or "USER"
        group_name = (row.get("principal_id") or row.get("group") or "").strip()
        if scope not in VALID_SCOPES:
            scope = "FOLDER"
        if ptype not in VALID_PRINCIPAL_TYPES:
            ptype = "USER"
        if not all([ws_id, uc_catalog, uc_schema, volume, folder, permission]):
            continue

        if ptype == "GROUP":
            if not group_name:
                continue
            safe(group_name)
            principal_id = group_name
            scope = "FOLDER_TREE" if scope == "VOLUME" else scope  # VOLUME not allowed for groups
        else:
            if not email:
                continue
            if email not in existing:
                uid  = email.split("@")[0].replace(".", "_").replace("-", "_")
                base = uid; n = 1
                while uid in existing_ids:
                    uid = f"{base}_{n}"; n += 1
                run_sql(
                    f"INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.users VALUES "
                    f"('{uid}','{name}','{email}',false)"
                )
                existing[email] = uid
                existing_ids.add(uid)
                users_added += 1
            principal_id = existing[email]
        perm_rows.append((ptype, principal_id, ws_id, uc_catalog, uc_schema, volume, folder, permission, scope))

    if perm_rows:
        conds = " OR ".join(
            f"(principal_type='{r[0]}' AND principal_id='{r[1]}' AND workspace_id='{r[2]}' AND uc_catalog='{r[3]}'"
            f" AND uc_schema='{r[4]}' AND volume='{r[5]}' AND folder_path='{r[6]}')"
            for r in perm_rows
        )
        run_sql(f"DELETE FROM {APP_CATALOG}.{APP_SCHEMA}.permissions WHERE {conds}")
        granter = user["user_id"]
        vals = ", ".join(
            f"('{r[0]}','{r[1]}','{r[2]}','{r[3]}','{r[4]}','{r[5]}','{r[6]}','{r[7]}','{granter}',current_timestamp(),'{r[8]}')"
            for r in perm_rows
        )
        run_sql(f"INSERT INTO {APP_CATALOG}.{APP_SCHEMA}.permissions VALUES {vals}")

    return {"users_added": users_added, "permissions_added": len(perm_rows)}


# ── serve React build ─────────────────────────────────────────────────────────
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

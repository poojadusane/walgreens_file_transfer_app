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


def check_perm(uid: str, workspace_id: str, volume: str, folder: str) -> str:
    rows = run_sql(f"""
        SELECT permission FROM {APP_CATALOG}.config.permissions
        WHERE user_id = '{uid}' AND workspace_id = '{workspace_id}'
          AND volume = '{volume}' AND folder_path = '{folder}'
    """)
    if not rows:
        raise HTTPException(403, "Access denied")
    return rows[0]["permission"]


def vol_path(workspace_id: str, volume: str, folder: str, filename: str = "") -> str:
    rows = run_sql(
        f"SELECT uc_catalog, uc_schema FROM {APP_CATALOG}.config.workspaces "
        f"WHERE workspace_id = '{workspace_id}'"
    )
    if not rows:
        raise HTTPException(400, f"Unknown workspace: {workspace_id}")
    return f"/Volumes/{rows[0]['uc_catalog']}/{rows[0]['uc_schema']}/{volume}{folder}{filename}"


# ── auth ─────────────────────────────────────────────────────────────────────

@app.get("/api/me")
def me(request: Request):
    email = request.headers.get("X-Forwarded-Email", "")
    if not email:
        raise HTTPException(401, "No SSO identity — app must be opened as a Databricks App")
    rows = run_sql(
        f"SELECT * FROM {APP_CATALOG}.config.users WHERE databricks_upn = '{email}'"
    )
    if not rows:
        raise HTTPException(403, f"{email} is not provisioned. Ask your admin to add you.")
    user = rows[0]
    token = jwt.encode(
        {
            "user_id":      user["user_id"],
            "display_name": user["display_name"],
            "is_admin":     user["is_admin"] == "true",
            "exp":          int(time.time()) + 604800,
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    return {"token": token, "user": user}


# ── workspaces ────────────────────────────────────────────────────────────────

@app.get("/api/workspaces")
def get_workspaces(user: dict = Depends(current_user)):
    uid = user["user_id"]
    return run_sql(f"""
        SELECT DISTINCT w.workspace_id, w.display_name, w.host_url
        FROM {APP_CATALOG}.config.workspaces w
        JOIN {APP_CATALOG}.config.permissions p ON w.workspace_id = p.workspace_id
        WHERE p.user_id = '{uid}'
        ORDER BY w.display_name
    """)


# ── volumes ───────────────────────────────────────────────────────────────────

@app.get("/api/volumes")
def get_volumes(workspace_id: str, user: dict = Depends(current_user)):
    uid = user["user_id"]
    rows = run_sql(f"""
        SELECT volume, folder_path, permission
        FROM {APP_CATALOG}.config.permissions
        WHERE user_id = '{uid}' AND workspace_id = '{workspace_id}'
        ORDER BY volume, folder_path
    """)
    volumes: dict = {}
    for r in rows:
        v = r["volume"]
        if v not in volumes:
            volumes[v] = []
        volumes[v].append({"folder": r["folder_path"], "permission": r["permission"]})
    return [{"volume": k, "folders": v} for k, v in volumes.items()]


# ── files ─────────────────────────────────────────────────────────────────────

@app.get("/api/files")
def list_files(workspace_id: str, volume: str, folder: str, user: dict = Depends(current_user)):
    permission = check_perm(user["user_id"], workspace_id, volume, folder)
    path = vol_path(workspace_id, volume, folder)
    entries = list(w.files.list_directory_contents(path))
    files = [
        {"name": e.name, "size": e.file_size, "modified": e.last_modified}
        for e in entries
        if not e.is_directory
    ]
    return {"files": files, "permission": permission}


@app.get("/api/download")
def download_file(
    workspace_id: str, volume: str, folder: str, filename: str,
    user: dict = Depends(current_user)
):
    perm = check_perm(user["user_id"], workspace_id, volume, folder)
    if perm != "DOWNLOAD":
        raise HTTPException(403, "READ-only — download not permitted")
    path = vol_path(workspace_id, volume, folder, filename)
    resp = w.files.download(path)
    return StreamingResponse(
        resp.contents,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class ZipBody(BaseModel):
    workspace_id: str
    volume: str
    folder: str
    filenames: list[str]

@app.post("/api/download-zip")
def download_zip(body: ZipBody, user: dict = Depends(current_user)):
    perm = check_perm(user["user_id"], body.workspace_id, body.volume, body.folder)
    if perm != "DOWNLOAD":
        raise HTTPException(403, "READ-only — download not permitted")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in body.filenames:
            path = vol_path(body.workspace_id, body.volume, body.folder, fname)
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
        SELECT p.user_id, u.display_name, p.workspace_id, w.display_name AS workspace_name,
               p.volume, p.folder_path, p.permission, p.granted_by, p.granted_at
        FROM {APP_CATALOG}.config.permissions p
        JOIN {APP_CATALOG}.config.users u ON p.user_id = u.user_id
        JOIN {APP_CATALOG}.config.workspaces w ON p.workspace_id = w.workspace_id
        ORDER BY p.user_id, p.workspace_id, p.volume, p.folder_path
    """)


@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(require_admin)):
    return run_sql(
        f"SELECT user_id, display_name, databricks_upn, is_admin "
        f"FROM {APP_CATALOG}.config.users ORDER BY display_name"
    )


@app.get("/api/admin/workspaces")
def admin_list_workspaces(user: dict = Depends(require_admin)):
    return run_sql(f"SELECT * FROM {APP_CATALOG}.config.workspaces ORDER BY display_name")


class PermRow(BaseModel):
    user_id: str
    workspace_id: str
    volume: str
    folder_path: str
    permission: str

@app.post("/api/admin/permission")
def add_permission(body: PermRow, user: dict = Depends(require_admin)):
    run_sql(f"""
        INSERT INTO {APP_CATALOG}.config.permissions
        VALUES ('{body.user_id}','{body.workspace_id}','{body.volume}',
                '{body.folder_path}','{body.permission}','{user["user_id"]}',current_timestamp())
    """)
    return {"ok": True}


class UpdatePerm(BaseModel):
    user_id: str
    workspace_id: str
    volume: str
    folder_path: str
    permission: str

@app.put("/api/admin/permission")
def update_permission(body: UpdatePerm, user: dict = Depends(require_admin)):
    run_sql(f"""
        UPDATE {APP_CATALOG}.config.permissions
        SET permission='{body.permission}', granted_by='{user["user_id"]}', granted_at=current_timestamp()
        WHERE user_id='{body.user_id}' AND workspace_id='{body.workspace_id}'
          AND volume='{body.volume}' AND folder_path='{body.folder_path}'
    """)
    return {"ok": True}


class DeletePerm(BaseModel):
    user_id: str
    workspace_id: str
    volume: str
    folder_path: str

@app.delete("/api/admin/permission")
def delete_permission(body: DeletePerm, user: dict = Depends(require_admin)):
    run_sql(f"""
        DELETE FROM {APP_CATALOG}.config.permissions
        WHERE user_id='{body.user_id}' AND workspace_id='{body.workspace_id}'
          AND volume='{body.volume}' AND folder_path='{body.folder_path}'
    """)
    return {"ok": True}


# ── preview ───────────────────────────────────────────────────────────────────

@app.get("/api/preview")
def preview_file(
    workspace_id: str, volume: str, folder: str, filename: str,
    user: dict = Depends(current_user)
):
    check_perm(user["user_id"], workspace_id, volume, folder)
    path = vol_path(workspace_id, volume, folder, filename)
    resp = w.files.download(path)
    content = resp.contents.read(1_048_576).decode("utf-8", errors="replace")
    return {"content": content, "filename": filename}


# ── bulk permissions ──────────────────────────────────────────────────────────

class BulkChange(BaseModel):
    user_id: str
    workspace_id: str
    volume: str
    folder_path: str
    permission: Optional[str] = None

class BulkBody(BaseModel):
    changes: list[BulkChange]

@app.post("/api/admin/permissions/bulk")
def bulk_permissions(body: BulkBody, user: dict = Depends(require_admin)):
    if not body.changes:
        return {"ok": True, "applied": 0}
    conds = " OR ".join(
        f"(user_id='{c.user_id}' AND workspace_id='{c.workspace_id}'"
        f" AND volume='{c.volume}' AND folder_path='{c.folder_path}')"
        for c in body.changes
    )
    run_sql(f"DELETE FROM {APP_CATALOG}.config.permissions WHERE {conds}")
    to_add = [c for c in body.changes if c.permission]
    if to_add:
        vals = ", ".join(
            f"('{c.user_id}','{c.workspace_id}','{c.volume}','{c.folder_path}',"
            f"'{c.permission}','{user['user_id']}',current_timestamp())"
            for c in to_add
        )
        run_sql(f"INSERT INTO {APP_CATALOG}.config.permissions VALUES {vals}")
    return {"ok": True, "applied": len(body.changes)}


# ── CSV import ────────────────────────────────────────────────────────────────

@app.post("/api/admin/import")
async def import_csv(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    content = await file.read()
    text    = content.decode("utf-8-sig")
    rows    = list(csv_mod.DictReader(io.StringIO(text)))

    existing = {
        r["databricks_upn"]: r["user_id"]
        for r in run_sql(f"SELECT user_id, databricks_upn FROM {APP_CATALOG}.config.users")
    }
    existing_ids = set(existing.values())

    users_added = 0
    perm_rows   = []

    for row in rows:
        email      = (row.get("email") or "").strip()
        name       = (row.get("display_name") or "").strip()
        ws_id      = (row.get("workspace_id") or "").strip()
        volume     = (row.get("volume") or "").strip()
        folder     = (row.get("folder_path") or "").strip()
        permission = (row.get("permission") or "").strip().upper()
        if not all([email, ws_id, volume, folder, permission]):
            continue
        if email not in existing:
            uid  = email.split("@")[0].replace(".", "_").replace("-", "_")
            base = uid; n = 1
            while uid in existing_ids:
                uid = f"{base}_{n}"; n += 1
            run_sql(
                f"INSERT INTO {APP_CATALOG}.config.users VALUES "
                f"('{uid}','{name}','{email}',false)"
            )
            existing[email] = uid
            existing_ids.add(uid)
            users_added += 1
        perm_rows.append((existing[email], ws_id, volume, folder, permission))

    if perm_rows:
        conds = " OR ".join(
            f"(user_id='{r[0]}' AND workspace_id='{r[1]}' AND volume='{r[2]}' AND folder_path='{r[3]}')"
            for r in perm_rows
        )
        run_sql(f"DELETE FROM {APP_CATALOG}.config.permissions WHERE {conds}")
        granter = user["user_id"]
        vals = ", ".join(
            f"('{r[0]}','{r[1]}','{r[2]}','{r[3]}','{r[4]}','{granter}',current_timestamp())"
            for r in perm_rows
        )
        run_sql(f"INSERT INTO {APP_CATALOG}.config.permissions VALUES {vals}")

    return {"users_added": users_added, "permissions_added": len(perm_rows)}


# ── serve React build ─────────────────────────────────────────────────────────
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

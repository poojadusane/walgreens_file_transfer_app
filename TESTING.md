# Walgreens File Transfer — Testing Guide

This document describes what is required to test the app end-to-end and the
step-by-step procedure to validate a volume/folder is downloadable through the
app. It applies to both the dev test and the eventual production rollout.

---

## 1. How the app works (context for testing)

- Users log in via **Azure AD SSO** — the app reads the `X-Forwarded-Email`
  header and checks it against the `users` config table.
- The app fetches files using its **own service principal (SP)** via the Unity
  Catalog Files API. End users never touch the volume directly.
- Access is driven entirely by three config tables in `<APP_CATALOG>.config`:
  `users`, `workspaces`, `permissions`.
- Because Unity Catalog is **metastore-level**, one app deployment can serve
  volumes across every workspace on the same metastore — the app does not need
  to be deployed in the workspace where the data lives.

---

## 2. Prerequisites for testing a volume

Before a file in a given volume can be downloaded through the app, ALL of the
following must be true:

| # | Requirement | Who does it | How to verify |
|---|-------------|-------------|---------------|
| 1 | App is deployed and running | You (CLI) | App URL loads the login page |
| 2 | Config tables exist in `<APP_CATALOG>.config` | You (setup.sql) | `DESCRIBE <APP_CATALOG>.config.permissions` |
| 3 | Tester is in the `users` table with the exact SSO email | You (Admin UI / SQL) | row in `users` |
| 4 | Tester has `CAN USE` on the Databricks App itself | Admin (App → Share) | tester can open the app (no "Permission Required" screen) |
| 5 | App SP has UC grants on the target volume | UC admin (SQL) | see grant block below |
| 6 | A `workspaces` row exists AND its `workspace_id` matches the one used in the `permissions` row | You (Admin UI / SQL) | IDs are identical strings |
| 7 | A `permissions` row grants the tester READ or DOWNLOAD on the volume/folder | You (Admin UI / SQL) | row in `permissions` |

### Grant the app SP access (requirement 5)

The app service principal is `2b75bedd-d97d-4a24-ac8e-b120a0f996ff`. A UC admin
runs (note backticks around hyphenated names):

```sql
GRANT USE CATALOG ON CATALOG <catalog> TO `2b75bedd-d97d-4a24-ac8e-b120a0f996ff`;
GRANT USE SCHEMA  ON SCHEMA  <catalog>.<schema> TO `2b75bedd-d97d-4a24-ac8e-b120a0f996ff`;
GRANT READ VOLUME ON VOLUME  <catalog>.<schema>.`<volume>` TO `2b75bedd-d97d-4a24-ac8e-b120a0f996ff`;
```

`USE SCHEMA` does NOT cascade read access to every volume — each volume needs
its own `READ VOLUME` (or grant `READ VOLUME ON SCHEMA` to blanket a schema).

---

## 3. Mapping a `/Volumes/...` path to config fields

A Unity Catalog volume path decomposes like this:

```
/Volumes/dlx_dev/ext_vols/dlxdevsemprtoutsa10-ice-phi/flushot/flu_shot_category_ndc/
         └catalog┘ └schema┘ └────── volume ──────────┘ └──────── folder ──────────┘
```

- `uc_catalog` = `dlx_dev`
- `uc_schema`  = `ext_vols`
- `volume`     = `dlxdevsemprtoutsa10-ice-phi`
- `folder_path`= `/flushot/flu_shot_category_ndc/`  (leading + trailing slash)

---

## 4. Test procedure

### 4a. Via the Admin UI (preferred — no SQL)

1. Open the app, sign in as an admin.
2. **Admin → + Add Workspace**: enter a `workspace_id`, display name, host URL.
   Note the exact `workspace_id` string — you must reuse it below.
3. **Admin → + Add Permission**: pick the user, pick that workspace, type the
   catalog / schema / volume / folder from step 3, choose DOWNLOAD, Save.
4. **Files tab**: the workspace appears → click in → volume shows (with
   `catalog.schema` beneath it) → open the folder → files list.
5. Select a file → Download. Confirm the file downloads.

### 4b. Via SQL (equivalent)

```sql
-- workspace row (workspace_id is a label; reuse it verbatim in the permission)
INSERT INTO <APP_CATALOG>.config.workspaces (workspace_id, display_name, host_url)
VALUES ('<ws_id>', '<display>', '<host_url>');

-- permission row (9-col schema shown; add scope col if your table has it)
INSERT INTO <APP_CATALOG>.config.permissions
  (user_id, workspace_id, uc_catalog, uc_schema, volume, folder_path, permission, granted_by, granted_at)
VALUES ('<user_id>', '<ws_id>', '<catalog>', '<schema>', '<volume>', '<folder_path>',
        'DOWNLOAD', '<granter_user_id>', current_timestamp());
```

---

## 5. Common failure modes (all hit during dev testing)

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No workspaces available" in Files | `permissions.workspace_id` ≠ `workspaces.workspace_id` (label vs numeric id) | Make the two strings identical |
| "No workspaces available" (as admin) | Admin has no permission row for themselves | Add a permission row for the admin too — admin ≠ auto-access |
| "Permission Required" (Databricks screen) | Tester lacks `CAN USE` on the app | Admin grants CAN USE in App → Share (use an AD group at scale) |
| Folder opens but files error / access denied | App SP missing `READ VOLUME` on that volume | UC admin runs the grant block (§2) |
| "not provisioned" on login | Email not in `users`, or doesn't match SSO email exactly | Add/fix the `users` row |
| Deploy fails: `RESOURCE_DOES_NOT_EXIST /Workspace/...` | Source folder purged by the "UnusedFolders" cleanup job | Re-run `workspace import-dir`; ask admin to exclude the path |
| `Invalid access token` on CLI | PATs disabled; token expired | `databricks auth login --host <url> --profile wag` (OAuth/SSO) |

---

## 6. Test results — dev run

- **Date:** 2026-07-28
- **Environment:** Walgreens dev; app `walgreens-file-transfer`, config catalog
  `data_migration_validator_dev`, warehouse `ba9953193041ffec`.
- **Workspace under test:** `dlx-dev-databricks-10` (workspaces.workspace_id =
  `2596972336492633`)
- **Volume under test:** `dlx_dev.ext_vols.dlxdevsemprtoutsa10-ice-phi`
- **Folder:** `/flushot/flu_shot_category_ndc/`
- **File:** `Flu_Shot_Category_NDCs_20161111000536.dat`
- **Testers:** Pooja Dusane (admin), Guo Chen (user)
- **App SP grant confirmed:** yes — UC admin granted USE CATALOG / USE SCHEMA /
  READ VOLUME on `dlx_dev.ext_vols.dlxdevsemprtoutsa10-ice-phi`.

**Result (admin — Pooja):** ✅ **PASS.** After aligning `workspace_id`, the
`dlx-dev-databricks-10` workspace appeared in Files, the volume and
`/flushot/flu_shot_category_ndc/` folder resolved, and
`Flu_Shot_Category_NDCs_20161111000536.dat` downloaded successfully.

**Result (non-admin — Guo Chen):** _<TO CONFIRM — Guo to test download and
report. Fill in PASS/FAIL.>_

**Notes / issues hit:** workspace_id mismatch (label `dlx-dev-databricks-10` in
permissions vs numeric `2596972336492633` in workspaces) caused an initial
"No workspaces available"; resolved by aligning both to the numeric id.

---

## 7. Screenshots

> Add screenshots below as evidence. Suggested captures:

**A. Admin — permissions configured**
`![Admin permissions table](screenshots/01-admin-permissions.png)`
_Where to capture: Admin page → the permissions table showing the granted row(s)
for Pooja and Guo on `dlxdevsemprtoutsa10-ice-phi`._

**B. Admin (Pooja) — workspace visible in Files**
`![Files - workspace list](screenshots/02-files-workspace.png)`
_Where to capture: Files tab → "Your workspaces" showing `dlx-dev-databricks-10`._

**C. Admin (Pooja) — folder + file listing**
`![Files - folder listing](screenshots/03-files-listing.png)`
_Where to capture: Files → into the volume → `/flushot/flu_shot_category_ndc/`
showing `Flu_Shot_Category_NDCs_...dat`._

**D. Admin (Pooja) — successful download**
`![Download success](screenshots/04-download.png)`
_Where to capture: browser download bar / downloaded file after clicking Download._

**E. Non-admin (Guo) — login + workspace visible**
`![Guo - Files view](screenshots/05-guo-files.png)`
_Where to capture: Guo's session → Files tab showing the same workspace/folder.
Confirms non-admin access works through her own permission row._

**F. Non-admin (Guo) — successful download**
`![Guo - download](screenshots/06-guo-download.png)`
_Where to capture: Guo's browser after downloading the file. This is the key
end-user proof._

**G. (Optional) READ-only behavior**
`![Read-only folder](screenshots/07-readonly.png)`
_Where to capture: a folder granted READ (not DOWNLOAD) showing the "Read-only
access" banner and no download option — proves the permission gate works._

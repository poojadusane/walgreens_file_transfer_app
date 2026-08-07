# Walgreens File Transfer — Test Plan

| | |
|---|---|
| **Application** | Walgreens File Transfer (Databricks App) |
| **Environment** | Dev — workspace `adb-5346339970823458.18`, config catalog `data_migration_validator_dev` |
| **App URL** | https://walgreens-file-transfer-5346339970823458.18.azure.databricksapps.com |
| **Prepared by** | Pooja Dusane |
| **Date** | 2026-07-28 |
| **Version under test** | commit `bf46d24` (scopes + admin-flag fix) |

---

## 1. Purpose & scope

Validate that the app correctly enforces per-user, per-folder access to Unity
Catalog volume files, that admins can manage access without SQL, and that the
security model (users never touch volumes directly; the app SP is the gatekeeper)
holds. Out of scope: load/performance testing, penetration testing, DR.

## 2. Test environment prerequisites

Before executing, confirm all of the following are true (see `TESTING.md §2`):

- [ ] App deployed and running (URL loads the SSO login page)
- [ ] Config tables exist in `<APP_CATALOG>.<APP_SCHEMA>` (per app.yaml) with the current schema (permissions has `scope`)
- [ ] Testers exist in `users` with exact SSO emails: Pooja (admin), Guo Chen (non-admin), Mohamed Ziane (non-admin)
- [ ] All testers have `CAN USE` on the Databricks App
- [ ] App SP `2b75bedd-d97d-4a24-ac8e-b120a0f996ff` has `USE CATALOG` / `USE SCHEMA` / `READ VOLUME` on the test volume `dlx_dev.ext_vols.dlxdevsemprtoutsa10-ice-phi`
- [ ] Test volume/folder has at least one real file (`/flushot/flu_shot_category_ndc/`)

## 3. Test data

| Item | Value |
|------|-------|
| Workspace label | `dlx-dev-databricks-10` (workspaces.workspace_id `2596972336492633`) |
| Catalog / schema | `dlx_dev` / `ext_vols` |
| Volume | `dlxdevsemprtoutsa10-ice-phi` |
| Folder | `/flushot/flu_shot_category_ndc/` |
| File | `Flu_Shot_Category_NDCs_20161111000536.dat` |

---

## 4. Test cases

Legend: **Result** = Pass / Fail / Blocked / Not Run. Fill **Actual** only if it differs from Expected.

### A. Authentication & provisioning

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| A1 | Provisioned user login | Open app URL as Pooja, complete SSO | Lands in app; name shows top-right | | |
| A2 | Non-provisioned user | Sign in as an email NOT in `users` | "You are not provisioned. Ask your admin." screen | | |
| A3 | Email mismatch | Add a user with a typo'd email, log in with real email | Rejected as not provisioned (no silent pass) | | |
| A4 | No app access | User in `users` but without `CAN USE` on the app | Databricks "Permission Required" screen before app loads | | |

### B. Admin vs non-admin

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| B1 | Admin sees Admin tab | Log in as Pooja | Admin tab visible | | |
| B2 | Non-admin no Admin tab | Log in as Guo | No Admin tab; only Files | | |
| B3 | Admin checkbox accuracy | Admin → Users dropdown | Only true admins ticked (Pooja), others unticked | | |
| B4 | Promote to admin | Toggle Guo → Admin on, Guo re-logs in | Guo now sees Admin tab | | |
| B5 | Demote admin | Toggle Guo → Admin off | Admin tab gone for Guo on next login | | |

### C. Permission enforcement (READ vs DOWNLOAD)

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| C1 | DOWNLOAD folder | Open a DOWNLOAD-granted folder | File list + checkboxes + Download button shown | | |
| C2 | READ folder | Open a READ-granted folder | "Read-only access" banner; no download; lock icons | | |
| C3 | No permission = hidden | User with no grant on a volume | Volume/workspace does not appear at all | | |
| C4 | Preview on READ | Preview a file in a READ folder | CSV/text preview works; still no download | | |

### D. Permission scopes

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| D1 | FOLDER scope | Grant FOLDER on `/flushot/flu_shot_category_ndc/` | Only that folder's files; cannot navigate elsewhere | | |
| D2 | FOLDER_TREE scope | Grant FOLDER_TREE on `/flushot/` | Can open `/flushot/` and navigate into subfolders | | |
| D3 | VOLUME scope (admin) | Grant VOLUME to Pooja on the volume | Browse whole volume from root, into any subfolder | | |
| D4 | Up-navigation bound | In a tree/volume grant, click Up repeatedly | Cannot navigate above the granted root | | |
| D5 | VOLUME admin-only (UI) | Add Permission, select non-admin user | "Whole volume" scope option NOT shown | | |
| D6 | VOLUME admin-only (backend) | Attempt VOLUME grant for non-admin via API | Rejected (403) | | |

### E. Admin management (no SQL)

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| E1 | Add user | + Add User (name, email, non-admin) | User appears; can log in | | |
| E2 | Add workspace | + Add Workspace | Appears in Add Permission dropdown | | |
| E3 | Duplicate workspace | Add same workspace_id twice | Rejected with clear error | | |
| E4 | Add permission | + Add Permission via UI | Row appears; user sees it in Files | | |
| E5 | Edit permission | Change READ↔DOWNLOAD on a row | Takes effect immediately for the user | | |
| E6 | Delete permission | Delete a row | User loses access immediately | | |
| E7 | Injection guard | Put a single quote `'` in a free-text field | Rejected with a 400 message | | |
| E8 | Granted-by name | Inspect permissions table | Shows friendly name (e.g. "Pooja Dusane") | | |

### F. CSV import

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| F1 | Valid CSV | Import well-formed CSV | "Imported N users, M permissions" with correct counts | | |
| F2 | Wrong headers | Import CSV with mis-cased/renamed headers | Imports 0 (documented limitation) — verify counts | | |
| F3 | Auto-create users | CSV with new emails | New users created, existing skipped | | |
| F4 | Scope column | CSV with `scope` col; and one without | Scope respected; missing → defaults FOLDER | | |
| F5 | Re-import | Import the same CSV twice | Upsert — no duplicate rows | | |

### G. Multi-catalog / schema / workspace

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| G1 | Multiple catalogs, one workspace | Grant volumes in 2 catalogs under one workspace | Both appear; each resolves its own path | | |
| G2 | Same volume name, different schema | Two volumes with same name, different schema | Treated as distinct, no collision | | |
| G3 | workspace_id mismatch | permissions.workspace_id ≠ workspaces.workspace_id | Workspace hidden ("No workspaces available") — known gotcha | | |
| G4 | SP missing READ VOLUME | Grant a volume the SP can't read | Folder errors clearly (not a blank hang) | | |

### H. File operations

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| H1 | List files | Open a granted folder | Files list with name + size | | |
| H2 | Preview | Click a CSV/.dat file | First 200 rows shown; truncation notice if longer | | |
| H3 | Single download | Select 1 file, Download | Correct file downloads with correct name | | |
| H4 | Multi / ZIP download | Select multiple, Download | ZIP downloads with all selected files | | |
| H5 | Empty folder | Open a folder with no files | "This folder is empty" message, no crash | | |

### I. Resilience / negative

| ID | Test | Steps | Expected result | Result | Actual / notes |
|----|------|-------|-----------------|--------|----------------|
| I1 | Concurrent admin edits | Two admins edit the users/permissions table at once | No data corruption; conflict handled/retried | | |
| I2 | Session re-auth | Let SSO session expire, act again | Cleanly re-authenticates | | |
| I3 | Metastore boundary | Point at a volume on a different metastore | Cannot access (confirms security boundary) | | |

---

## 5. Execution log — dev run (2026-07-28)

| Case | Tester | Result | Notes |
|------|--------|--------|-------|
| A1 | Pooja | Pass | SSO login working |
| B3 | Pooja | Pass | Fixed — only Pooja ticked after is_admin string bug fix |
| C1 / H1 / H3 | Pooja | Pass | Browsed to `/flushot/flu_shot_category_ndc/`, downloaded the .dat file |
| G3 | Pooja | Pass (after fix) | Hit "No workspaces available" due to workspace_id label vs numeric mismatch; resolved by aligning IDs |
| H3 | Guo Chen | _Not Run_ | Guo to test non-admin download and report |

_(Add rows as more cases are executed.)_

---

## 6. Defects found & resolved during testing

| # | Defect | Severity | Status | Fix |
|---|--------|----------|--------|-----|
| 1 | All admin checkboxes ticked regardless of real value | Medium | Fixed | `is_admin` string `"false"` is truthy; added `isAdmin()` normalizer (commit `bf46d24`) |
| 2 | `p.uc_catalog cannot be resolved` after schema change | High | Fixed | DB still on old schema; recreated permissions table with `uc_catalog`/`uc_schema` |
| 3 | `scope cannot be resolved` after scope deploy | High | Fixed | `ALTER TABLE ... ADD COLUMN scope STRING` + backfill `'FOLDER'` |
| 4 | Volume-card folder path overflowed / clipped into badge | Low | Fixed | flex + ellipsis layout (commit `bf46d24`) |
| 5 | "No workspaces available" | High | Fixed | workspace_id mismatch between permissions and workspaces tables |
| 6 | CSV import imported 0 | Medium | Fixed | Header names must match exactly (documented) |

---

## 7. Sign-off

| Role | Name | Result (Pass / Pass w/ notes / Fail) | Date | Signature |
|------|------|--------------------------------------|------|-----------|
| Tester (admin) | Pooja Dusane | | | |
| Tester (end user) | Guo Chen | | | |
| Approver | | | | |

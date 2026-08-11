# Walgreens File Download — Deployment Runbook

Deploying the Walgreens File Download app to an environment (dev / test / prod)
using Databricks Asset Bundles (DABs). The same code deploys to every
environment; only per-environment configuration changes.

**Deployment model:** one app per environment, deployed **in that environment's
workspace**. Unity Catalog catalogs are isolated per workspace, so each
environment has its own app instance, its own service principal, and its own
grants. Promotion = running the same bundle against the next target.

Throughout this runbook, **dev** is the worked example. For **test** and
**prod**, use the same steps with that environment's own values.

---

## 1. Prerequisites (provided by the Walgreens platform team, per environment)

| Item | Purpose | Example (dev) |
|------|---------|---------------|
| Workspace host URL | Target workspace | `https://adb-2596972336492633.13.azuredatabricks.net` |
| Config catalog + schema | Holds the app's config tables | `dlx_platform_dev.access_metadata` |
| External-location path (`abfss://`) | Where the config tables physically live (tables are EXTERNAL) | `abfss://access-metadata@dlxdevplatfmetadatasa10.dfs.core.windows.net` |
| SQL warehouse id | App reads/writes config tables | `41d8b422559d6cb1` |
| `CAN_MANAGE` on `/Workspace/dlx-databricks/Resources/Apps/` | So the deploy can create the app folder | granted to the deployer |
| Data-volume grants for the app SP | App reads the files users download | `READ VOLUME` on the data schema(s) |

**Access model:** end users reach the app and download files via their Azure AD
group (Consumer access on the workspace, no workspace login required). The app's
service principal is the only identity that touches the volumes.

---

## 2. Configure `databricks.yml` for the environment

Each environment is a `target` block in `databricks.yml`. Set that target's
values; the app code never changes between environments. Dev is shown below —
`test:` and `prod:` are identical in shape, each with its own values.

```yaml
targets:
  dev:
    workspace:
      host: https://adb-2596972336492633.13.azuredatabricks.net
      root_path: /Workspace/dlx-databricks/Resources/Apps/${bundle.name}/${bundle.target}
    variables:
      app_catalog: dlx_platform_dev
      app_schema: access_metadata
      warehouse_id: 41d8b422559d6cb1
      ext_location: abfss://access-metadata@dlxdevplatfmetadatasa10.dfs.core.windows.net
      admin_email: pooja.dusane@walgreens.com
      admin_name: Pooja Dusane
      jwt_secret_scope: wagfiledownload-dev
      jwt_secret_key: jwt_secret
  # test: and prod: same shape — set each block's own host, app_catalog,
  # warehouse_id, ext_location, admin_email, and jwt_secret_scope
  # (wagfiledownload-test / wagfiledownload-prod).
```

`JWT_SECRET` itself is **never** in this file — only the secret-scope **name**
appears here; the value lives in the secret scope (created in step 3) and is
injected at runtime by the bundle.

---

## 3. One-time setup per environment

Run on the Walgreens VDI, signed in via SSO (`databricks auth login`).

**a. Create the JWT secret scope + secret**
```
databricks secrets create-scope wagfiledownload-dev
python -c "import secrets; print(secrets.token_urlsafe(48))"   # copy the output
databricks secrets put-secret wagfiledownload-dev jwt_secret   # paste it when prompted
```
In test / prod, replace `dev` with `test` / `prod` (scope `wagfiledownload-test`
/ `wagfiledownload-prod`).

**b. Create the config tables** (EXTERNAL Delta tables — the bundle job uses this
target's catalog / schema / external-location path automatically):
```
databricks bundle run setup_download_tables -t dev
```
This creates `download_workspaces`, `download_user`, `download_permissions` and
seeds the first admin (from the target's `admin_email`).

**c. Grant the app's service principal access** (dev SP shown; in test / prod
replace the config catalog `dlx_platform_dev`, the data catalog/schema
`dlx_dev.ext_vols`, and the app SP id with that environment's values):
```sql
GRANT USE CATALOG ON CATALOG dlx_platform_dev TO `08b9cbd6-836a-402c-8805-e13141c85f02`;
GRANT USE SCHEMA, SELECT, MODIFY ON SCHEMA dlx_platform_dev.access_metadata TO `08b9cbd6-836a-402c-8805-e13141c85f02`;
GRANT USE CATALOG ON CATALOG dlx_dev TO `08b9cbd6-836a-402c-8805-e13141c85f02`;
GRANT USE SCHEMA, READ VOLUME ON SCHEMA dlx_dev.ext_vols TO `08b9cbd6-836a-402c-8805-e13141c85f02`;
```
`READ` on the JWT secret scope is granted automatically by the bundle's secret
resource — no separate command needed.

---

## 4. Deploy

Run on the Walgreens VDI:
```
databricks auth login
databricks bundle validate -t dev              # checks config, changes nothing
databricks bundle deploy   -t dev              # create/update the app + upload code
databricks bundle run  file_transfer -t dev    # start the app
```
`-t <env>` selects the target (`dev` / `test` / `prod`); each target supplies its
own host, catalog, schema, warehouse, external-location, and secret scope from
`databricks.yml`. The app code is identical across environments.

---

## 5. What changes per environment

Everything environment-specific is a per-target value in `databricks.yml`. The
only secret (`JWT_SECRET`) comes from a secret scope and is never committed.

| Parameter | Source |
|-----------|--------|
| Workspace host | `targets.<env>.workspace.host` |
| `APP_CATALOG` / `APP_SCHEMA` | `targets.<env>.variables` |
| `WAREHOUSE_ID` | `targets.<env>.variables` |
| `ext_location` (config-table ADLS path) | `targets.<env>.variables` |
| `JWT_SECRET` | secret scope (`wagfiledownload-<env>`), via the bundle |
| App-SP data grants | granted in that env's workspace |

---

## 6. Group-removal timing (production behavior)

The app resolves a user's AD group membership at login (via SCIM) and caches it
in a short-lived token (10 minutes). Databricks' identity sync (AIM) refreshes
group membership on its own schedule (up to ~40 minutes on non-interactive
paths). **Effective removal delay ≈ up to ~40 minutes** once a user is removed
from an AD group. This is governed by Databricks identity sync, not the app.
There is no app-side access list — Azure AD is the single source of truth.

---

## 7. Open items to confirm with Walgreens (per environment)

1. Workspace host, config catalog + schema, and SQL warehouse id.
2. External-location (`abfss://`) path for the config tables.
3. `CAN_MANAGE` on `/Workspace/dlx-databricks/Resources/Apps/` for the deployer.
4. Approval flow for granting the app SP `READ VOLUME` on data volumes.
5. (Optional, future) a dedicated deploy service principal, if deployment is
   moved off interactive VDI login into an automated pipeline.

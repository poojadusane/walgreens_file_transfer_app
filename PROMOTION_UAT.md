# Walgreens File Download — Deployment Runbook

Deploying the Walgreens File Download app to an environment (dev / test / UAT /
prod) using Databricks Asset Bundles (DABs). The same code deploys to every
environment; only per-environment configuration changes.

**Deployment model:** one app per environment, deployed **in that environment's
workspace**. Unity Catalog catalogs are isolated per workspace, so each
environment has its own app instance, its own service principal, and its own
grants. Promotion = running the same bundle against the next target.

---

## 1. Prerequisites (provided by the Walgreens platform team, per environment)

| Item | Purpose | Example (dev) |
|------|---------|---------------|
| Workspace host URL | Target workspace | `https://adb-2596972336492633.13.azuredatabricks.net` |
| Config catalog + schema | Holds the app's config tables | `dlx_platform_dev.access_metadata` |
| External-location path (`abfss://`) | Where the config tables physically live (tables are EXTERNAL) | `abfss://access-metadata@dlxdevplatfmetadatasa10.dfs.core.windows.net` |
| SQL warehouse id | App reads/writes config tables | *(dev warehouse id)* |
| `CAN_MANAGE` on `/Workspace/dlx-databricks/Resources/Apps/` | So the deploy can create the app folder | granted to the deployer |
| Secret scope for `JWT_SECRET` | Holds the app's token-signing secret | e.g. `wft-dev` |
| Data-volume grants for the app SP | App reads the files users download | `READ VOLUME` on the data schema(s) |

**Access model reminder:** end users reach the app and download files via their
**Azure AD group** (Consumer access on the workspace, no workspace login
required). The app's service principal is the only identity that touches the
volumes.

---

## 2. One-time setup per environment

Run on the Walgreens VDI, signed in via SSO (`databricks auth login`).

**a. Create the JWT secret scope + secret**
```
databricks secrets create-scope <scope-name>
databricks secrets put-secret <scope-name> jwt_secret
# paste a long random string when prompted (any 32+ char random value)
```

**b. Create the config tables** (EXTERNAL Delta tables, created by the bundle job
which auto-uses this target's catalog/schema/path):
```
databricks bundle run setup_download_tables -t <env>
```
This creates `download_workspaces`, `download_user`, `download_permissions` and
seeds the first admin (from the target's `admin_email`).

**c. Grant the app's service principal access**
- `SELECT`, `MODIFY` on the config schema (read/write the config tables).
- `READ VOLUME` on each data schema whose volumes the app serves.
- `READ` on the JWT secret scope (granted automatically via the bundle's secret
  resource).

---

## 3. Deploy

Run on the Walgreens VDI:
```
databricks auth login
databricks bundle validate -t <env>          # fail fast on config errors
databricks bundle deploy   -t <env>          # create/update the app + upload code
databricks bundle run  file_download -t <env>  # start the app
```
`-t <env>` selects the target (`dev` / `test` / `uat` / `prod`); each target
supplies its own host, catalog, schema, warehouse, external-location, and secret
scope from `databricks.yml`. The app code (`main.py`) is identical across
environments.

---

## 4. What changes per environment

Everything environment-specific is a per-target value in `databricks.yml`. The
only secret (`JWT_SECRET`) comes from a secret scope and is never committed.

| Parameter | Source |
|-----------|--------|
| Workspace host | `targets.<env>.workspace.host` |
| `APP_CATALOG` / `APP_SCHEMA` | `targets.<env>.variables` |
| `WAREHOUSE_ID` | `targets.<env>.variables` |
| `ext_location` (config-table ADLS path) | `targets.<env>.variables` |
| `JWT_SECRET` | secret scope, via `valueFrom` |
| App-SP data grants | granted in that env's workspace |

---

## 5. Group-removal timing (production behavior)

The app resolves a user's AD group membership at login (via SCIM) and caches it
in a short-lived token (10 minutes). Databricks' identity sync (AIM) refreshes
group membership on its own schedule (up to ~40 minutes on non-interactive
paths). **Effective removal delay ≈ up to ~40 minutes** once a user is removed
from an AD group. This is governed by Databricks identity sync, not the app.
There is no app-side access list — Azure AD is the single source of truth.

---

## 6. Open items to confirm with Walgreens (per environment)

1. Workspace host, config catalog + schema, and SQL warehouse id.
2. External-location (`abfss://`) path for the config tables.
3. `CAN_MANAGE` on `/Workspace/dlx-databricks/Resources/Apps/` for the deployer.
4. Secret scope name for `JWT_SECRET`.
5. Approval flow for granting the app SP `READ VOLUME` on data volumes.
6. (Optional, future) a dedicated deploy service principal, if deployment is
   moved off interactive VDI login into an automated pipeline.

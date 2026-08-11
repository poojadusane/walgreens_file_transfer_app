# Databricks notebook source
# =============================================================================
# Walgreens File Download — config-table setup (parameterized, per-target)
# =============================================================================
# Creates the 3 config tables as EXTERNAL Delta tables at the target's ADLS
# path. Managed tables are blocked by the storage firewall in these
# environments, so EXTERNAL + LOCATION is required.
#
# Run via the bundle so each environment auto-supplies its own values:
#   databricks bundle run setup_download_tables -t dev
#   databricks bundle run setup_download_tables -t test
# The -t <target> flag selects the target whose variables (catalog, schema,
# ext_location, admin_*) are injected as job parameters below — the test path
# can never be picked for dev, because the target drives every value.
#
# Parameters (job parameters -> widgets):
#   catalog       config catalog        (e.g. dlx_platform_dev)
#   schema        config schema         (e.g. access_metadata)
#   ext_location  abfss:// base path    (tables are created at <ext_location>/<table>)
#   admin_email   first admin's SSO email (bootstrap; required to log in)
#   admin_name    first admin's display name
# =============================================================================

dbutils.widgets.text("catalog", "")
dbutils.widgets.text("schema", "")
dbutils.widgets.text("ext_location", "")
dbutils.widgets.text("admin_email", "")
dbutils.widgets.text("admin_name", "")

catalog      = dbutils.widgets.get("catalog").strip()
schema       = dbutils.widgets.get("schema").strip()
ext_location = dbutils.widgets.get("ext_location").strip().rstrip("/")
admin_email  = dbutils.widgets.get("admin_email").strip()
admin_name   = dbutils.widgets.get("admin_name").strip() or admin_email

for name, val in [("catalog", catalog), ("schema", schema), ("ext_location", ext_location)]:
    if not val:
        raise ValueError(f"Missing required parameter: {name}")

fq = f"{catalog}.{schema}"
print(f"Creating config tables in {fq} at {ext_location}/")

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")

# ── download_workspaces ──────────────────────────────────────────────────────
# One row per Databricks workspace (helps distinguish dev/test/prod + groups
# volumes in the UI).
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {fq}.download_workspaces (
  workspace_id STRING,
  display_name STRING,
  host_url     STRING
)
USING DELTA
LOCATION '{ext_location}/download_workspaces'
""")

# ── download_user ────────────────────────────────────────────────────────────
# ADMIN LIST ONLY. A row here with is_admin=true grants admin rights in the app.
# Regular end-user access is by AD group (download_permissions), not this table.
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {fq}.download_user (
  user_id        STRING,
  display_name   STRING,
  databricks_upn STRING,
  is_admin       BOOLEAN
)
USING DELTA
LOCATION '{ext_location}/download_user'
""")

# ── download_permissions ─────────────────────────────────────────────────────
# One row per grant. principal_type = 'USER' (principal_id = email) or 'GROUP'
# (principal_id = AD group display name). COLUMN ORDER IS LOAD-BEARING — the app
# inserts positionally in this exact order.
spark.sql(f"""
CREATE TABLE IF NOT EXISTS {fq}.download_permissions (
  principal_type STRING,
  principal_id   STRING,
  workspace_id   STRING,
  uc_catalog     STRING,
  uc_schema      STRING,
  volume         STRING,
  folder_path    STRING,
  permission     STRING,
  granted_by     STRING,
  granted_at     TIMESTAMP,
  scope          STRING
)
USING DELTA
LOCATION '{ext_location}/download_permissions'
""")

# ── bootstrap first admin ────────────────────────────────────────────────────
# Required so someone can log in as admin. Idempotent: only inserts if absent.
if admin_email:
    existing = spark.sql(
        f"SELECT 1 FROM {fq}.download_user WHERE databricks_upn = '{admin_email}'"
    ).count()
    if existing == 0:
        uid = admin_email.split("@")[0].replace(".", "_").replace("-", "_")
        spark.sql(f"""
        INSERT INTO {fq}.download_user VALUES
          ('{uid}', '{admin_name}', '{admin_email}', true)
        """)
        print(f"Seeded admin: {admin_email}")
    else:
        print(f"Admin already present: {admin_email}")
else:
    print("No admin_email provided — remember to seed an admin before opening the app.")

print("Setup complete.")

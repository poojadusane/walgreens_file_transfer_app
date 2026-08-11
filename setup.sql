-- Walgreens File Download — config tables (MANUAL FALLBACK)
-- =============================================================================
-- PRIMARY setup is the parameterized bundle job (recommended):
--     databricks bundle run setup_download_tables -t <env>
--   which runs setup/create_tables.py and picks each env's catalog / schema /
--   external-location path automatically from databricks.yml.
--
-- This .sql file is a MANUAL fallback for running the same DDL by hand in the
-- SQL editor. Replace the THREE placeholders first (Find & Replace):
--     <APP_CATALOG>   -> config catalog   (e.g. dlx_platform_dev)
--     <APP_SCHEMA>    -> config schema    (e.g. access_metadata)
--     <EXT_LOCATION>  -> abfss:// base    (e.g. abfss://access-metadata@dlxdevplatfmetadatasa10.dfs.core.windows.net)
--
-- Tables are EXTERNAL (LOCATION ...): managed tables are blocked by the storage
-- firewall in these environments. Run as an identity that can write to the ADLS
-- path, then grant the app's service principal SELECT/MODIFY on the schema.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS <APP_CATALOG>.<APP_SCHEMA>;

-- ── download_workspaces ──────────────────────────────────────────────────────
-- One row per Databricks workspace (helps distinguish dev/test/prod, groups volumes).
CREATE TABLE IF NOT EXISTS <APP_CATALOG>.<APP_SCHEMA>.download_workspaces (
  workspace_id STRING,
  display_name STRING,
  host_url     STRING
)
USING DELTA
LOCATION '<EXT_LOCATION>/download_workspaces';

-- ── download_user ────────────────────────────────────────────────────────────
-- ADMIN LIST ONLY. is_admin=true grants admin rights in the app. Regular
-- end-user access is by AD group (see download_permissions), not this table.
CREATE TABLE IF NOT EXISTS <APP_CATALOG>.<APP_SCHEMA>.download_user (
  user_id        STRING,
  display_name   STRING,
  databricks_upn STRING,
  is_admin       BOOLEAN
)
USING DELTA
LOCATION '<EXT_LOCATION>/download_user';

-- ── download_permissions ─────────────────────────────────────────────────────
-- One row per grant. principal_type = 'USER' (principal_id = email) or 'GROUP'
-- (principal_id = AD group display name). COLUMN ORDER IS LOAD-BEARING — the app
-- inserts positionally in this exact order. permission is 'READ' or 'DOWNLOAD';
-- scope is 'VOLUME' (admin/USER only) | 'FOLDER_TREE' | 'FOLDER'.
CREATE TABLE IF NOT EXISTS <APP_CATALOG>.<APP_SCHEMA>.download_permissions (
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
LOCATION '<EXT_LOCATION>/download_permissions';

-- ── FIRST ADMIN (required) ──────────────────────────────────────────────────
-- Insert at least one admin before opening the app. databricks_upn must match
-- the SSO email exactly.
-- INSERT INTO <APP_CATALOG>.<APP_SCHEMA>.download_user
--   (user_id, display_name, databricks_upn, is_admin) VALUES
--   ('<your_user_id>', '<Your Name>', '<you@walgreens.com>', true);

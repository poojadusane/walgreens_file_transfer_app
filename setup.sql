-- Walgreens File Transfer — setup / reseed
-- =============================================================================
-- BEFORE RUNNING: replace TWO placeholders below with the values you set in
-- app.yaml (use Find & Replace, Ctrl+H):
--   <APP_CATALOG>  -> your catalog   (e.g. dlx_platform_dev)
--   <APP_SCHEMA>   -> your schema    (e.g. access_metadata; default is 'config')
--
-- This is a WIPE & RESEED script: it DROPs and recreates the 3 config tables,
-- clearing any existing users / workspaces / permissions. Comment out the DROP
-- lines if you need to preserve existing data.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS <APP_CATALOG>.<APP_SCHEMA>;

-- ── workspaces ────────────────────────────────────────────────────────────────
-- One row per real Databricks workspace you want to group volumes under.
-- Catalog/schema are NOT stored here — each permission row carries its own
-- catalog + schema, so one workspace can expose volumes from many catalogs and
-- many schemas.
DROP TABLE IF EXISTS <APP_CATALOG>.<APP_SCHEMA>.workspaces;
CREATE TABLE <APP_CATALOG>.<APP_SCHEMA>.workspaces (
  workspace_id STRING,   -- the real Databricks workspace id (e.g. 5346339970823458)
  display_name STRING,   -- friendly name shown in the UI
  host_url     STRING    -- e.g. https://adb-<id>.<n>.azuredatabricks.net
);

-- ── users ─────────────────────────────────────────────────────────────────────
-- One row per person who can access the app.
-- databricks_upn must match their Azure AD SSO email exactly.
DROP TABLE IF EXISTS <APP_CATALOG>.<APP_SCHEMA>.users;
CREATE TABLE <APP_CATALOG>.<APP_SCHEMA>.users (
  user_id        STRING,
  display_name   STRING,
  databricks_upn STRING,
  is_admin       BOOLEAN
);

-- ── permissions ───────────────────────────────────────────────────────────────
-- One row per (principal, workspace, catalog, schema, volume, folder) grant.
-- A grant can be to a USER or to an AD GROUP:
--   principal_type = 'USER'  -> principal_id is the users.user_id
--   principal_type = 'GROUP' -> principal_id is the AD group display name
-- At login the app resolves the caller's own group memberships and matches any
-- grant whose principal is the user OR one of their groups.
-- uc_catalog / uc_schema pin down where the volume lives (one workspace can span
-- multiple catalogs/schemas). COLUMN ORDER IS LOAD-BEARING: the app inserts
-- positionally in this exact order. permission is 'READ' or 'DOWNLOAD'.
DROP TABLE IF EXISTS <APP_CATALOG>.<APP_SCHEMA>.permissions;
CREATE TABLE <APP_CATALOG>.<APP_SCHEMA>.permissions (
  principal_type STRING,     -- 'USER' or 'GROUP'
  principal_id   STRING,     -- users.user_id (USER) or AD group display name (GROUP)
  workspace_id STRING,
  uc_catalog   STRING,
  uc_schema    STRING,
  volume       STRING,
  folder_path  STRING,
  permission   STRING,      -- 'READ' or 'DOWNLOAD'
  granted_by   STRING,
  granted_at   TIMESTAMP,
  scope        STRING       -- 'VOLUME' (admin only, USER only) | 'FOLDER_TREE'
                            -- (folder + everything under it) | 'FOLDER' (just this folder's files)
);

-- ── FIRST ADMIN (required) ──────────────────────────────────────────────────
-- You must insert at least one admin before opening the app, or no one can log
-- in. Replace the values with your own. user_id can be any unique string
-- (your Databricks numeric id is a good choice); databricks_upn must match your
-- SSO email exactly; is_admin must be true.
--
-- INSERT INTO <APP_CATALOG>.<APP_SCHEMA>.users
--   (user_id, display_name, databricks_upn, is_admin) VALUES
--   ('<your_user_id>', '<Your Name>', '<you@company.com>', true);
--
-- Everything else (workspaces, more users, permissions) can be added from the
-- app's Admin page or via CSV import — no SQL needed after this.

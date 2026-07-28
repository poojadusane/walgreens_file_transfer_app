-- Walgreens File Transfer — setup / reseed
-- =============================================================================
-- BEFORE RUNNING: replace the placeholder <APP_CATALOG> everywhere below with
-- the catalog name you set as APP_CATALOG in app.yaml. Use Find & Replace
-- (Ctrl+H) on <APP_CATALOG>. The schema must always stay literally `config`
-- (the app hard-codes that part).
--
-- This is a WIPE & RESEED script: it DROPs and recreates the 3 config tables,
-- clearing any existing users / workspaces / permissions. Comment out the DROP
-- lines if you need to preserve existing data.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS <APP_CATALOG>.config;

-- ── workspaces ────────────────────────────────────────────────────────────────
-- One row per real Databricks workspace you want to group volumes under.
-- Catalog/schema are NOT stored here — each permission row carries its own
-- catalog + schema, so one workspace can expose volumes from many catalogs and
-- many schemas.
DROP TABLE IF EXISTS <APP_CATALOG>.config.workspaces;
CREATE TABLE <APP_CATALOG>.config.workspaces (
  workspace_id STRING,   -- the real Databricks workspace id (e.g. 5346339970823458)
  display_name STRING,   -- friendly name shown in the UI
  host_url     STRING    -- e.g. https://adb-<id>.<n>.azuredatabricks.net
);

-- ── users ─────────────────────────────────────────────────────────────────────
-- One row per person who can access the app.
-- databricks_upn must match their Azure AD SSO email exactly.
DROP TABLE IF EXISTS <APP_CATALOG>.config.users;
CREATE TABLE <APP_CATALOG>.config.users (
  user_id        STRING,
  display_name   STRING,
  databricks_upn STRING,
  is_admin       BOOLEAN
);

-- ── permissions ───────────────────────────────────────────────────────────────
-- One row per (user, workspace, catalog, schema, volume, folder) grant.
-- uc_catalog / uc_schema pin down exactly where the volume lives, so a single
-- workspace can span multiple catalogs and schemas.
-- COLUMN ORDER IS LOAD-BEARING: the app inserts positionally in this exact order.
-- permission is 'READ' (view only) or 'DOWNLOAD' (can download files).
DROP TABLE IF EXISTS <APP_CATALOG>.config.permissions;
CREATE TABLE <APP_CATALOG>.config.permissions (
  user_id      STRING,
  workspace_id STRING,
  uc_catalog   STRING,
  uc_schema    STRING,
  volume       STRING,
  folder_path  STRING,
  permission   STRING,      -- 'READ' or 'DOWNLOAD'
  granted_by   STRING,
  granted_at   TIMESTAMP,
  scope        STRING       -- 'VOLUME' (admin only, whole volume) | 'FOLDER_TREE'
                            -- (folder + everything under it) | 'FOLDER' (just this folder's files)
);

-- ── FIRST ADMIN (required) ──────────────────────────────────────────────────
-- You must insert at least one admin before opening the app, or no one can log
-- in. Replace the values with your own. user_id can be any unique string
-- (your Databricks numeric id is a good choice); databricks_upn must match your
-- SSO email exactly; is_admin must be true.
--
-- INSERT INTO <APP_CATALOG>.config.users
--   (user_id, display_name, databricks_upn, is_admin) VALUES
--   ('<your_user_id>', '<Your Name>', '<you@company.com>', true);
--
-- Everything else (workspaces, more users, permissions) can be added from the
-- app's Admin page or via CSV import — no SQL needed after this.

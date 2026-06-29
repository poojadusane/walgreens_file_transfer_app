-- Walgreens File Transfer — one-time setup
-- Run this in any Databricks SQL editor against your Unity Catalog metastore.
-- Replace 'wag_file_transfer' with your chosen catalog name, then set the same
-- value as APP_CATALOG in app.yaml before deploying.

CREATE CATALOG IF NOT EXISTS wag_file_transfer;
CREATE SCHEMA  IF NOT EXISTS wag_file_transfer.config;

-- Workspaces: one row per Databricks workspace whose volumes you want to expose.
-- uc_catalog / uc_schema point to where the volumes live in Unity Catalog.
CREATE TABLE IF NOT EXISTS wag_file_transfer.config.workspaces (
  workspace_id STRING,   -- short logical ID referenced in the permissions table
  display_name STRING,   -- shown in the workspace dropdown
  host_url     STRING,   -- e.g. https://adb-1234567890.12.azuredatabricks.net
  uc_catalog   STRING,   -- UC catalog that contains the volumes
  uc_schema    STRING    -- schema within that catalog
);

-- Users: one row per person who should be able to access the app.
-- databricks_upn must match their Azure AD UPN exactly (e.g. jane.doe@walgreens.com).
CREATE TABLE IF NOT EXISTS wag_file_transfer.config.users (
  user_id        STRING,
  display_name   STRING,
  databricks_upn STRING,
  is_admin       BOOLEAN DEFAULT false
);

-- Permissions: one row per (user, workspace, volume, folder) combination.
-- permission is 'READ' (view only) or 'DOWNLOAD' (can download files).
CREATE TABLE IF NOT EXISTS wag_file_transfer.config.permissions (
  user_id      STRING,
  workspace_id STRING,
  volume       STRING,
  folder_path  STRING,
  permission   STRING,
  granted_by   STRING,
  granted_at   TIMESTAMP
);

-- FIRST ADMIN: insert yourself before opening the app for the first time.
-- Without this row no one can log in (the app requires a provisioned admin).
-- Uncomment and fill in your details:
--
-- INSERT INTO wag_file_transfer.config.users VALUES
--   ('admin', 'Your Name', 'you@walgreens.com', true);

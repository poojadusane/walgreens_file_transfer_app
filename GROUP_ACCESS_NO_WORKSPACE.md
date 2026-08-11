# Group-Based App Access WITHOUT Workspace Access — Validated Recipe

**Goal:** end users access the File Transfer app and download files via their
**Azure AD group**, with **no Databricks workspace access** (Walgreens hard
requirement). Validated on the Walgreens dlx-dev workspace (AIM environment),
2026-08-10.

## The key finding

An AD group can be added to a workspace with:
- **Consumer access: ON** (lets members use Databricks Apps)
- **Workspace access: OFF** (members CANNOT log into the Databricks workspace)

This is the entitlement combination that makes it work. Confirmed settable on
`role-dna-analytics-download` in the real Walgreens dlx-dev workspace.

> Caveat encountered: the Workspace-access entitlement initially showed as
> "inherited from a parent group and cannot be updated here" (with an empty
> Parent groups tab — the parent is an Entra/AD-side construct under AIM). A
> workspace admin (Stephen) was able to set it to Consumer-ON / Workspace-OFF.
> So this may require the right admin to set the entitlement at the level that
> controls it; it is not always freely editable on the group directly.

## The onboarding recipe (per AD group)

1. **Add the AD group to the workspace** with **Consumer access ON, Workspace
   access OFF** (Settings → Identity and access → Groups → group → Entitlements).
   Workspace admin action; may need to be set where the entitlement is controlled.
2. **Grant the group "Can Use" on the app** (app → Share).
3. **Add a permission row** for the group in the app's `permissions` table
   (principal_type='GROUP', principal_id=<group display name>, + volume/folder/
   READ|DOWNLOAD/scope).
4. **App SP needs `READ VOLUME`** on the data schema/volume (schema-level grant
   covers all volumes).

That's it — no per-user setup, no per-user workspace access, no account SP.

## How access resolves at login (why it works)

- User opens the app (allowed by Consumer access + Can Use).
- App reads the user's forwarded token → SCIM `/Me` → returns the user's groups
  (including AD groups they belong to, even with Workspace access OFF).
- App matches those groups against the `permissions` table → shows only granted
  folders. Files are fetched by the app's service principal.

## Entitlement layers (mental model)

| Layer | Controls | Needed for end user? |
|-------|----------|----------------------|
| Consumer access | Use Databricks Apps | ✅ Yes (on the group) |
| Workspace access | Log into the Databricks workspace | ❌ No — kept OFF |
| App "Can Use" | Open this specific app | ✅ Yes (group granted) |
| UC READ VOLUME | App SP reads the files | ✅ On the app SP, not the user |

## End-to-end test (real user, no workspace access)

1. **App opens, workspace does not:** user opens the app URL (works); tries the
   workspace URL (denied) → proves app access without Databricks access.
2. **Groups resolve:** user hits `/api/debug/whoami` → `resolved_groups` contains
   the AD group, `scim_error: null` (no 403).
3. **Browse + download:** Files tab → granted folder → download works.

## Prerequisites / caveats to confirm per environment

- **Consumer access** entitlement must be available/enabled in the account
  (it was in both the test account and Walgreens dlx-dev).
- Entitlement may be **inherited** (AIM/Entra nesting) — a workspace admin may
  need to set it at the controlling level.
- Each environment (dev/test/prod) is a separate app deployment in its own
  workspace, with its own SP `READ VOLUME` grants (catalogs are ISOLATED).
- App SP `READ VOLUME` is still required on each data schema/volume.

## Status
Entitlement combination proven settable on Walgreens dlx-dev
(`role-dna-analytics-download`: Consumer ON / Workspace OFF). Final end-to-end
confirmation = a group member (Sushma) completing the 3-step test above.

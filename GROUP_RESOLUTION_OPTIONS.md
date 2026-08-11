# Group Resolution — Design Decision for Walgreens Security/Platform Review

## The requirement

End users (~1000, e.g. pharmacy/analytics staff) must download files through the
Walgreens File Transfer app **without being given any Databricks workspace or
account access**. Access is granted to their **Azure AD group**; the app must
determine, at login, which groups the user belongs to, then show only the
folders those groups are granted.

The app already: authenticates users via SSO (`X-Forwarded-Email`), gates app
entry via the AD group's "Can Use" grant, reads files via the app's **workspace
service principal**, and stores per-group folder grants in a Delta table. The
one open question is **how the app resolves a user's group memberships** — and
it must work for users who have **no Databricks access at all**.

## What we proved by testing (evidence, not assumption)

- The app resolves groups today by calling SCIM `/Me` with the **user's own
  forwarded token**.
- For a user **with** workspace access (e.g. an engineer): works — returns all
  their groups.
- For an **app-only user with no workspace access** (the real target
  population): SCIM `/Me` returned **403 Forbidden** → zero groups → no access.
  It only started working after that user's AD group was **assigned to the
  workspace**.
- Conclusion: **the current user-token design does NOT meet the "no workspace
  access" requirement** on its own. Something must resolve groups on the user's
  behalf. Two viable options follow.

---

## Option A — Assign each exposed AD group to the app's workspace

Keep the current design (user token resolves own groups), and make it work for
app-only users by **assigning each granted AD group to the app's workspace**
(a workspace-admin action). Once assigned, AIM provisions members on login and
SCIM `/Me` returns their groups — verified: this is what unblocked the app-only
test user.

**Pros**
- **No account-level service principal.** No account-admin dependency.
- **No standing account-directory credential** to secure/rotate/defend.
- **Smallest security surface** — nothing can read the account-wide directory.
- Workspace-admin action only (lower approval bar than account admin).
- Per environment, self-contained (dev groups → dev workspace, etc.).

**Cons**
- **One setup step per AD group** you expose (assign group → workspace). Ongoing
  operational task as new groups are onboarded.
- Assigning a group to the workspace is itself a (small) access change — the
  group gains a workspace presence (though not data access; data is still
  gated by the app + UC grants).
- Doesn't scale as elegantly if there are many distinct groups.

**Security posture:** minimal. No credential can enumerate the org directory.
Blast radius of an app compromise stays within that workspace's already-granted
scope.

---

## Option B — Dedicated account-level service principal reads the directory

Introduce a separate **account-level OAuth service principal** (client_id +
secret, authenticates to `accounts.azuredatabricks.net`). The app uses it to
look up any user's groups by email via account SCIM. Confirmed necessary detail:
a **workspace** SP (like the app's built-in one) **cannot** authenticate to the
account API — it must be an account-level SP. This is an **account-admin**
action to create + grant.

**Pros**
- **Zero per-group workspace steps.** Groups need only "Can Use" + a grant row.
- Resolves any user's groups directly from the account directory (where AIM
  already holds all memberships) — works for fully app-only users.
- Scales cleanly to many groups / 1000s of users with no per-group admin work.

**Cons / caveats (the security review points)**
- **Broad read.** An account SP with identity-read can read the **entire
  account directory** — every user, group, and membership org-wide, not just
  this app's groups. SCIM user/group read is **not** environment- or
  group-scopable in a way that cleanly limits it to "just our groups" for a
  **by-user** lookup (Group Manager may not satisfy a user-centric query —
  unverified; likely needs broader identity read).
- **Standing secret.** The SP's client secret lives in app config; if leaked,
  it enumerates the org directory. Must be in a **secret scope**, rotated.
- **Cross-environment blast radius:** 
  - *One shared SP across dev/UAT/prod* = convenient, but its secret sits in the
    **least-hardened (dev)** app too; a dev compromise exposes an account-wide
    directory credential usable everywhere. **Not recommended for PHI.**
  - *One SP per environment* = contains where the secret lives, but **each still
    reads the whole account directory** (directory read is global). Limits
    secret exposure, not read scope.
- **Account-admin dependency** to create the SP and grant the role — a higher
  approval bar, and a credential a security team must formally sign off on.
- **Directory read on every login** (cached in the app token ~4h) — confirm no
  rate-limit/logging concerns at scale.

**Security posture:** a single (or per-env) credential capable of reading the
entire Databricks account directory. Defensible only with vaulted secret,
rotation, per-env isolation, and least-role — and even then it's a meaningfully
larger surface than Option A.

---

## Honest recommendation & how to decide with minimal risk

- If the number of exposed AD groups is **small/stable** → **Option A** is
  simpler, safer, and avoids the account-admin ask entirely. Recommended unless
  group volume makes the per-group step impractical.
- If there will be **many groups / high churn** and the per-group workspace step
  is operationally unacceptable → **Option B**, but only with: per-environment
  SPs, secret in a scope, rotation, and the narrowest role that still answers a
  by-email lookup.

**De-risking Option B before committing:** do NOT request a permanent/prod
account SP up front. Ask for a **time-boxed, dev-only, narrowly-scoped** account
SP as a proof-of-concept, then validate with a single CLI probe (no app code, no
prod, no end users):
```
export DATABRICKS_HOST=https://accounts.azuredatabricks.net
export DATABRICKS_ACCOUNT_ID=<account_id>
export DATABRICKS_CLIENT_ID=<sp_client_id>
export DATABRICKS_CLIENT_SECRET=<sp_secret>
databricks account users list --filter "userName eq 'someone@walgreens.com'"
```
If it returns the user with a populated `groups` array → the approach is proven
for app-only users. If `groups` is empty or 403 → the grant is insufficient, and
you learned that on a throwaway credential.

## Question for the Walgreens security/platform team
Which do you prefer given our PHI posture:
1. **Option A** — per-group workspace assignment, no account credential; or
2. **Option B** — a scoped account-level directory-reader SP (and if so:
   per-environment SPs, and what is the minimum role that answers a by-email
   group lookup)?

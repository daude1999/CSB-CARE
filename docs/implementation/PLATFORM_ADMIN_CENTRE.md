# Evantix Platform Admin Centre

Owner's brief of 8 Nov 2026 ("EVANTIX – Enterprise SaaS Platform Admin Centre"). Built on branch `claude/project-thread-8z4axw` as a draft PR. Not merged and not deployed.

## Purpose

There are two levels of administration, and both use the same users, organisations, memberships, sessions, tokens and audit log. There is no second tenant system and no second user database.

- **Evantix platform administrators** (`PLATFORM_ADMIN`) use `/platform-admin` to manage:
  - customers, subscriptions and modules
  - accounts, password recovery and sessions
  - AI usage, storage, jobs and health
  - settings and controlled support access

  They get no organisation permission from this role, so service-user, care, medication and HR records stay closed to them.
- **Customer organisation administrators** (`ORG_ADMIN`) keep their own `/admin` area inside their organisation. They cannot open the Admin Centre. Every page there returns 404, and every server function refuses them.

## Routes

The shell is `src/app/(platform)/layout.tsx`: a navy sidebar, a white workspace and purple accents. On phones the sidebar becomes a menu.

| Group | Pages |
| --- | --- |
| Overview | `/platform-admin` (dashboard) |
| Customers | `/platform-admin/clients`, `/clients/new` (wizard) → `/clients/new/done`, `/clients/[id]?tab=` (11 tabs), `/onboarding`, `/administrators` |
| Accounts & Security | `/users`, `/users/[id]`, `/passwords`, `/roles`, `/sessions`, `/security` |
| Commercial | `/subscriptions`, `/plans`, `/billing`, `/renewals` |
| Platform | `/modules`, `/ai`, `/storage`, `/jobs`, `/health` |
| Administration | `/settings`, `/notifications`, `/support`, `/activity` |

The client profile has these tabs: Overview, Company Details, Branches, Users & Permissions, Subscription, Modules, AI Usage, Storage, Security, Settings and Audit History.

In the customer app there are four related changes:
- A platform administrator sees "Evantix Admin Centre" in the admin menu.
- Customer Settings has a **Support access** panel where the customer approves, declines or revokes support requests.
- A suspended organisation sees a notice instead of its pages.
- A maintenance notice, if one is set, shows on every page.

## Code

- **Business logic** is in `src/server/platform/`:
  - `access`, `customers`, `onboarding`, `subscriptions`, `billing`, `modules`, `accounts`, `permissions`, `support`, `settings`
  - `usage`, `activity`, `health`, `dashboard`, `alerts`, `reference`
- **Server actions** are in `src/app/platform-actions.ts`, through the existing `handle()` and `handleData()`.
- **UI** is in `src/components/platform/`.
- **AI metering** is in `src/server/ai/metering.ts`:
  - The Anthropic and simulated providers are wrapped in a proxy that checks allowances and records one `AiUsageEvent` per call.
  - The tenant comes from `AsyncLocalStorage`, set by `handle()`, by the job runner and by the intake reader.
- **Module entitlements** are enforced in `hasOrgPermission`. The session's context carries `disabledModules` and `suspended`, so every existing permission check also enforces licensing on the server. The Policy portal is closed when Policy & Compliance is off.
- **The user administration core** in `src/server/admin/users.ts` is shared. Organisation-level and platform-level actions call the same functions, with an `Actor` that sets the audit prefix (`admin.` or `platform.`).

## Database change

Migration `20261108170000_platform_admin_centre` is additive.

| Change | Why |
| --- | --- |
| `CustomerAccount` (1:1 with Organisation) | Commercial and company record, plus the `EVX-0001` reference and status (trial, active, suspended, closed). Kept off `Organisation` so the tenant model stays unchanged. |
| `SubscriptionPlan`, `CustomerSubscription` | Configurable plans with nullable prices (never assumed). Full subscription history: a change ends the current period and starts a new one, and a partial unique index allows only one current period. |
| `TenantModuleEntitlement` | Per-client module switches and limits. Without a row, a module is on, so existing organisations behave exactly as before. |
| `AiUsageEvent` | Metadata only: client, feature, provider, tokens, duration, success and reason. Never prompts or answers. |
| `PlatformSetting` | Documented, validated settings. No secrets are stored. |
| `SupportAccessGrant` | Time-limited, scoped, purpose-recorded support access. |
| `User.passwordResetRequired` | "Require a password change at next sign-in." |
| `AccountToken.organisationId` is now optional | A platform-level reset link for a person in several organisations belongs to no single organisation. |
| Sequence `customer_reference_seq` and a backfill | Every existing organisation gets an `ACTIVE` account (`EVX-0001`, `EVX-0002`, … in creation order). |

## Security

- Every function starts with `requirePlatform(ctx, "platform.*")`. Client ids come from the URL or form only to name the client, never to authorise anything.
- These actions need the administrator's own password (rate-limited):
  - suspending or closing a client
  - deactivating an account
  - changing platform roles
  - changing sign-in settings
  - emergency support access
- These actions need a written reason, which is audited:
  - module changes
  - subscription changes
  - support access
  - ending all of a person's sessions
- **Passwords:**
  - Only the hash is stored, and passwords are never shown.
  - Invitation and reset links are single-use, stored as hashes, and have a configured expiry.
  - Earlier reset links are revoked when a new one is made, and reset links are rate-limited (refusals are audited).
  - Sessions end when a password is reset or a password change is required.
  - Demo accounts refuse resets.
  - One-time links are shown once only: the cookie is cleared as soon as the link is on screen.
- **Never removed:** the last platform administrator and the last organisation administrator of a client cannot be removed. Removing a role ends that person's sessions.
- **Support access** is never impersonation:
  - It needs the customer's approval, except emergency access, which lasts 4 hours at most, needs the password and tells the customer.
  - It is limited to configuration and the activity log, ends at its expiry time, and can be revoked by either side.
  - Each use is audited (`platform.support.used`).
- **Audit:** every change is in the existing append-only audit log, under `platform.*`. No token, password or clinical detail is ever written to it, and tests check this.

## Real data only

Figures are counted from records. Anything that is not set up says so:
- **Revenue:** "Prices not set" when no current subscription has a priced plan.
- **AI cost:** "Not metered yet" or "not configured" until token prices are set in Platform Settings.
- **Billing:** a provider interface exists, but no provider is connected. Nothing is charged, and no invoice is issued or simulated.
- **Backups:** "not configured" until a person records a restore test. Health never claims a backup succeeded.
- **Health checks** are labelled measured, recorded or not configured.
- **Storage** is measured from file records (evidence, service-user documents, body-map photos, care-intake documents and HR files) plus the PostgreSQL database size.

## Tests

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/platform-admin.test.ts` | 10 passed |
| `npx vitest run tests/integration/platform-admin.test.ts` | 23 passed |
| `tests/e2e/platform-admin.spec.ts` (run against a local dev server) | 3 passed |

The unit tests cover module mapping and enforcement, suspension, portals, permission levels and differences, billing status, IP masking, link states and settings rules.

The integration tests cover:
- an organisation administrator refused everywhere
- no care access for platform administrators
- reference backfill
- onboarding in one transaction with no password, a one-time invite and invite redemption
- retry safety and duplicate refusal
- onboarding validation
- directory search, filter, sort and pages
- company edits and the CQC check reset
- subscription history and revenue that is not configured
- suspension with the password, reinstatement and data kept
- module switch-off with confirmation, limited to that client and data kept
- multi-organisation recovery, link revocation and sessions ended
- rate limit
- required password change
- ending all sessions
- last platform administrator and password check
- last organisation administrator
- AI metering, allowance and licensing
- support approval, scope, revocation, emergency limits and expiry
- sign-in settings needing the password and an audited before and after
- backups never reported as successful
- the security audit

The browser tests cover:
- an organisation administrator gets 404
- creating a plan, then a client through the wizard
- the one-time link shown once
- all 11 profile tabs and all 22 pages render
- a phone layout with no sideways page scroll

## Limitations and what is not built

- **Billing:** no live billing provider. A provider is plugged into `src/server/platform/billing.ts` once Evantix chooses one, and invoices appear only then.
- **Custom roles:** not built. The matrix describes the existing roles. A custom role would need its own reviewed change.
- **Email:** links are emailed only when SMTP is configured. Otherwise they are handed over in person.
- **Re-authentication** uses the administrator's password. There is no MFA yet.
- **Wizard steps:** the onboarding wizard shows 4 steps, and the confirmation page is the fifth (the invitation is created during provisioning).
- **Support access** covers configuration and the activity log only. Wider scopes, such as viewing records, are deliberately not offered.
- **Storage** sizes come from file records. Object-store bucket sizes are not read from the provider.

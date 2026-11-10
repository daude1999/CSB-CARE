# Security model

## Authentication

- Email and password, bcrypt hashes (cost 12). Sessions are random tokens; only their SHA-256 is stored, and they expire after 12 hours without activity. Cookie `evx_session` is HttpOnly, SameSite=Lax and Secure in production.
- Sign-in is rate limited (5 failed attempts per email address per 15 minutes). Failures do not reveal whether the account exists.
- Single sign-on (Entra ID / OIDC) is a planned next step; the session layer is separate from the credential check to make that straightforward.

## Authorisation

- Organisation roles: org admin, policy author, reviewer, approver, compliance lead, staff. Platform roles: platform admin, content editor, regulatory reviewer.
- Every server action and page re-checks permissions on the server (`src/server/auth/rbac.ts`). Navigation hiding is cosmetic only.
- Master templates are governed by platform roles; customer policies only by roles in the owning organisation.
- Separation of duties: the author or creator of a revision can never approve it; organisations can require up to 3 approvals. Implementation confirmation and action verification cannot be done by the person who did the work.

## Tenant isolation

Every tenant-owned row carries `organisationId`, and every query is scoped by the caller's active organisation. That is the first layer; PostgreSQL row-level security (below) is the second. Pages return 404 for records in other organisations so existence is not revealed. Full-text search filters by tenant inside the SQL query. The test suites cover cross-tenant access to policies, revisions, assessments, evidence, search and the assistant.

### Row-level security (second layer, from 10 November 2026)

PostgreSQL row-level security (RLS) backs up the application's own checks. If a query ever forgets its
`organisationId` filter, the database still returns only the caller's organisation's rows and refuses writes into
another organisation.

**How it works**

- Migrations `20261110120000_rls_pilot` and `20261110130000_rls_all_tenant_tables` create a database role `csb_app`
  (no login, not a superuser, no `BYPASSRLS`, owns nothing) and `ENABLE` and `FORCE` row-level security on **every
  table that has an `organisationId` column** (150 tables), each with one policy, `tenant_isolation`:
  `"organisationId" = current_setting('app.organisation_id', true)`, or `current_setting('app.rls_bypass', true) = 'on'`.
- The application keeps its one database login. `src/lib/db.ts` wraps the Prisma client so that every query runs in
  a transaction whose first statement switches to `csb_app` and sets the two settings, transaction-locally
  (`set_config(..., true)`), so nothing stays on a pooled connection. An interactive `db.$transaction` does this
  once at its start.
- The scope comes from `src/server/tenancy/scope.ts`:
  - **Tenant**: a signed-in request. The organisation is the session's active organisation, read on the server from
    the session cookie (`src/server/auth/current.ts`), never from the request.
  - **System**: every organisation, only through `withSystemScope(reason, ...)` (`src/server/tenancy/system.ts`),
    which writes an `rls.bypass` entry to the audit log.
  - **Identity**: the sign-in code only (`src/server/auth/session.ts`), which must find a user's memberships before
    any organisation is known.
  - **None**: anything else. Protected tables then show no rows and refuse writes (default deny).
- Tables whose `organisationId` is optional hold shared, central rows (CSB master policies, platform notifications,
  platform audit entries). Rows with no organisation are readable and writable from any scope; the application's
  platform permissions decide who may change them, as before. Rows that belong to an organisation are isolated.

**Bypass call sites (complete list)**

| Where | Why | Audit |
| --- | --- | --- |
| `src/server/auth/current.ts`: requests by a platform administrator to `/platform-admin/**` and `/api/platform/**` | The Evantix Platform Admin Centre manages every customer | One `rls.bypass` entry per request, with the person and the address |
| `src/server/jobs/queue.ts` `drain()` | The job queue and its handlers (call sweep, reminders, source checks, publication sync) serve every organisation. Used by the worker, `/api/jobs/kick`, `/api/cron/tick`, the long document-read route and the CLI | One entry per hour per server process while the queue is drained |
| `src/worker/run-once.ts` | Manual source check from the command line | Each run |
| `prisma/seed.ts`, `prisma/seed-hr.ts`, `prisma/seed-recruitment.ts`, `prisma/sync-forms.ts`, `prisma/demo-reset.ts` | Seeds and deploy scripts | Each run |
| `scripts/create-organisation.ts`, `scripts/workforce-identity.ts` | Operator scripts | Each run |
| `prisma/demo-cleanup.ts`, `prisma/test-record-cleanup.ts`, `prisma/demo-reset.ts` (direct `pg` connection as the table owner) | One-off data scripts that work across organisations; they set `app.rls_bypass` for their own transaction | Each already writes its own audit entry for what it changed |
| `src/server/auth/session.ts` (identity scope) | Session and membership lookup at sign-in and on each request | Not audited one by one (it runs on every page view); sign-ins are audited as `auth.login` |
| `tests/support/db-scope.ts` | The vitest suite calls server functions directly and checks the database across organisations | Test databases only |

Adding a bypass call site is a security decision and needs review.

**Tests.** `tests/integration/rls-tenancy.test.ts` puts a row for two organisations in every protected table and
checks, with the organisation filter deliberately left out, that one cannot read, update, delete, insert into or
move rows into the other, that no scope means no rows, that scopes do not leak between concurrent requests on the
pool, and that the bypass is audited. It also fails if a table with an `organisationId` column has no policy, so a
table added later cannot be forgotten.

**What it does and does not protect against**

- It protects against the main risk it was added for: application code that forgets a tenant filter.
- It does **not** protect against SQL injection or a stolen database password. The application's login is still the
  table owner, and anyone able to run arbitrary SQL on that connection could switch the setting or the role.
  The stronger arrangement is a separate login that *is* `csb_app` (so it cannot switch back) with a second,
  tightly held login for migrations and the system scope. That changes the production database credentials and
  connection settings, which is hosting work outside this change.
- Tables without an `organisationId` column (child rows such as `CarePlanSection` or `VisitTask`) are reached
  through a protected parent but are not protected directly.
- The vitest suite runs in the system scope (see the table above), so tenant scoping of each feature is exercised
  by the browser suite, which signs in through the real request path, and by the tenancy test.

**Operating notes**

- A later migration that changes rows in a protected table must begin with
  `SELECT set_config('app.rls_bypass', 'on', true);` in its transaction, unless the migrating role has `BYPASSRLS`.
- `pg_dump` needs a role with `BYPASSRLS` (or superuser) to dump protected tables in full; otherwise it stops with
  "query would be affected by row-level security policy". Check this before relying on the backup (`docs/BACKUPS.md`).
- `DB_ROW_LEVEL_SECURITY=off` makes the application connect without switching role. It exists for an emergency
  rollback together with dropping the policies; with the policies in place and the owner not exempt, it shows no data.

## Data integrity

Database triggers (migration `20261024232000_integrity`) make source versions, audit log entries and approval decisions immutable, freeze policy version content once out of draft, enforce the version state machine and allow at most one published version per policy. Publishing runs in a serializable transaction with a row lock and an optimistic base-version check, so two concurrent publications cannot both win.

## Web protections

- Server actions are protected by Next.js origin checks; all forms are same-origin. Security headers include CSP, HSTS, `X-Frame-Options: DENY` and `nosniff`.
- Evidence uploads: 10 MB limit, type detected from file content (not the extension), safe stored names, private storage, downloads only through an authorised route with `Content-Disposition: attachment`.
- Evidence files: virus-check policy (1 Nov 2026). With `MALWARE_SCAN_URL` set, every upload is scanned before it is stored; the scanner must answer within 20 seconds with JSON `{"infected": boolean}`. A failed or unclear answer refuses the upload (nothing is stored), so a file can never be recorded as clean by mistake. INFECTED files are never served; PENDING and SCAN_FAILED files are held with a message saying what to do. Without a scanner, files are stored as NOT_SCANNED, labelled "Not virus-checked", and served as attachments only; set `EVIDENCE_REQUIRE_SCAN=true` to hold them instead. Once a scanner is configured, an older NOT_SCANNED file is scanned on its first download and the result is recorded and audited. Nothing is deleted automatically. The same rules apply to missed-call evidence.
- HR Hub API rate limits (120 requests a minute per user, 60 for uploads) are counted in the shared `RateLimitWindow` table, so they hold across every server instance on Vercel. If the database is unreachable the limit falls back to a per-instance memory counter.
- CSV exports neutralise spreadsheet formulas.
- External content (source pages, AI outputs) is rendered as text, never as HTML. Source text sent to the model is escaped and marked as untrusted data.

## Logging and audit

Structured logs redact passwords, tokens, cookies and API keys. The audit log records who did what to which record for every decision, publication, export and download.

## Known gaps

- No MFA or SSO yet.
- The malware scanner is an integration point; without one, files are marked NOT_SCANNED (see the virus-check policy above).
- No admin screens yet for user management or for editing the requirements register.

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

Every tenant-owned row carries `organisationId`, and every query is scoped by the caller's active organisation. Pages return 404 for records in other organisations so existence is not revealed. Full-text search filters by tenant inside the SQL query. The test suites cover cross-tenant access to policies, revisions, assessments, evidence, search and the assistant.

### Row-level security evaluation

PostgreSQL row-level security was evaluated as a second layer. It is not enabled in this slice because Prisma connects through one pooled role, which needs a per-transaction `SET LOCAL app.organisation_id` on every query. That is achievable with a Prisma client extension, but it touches every query path and needs its own test suite. Recommended next step: enable RLS on the tenant tables with policies on `current_setting('app.organisation_id')`, add the extension, and keep the application checks as the first layer.

## Data integrity

Database triggers (migration `20261024232000_integrity`) make source versions, audit log entries and approval decisions immutable, freeze policy version content once out of draft, enforce the version state machine and allow at most one published version per policy. Publishing runs in a serializable transaction with a row lock and an optimistic base-version check, so two concurrent publications cannot both win.

## Web protections

- Server actions are protected by Next.js origin checks; all forms are same-origin. Security headers include CSP, HSTS, `X-Frame-Options: DENY` and `nosniff`.
- Evidence uploads: 10 MB limit, type detected from file content (not the extension), safe stored names, private storage, downloads only through an authorised route with `Content-Disposition: attachment`. Files flagged by the malware scanner cannot be downloaded.
- CSV exports neutralise spreadsheet formulas.
- External content (source pages, AI outputs) is rendered as text, never as HTML. Source text sent to the model is escaped and marked as untrusted data.

## Logging and audit

Structured logs redact passwords, tokens, cookies and API keys. The audit log records who did what to which record for every decision, publication, export and download.

## Known gaps

- No MFA or SSO yet.
- Row-level security not yet enabled (above).
- The malware scanner is an integration point; without one, files are marked NOT_SCANNED.
- No admin screens yet for user management or for editing the requirements register.

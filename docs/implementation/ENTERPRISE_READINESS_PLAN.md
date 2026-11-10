# Enterprise readiness plan

Owner's brief of 10 November 2026. CSB Care holds special-category health data under UK GDPR, so correctness and
tenant isolation come before speed. CLAUDE.md is binding. Out of scope: production hosting changes and two-factor
sign-in. Design freeze: nothing is redesigned; only the consistency fixes in workstream 5.

Branches and PRs: the work starts on `enterprise-readiness`. Each workstream gets its own PR, stacked in order
(workstream 1 targets `main`; each later PR is based on the branch before it so its diff shows only its own work).
Nothing is merged by Claude. Every new dependency is justified in its PR and waits for the owner's approval before it
is installed.

Live data: the live site holds real service users. No step touches the live database or Vercel. Tests run only on
local, disposable databases (`csb_test`, `csb_e2e`) and the CI service container, with synthetic data.

## Baseline (10 Nov 2026, `main` at a702f5c)

Recorded in `TEST_RESULTS.md` at the start of workstream 1 (typecheck, lint, vitest, `test:hr`, `npm audit`, build).
Known failures carried in from earlier notes, each to be fixed at the root cause, never by weakening the test:
`cutoff.test.ts` (fails late in the evening), 13 CQC unit tests (fail just after midnight), 4 navigation browser
tests with stale page titles, the support-plan-import browser test (since PR #83).

## 1. Quality gates

Purpose: no change reaches `main` without the same checks every time.

- `.github/workflows/ci.yml` on every PR and every push to `main`: `npm ci`, `prisma validate`, typecheck, lint, the
  full vitest suite against a `postgres:16` service container, `npm run test:hr`, `npm audit --audit-level=high`,
  `npm run build`. Read-only token, concurrency group, Node 22, npm cache.
- `.github/dependabot.yml`: npm and github-actions, weekly, grouped minor/patch updates so it does not flood PRs.
- Remove committed scratch files (`demo-missed.tmp.ts`) and ignore `*.tmp.*`.
- Fix every failure the gate shows, at the root cause. Time-of-day failures are fixed by making the code or the
  test's clock explicit (inject "now", fixed timezone), not by skipping.
- Making the check *required* is a GitHub branch-protection setting; the PR says exactly which check name to tick
  (owner action, no code can do it).
- Acceptance: CI green; one throwaway commit with a lint error and one with a failing test turn it red (linked in
  the PR), then both are reverted.

Risk: `npm audit --audit-level=high` may fail on transitive packages. Fixes that need a major version bump or a new
package are listed for the owner instead of installed.

## 2. Row-level security

Purpose: a second, database-enforced layer so a query that forgets its `organisationId` filter cannot read or write
another organisation's records.

Design:
- `src/server/tenancy/context.ts`: an `AsyncLocalStorage` holding either `{ organisationId }` or
  `{ bypass: reason }`. `requireCtx()`/`getCtx()` enter the tenant scope for the rest of the request.
- `src/lib/db.ts`: the exported `db` becomes a Prisma client extension. Every model and raw query runs in a
  transaction that first runs `SET LOCAL ROLE csb_app` and `set_config('app.organisation_id', $1, true)` (or
  `app.rls_bypass = 'on'` in a bypass scope). Interactive `db.$transaction(fn)` sets the same settings once at the
  start of the transaction, so queries inside it are not wrapped again.
- Migration: create a `NOLOGIN` role `csb_app` without `BYPASSRLS`, grant it table privileges and grant it to the
  connecting role (so `SET ROLE` works on PostgreSQL, Supabase and Neon). `ENABLE` and `FORCE ROW LEVEL SECURITY`;
  policy `organisationId = current_setting('app.organisation_id', true) OR current_setting('app.rls_bypass', true) = 'on'`.
  Tables where `organisationId` is nullable (master content) also allow `organisationId IS NULL` for reads only.
- Pilot: `ServiceUser`, `CareIntakeDocument`, `ServiceUserExternalReference`. Then every table with an
  `organisationId` column, generated from the Prisma schema so none is missed.
- Bypass path `withSystemScope(reason, fn)`: platform admin pages, seeds, the worker, cron and job routes, sign-in and
  session lookup (which run before an organisation is known). Each entry writes an `AuditLog` row
  (`rls.bypass`, reason, call site). Every call site is listed in the PR.
- Existing application checks stay as the first layer.
- `tests/integration/rls-tenancy.test.ts`: for each protected table, a deliberately unfiltered query inside tenant A
  returns no rows of tenant B, and a write into tenant B fails.
- p95 latency of the rota and service-user page queries measured before and after on the same seeded database.

Code that runs with **no** scope at all is denied (an unscoped query on a protected table sees nothing and cannot
write). Every unscoped path is first moved into a tenant scope or the audited system scope; the pilot shows how many
paths that is before the rollout to every table.

Risk to data: merging runs the migration on the live database through `vercel-build`. The migration is additive
(role, grants, policies), contains no data changes, and comes with a one-statement rollback migration documented in
the PR. Merge stays the owner's decision.

## 3. Operations

- Error tracking: proposal only until approved. Recommendation: Sentry, EU data region (Frankfurt), `@sentry/nextjs`
  for server, client and edge plus `@sentry/node` in the worker, with a `beforeSend` that removes personal and
  care-record fields, request bodies, cookies and query strings. Nothing installed until the owner says yes.
- Request ID: `src/middleware.ts` sets `x-request-id` (kept from an incoming header if well formed, else random) on the
  request and the response; the logger gets a child per request carrying it.
- Logger redaction extended to care-record fields (names, NHS numbers, addresses, dates of birth, notes,
  phone numbers, emails) with a unit test.
- `/api/health` reports job-queue backlog (queued, running, oldest queued age, dead-lettered in the last day).
- `docs/OPERATIONS.md`: uptime check on `/api/health` and alert rules.
- Email: invitations and password resets sent through the existing `nodemailer` setup when `EMAIL_PROVIDER=smtp`,
  with branded HTML and plain-text templates, a per-address and per-admin rate limit in `RateLimitWindow`, and the
  current copy-link fallback when email is not configured. Tests use a mock transport.

## 4. Assurance pack (documents only, each marked DRAFT FOR HUMAN REVIEW)

`docs/assurance/`: `DPIA.md`, `DATA_FLOW.md` (Mermaid diagram), `RETENTION_SCHEDULE.md` (proposed periods with the
source of each), `DSPT_EVIDENCE_INDEX.md` (each assertion mapped to code, config or doc, gaps marked),
`PEN_TEST_SCOPE.md`, `INCIDENT_RESPONSE.md` (with the 72-hour ICO steps). No deletion jobs.

## 5. UX and responsiveness

- Audit every route into `UX_RESPONSIVENESS_AUDIT.md` (page, slowest query, loading, error and empty states).
- `loading.tsx` skeletons per section, Suspense for heavy dashboard widgets, `error.tsx` with retry per route group.
  Note from 25 Oct: a `loading.tsx` at the `(app)` root once broke client navigation in production builds, so
  skeletons go at section level and the browser suite runs against a production build.
- Pending state and double-submit protection on every form submit through one shared submit button; `useOptimistic`
  for quick toggles; a toast after each mutation driven by the existing `?ok=`/`?error=` flash.
- Split `src/hr/components/hub.tsx` and `workspace-widgets.tsx`; lazy-load heavy client parts.
- Cap or paginate unbounded `findMany` calls on list pages; add indexes found by the audit.
- Consistency pass only: one type scale (12, 13, 14, 16, 18, 24 px) in `tailwind.config.ts` with arbitrary sizes
  snapped to the nearest step; Inter as the one body font (display, label and mono fonts keep their roles); unused
  font packages removed; one page background, padding and set of max-widths; consistent row heights.
- Before and after Playwright screenshots of every main page; visible focus; WCAG 2.2 AA contrast fixes within the
  existing palette.
- A browser test asserts visible feedback within 200 ms of clicking primary actions on Overview, Rota, Service Users,
  HR and Policies. Lighthouse performance and accessibility before and after for those pages.

## After each workstream

Update `MASTER_BUILD_TRACKER.md` and `KNOWN_LIMITATIONS.md`, and post a plain-English summary with test results and
anything needing a decision.

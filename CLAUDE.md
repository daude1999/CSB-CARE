# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CSB ("CSB All In One Platform", Care Solution Bureau CIC) is a multi-tenant B2B SaaS platform for adult social care providers in England: policy and procedure management driven by an automated regulatory-change engine, plus an HR & Workforce portal. README.md is the authoritative product overview; `docs/` covers sources, deployment, security and operations. These rules are permanent. Where a user instruction in a session conflicts with them, ask before acting.

## Current scope

The owner's brief of 29 October 2026 ("Master autonomous CRM implementation") widens the scope to five modules: Policy & Compliance (preserve), **Rostering & Care Management** (the main build), HR & Workforce (preserve; the HR Hub stays the source of truth for people), Reporting & Analytics, and Administration & Settings. Build on a feature branch and open a PR. Never merge without the owner's explicit "merge". Progress, decisions and limitations are in `docs/implementation/` (start with `MASTER_BUILD_TRACKER.md`). Policy Library redesign work still needs the owner's "APPROVED — BUILD POLICY LIBRARY" (`docs/POLICY_COMPLIANCE_IMPLEMENTATION_PLAN.md`).

Rostering rules: staff come from HR through the projection in `src/server/workforce`, and sign-ins are linked to staff by hand only. Every assignment goes through the eligibility service. HR changes flag visits and never reassign them. Never activate clinical workflows (eMAR, medication figures) or send outbound notifications without review, and never present simulated GPS, NFC or offline features as real.

## Technology stack (mandatory)

- **Frontend:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 3.
- **Backend:** Node.js runtime, Next.js Server Actions, Next.js Route Handlers, TypeScript, Prisma 6.
- **Database:** PostgreSQL 16.
- **Already in place:** a Postgres-backed job worker (`src/worker`), zod, Phosphor icons, `docx`/`pdfkit` for exports, Vitest and Playwright.

Architecture rules:
1. Keep the existing Next.js full-stack architecture. Don't rebuild the app or replace services that work.
2. Business logic goes in `src/server/<domain>`. Pages and server actions only call it.
3. Use Server Actions for form mutations (in `src/app/actions.ts`, through its `handle()` wrapper). Use Route Handlers (`src/app/api`) only when an HTTP API is really needed, such as file downloads, cron or JSON for client widgets.
4. All database access goes through Prisma, using `db.$transaction` for anything that writes more than one record.
5. Don't add Express, NestJS, another backend service, another ORM or a UI kit without a stated architectural need and the owner's approval. Justify every new dependency.

## Commands

Requires Node 22 and PostgreSQL 16. Copy `.env.example` to `.env` first.

```bash
npm install                 # postinstall runs `prisma generate` and copies pdf.js assets
npx prisma migrate deploy   # npm run db:migrate:dev creates a new migration
npm run db:seed             # base data + demo orgs (SEED_DEMO=false to skip demo)
npx tsx prisma/seed-hr.ts   # add HR demo people to an existing demo database
npm run dev                 # web app on :3000
npm run worker              # separate process: monitoring + background job queue

npm run typecheck && npm run lint
npm test                    # vitest unit + integration; RESETS the database in TEST_DATABASE_URL (default csb_test)
npx vitest run tests/unit/portals.test.ts      # single file
npx vitest run -t "name of test"               # single test by name
npm run test:hr             # HR Hub domain tests (node:test, no database)
npm run build && npm run test:e2e              # Playwright; resets csb_e2e (E2E_DATABASE_URL), serves on :3100
```

On a brand-new `csb_e2e`, run `prisma migrate deploy` against it once first. Otherwise the web server starts before global setup and times out.

Vitest runs in a single fork because every test shares one real database, and global setup runs `prisma migrate reset` on it. Demo password for every demo account is `DemoPassword!2026` (accounts are listed in README.md).

## Architecture

**Auth and tenancy.** `src/middleware.ts` only checks that the `evx_session` cookie exists. Real checks happen on the server. `requireCtx()` (`src/server/auth/current.ts`) returns a `Ctx` with the session's single active `organisationId`. Permissions are role lists in `src/server/auth/rbac.ts`: `ORG_PERMISSIONS` for provider roles and `PLATFORM_PERMISSIONS` for CSB staff roles. Policies use `canOnPolicy` / `requireOnPolicy` / `visiblePolicyWhere`, which give read access to master templates (`kind: MASTER`, `organisationId: null`) and full access only to the caller's own organisation's policies. Pages wrap lookups in `orNotFound()` (`page-guard.ts`) so forbidden and missing records both return 404. Portal access is decided only in `canUsePortal()` (`src/server/auth/portals.ts`).

**Mutations.** Server actions in `src/app/actions.ts` read `FormData`, call a `src/server` function with `ctx`, and redirect back with `?ok=` or `?error=`, which `<Flash>` shows. Domain code throws `ValidationError`, `ForbiddenError`, `NotFoundError` or `ConflictError` from `src/lib/errors.ts`. Their messages are shown to users, and any other error is logged and replaced with a generic message.

**Policy engine (`src/server`).** `sources` → `changes` → `impact` → `policies` (`library.ts`, `versions.ts`, `workflow.ts`, `revise.ts`, `sync.ts`) → `notifications`, `compliance`, `search`, `documents` (CSB board-paper Word/PDF export), `audit-log.ts`. A policy has immutable `PolicyVersion`s made of `PolicySection`s with stable keys. Sections marked `isLocal` are customer-owned and are never changed automatically. Every change goes through a `PolicyRevision` (draft → review → approval decisions → `PolicyPublication` → `Acknowledgement`s).

**Database-enforced invariants** (triggers in `prisma/migrations`):
- Source versions, audit log entries and approval decisions are immutable.
- Version content is frozen once it leaves draft.
- Status transitions follow a fixed state machine.
- A policy has at most one published version.
- `Policy.lockVersion` gives optimistic concurrency on publish.

Expect the database to reject invalid transitions, and update the triggers in a new migration if a schema change touches these tables.

**AI** (`src/server/ai`). The provider is `anthropic`, `simulated` (deterministic and always labelled) or `none`. Output is a zod-validated proposal, and every quotation must appear verbatim in the stored source text. Handle `AiUnavailableError`.

**Jobs.** The Postgres queue is in `src/server/jobs/queue.ts`. Handlers are in `src/worker/handlers.ts`. Vercel has no worker, so `inline.ts` drains the queue through `/api/jobs/kick` and a daily `/api/cron/tick`.

**HR & Workforce** (`src/hr`, `src/app/hr`, `src/app/api/hr`) is the standalone CSB HR Hub, moved in with its own conventions:
- HR data is one JSON document per organisation in `HrWorkspace`, written under a row lock.
- The HR Hub uses Tailwind 4. Its CSS is prebuilt into `public/hr/hr-hub.css` with `npm run build:hr-css -- <folder with Tailwind 4>`.
- Don't restructure it while it is out of scope.

**Content and look.** The starter library is original TypeScript seed data in `prisma/seed-data/library/`. Never add QCS or other providers' content. Themes (`src/lib/themes.ts`, `src/app/themes.css`) change colour and type only. Shared UI primitives are in `src/components/ui.tsx` and `tabs.tsx`, and the official logo is `public/csb-logo.*` through `src/components/brand.tsx`.

## Security rules (enforced)

- Every query or mutation on tenant-owned data is scoped by `ctx.organisationId` from the session. Never take an organisation, branch or owner id from form data, query strings or request bodies, and re-check record ownership on the server before every write.
- Check authorisation on the server for every sensitive read and mutation, not only in the UI. Hiding a button doesn't count as a permission check.
- Validate new action and route inputs with zod (or the existing `str()` helpers for trivial fields). Handle invalid input, permission failures, missing records, concurrent edits and transaction failures explicitly.
- Keep these intact: separation of duties (an author can't approve their own draft), the configured number of approvers, immutable approved and published versions (a rollback creates a new version), master and customer separation, and the audit log for every state change. Never silently replace approved text with AI output.
- Don't log or expose secrets, tenant data or personal records. Downloads and evidence are served only after a server-side permission check.

## Product and design standards

- The platform must look like the work of an experienced enterprise SaaS team. Avoid generic AI-dashboard patterns: repeated stat-card rows, meaningless metrics, gradients, decorative icons and empty whitespace.
- Give each module a layout built around its job, and don't reuse one dashboard template across modules:
  - Policy Library: document management and policy inspection.
  - Regulatory Updates: source comparison and applicability decisions.
  - Requirements Register: traceability and evidence mapping.
  - Change Queue: drafting, review, approval and publication.
  - Audits: assessments, findings and evidence.
  - Actions & Risks: ownership, deadlines and verification.
  - Staff Sign-off: reading assignments and overdue acknowledgements.
  - Evidence Library: secure files linked to compliance records.
- The approved Policy Library reference is `docs/design/policy-library-reference.png` (1536 × 1024). It is the visual source of truth, not just inspiration, so match its layout, proportions, type, spacing and components as closely as practical. Use real, authorised data, never the sample names in the image. Keep its craftsmanship elsewhere without copying its three-column layout. Always use the official CSB logo assets in `public/brand/` and `public/csb-logo*`, never a redrawn logo.
- A feature is done only when it has its full workflow:
  - create, read, update and complete actions, with real persistence
  - search, filters and navigation
  - validation and useful errors
  - permissions, status transitions and deadlines
  - related records and audit history
  - empty and loading states
  - notifications where relevant
  - automated tests
- Never ship decorative buttons, fake actions, hardcoded statistics, or placeholders presented as working software. A planned feature must say plainly that it isn't built yet.
- Keep it responsive (desktop, tablet, phone) and accessible: semantic HTML, labelled controls, keyboard reachable, visible focus, sufficient contrast.

## How to work

1. **Plan before building.** For any feature:
   - inspect the current code
   - state the business purpose, existing functionality and dependencies
   - list functional and non-functional requirements, gaps and regression risks
   - write an implementation plan and an acceptance-test matrix
   - record the current test baseline
   - get the owner's approval before changing application code
2. **Engineering.** Use strict TypeScript (no `any` or unchecked casts in new code). Follow the existing conventions and reuse components and server functions. Prefer small, testable changes, and avoid oversized components, duplication and premature abstraction. Don't modify unrelated modules or replace working behaviour for a visual effect. Every schema change needs a stated justification and an additive, migration-safe Prisma migration.
3. **Testing.** Add or update unit and integration tests (Vitest) and browser tests (Playwright) with each feature. Run database tests only against local, isolated test databases, never against Supabase or production. Report exactly which commands ran and their results, and never claim a test passed unless it ran and passed.
4. **Visual validation.** When an approved design or screenshot exists:
   - capture real Playwright screenshots at desktop (1440), tablet (834) and phone (390) widths
   - compare them with the reference and fix material differences
   - check keyboard navigation

   Never invent screenshots or claim a visual match you haven't checked.
5. **Git and deployment.**
   - Work on a dedicated feature branch.
   - Never merge to `main` without the owner's explicit approval. `main` auto-deploys to the live demo on Vercel, and `vercel-build` runs migrations and seeds there.
   - Never deploy by hand.
   - Never run destructive database commands (`migrate reset`, `db:reset`, drops, bulk deletes) against any non-local database.

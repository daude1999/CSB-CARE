# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CSB ("CSB All In One Platform", Care Solution Bureau) is a Next.js 15 + Prisma/PostgreSQL app for adult social care providers in England: policy and procedure management driven by an automated regulatory-change engine, plus an HR & Workforce portal. README.md is the authoritative overview; `docs/` covers sources, deployment, security and operations.

## Commands

Requires Node 22 and PostgreSQL 16. Copy `.env.example` to `.env` first.

```bash
npm install                 # postinstall runs `prisma generate` and copies pdf.js assets
npx prisma migrate deploy   # or: npm run db:migrate:dev to create a new migration
npm run db:seed             # base data + demo orgs (SEED_DEMO=false to skip demo)
npx tsx prisma/seed-hr.ts   # add HR demo people to an existing demo database
npm run dev                 # web app on :3000
npm run worker              # separate process: monitoring + background job queue
npm run monitor:once        # run one monitoring pass

npm run typecheck && npm run lint
npm test                    # vitest unit + integration; resets database csb_test (TEST_DATABASE_URL)
npx vitest run tests/unit/portals.test.ts      # single file
npx vitest run -t "name of test"               # single test by name
npm run test:hr             # HR Hub domain tests (node:test via tsx, no database)
npm run build && npm run test:e2e              # Playwright; needs a build, uses database csb_e2e on port 3100
```

Vitest runs in a single fork with no file parallelism because every test shares one real database; global setup runs `prisma migrate reset` on it. Tests force `AI_PROVIDER=simulated`, local storage and log email.

Demo password for every demo account is `DemoPassword!2026` (accounts listed in README.md).

## Architecture

**Request flow.** `src/middleware.ts` only checks the `evx_session` cookie exists; real auth happens server-side. `requireCtx()` (`src/server/auth/current.ts`) builds a `Ctx` scoped to one active organisation. Permissions are role lists in `src/server/auth/rbac.ts` (`ORG_PERMISSIONS` for org roles, `PLATFORM_PERMISSIONS` for CSB staff roles); call `requireOrgPermission` / `requirePlatformPermission` inside server code, not just in the UI. Pages wrap lookups in `orNotFound()` (`page-guard.ts`) so forbidden and missing records both 404. Every query must be scoped by `organisationId` (tenant isolation is tested).

**Mutations** are server actions, mostly in `src/app/actions.ts`, which parse `FormData`, re-check permissions, then call domain functions in `src/server/*`. Keep business logic in `src/server`, not in pages or actions.

**Domain layout (`src/server`)**: `sources` (adapters, polite HTTP client, monitoring engine) → `changes` (diff, classify, 11-status change workflow) → `impact` (candidate policies, impact assessments) → `policies` (versions, AI drafting, review/approve/publish, rollback, master→customer three-way merge) → `notifications`, `compliance` (audits, actions, evidence), `search` (Postgres full-text + assistant), `documents` (Word/PDF export in the CSB board-paper style via `docx`/`pdfkit`), `audit-log.ts`.

**Database invariants live in Postgres triggers** (in `prisma/migrations`), not just app code: source versions, audit log entries and approval decisions are immutable; policy version content is frozen once out of draft; status transitions follow a fixed state machine; at most one published version per policy. Approved versions are never overwritten (rollback creates a new version), and a draft cannot be approved by its own author. When changing workflow code, expect the database to reject invalid transitions; schema changes that touch these tables may need trigger updates in a new migration.

**AI** (`src/server/ai`): provider abstraction with `anthropic`, `simulated` (deterministic, used in demos/tests, always labelled) or `none`. Outputs are zod-validated proposals, and quotations must appear verbatim in stored source text (`citations.ts`) or they are rejected. Code must handle `AiUnavailableError`.

**Background jobs**: Postgres job queue (`src/server/jobs/queue.ts`, `FOR UPDATE SKIP LOCKED`, idempotency keys, retries, dead-letter). Handlers are in `src/worker/handlers.ts`. On Vercel there is no worker, so `src/server/jobs/inline.ts` drains the queue when signed-in pages hit `/api/jobs/kick`, plus a daily Vercel Cron to `/api/cron/tick` (needs `CRON_SECRET`).

**Portals.** `src/lib/portals.ts` defines the portals; `canUsePortal()` in `src/server/auth/portals.ts` is the single rule for who sees each one, used by both the header switcher and page guards. Service Users and Rota are placeholder pages (planned).

**HR & Workforce (`src/hr`, `src/app/hr`, `src/app/api/hr`)** is the standalone CSB HR Hub moved in largely unchanged, so it follows its own conventions:
- Identity comes from the platform session; `Membership.hrUserId` links to the HR Hub account and its role/branch limits.
- All HR data for an organisation is one JSON document in the `HrWorkspace` table, written under a row lock (`src/hr/lib/store.ts`); uploads go to `HrFile`.
- It uses Tailwind 4 while the platform uses Tailwind 3. Its CSS is prebuilt into `public/hr/hr-hub.css` with `npm run build:hr-css -- <folder with Tailwind 4 installed>` and committed; edits to `src/hr/styles` require regenerating it. Portal switches are full page loads so the two style sheets never mix.

**Content.** The starter library (policies, forms, audit tools, requirements) is TypeScript seed data in `prisma/seed-data/library/`, original drafting cited to sources in `docs/SOURCES.md`. It must not contain content from QCS or other providers.

**Theming.** Layout is identical across themes; `src/lib/themes.ts` + `src/app/themes.css` swap colour/type only (cookie `csb-theme`, default `care`).

## Deployment

The demo runs on Vercel (region `lhr1`) with Supabase Postgres and auto-deploys from `main`. The `vercel-build` script runs migrations, seeds only if empty (`--if-empty`), runs `seed-hr.ts`, then builds, so pushing to `main` changes the live demo. Docker/Azure (the eventual production target) is described in `docs/DEPLOYMENT.md`.

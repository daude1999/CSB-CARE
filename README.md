# Evantix Care

Policy and procedure management for adult social care providers in England, built around an automated policy maintenance engine:

```
monitor sources → detect genuine change → store immutable source versions → compare
→ identify affected policies → assess applicability and urgency → AI-drafted revision (proposal)
→ citation verification → human review → approve and publish → notify → acknowledgements → audit trail
```

Each stage is a separate, recorded step in both the data and the interface. Detecting a change does not mean it is substantive; a substantive change does not mean it applies to a given service; applying does not mean a policy must change; and a draft is never live until someone other than its author approves it and it is published. Approved versions are never overwritten.

Evantix Care is original work. It contains no content, code or branding from QCS or any other provider. The bundled starter policies are original drafts that have **not** been professionally or legally reviewed; they are marked as such throughout the product and carry no approval record.

## What works today

| Area | Status |
| --- | --- |
| Source registry and monitoring engine (GOV.UK Content API, GOV.UK Search API, Atom/RSS, legislation.gov.uk XML, HTML pages with robots.txt checks, manual-only sources) | Built and tested against recorded copies. **Not yet verified against the live sites**: the build environment's network blocked gov.uk, legislation.gov.uk and cqc.org.uk. See [docs/SOURCES.md](docs/SOURCES.md). |
| Change detection, section diffs, rule-based classification, change workflow with 11 statuses | Built and tested |
| Candidate policies (requirement links, source links, text similarity as supporting evidence only), impact assessments | Built and tested |
| AI analysis, impact assessment and drafting with structured output and verbatim citation checks | Built. Tested with the deterministic simulated provider; the Anthropic integration needs an API key to exercise |
| Review, approval (separation of duties, configurable number of approvers), scheduled or immediate publishing, rollback as a new approved version | Built and tested |
| Master templates and customer policies, three-way merge that preserves customer edits and locked local sections | Built and tested |
| Acknowledgements, reminders, notifications (in-app and email outbox), implementation confirmation | Built and tested |
| Audits, findings, actions, evidence uploads, staff and training view, reports with CSV export | Built and tested |
| AI assistant over your policies and stored sources (Postgres full-text search) with citation verification | Built and tested |
| Background jobs: idempotent, retries with backoff, dead-letter state, admin retry and cancel | Built and tested |

The dashboard figures are computed from the database. A source is only shown as monitored when it has actually been checked successfully within its freshness window, and the admin pages warn when the worker has stopped.

## Quick start (development)

Requirements: Node 22, PostgreSQL 16.

```bash
cp .env.example .env              # adjust DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed                   # base data plus a clearly labelled demo organisation
npm run dev                       # web app on http://localhost:3000
npm run worker                    # in a second terminal: monitoring and background jobs
```

Demo sign-ins (password `DemoPassword!2026`, demo data only):

| Email | Role |
| --- | --- |
| `manager@brookfield.demo` | Organisation admin and compliance lead (Brookfield Care Group, demo) |
| `author@brookfield.demo` | Policy author |
| `reviewer@brookfield.demo` | Policy reviewer |
| `approver@brookfield.demo` | Policy approver (can publish) |
| `carer1@brookfield.demo`, `carer2@brookfield.demo` | Care staff |
| `manager@oakridge.demo` | A second organisation, to show tenant isolation |
| `regulatory@evantix.demo` | Evantix regulatory reviewer (triages detected changes) |
| `content@evantix.demo` | Evantix content editor (master templates) |
| `admin@evantix.demo` | Platform admin (sources, jobs) |

The demo includes one **simulated** regulatory change (a safeguarding reporting timescale shortened from 48 to 24 hours) produced by running the real engine against recorded test content. It is labelled SIMULATED everywhere and is not real guidance. To walk the full flow: sign in as `regulatory@` and confirm the change as relevant; as `manager@`, record that the safeguarding policy needs revising; as `author@`, generate the draft and submit it; as `approver@`, approve and publish; as `carer1@`, acknowledge it.

Set `SEED_DEMO=false` for an environment without demo organisations.

## Tests

```bash
npm run typecheck && npm run lint
npm test                          # 69 unit and integration tests (uses database evantix_test)
npm run build && npm run test:e2e # browser tests (uses database evantix_e2e)
```

The integration suite includes the end-to-end scenario from the specification (baseline capture, change detection, analysis, candidates, human decisions, drafting with verified citations, separation of duties, publication, acknowledgement, audit trail), tenant isolation, concurrency on publishing, scheduled publishing, rollback, notification retries, behaviour with AI unavailable, master-to-customer sync and evidence handling. The browser suite runs the same scenario through the interface and opens every reachable page as seven different roles.

## Architecture

- **Next.js 15 (App Router) + React 19 + Tailwind** for the web app. Pages are server-rendered; mutations are server actions that re-check permissions on the server.
- **PostgreSQL + Prisma.** Database triggers enforce what must never be bypassed: source versions, audit log entries and approval decisions are immutable; policy version content is frozen once it leaves draft; status transitions follow a fixed state machine; at most one published version per policy.
- **Background worker** (`src/worker`), a separate process using a PostgreSQL job queue (`FOR UPDATE SKIP LOCKED`), so no extra infrastructure is needed.
- **AI provider abstraction** (`src/server/ai`): Anthropic, a deterministic simulated provider for demos and tests, or none. All outputs are schema-validated proposals; quotations must appear verbatim in the stored source text or they are rejected.
- **Storage**: local disk or Azure Blob Storage. **Email**: log/outbox or SMTP.

```
src/server/sources     adapters, HTTP client, extraction, monitoring engine
src/server/changes     diffing, classification, change workflow
src/server/impact      candidate policies, impact assessments
src/server/policies    versions, drafting, review, publishing, master sync
src/server/compliance  audits, actions, evidence
src/server/search      full-text index, assistant
src/app                pages, server actions, API routes
prisma                 schema, migrations (including integrity triggers), seed data
```

## Further documentation

- [docs/SOURCES.md](docs/SOURCES.md): monitored sources, how each is checked, coverage and limits
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker and Azure deployment
- [docs/SECURITY.md](docs/SECURITY.md): security model, tenant isolation, the row-level security evaluation
- [docs/OPERATIONS.md](docs/OPERATIONS.md): backup, recovery and runbook

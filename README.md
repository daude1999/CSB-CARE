# CSB

Policy and procedure management for adult social care providers in England, built around an automated policy maintenance engine:

```
monitor sources → detect genuine change → store immutable source versions → compare
→ identify affected policies → assess applicability and urgency → AI-drafted revision (proposal)
→ citation verification → human review → approve and publish → notify → acknowledgements → audit trail
```

Each stage is a separate, recorded step in both the data and the interface. Detecting a change does not mean it is substantive; a substantive change does not mean it applies to a given service; applying does not mean a policy must change; and a draft is never live until someone other than its author approves it and it is published. Approved versions are never overwritten.

CSB is original work. It contains no content, code or branding from QCS or any other provider. The bundled starter library (about 120 policies and procedures plus 64 forms, templates, checklists, risk assessments and audit tools, across care homes, home care, supported living, learning disability and autism, mental health and dementia) is original drafting, cited to the legislation and national guidance it relies on (see docs/SOURCES.md). These are drafts that have **not** been professionally or legally reviewed; they are marked as such throughout the product and carry no approval record.

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

Demo sign-ins (password `DemoPassword!2026`, demo data only; the demo organisation is "Care Solution Bureau (DEMO)" with branches Liverpool, Portsmouth and Tower Hamlets):

| Email | Role |
| --- | --- |
| `manager@care-solution.demo` | Organisation admin, compliance lead and care manager (also HR Organisation Admin) |
| `coordinator@care-solution.demo` | Care coordinator (rota, visits, call monitoring) |
| `finance@care-solution.demo` | Finance officer (timesheets, invoice and pay runs) |
| `carer@care-solution.demo`, `carer1@care-solution.demo`, `carer2@care-solution.demo` | Care staff (own visits, clocking, policy acknowledgements) |
| `author@care-solution.demo`, `reviewer@care-solution.demo`, `approver@care-solution.demo` | Policy author, reviewer and approver |
| `jordan.ellis@care-solution.demo`, `sam.parker@care-solution.demo`, `taylor.reed@care-solution.demo` | HR & Workforce: Group HR, Branch HR (Liverpool), Branch Viewer (Liverpool) |
| `manager@oakridge.demo` | A second organisation, to show tenant isolation |
| `regulatory@csb.demo` | CSB regulatory reviewer (triages detected changes) |
| `content@csb.demo` | CSB content editor (master templates) |
| `admin@csb.demo` | Platform admin (sources, jobs) |

The demo includes one **simulated** regulatory change (a safeguarding reporting timescale shortened from 48 to 24 hours) produced by running the real engine against recorded test content. It is labelled SIMULATED everywhere and is not real guidance. To walk the full flow: sign in as `regulatory@` and confirm the change as relevant; as `manager@`, record that the safeguarding policy needs revising; as `author@`, generate the draft and submit it; as `approver@`, approve and publish; as `carer1@`, acknowledge it.

Set `SEED_DEMO=false` for an environment without demo organisations.

## Tests

```bash
npm run typecheck && npm run lint
npm test                          # unit and integration tests (uses database csb_test)
npm run test:hr                   # the HR Hub's own domain tests
npm run build && npm run test:e2e # browser tests (uses database csb_e2e)
```

The integration suite includes the end-to-end scenario from the specification (baseline capture, change detection, analysis, candidates, human decisions, drafting with verified citations, separation of duties, publication, acknowledgement, audit trail), tenant isolation, concurrency on publishing, scheduled publishing, rollback, notification retries, behaviour with AI unavailable, master-to-customer sync and evidence handling. The browser suite runs the same scenario through the interface and opens every reachable page as seven different roles.

## Portals (CSB All in One Platform)

One sign-in opens every portal the person may use. The portal button in the header lists only those portals; the server checks the same rule on every page and HR request (`src/server/auth/portals.ts`), and anyone who types another portal's address gets a "No access" page.

| Portal | Address | Status |
| --- | --- | --- |
| Overview | `/overview` | Working. Figures are counted from the database. |
| Policy & Compliance | `/` and the existing policy pages, unchanged addresses | Working |
| HR & Workforce | `/hr/...` | Working. The CSB HR Hub, moved in unchanged (see below). |
| Reporting & Analytics | `/reports`, `/assistant` | Working |
| Administration | `/settings`, `/modules`, `/admin/...` | Working |
| Rostering & Care Management | `/rota/...`, `/carer` | Working: service users, templates, Build Rota, daily and advanced rota, allocation, call monitoring, carer clocking, care plans, risks, incidents, finance preparation, reports. Anything not built is marked "Planned" in its menu. |

**HR & Workforce** is the standalone CSB HR Hub (people, compliance checks, documents, training, HR tasks, imports, alerts, settings) with its screens, rules and look kept as built. Its code is in `src/hr`, its pages in `src/app/hr`, its API in `src/app/api/hr`. What changed when it moved in:

- **Sign-in**: the platform session decides who you are; `Membership.hrUserId` names the HR Hub account you work as (Organisation Admin, Group HR, Branch HR or Branch Viewer, with their branch limits). No HR account means no HR portal.
- **Data**: the HR Hub keeps its records as one document per organisation in the `HrWorkspace` table, written under a row lock, instead of the pilot's local SQLite file. Uploaded files go to `HrFile` and stay in quarantine. A later step should move these records into relational tables (the HR Hub's `supabase/migrations` design is the blueprint) so the rota can share staff records directly.
- **Styling**: the HR Hub was built with Tailwind 4; its CSS is compiled separately into `public/hr/hr-hub.css` by `npm run build:hr-css -- <folder with Tailwind 4 installed>` and loaded only on HR pages. Portal changes are full page loads so the two style sheets never mix.
- Demo HR accounts: `manager@care-solution.demo` (Organisation Admin), `jordan.ellis@` (Group HR), `sam.parker@` (Branch HR, Liverpool), `taylor.reed@` (Branch Viewer, Liverpool), all `@care-solution.demo` with the demo password. Existing demo databases get HR added on the next build by `prisma/seed-hr.ts`.

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

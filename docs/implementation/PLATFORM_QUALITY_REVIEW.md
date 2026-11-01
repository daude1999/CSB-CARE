# Platform quality, simplicity and security review (1 Nov 2026)

Owner's brief: "CSB-CARE — Complete platform UX, simplification, security & quality improvement" (1 Nov 2026, 18:32).
One feature branch, one draft PR, no merge or deploy until the owner writes "I approve the screenshots. Merge the PR."

Recruitment and Care Intelligence are out of scope (they are in draft PR #48). This branch starts from `main` and does
not touch PR #48's branch.

## 1. Baseline (before any change)

| Check | Command | Result on `main` (b3a00c2) |
|---|---|---|
| TypeScript | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Unit + integration | `npm test` | 69 files, 551 tests, all pass |
| HR Hub domain tests | `npm run test:hr` | pass |
| Production build | `next build` | pass |

Inventory: 112 pages (55 under Rostering & Care, 9 Finance, 7 Compliance workspaces, 9 Administration, the HR Hub's
single catch-all route), 23 route handlers, 165 server actions (`actions.ts` and `rota-actions.ts`), all domain logic
under `src/server/<domain>`. Real screenshots of 24 screens at 1672 × 941 and 9 phone screens were captured from a
production build of `main` before any change.

Protected before editing: Rota Dashboard (`/rota`), Daily Rota (`/rota/visits`), Daily Templates, Unassigned Visits,
Coverage History and the Policy Library. **None of their files were changed.**

## 2. Audit findings by module

| Module | Working well | Problems found | Done in this build |
|---|---|---|---|
| Overview | Role-filtered figures, cards and quick actions from real data | "Needs your attention" listed policy paperwork first and cut off at five, so today's missed and unassigned visits could be hidden | Today's care-delivery problems first; items beyond six are named and linked |
| HR & Workforce | Dashboard already lists plain-language actions ("DBS review overdue", "Review employee") linked to records | `hub.tsx` was 3,569 lines; in-memory rate limit | Hub split (no behaviour change); shared rate limit |
| Rota Dashboard, Daily Rota | Approved | none | Untouched; pixel-identical before/after |
| Daily Templates, Unassigned Visits, Coverage History | Approved | none | Untouched; pixel-identical before/after |
| Service Users | Eight tabs, scoped server checks, audited key safe | Hard-coded "Fictional demonstration person" on every record; overview had no care plan, risk or incident summary; contacts only on another tab; absence form always open | Label only for demo organisations; "Care at a glance"; "Key contacts"; absence form folded |
| Care Plans | Clear "In use" version, second-person approval, version history | Register's "Read by carers" was a bare count with no denominator | "x of y booked in 14 days", the same measure as the plan page |
| The Monitor | Clear rings and table | "Alerts reached the office in a median 9215 min over the last day" counted alerts raised today for conditions from days ago | Only conditions from the last day count; plain-English definitions of Late / Missed / Not delivered / Cancelled, with "missed is no recorded attendance, not proof" |
| Missed Calls | Full investigation workflow with sign-off | Banner implied missed = absent | Banner says no attendance was recorded, check first |
| Policy & Compliance | Six workspaces, governance intact | none blocking | Unchanged |
| Finance | Second-person approval, exports only | Week table showed states but not what to do next | Five-step guide and a "Next step" column per week |
| Reporting & Analytics | Already grouped into Care delivery, Workforce, Compliance, Finance with definitions beside each figure | none blocking | Unchanged |
| Administration | Strict `org.manage` checks, audit log | Ten technical pages in one flat list | "Everyday" group and a folded "Advanced" group (opens on its own pages) |
| Evidence | Tenant-scoped, attachment-only downloads | NOT_SCANNED files served with no policy; a scanner error broke the upload with a generic error; malformed scanner answers were treated as clean | Virus-check policy (section 3) |

## 3. Security and reliability fixes (verified)

**A. Demonstration labels.** Confirmed: `src/app/(app)/rota/service-users/[id]/page.tsx` labelled every person
"Fictional demonstration person". It now appears only when the person's organisation has `isDemo = true`.

**B. Evidence files** (`src/server/compliance/evidence.ts`). Confirmed: NOT_SCANNED files downloaded freely; a scanner
HTTP error threw a generic error; a scanner reply without `infected` was recorded as CLEAN. New policy:
- With a scanner, each upload is scanned before storage, with a 20 s timeout. A failed or unclear answer refuses the
  upload and stores nothing. Infected uploads are refused.
- INFECTED files are never served. PENDING and SCAN_FAILED files are held, with a message saying what to do.
- Without a scanner, files are labelled "Not virus-checked" and served only as attachments.
  `EVIDENCE_REQUIRE_SCAN=true` holds them instead.
- When a scanner is added later, an older unchecked file is scanned on its first download; the result is saved and
  audited (`evidence.scanned`).
- Nothing is deleted. Downloads still check permission and organisation first. Missed-call evidence follows the same
  rules.

**C. HR rate limiting** (`src/hr/lib/request-security.ts`). Confirmed: a per-process `Map`. On Vercel each function
instance had its own counter, so limits did not hold. Now counted in a shared Postgres table (`RateLimitWindow`, one
atomic upsert per request), with a per-instance fallback if the database is unreachable. Body-size limits and origin
checks are unchanged.

**D. Database performance.** See section 5.

**E. HR Hub maintainability.** `Imports`, `SettingsPage` (with `PolicyAdministration`) and `CommandPalette` moved
unchanged into their own files. `hub.tsx` is now 2,488 lines (was 3,569). Data storage, permissions and integrations
are untouched; `npm run test:hr` passes.

**F. csb-staging deployment.** What was verified: every pull-request preview on both Vercel projects (`csb-staging`
and `evantix-care`) reports "Deployment has failed" (PRs #47 and #48, for example), while production deploys from
`main` succeed. The build logs are only visible in the Vercel dashboard (`npx vercel inspect <deployment> --logs`), and
this environment has no Vercel access, so **the cause was not confirmed and nothing was changed**. Next step for the
owner: open the failed `csb-staging` deployment in Vercel and copy the last 30 lines of its build log. Two things worth
checking there:
1. Whether the Preview environment has `DATABASE_URL` set. `vercel-build` runs `prisma migrate deploy` first, which
   fails without it.
2. Which database Preview points at. If Preview shares the production `DATABASE_URL`, a PR build would apply that
   PR's migrations to the live demo database before review. A separate preview database (or no migrations on preview
   builds) would prevent that. This needs the owner's decision, so it is listed under proposals.

**G. Multi-tenant isolation.** New integration tests sign in as another agency's manager and confirm they get
"not found" or nothing for this agency's service users, care plans, care plan register, risk assessments, incidents,
recent incidents, medication, visits and evidence (both download routes). Existing tests already cover policies,
finance runs, rota, missed calls, sign-off and admin users across organisations; all still pass.

## 3b. Test results on this branch

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run test:hr` | pass |
| `npm test` | 70 files, 561 tests, all pass (551 existing + 10 new in `tests/integration/platform-quality.test.ts`) |
| `next build` | pass |
| `npm run test:e2e` | 109 tests; 107 passed and 2 of the new tests failed on their own selectors (a second "Reason" field and a second "Audit log" link on the page). Selectors fixed; `tests/e2e/platform-quality.spec.ts` re-run: 8 of 8 pass |
| Protected screens, pixel comparison | Rota Dashboard, Daily Rota, Daily Templates, Unassigned Visits and Policy Library captured from `main` and this branch at the same moment at 1672 × 941: pixel-identical |

Accessibility: the new content uses headings, definition lists, labelled links and native `<details>` disclosure, all
keyboard reachable with the existing focus styles. No automated accessibility scanner is installed in the project, so
no axe-style audit was run.

## 4. Usability changes

Listed in section 2. Each uses existing components (`Card`, `Badge`, `btn-secondary`, the sidebar's fold groups) and
existing server functions with their permission checks (`listRisks`, the incidents visibility rule, care plan scope).
No new dependency. Phone layouts were captured for each changed screen.

## 5. Performance

Measured on production builds of `main` and of this branch, served side by side against the same local demo
database, signed in as the registered manager. Server time to the end of the HTML response, median of five loads
after one warm-up:

| Page | Before: server median (ms) | After: server median (ms) |
|---|---|---|
| /overview | 123 | 99 |
| /rota | 208 | 177 |
| /rota/visits | 136 | 126 |
| /rota/service-users/[id] | 82 | 84 |
| /rota/care-plans | 72 | 72 |
| /rota/monitor | 102 | 92 |
| /rota/finance | 65 | 61 |
| /hr/dashboard | 90 | 71 |
| /analytics | 95 | 94 |
| /settings | 75 | 71 |

Reading: the differences are within run-to-run noise. The new summaries on the service user record and care plan
register add no measurable time. Nothing here is a claimed speed-up. Changes:
- Three indexes for query patterns used by changed or existing screens: `RotaAlert(organisationId, raisedAt)`
  (Monitor), `Incident(serviceUserId, occurredAt)` (service user overview), `EvidenceDocument(organisationId,
  linkedType, linkedId)` (evidence beside its record).
- The care plan register's new read-by figure uses two queries for the whole list, not one per person.

No speed-up is claimed beyond the measured numbers. With demo-sized data Postgres often scans small tables anyway; the
indexes matter as real data grows.

## 6. Schema change

Migration `20261101190000_rate_limit_and_indexes` is additive: one new table (`RateLimitWindow`) and three indexes.
No existing column, constraint or trigger changes. Justification: the shared rate limit needs shared storage, and the
indexes support existing queries. `prisma migrate diff` reports the schema and migrations match.

## 7. Overlap with draft PR #48 (likely merge conflicts)

| File | This PR | PR #48 | Expected |
|---|---|---|---|
| `src/app/(app)/rota/service-users/[id]/page.tsx` | Care at a glance, Key contacts, absence fold, subtitle | Adds the Care Summary | Conflict likely in the overview column; both can keep their cards |
| `src/server/care/care-plans.ts` | Register read-by counts | Small change | Possible small conflict |
| `src/app/(app)/rota/monitor/page.tsx` | Help text at the bottom | Alerts at the top | Probably merges cleanly |
| `prisma/schema.prisma` | New model beside `LoginAttempt`, three indexes | New recruitment models | Probably merges cleanly; migration timestamps are in order (#48 is 170000, this is 190000) |

Whichever PR merges second should be rebased and its tests re-run.

## 8. Known limitations

- Automated tests are not a substitute for trying the screens with real office staff and carers.
- The staging failure cause is unconfirmed (section 3F).
- HR Hub screens (Tailwind 4, prebuilt CSS) were not restyled. Its dashboard already meets the brief's
  "plain-language action with a direct link" pattern.
- Reporting & Analytics and the six Policy & Compliance workspaces were reviewed and left as they are.

## 9. Proposals needing the owner's approval (not built)

1. Preview deployments: use a separate preview database, or skip migrations and seeding on non-production builds.
2. Set `EVIDENCE_REQUIRE_SCAN=true` in production once a scanner (e.g. Defender for Storage) is connected.
3. Rota sidebar: the brief allows simplifying overloaded menus, but the Rota sidebar mirrors OnePlan by the owner's
   rule, so it was left unchanged.

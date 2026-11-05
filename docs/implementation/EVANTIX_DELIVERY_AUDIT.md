# Delivery audit (Phase Zero)

Audited 5 November 2026 against `main` at `92d6070` (dark mode, PR #90), the brief "CLAUDE CODE MASTER DEVELOPMENT BRIEF, P0 & P1". Status is based on code read and tests run in this session, not on earlier claims. "Unverified" means the code exists but nothing in this session proved it works.

Key: **Complete** (works and has tests) · **Partial** (works for part of the job) · **Missing** · **Broken** · **Unverified**.

## Branch reconciliation

- No pull requests were open when the audit started.
- `feature/ai-care-coordinator` is 31 commits ahead of `main`, but 24 of them are the floating-panel and chat work already squash-merged in #78, #86 and #88. Comparing its tip against `main` shows it would delete newer work (Call Notes, Policy Reader, dark mode, search fix), so it must **not** be merged.
- The only work on it that is not on `main` is the user's "Stage 1 no-API council reader" (7 commits, 5 files): `augmentCouncilSupportPlan` in `src/lib/care-coordinator-rules.ts`, `docs/implementation/NO_API_COUNCIL_READER.md`, a unit test and a CI line. No migrations. These 7 commits were cherry-picked onto this branch and kept intact.
- Defect found in that work: the visit-card field pattern had no capture group for the field name, so any document in that layout made the reader throw (`Cannot read properties of undefined (reading 'trim')`). Its own unit test failed for the same reason. Fixed in this branch.

## Feature inventory

| Feature | Current status | Code location | Evidence | Gap | Priority | Work required | Risk | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Care Coordinator intake (upload → facts → coordinator check → manager approval per section → save → draft rota) | Complete (pipe-table layout) | `src/server/care/coordinator/{intake,apply,rota,reader}.ts`, `/rota/coordinator` | `tests/integration/care-coordinator.test.ts` 17/17 passed | None for the existing layout | P0 | None | Clinical: separation of duties relies on a second manager login | Existing test stays green |
| No-API reader, card layout (headings + visit cards) | Broken on `main`'s feature branch → fixed here | `augmentCouncilSupportPlan` in `src/lib/care-coordinator-rules.ts` | New unit (15) and integration (5) tests pass | Was throwing on every card | P0 | Repair (done) | Operational: council plans in this layout could not be read | `care-coordinator-no-api-support-plan.test.ts`, `care-coordinator-no-api.test.ts` |
| Visit-card lines leaking into package facts | Broken → fixed | same | Test "a visit card's end date and staffing stay with the visit" | A card's "End date" would have become the package end date | P0 | Repair (done) | Commercial/clinical: wrong package end | Unit test |
| Discontinued / temporary visits | Missing → added | same | Unit tests | Stopped visits were proposed as current | P0 | New (done) | Operational | Historical, flagged, not counted |
| Funding ambiguity, non-council funders | Partial → completed | `visitFunding()` | Unit tests | Only "family/informal" was recognised; anything else counted as council | P0 | New (done) | Commercial: inflated commissioned hours | Unclear funding flagged, excluded |
| More than 20 carers | Partial → completed | same | Unit test | Silently capped at 20 | P0 | Flag (done) | Operational | Flag shown |
| Contradictory pages | Missing → added | same | Unit test | Same visit on two pages with different times was taken twice silently | P0 | Flag (done) | Operational | Flag shown |
| Commissioned vs carer-hours | Complete | `weeklyTotals`, `reconcileHours` | Unit test (double-up: 420 visit min, 840 carer min) | None | P0 | None | — | Test |
| Hours mismatch blocks finalisation | Complete | `reconcileHours`, apply PACKAGE_HOURS review item | Existing integration test | None | P0 | None | — | Test |
| Nine care-plan sections, "Not documented" | Complete | `applyCarePlan` | Both integration tests | None | P0 | None | — | Test |
| Draft risks, no invented level | Complete | `riskValue`, `approveVerified` skips level-less risks | Both integration tests | None | P0 | None | Clinical | Test |
| Frameworki references | Partial → improved | `src/lib/reference-numbers.ts` | Unit tests | "Frameworki client reference: …" was not recognised | P0 | Repair (done) | — | Test |
| Encrypted reference register | Complete; live needs `CSB_REFERENCE_SECRET` | `src/server/care/external-references.ts` | `reference-numbers.test.ts` | Secret still not confirmed on Vercel | P0 | Owner action | Security | Owner confirms |
| Word documents | Missing | intake accepts the upload; `readIntakeDocument` refuses non-PDF | Code read | No local .docx text extraction in the project | P1 | New (needs a dependency, owner approval) | Operational | Manual entry works today |
| Scanned PDFs / OCR | Partial | blank pages → `unreadable`, status PARTLY_READ/UNREADABLE | Unit test "partially unreadable files" | No OCR | P2 | Evaluate local OCR separately | Operational | Manual entry |
| Floating AI CSB Coordinator chat (no key) | Partial | `src/server/care/coordinator/crm-assistant.ts` | `coordinator-chat.test.ts` | Not yet: "staff unavailable", "why can't this carer be allocated", "what is missing from this package", "tomorrow" | P0 | Extend intents (PR 2) | — | Integration tests per intent |
| Chat upload instructions | Broken wording → fixed | same | Code read | Said Word and images are read; only PDFs with text are | P0 | Fixed | Trust | Text |
| Replacement cover | Complete (per its doc), unverified in this session beyond its tests | `REPLACEMENT_COVER.md`, rota services | Baseline vitest | External messaging off by design | P1 | Audit in PR 5 | Operational | P1 scenario |
| Carer mobile `/carer` | Partial | `/carer` | Baseline vitest + e2e | No GPS, no offline (stated in app) | P1 | PR 6 | Clinical/security | P1 scenario |
| Medication / eMAR | Complete, switched off | medication services | Baseline vitest | Clinical sign-off | P1 | Keep off | Clinical | Owner + clinical lead |
| Finance (timesheets, pay and invoice runs) | Partial | `src/server/finance` | Baseline vitest | No credit notes, no automatic prior-period adjustments | P1 | PR 7 | Commercial | Finance scenario |
| Background worker | Partial | `src/worker`, `/api/jobs/kick`, `/api/cron/tick` | Code read | On Vercel there is no worker: time-critical sweeps only run when a page kicks the queue (up to hourly) or daily cron | P0 | PR 4 (dedicated worker on Azure) | Operational: late/missed call alerts can be late | Worker heartbeat + alert |
| Backups and restore | Missing | none in repo | Code read | No automated backup, no restore test | P0 | PR 4 | Operational | Restore exercise evidence |
| MFA / SSO | Missing | `docs/SECURITY.md` known gaps | Doc | Needed for real health data | P0 | PR 3 | Security | Test |
| Row-level security | Missing (evaluated) | `docs/SECURITY.md` | Doc | App-level scoping only | P1 | PR 3 evaluation | Security | Tenancy tests |
| Malware scanning | Partial | `MALWARE_SCAN_URL` hook | Doc | No scanner configured | P0 | PR 4 | Security | Configured scanner |
| Azure deployment | Unverified | `Dockerfile`, `docs/DEPLOYMENT.md` | Doc says Docker image never built | Not built, no runbook evidence | P0 | PR 4 | Operational | Built image + staging |
| UK GDPR / DSPT / CQC readiness checklist | Missing | — | — | Owner and legal actions | P0 | PR 3 docs | Legal | Owner sign-off |

## Approved designs

No screen layout was changed in this branch. The only user-visible changes are words inside the existing Care Coordinator check screen (flags and the reader note) and the floating assistant's upload answer. Missing visual references named in the brief that are not in the repository: none were needed for this PR.

## Test baseline (main at 92d6070, run 5 Nov 2026 in the cloud container)

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` (vitest, local `csb_test`) | 1,050 passed, 3 failed, 1 file could not load (116 files) |
| `npm run test:hr` | 22 passed, 0 failed |
| `npm run build`, `npm run test:e2e` | Not run in this pass |

The 4 failures on main are all the same environment problem, not product defects: `tests/support/pdf-inspect.ts` loads pdf.js 6.3.289 against a 6.4.299 worker ("The API version does not match the Worker version"). Affected: `tests/unit/document-rendering.test.ts` (whole file) and 3 tests in `tests/integration/document-qa.test.ts` (printable rota, MAR chart). Earlier known time-of-day failures (cutoff, CQC just after midnight) did not occur at 16:25 UTC.

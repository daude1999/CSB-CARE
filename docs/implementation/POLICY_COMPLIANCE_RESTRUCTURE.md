# Policy & Compliance restructure (1 Nov 2026)

Owner's brief: "CSB-CARE — Complete Policy & Compliance module restructure". The owner approved merging once complete and all tests pass.

## What changed for users

The Policy & Compliance sidebar now has six entries. Each entry opens a workspace, and the workspace's tabs are the pages that used to be separate sidebar entries. Those pages keep their old addresses.

| Sidebar entry | Opens | Tabs (old addresses kept) |
|---|---|---|
| Compliance Dashboard | `/` | KPIs (active policies, overdue reviews, awaiting approval, outstanding acknowledgements), Needs attention, Recent activity, Quick actions |
| Policy Library | `/policies` | My Policies, Templates, Archived, Review Calendar, Review & Approval Queue (`/queue`) |
| Regulatory Monitoring | `/compliance/regulatory` → `/changes` | Regulatory Updates (`/changes`), Requirements Register (`/requirements`), Source Status (`/compliance/regulatory/sources`, new) |
| Staff Sign-off | `/staff` (managers) or `/acknowledgements` (staff) | Overview (new), By Employee, By Policy, Overdue, Assignment Rules (`/staff/rules`, new), My Reading List (`/acknowledgements`) |
| Audits & Improvements | `/compliance/improvements` → first tab allowed | Audits & Inspections (`/audits`), Corrective Actions (`/actions`, with a new `/actions/[id]` page), Risk Register (`/compliance/risks`, new), Evidence Library (`/evidence`) |
| Compliance Reports | `/compliance/reports` | Policies, publications, sign-off (overall and by branch/role), audits, findings, corrective actions, risks, evidence. Date range and branch filters; CSV, Excel and PDF |

`/reports` stays in the Reporting & Analytics portal. Resource Centre and Interview Prep moved from the sidebar to the Help menu (question mark in the top bar). Their addresses are unchanged. Interview answers are labelled as guidance.

Policy statuses are now distinct: starter template, draft, under review, approved (awaiting publication), published, not yet approved, review due, overdue and archived.

## The loop: audit → finding → action → evidence → verification → management review

- A finding can name the audit question it came from. Actions can come from a finding or from a risk.
- The action page shows where the action came from, its history and evidence. The owner can attach evidence and complete the action with a note.
- A compliance lead other than the owner verifies the action with a note of what they checked. An action is closed only after verification.
- Risks are reviewed by management with a note and a next review date. A risk cannot be closed while any of its mitigation actions is unverified.

## Risk register

- 5 × 5 scoring of inherent (before controls) and residual (with controls) risk. The residual rating cannot exceed the inherent one.
- Bands: Low 1–3, Moderate 4–6, High 8–12, Extreme 15–25. These are an internal management tool, not a regulatory rating.
- Each risk has a category, branch or organisation scope, controls and their effectiveness, an owner (notified), a review date, a link to a finding, and mitigation actions.
- Every change is kept in `RiskEvent`, which the database makes immutable. Material changes (scores, controls, owner, scope) need a reason. Edits use optimistic concurrency, and references (R-001…) are numbered under an advisory lock.
- Permissions: `risk.view` for ORG_ADMIN, COMPLIANCE_LEAD, CARE_MANAGER and POLICY_APPROVER; `risk.manage` for ORG_ADMIN, COMPLIANCE_LEAD and CARE_MANAGER. Branch-limited members see their branches' risks and organisation-wide ones.

## Evidence

Evidence can be linked to a policy, audit, audit question, finding, corrective action or risk. The link is checked against the caller's own organisation on the server. A file shows as clean only after a malware scan. Without `MALWARE_SCAN_URL` it shows as "Not scanned", never as clean.

## Migration

`prisma/migrations/20261101040000_compliance_risk_register` is additive only:

- new tables `ComplianceRisk` and `RiskEvent`, with CHECK constraints on scores and status
- trigger `risk_event_immutable`, which uses the existing `evx_immutable()`
- nullable `ComplianceAction.riskId`, with a SET NULL foreign key and an index

No existing data is changed.

## Files

- **New server code:** `src/server/compliance/{risks,dashboard,reports}.ts`, `src/app/compliance-actions.ts`, `src/app/api/compliance-reports/[kind]/route.ts`.
- **New pages:** `src/app/(app)/compliance/{regulatory,regulatory/sources,improvements,risks,risks/new,risks/[id],reports}`, `src/app/(app)/staff/rules`, `src/app/(app)/actions/[id]`.
- **New components:** `src/components/{compliance-nav,help-menu,risk-register-ui,evidence-ui}.tsx`.
- **Changed:**
  - `src/server/compliance/{audits,evidence}.ts`: action links to risks, evidence on actions, an atomic action transition, and verify-before-close.
  - `src/server/policies/{assignment,library-view}.ts`: sign-off by group, and the distinct statuses.
  - `src/server/reports/export-files.ts`: an optional header accent colour.
  - `src/lib/navigation.ts`: `activeEntryHref`, so one entry stays lit across its workspace's addresses.
  - `src/components/portal-switcher.tsx` and `src/app/(app)/layout.tsx`.
  - The existing P&C pages: they gained workspace tabs.
- **Tests:**
  - `tests/unit/compliance-module.test.ts`
  - `tests/integration/compliance-module.test.ts`
  - `tests/e2e/compliance.spec.ts`
  - Updated: `tests/e2e/navigation.spec.ts` and `tests/e2e/v1.spec.ts`, for the new sidebar and tab labels.

## Limitations

- There is no settings screen for evidence retention periods.
- Malware scanning depends on `MALWARE_SCAN_URL` being configured. Until it is, files show as "Not scanned".
- There is no bulk upload or import of existing policy documents.
- Source Status shows checks recorded by the monitoring worker. On Vercel, checks run from the daily cron, and simulated sources are labelled as demonstration data.
- Report figures are internal management information. They do not certify compliance and are not CQC ratings.
- No Rota or HR code was changed.

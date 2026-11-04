# CQC Inspection & Evidence with Root Cause Analysis

Owner's brief: "CSB CARE – CQC Inspection & Evidence + Root Cause Analysis (RCA) – Complete Integrated Development
Specification – Version 1" (4 Nov 2026). Built on a feature branch as a draft PR. Not merged, not deployed.

## Business purpose

Managers need one place that shows whether the service is ready for a CQC assessment, the evidence behind that view,
and what is being done about failures. Root cause analysis turns incidents, missed calls and audit findings into
learning and verified improvement, which is itself evidence for Well-led and Safe.

## Where it lives

Policy & Compliance → **CQC Inspection & Evidence** (one sidebar entry, `/compliance/cqc`), with six tabs:

| Tab | Route | What it does |
| --- | --- | --- |
| Overview | `/compliance/cqc` | Filters (branch and service from the database, period, manager). "Needs management attention" warnings sit above every score. Readiness by key question with confidence, assessment status, evidence, improvement, care and workforce figures. Every figure links to the records it counts. |
| CQC Assessment | `/compliance/cqc/assessments`, `/[id]`, `/[id]/areas/[criterionId]` | Start an assessment (branch, service, period, optionally copied from an earlier approved one). Areas by key question with result, evidence and score. Area page: result with rationale (Not applicable needs a reason), evidence with review, improvement actions, history. Submit, approve or return (not by the assessor), snapshots. |
| Evidence | `/compliance/cqc/evidence` | Awaiting review, Gaps, Verified, Outdated, Rejected, All. "Find possible evidence" only adds Suggested links. |
| Root Cause Analysis | `/compliance/cqc/rca`, `/new`, `/[id]` | Figures and recurring themes, filters, list. New investigation (optionally from an incident, missed call, audit finding or risk). Seven step tabs plus escalation decisions, CQC links, who has been told (with email delivery status) and history. |
| Improvement Actions | `/compliance/cqc/actions` | Actions from RCAs and assessments in one list with reference (e.g. `RCA-2026-0001/A2`), source, type, priority, owner, due date, progress and verification. |
| Reports | `/compliance/cqc/reports` | Readiness, RCA and improvement action reports as PDF and CSV. |

`/compliance/cqc/framework` shows the framework version and explains the scoring method. Incidents and missed calls
have a "Start root cause analysis" button (or "Open RCA-…" when one is already open).

## Reused, not duplicated

- **Evidence Library** (`src/server/compliance/evidence.ts`): files attached to an RCA are stored there with
  `linkedType: "RCA"`. Malware scanning stays on the file; verification is a separate status on the CQC link.
- **Corrective actions** (`createAction`, `transitionAction`): RCA and CQC actions are ordinary actions with new
  optional fields (`rcaId`, `rcaFindingId`, `actionType`, `priority`, `evidenceRequired`, `cqcAssessmentId`,
  `cqcCriterionId`). The owner still cannot verify their own action.
- **Notifications** (`notify()`): in-app plus queued email with dedupe keys and retries. Bodies carry only the
  reference and category, never personal or safeguarding detail.
- **Incidents and missed calls** are linked by id. Their references and statuses are never changed by an RCA.
- **Reports** use the existing `toPdfReport` / `toCsv`.
- **Reminders** (`sendCqcReminders`) run in the existing daily `maintenance.tick` job.

## Framework (versioned)

`prisma/seed-data/cqc-framework.ts`, version `CSB-SAF-1.0`: 56 areas (Safe 12, Effective 9, Caring 9, Responsive 11,
Well-led 15) written in CSB's own words from the owner's checklist topics. Each is mapped to the title of a CQC Single
Assessment Framework quality statement and to the 2014 Regulations. It is CSB's own mapping, not CQC text and not
checked by CQC. CQC published draft replacement frameworks in 2026; a confirmed new framework is added as a new
version, and existing assessments keep the version they used. The framework is created on first use, so a hosted
database that is only seeded once still gets it.

## Scoring method `CSB-READINESS-1` (`src/server/cqc/scoring.ts`)

1. Met 100, Partially met 50, Not met 0. Not applicable (with a recorded reason) is left out.
2. An area with no verified, in-date evidence counts for half.
3. Each overdue improvement action on the area takes off 10 points, at most 30.
4. A key question's score is shown only when 75% or more of its areas are assessed. Otherwise it shows Low confidence
   (or Not assessed).
5. The overall score is shown only when all five key questions have high confidence.
6. Critical concerns are warnings, never part of the score, and never hidden by a high score.
7. Closing an RCA or an action changes no figure by itself. Only results and verified evidence do.

Every screen and report with a score carries "Internal CQC Readiness Assessment – Not an Official CQC Rating".

## RCA workflow

New → Investigating → Awaiting review → Actions in progress → Effectiveness review → Closed, with reopen (reason
recorded, history kept). Reference `RCA-YYYY-NNNN` per organisation.

- Steps: what happened, timeline (fact, witness account or assumption), contributing factors and five whys, findings
  (each with its evidence) and conclusions, actions, management review, effectiveness review and closure.
- Before review: summary, a timeline entry, a finding, conclusions and an action. For serious cases (high, critical,
  restricted or safeguarding) every escalation decision is also needed.
- Management review is by someone other than the investigator, who confirms only the supported findings.
- The effectiveness review starts only when every action is verified, and needs every check ticked for "Effective".
- A normal close needs approved findings, all actions verified and an Effective decision. Anything else is an
  "approved exception" with a reason, by a manager other than the investigator.
- Escalation decisions (immediate safety, safeguarding referral, CQC notification, duty of candour, other external
  notification) are recorded. CSB never decides them and never submits anything.
- Restricted (safeguarding) cases are visible only to people with `rca.safeguarding` and the people on the case,
  including their files in the Evidence Library.

## Permissions (`src/server/auth/rbac.ts`)

| Permission | Roles |
| --- | --- |
| cqc.view | Org admin, compliance lead, care manager, policy approver, policy reviewer |
| cqc.assess | Org admin, compliance lead, care manager |
| cqc.approve, cqc.evidence.verify | Org admin, compliance lead, policy approver |
| rca.view | Org admin, compliance lead, care manager, policy approver |
| rca.create | Org admin, compliance lead, care manager |
| rca.investigate | rca.create roles plus care coordinator and policy reviewer |
| rca.approve, rca.safeguarding | Org admin, compliance lead, care manager, policy approver |

Everything is scoped to the session's organisation and branches on the server.

## Database

Migration `20261104150000_cqc_inspection_rca` is additive: new tables `CqcFramework`, `CqcCriterion`,
`CqcAssessment`, `CqcAssessmentResult`, `CqcEvidenceLink`, `CqcReadinessSnapshot`, `RcaInvestigation`,
`RcaSourceLink`, `RcaFinding`, `RcaReview`, `RcaEscalation`, plus nullable columns on `ComplianceAction`. Triggers make
RCA reviews and readiness snapshots immutable. Concurrency: `lockVersion` on assessments and RCAs, `version` on
results, `updatedAt` on evidence decisions.

## Demo data

`npx tsx prisma/seed-cqc.ts` adds synthetic data to a demo database (one Liverpool assessment, evidence decisions,
improvement actions, three investigations). It is not part of the normal seed, so tests and the hosted demo are
unchanged unless someone runs it.

## Tests

- `tests/unit/cqc-scoring.test.ts`: the scoring method.
- `tests/integration/cqc-rca.test.ts`: the spec's scenarios against a real database (assessment, evidence, scoring,
  RCA workflow, RCA to CQC, security and reliability).
- `tests/e2e/cqc-inspection.spec.ts`: the screens in the browser.

## Limitations and assumptions

- The regulatory mapping is CSB's own and has not been checked by CQC or a regulatory adviser.
- Automatic discovery matches by record type and keywords, so suggestions can be wrong. A reviewer decides.
- Email delivery status is what the email provider reports; "sent" does not mean read.
- The Overview's care and workforce figures come from the existing Rota records (care plans, risk assessments,
  readiness) and are only as current as those records.
- Ishikawa diagrams are recorded as notes, not drawn.

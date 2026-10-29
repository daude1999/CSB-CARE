# V1 audit — HR & Workforce and Staff Readiness (29 Oct 2026, read-only)

Requirements: owner's V1 brief §4 and spec Appendices C and F.

## Summary

Solid, tested HR → StaffMember projection and one eligibility service used by every allocation path. But eligibility knows only three coarse HR facts (DBS, Right to work, "Training" checks); no role-specific training requirements, competency, policy-version acknowledgement, qualifications, restrictions, task-level requirements or the five readiness statuses. Acknowledgements and the stub TrainingRecord hang off platform User logins, not HR people. No readiness engine.

## A. Classification

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | HR person record | Working | src/hr/lib/domain.ts:13-44; tests/hr/domain.test.ts |
| 2 | HR compliance checks with evidence, verification, reviewer, next review | Working | domain.ts:45-66; api/hr/hub/route.ts:510-556; tests/unit/business.test.ts:40 |
| 3 | HR requirement rules | Incomplete | src/hr/lib/requirements.ts:4-59 — exact job-title match, one branch; no service/task/level/source/version/effective dates; not versioned |
| 4 | HR reminders | Working | src/hr/lib/reminders.ts |
| 5 | HR tasks | Incomplete | generic; not linked to readiness |
| 6 | HR → StaffMember projection in the HR transaction | Working | workspace-tx.ts:37-49; workforce/projection.ts:91-163; tests/integration/rota.test.ts:37-77 |
| 7 | StaffCompliance projection | Working | projection.ts:60-73; only booleans/dates; categories other than DBS/RTW/Training ignored by eligibility |
| 8 | Eligibility service (14 rules) | Working for what it does | eligibility.ts:109-193; no direct unit test of evaluate() |
| 9 | HR change → flag, never reassign | Working | impact.ts:43-83 |
| 10 | Re-check at confirm assignment | Working | assign.ts:54-69 |
| 11 | Re-check at publish | Missing | build.ts:275-296 |
| 12 | Re-check at clock-in | Missing | attendance.ts:45-80 |
| 13 | Rota staff page with checks + eligibility checker | Working | rota/staff/[id]/page.tsx |
| 14 | Policy acknowledgements | Working for logins only | keyed on User, not StaffMember |
| 15 | TrainingRequirement / TrainingRecord models | Stub | schema.prisma:1019-1050; seed-only |
| 16 | /staff "Staff Sign-off" | Misleading | counts Memberships as people; "100% signed" when nothing assigned |
| 17 | Competency assessments, supervisor sign-off, restrictions, qualifications | Missing | — |
| 18 | Readiness engine, five statuses | Missing | nearest: EligibilityState + HR ReviewStatus |
| 19 | Task-level safeguards | Missing | CareTask has only a name; EligibilityInput has no task input |
| 20 | Controlled exceptions | Incomplete | acceptWarnings without approver/reason/expiry; BLOCK has no path |
| 21 | Branch model | Incomplete | three concepts (HR JSON branch, Prisma Branch.hrBranchKey seed-only, rota Area) |
| 22 | CQC staff-file export | Missing | — |
| 23 | NHS profiles, Care Certificate standards, Oliver McGowan tiers | Defer | — |

## B. Recommended design (dependency order)

Principles: HR stays source of truth for identity/employment/recruitment checks; readiness domain in new Prisma models keyed on StaffMember.id in `src/server/readiness/`; pure-function evaluation; eligibility.ts consumes readiness (NOT_READY/PENDING_VERIFICATION → block per hard-stop; REVIEW_REQUIRED → warning; READY_WITH_RESTRICTIONS → block only for restricted tasks).

1. Branch mapping admin action for `Branch.hrBranchKey`.
2. `ReadinessRequirement` (+ `ReadinessRequirementScope`: jobTitle | branchId | careTaskId | serviceUserId), versioned, classification, requiresPractical, renewalMonths, warningDays, hardStop, effective dates, approval.
3. `StaffTrainingRecord` keyed on staffId+requirementId with provider, dates, result, evidence, assessor, verificationStatus (SUBMITTED|VERIFIED|REJECTED), verifier, exemption; immutable once verified (supersede).
4. `CompetencyAssessment` (method, evidence, assessor, outcome COMPETENT|NOT_YET|COMPETENT_WITH_RESTRICTIONS, restrictions, reviewDue, approval). A requiresPractical requirement is satisfied only by COMPETENT in date.
5. `StaffRestriction` and `ReadinessException` (approver, reason, expiry; never on legal hard stops).
6. Acknowledgement linked to StaffMember (`staffId`), policy applicability by role/branch/task; new publication → not ready until re-acknowledged.
7. Readiness engine: evaluate(staff facts, context) → overall + component statuses + evidence list; `StaffReadinessSnapshot` persisted on change; "Review required" triggers (role/branch change, long absence, incident, policy publication, expiry via cron).
8. Wire into eligibility (careTaskIds input), publish and clock-in; rostering sees status + reasons only.
9. UI: requirements matrix, staff readiness profile at /rota/staff/[id], manager action queue, branch dashboard, staff-file export.
10. Tests per F10.

Regression risks: StaffCompliance rows are recreated on every projection (key on StaffMember.id); VisitAssignment triggers/exclusion; Acknowledgement.userId nullability; demo seed leaves some carers unverified so hard stops change rota.test.ts expectations.

## C. Broken, fake or misleading

/staff page semantics; stub training models; seed-only hrBranchKey; HR Hub hardcoded "Live service readiness" panel and "Care Solution Bureau" branch cards; eligibility ignores non-standard HR categories; no evaluate() unit test; no exception path for BLOCK, uncontrolled override for REVIEW.

# V1 audit — Policy & Compliance (29 Oct 2026, read-only)

Requirements: owner's V1 brief §5 and HealthCareTech spec Appendix E (docs/architecture/HEALTHCARETECH_SPEC_V8_EXTRACT.md).

## A. Classification

### Working and verified (tests ran per TEST_RESULTS.md)

| Area | Where | Evidence |
|---|---|---|
| Version-controlled register (immutable versions, fixed state machine, one published version, optimistic lock) | prisma/migrations/20261024232000_integrity/migration.sql:21-80; src/server/policies/workflow.ts:238-280 | tests/integration/workflow.test.ts |
| Review and approval with separation of duties and configurable approver count | workflow.ts:111-193 | workflow.test.ts; tests/unit/rules.test.ts |
| Immediate and scheduled publication, rollback as new version, master→customer sync | workflow.ts:196-231, 59-86; sync.ts | workflow.test.ts; scenario.test.ts |
| Acknowledgement creation at publication + daily overdue reminder, deduplicated | workflow.ts:265, 282-285, 343-361; src/worker/handlers.ts:34 | workflow.test.ts:150 |
| Implementation confirmation (manager only) | workflow.ts:332-340 | workflow.test.ts |
| Tenant isolation on policies, drafts, search, evidence, acknowledgements | rbac.ts:111-130; library.ts:50,123 | workflow.test.ts:58 |
| Policy Library workspace (tabs, filters, tree, inspector, assign reviewer, archive/restore) | library-view.ts; policies/page.tsx; inspector.tsx | library.test.ts; library-view.test.ts; e2e/library.spec.ts |
| Action lifecycle: fixed flow, completion note, verifier ≠ owner, ActionEvent history | compliance/audits.ts:60-109 | workflow.test.ts:288 |
| Evidence upload: type sniffing, 10 MB, scan hook, org-scoped download with audit entry | compliance/evidence.ts | workflow.test.ts:315 |
| Audit log append-only (DB trigger) | integrity migration:27; audit-log.ts | workflow.test.ts |
| Acknowledgement CSV export (audited) | api/reports/[kind]/route.ts; reports/tables.ts:27-32 | no test |

### Implemented but incomplete

- **Acknowledgement targeting** (workflow.ts:282-285): targets every Membership of the org (or `Policy.branchId` + unassigned, but nothing ever sets `Policy.branchId`). No role/team/individual targeting, no mandatory/optional, priority or owner (E1).
- **Assignment states**: only `acknowledgedAt` and `dueAt`. No opened / in progress / assessment / exempted / withdrawn. "Overdue" derived separately in four places — counts can drift.
- **Wording**: "I have read and understood this policy" overstates (E3 asks for "read … and know where to ask questions").
- **Reassignment on revision**: new rows for everyone every publication; no "material revision" switch; new joiners get no assignment except self-service `logReadAndSign`.
- **Reminders / escalation**: one daily reminder to the staff member; no pre-due reminders, no manager escalation, `remindedAt` never written.
- **Manager dashboard** (/staff): org-wide only, no filters or drill-down; gated on `staff.view` so branch managers see nothing.
- **Evidence export**: name/policy/version/due/signed only.
- **Audits**: no template authoring UI (`audit.manage` unused); findings not editable; `AuditAnswer` upsert-mutable.
- **Actions**: no edit/reassign/filters; `createActionAction` dueDate not zod-validated. No risk register despite page title.
- **Evidence Library**: upload form never sets `linkedType/linkedId`; no search/filter; `retainUntil` unused.
- **Training links**: `TrainingRequirement`/`TrainingRecord` are seed-only stubs keyed on User.

### Broken

1. `completeAudit` (compliance/audits.ts:44-50) completes with unanswered questions.
2. audits/[id]/page.tsx:63 defaults the response select to "MET" — saving without choosing records compliant.
3. `auditScore` (audits.ts:53-58) divides by answered questions, so 1 of 20 scores 100%; list page averages it.
4. No `completedById` on Audit.
5. `Acknowledgement` has no immutability trigger; `acknowledge()`/`logReadAndSign()` update in place.
6. `AuditAnswer` overwritten in place, no history.

### Missing

Assignment model (org/branch/role/individual; mandatory; owner), opened tracking, knowledge check / sign-off, exemption/withdrawal, escalation with history, branch-level dashboards and scoping (`Ctx.branchId` unused), notification log per acknowledgement, full evidence export, retention, assessment model, audit template CRUD, E8 tests.

### Defer (V1)

SMS/WhatsApp channels; mobile app; risk register; further Policy Library redesign (needs owner's "APPROVED — BUILD POLICY LIBRARY"; plan doc status line is stale — redesign is substantially built already).

## B. Ordered gap list (recommended design)

1. Audit integrity: refuse completion with unanswered questions (ValidationError), empty default option with `required`, score `null` while unanswered, `completedById`, AuditAnswerEvent history, trigger freezing COMPLETED audits. Tests.
2. Append-only acknowledgement evidence: `AcknowledgementEvent` (ASSIGNED|OPENED|ACKNOWLEDGED|REMINDED|ESCALATED|EXEMPTED|WITHDRAWN|ASSESSMENT_*|CORRECTED) with immutability trigger; trigger on Acknowledgement forbidding change once acknowledged; store statement text; E3 wording.
3. `PolicyAssignmentRule` (scope ORG|BRANCH|ROLE|JOB_TITLE|STAFF; mandatory; priority; dueDays; owner; withdrawn) resolving to StaffMember (HR projection) → userId where linked; additive columns on Acknowledgement (`staffMemberId`, `ruleId`, `mandatory`, `state`, `openedAt`, exemption fields); one `ackState()` function used everywhere; `materialRevision` flag on publish; reconcile job on staff create/branch change; `markOpened` on policy view; `assignment.manage` permission; branch scoping.
4. Reminders and escalation with events and `remindedAt`.
5. Staff Sign-off dashboard rebuilt around assignments with filters, drill-down, reconciled CSV.
6. Assessment / manager sign-off attempts; training link.
7. Audit template CRUD and audit evidence.
8. Actions and evidence completeness.

## C. Broken, fake or misleading

Complete-audit button; "MET" default; overstated scores; dead `Policy.branchId`; unused `remindedAt`; "understood" wording; "Actions & Risks" title without risks; Evidence Library cannot link; stale plan status line; stat-card rows on four pages.

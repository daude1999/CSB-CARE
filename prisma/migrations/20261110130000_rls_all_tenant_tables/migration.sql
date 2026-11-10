-- Row-level security, step 2: every remaining table that has an organisationId column.
--
-- The role, grants and the meaning of the two settings are in 20261110120000_rls_pilot. This migration only adds
-- policies. It changes no rows. Generated from prisma/schema.prisma; tests/integration/rls-tenancy.test.ts fails if
-- a table with an organisationId column is ever left without a policy.
--
-- Two kinds of table:
--   1. organisationId is required: a row belongs to exactly one organisation.
--   2. organisationId is optional: rows with no organisation are shared, central records (CSB master policies,
--      platform notifications, platform audit entries, queue bookkeeping). Every scope may read and write those;
--      who may do so is decided by the application's platform permissions, as before. Rows that do belong to an
--      organisation are isolated exactly like kind 1.
--
-- Tables without an organisationId column (for example CarePlanSection, VisitTask) are reached through a parent row
-- that is protected here; they are not protected directly. See docs/SECURITY.md.

-- 1. Organisation-owned tables (131)

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Branch"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "HrWorkspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrWorkspace" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HrWorkspace"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "HrFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HrFile"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Acknowledgement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Acknowledgement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Acknowledgement"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Audit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Audit"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AuditFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditFinding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditFinding"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ComplianceAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ComplianceAction"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ComplianceRisk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceRisk" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ComplianceRisk"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "EvidenceDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EvidenceDocument"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "TrainingRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TrainingRecord"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AssistantQuery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssistantQuery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssistantQuery"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffMember"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffCompliance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffCompliance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffCompliance"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaStaffProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaStaffProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaStaffProfile"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Area" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Area"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffArea" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffArea"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffAbsence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAbsence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffAbsence"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAvailability" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffAvailability"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserContact"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserAbsence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserAbsence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserAbsence"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CarePackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarePackage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CarePackage"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CarerPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarerPreference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CarerPreference"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CarePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarePlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CarePlan"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CarePlanAcknowledgement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarePlanAcknowledgement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CarePlanAcknowledgement"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RiskAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RiskAssessment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RiskAssessmentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskAssessmentVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RiskAssessmentVersion"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Incident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Incident" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Incident"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaSettings"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallType"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareTask"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitTemplate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaBuild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaBuild" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaBuild"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Visit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Visit"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitAssignment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitTaskOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitTaskOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitTaskOutcome"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitClock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitClock" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitClock"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitNote"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitEvent"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RunRouteTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RunRouteTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RunRouteTemplate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RunRoute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RunRoute" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RunRoute"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaAlert"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Funder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Funder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Funder"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RateCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateCard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RateCard"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BankHoliday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankHoliday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankHoliday"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffPayRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffPayRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffPayRate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "FinanceSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FinanceSettings"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timesheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Timesheet"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ClockCorrectionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClockCorrectionRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClockCorrectionRequest"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MileageClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MileageClaim" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MileageClaim"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "InvoiceRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PayRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ReadinessRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadinessRequirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReadinessRequirement"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffTrainingRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffTrainingRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffTrainingRecord"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CompetencyAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetencyAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompetencyAssessment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffRestriction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffRestriction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffRestriction"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ReadinessException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReadinessException" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReadinessException"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffReadinessFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffReadinessFlag" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffReadinessFlag"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "StaffReadinessSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffReadinessSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffReadinessSnapshot"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyAssignmentRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyAssignmentRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyAssignmentRule"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AcknowledgementEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcknowledgementEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcknowledgementEvent"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Medication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Medication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Medication"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "VisitMedicationLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitMedicationLead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitMedicationLead"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MarRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MarRecord"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallCase"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallAction"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallComment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaPlan"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaPlanChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaPlanChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaPlanChange"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallCover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallCover" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallCover"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CoverContactAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoverContactAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CoverContactAttempt"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Candidate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CandidateEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateEvent"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CandidateNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateNote"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CandidateScreening" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateScreening" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateScreening"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CandidateInterview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateInterview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CandidateInterview"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RecruitmentSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecruitmentSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecruitmentSettings"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareSummary" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareSummary"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserDocument"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserDocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserDocumentVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserDocumentVersion"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserDocumentVersionStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserDocumentVersionStatus" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserDocumentVersionStatus"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapObservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapObservation"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapReview"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapPhoto" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapPhoto"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapNote"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapRecommendationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapRecommendationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapRecommendationRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapRecommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapRecommendation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapRecommendation"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BodyMapTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMapTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BodyMapTask"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MedicationApplicationSite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MedicationApplicationSite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MedicationApplicationSite"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareIntakeReviewItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareIntakeReviewItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareIntakeReviewItem"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareIntake" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareIntake"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareIntakeFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareIntakeFact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareIntakeFact"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareIntakeSection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareIntakeSection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareIntakeSection"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallCarerConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallCarerConfirmation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallCarerConfirmation"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallCarerResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallCarerResponse" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallCarerResponse"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallInvestigationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallInvestigationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallInvestigationRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "MissedCallInvestigationDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MissedCallInvestigationDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MissedCallInvestigationDraft"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CqcAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CqcAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CqcAssessment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CqcAssessmentResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CqcAssessmentResult" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CqcAssessmentResult"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CqcEvidenceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CqcEvidenceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CqcEvidenceLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CqcReadinessSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CqcReadinessSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CqcReadinessSnapshot"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RcaInvestigation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RcaInvestigation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RcaInvestigation"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RcaSourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RcaSourceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RcaSourceLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RcaFinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RcaFinding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RcaFinding"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RcaReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RcaReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RcaReview"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RcaEscalation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RcaEscalation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RcaEscalation"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ServiceUserReferenceCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceUserReferenceCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceUserReferenceCounter"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "BranchPolicyProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BranchPolicyProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BranchPolicyProfile"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "OrgSourceReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSourceReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgSourceReview"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyBranchScope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyBranchScope" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyBranchScope"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicySourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicySourceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicySourceLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyGenerationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyGenerationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyGenerationRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicySourceGap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicySourceGap" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicySourceGap"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "SafeguardingAuthorityDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SafeguardingAuthorityDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SafeguardingAuthorityDecision"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallNote"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallNoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallNoteItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallNoteItem"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallNoteLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallNoteLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallNoteLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallNoteTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallNoteTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallNoteTask"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CallNoteReferenceCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CallNoteReferenceCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CallNoteReferenceCounter"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyBookmark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyBookmark" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyBookmark"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "FormRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FormRecord"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "FormRecordEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormRecordEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FormRecordEvent"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "FormRecordLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormRecordLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FormRecordLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "DischargeReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DischargeReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DischargeReview"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareInstructionVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareInstructionVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareInstructionVersion"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CareInstructionAck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareInstructionAck" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CareInstructionAck"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CustomerAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerAccount"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "CustomerSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerSubscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerSubscription"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "TenantModuleEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantModuleEntitlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantModuleEntitlement"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "SupportAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportAccessGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupportAccessGrant"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" = current_setting('app.organisation_id', true));

-- 2. Tables with shared (organisation-less) rows (16)

ALTER TABLE "ChangePolicyCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChangePolicyCandidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChangePolicyCandidate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Policy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Policy"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyVersion"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "ImpactAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImpactAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImpactAssessment"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyRevision"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyPublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyPublication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyPublication"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AuditTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditTemplate"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "TrainingRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingRequirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TrainingRequirement"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentChunk"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "RotaProcessingRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RotaProcessingRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RotaProcessingRun"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AccountToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AccountToken"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "PolicyResourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyResourceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PolicyResourceLink"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "FormDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormDefinition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FormDefinition"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

ALTER TABLE "AiUsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiUsageEvent"
  USING (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on' OR "organisationId" IS NULL OR "organisationId" = current_setting('app.organisation_id', true));

-- CreateEnum
CREATE TYPE "ReadinessCategory" AS ENUM ('TRAINING', 'COMPETENCY', 'POLICY', 'QUALIFICATION');

-- CreateEnum
CREATE TYPE "RequirementClassification" AS ENUM ('MANDATORY_ROLE', 'AGENCY_POLICY', 'CONTRACT', 'RECOMMENDED');

-- CreateEnum
CREATE TYPE "ReadinessScopeKind" AS ENUM ('ALL', 'JOB_TITLE', 'BRANCH', 'CARE_TASK', 'SERVICE_USER');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TrainingVerification" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssessmentMethod" AS ENUM ('OBSERVED', 'SIMULATED', 'DISCUSSION', 'WRITTEN');

-- CreateEnum
CREATE TYPE "CompetencyOutcome" AS ENUM ('COMPETENT', 'COMPETENT_WITH_RESTRICTIONS', 'NOT_YET_COMPETENT');

-- CreateEnum
CREATE TYPE "RestrictionKind" AS ENUM ('TASK', 'SERVICE_USER', 'GENERAL');

-- CreateTable
CREATE TABLE "ReadinessRequirement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ReadinessCategory" NOT NULL,
    "classification" "RequirementClassification" NOT NULL DEFAULT 'MANDATORY_ROLE',
    "sourceAuthority" TEXT,
    "sourceRef" TEXT,
    "sourceVersion" TEXT,
    "requiresPractical" BOOLEAN NOT NULL DEFAULT false,
    "renewalMonths" INTEGER,
    "warningDays" INTEGER NOT NULL DEFAULT 30,
    "hardStop" BOOLEAN NOT NULL DEFAULT true,
    "exceptionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "policyId" TEXT,
    "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessScope" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "kind" "ReadinessScopeKind" NOT NULL,
    "jobTitle" TEXT,
    "branchId" TEXT,
    "careTaskId" TEXT,
    "serviceUserId" TEXT,

    CONSTRAINT "ReadinessScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTrainingRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "provider" TEXT,
    "completedAt" DATE NOT NULL,
    "expiresAt" DATE,
    "result" TEXT,
    "evidenceId" TEXT,
    "evidenceNote" TEXT,
    "assessmentType" TEXT,
    "assessor" TEXT,
    "enteredById" TEXT NOT NULL,
    "verificationStatus" "TrainingVerification" NOT NULL DEFAULT 'SUBMITTED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "exemptionRationale" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "careTaskId" TEXT,
    "method" "AssessmentMethod" NOT NULL,
    "observedEvidence" TEXT NOT NULL,
    "assessorId" TEXT NOT NULL,
    "assessorRole" TEXT,
    "outcome" "CompetencyOutcome" NOT NULL,
    "restrictions" TEXT,
    "remedialAction" TEXT,
    "assessedAt" DATE NOT NULL,
    "reviewDue" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetencyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRestriction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" "RestrictionKind" NOT NULL,
    "careTaskId" TEXT,
    "serviceUserId" TEXT,
    "reason" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedById" TEXT,
    "liftedAt" TIMESTAMP(3),
    "liftedReason" TEXT,

    CONSTRAINT "StaffRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessException" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "compensatingControls" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "ReadinessException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffReadinessFlag" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedById" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedById" TEXT,
    "clearedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "StaffReadinessFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "trigger" TEXT NOT NULL,

    CONSTRAINT "StaffReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadinessRequirement_organisationId_status_idx" ON "ReadinessRequirement"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessRequirement_organisationId_key_version_key" ON "ReadinessRequirement"("organisationId", "key", "version");

-- CreateIndex
CREATE INDEX "ReadinessScope_requirementId_idx" ON "ReadinessScope"("requirementId");

-- CreateIndex
CREATE INDEX "StaffTrainingRecord_organisationId_staffId_idx" ON "StaffTrainingRecord"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "StaffTrainingRecord_requirementId_idx" ON "StaffTrainingRecord"("requirementId");

-- CreateIndex
CREATE INDEX "CompetencyAssessment_organisationId_staffId_idx" ON "CompetencyAssessment"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "StaffRestriction_organisationId_staffId_idx" ON "StaffRestriction"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "ReadinessException_organisationId_staffId_idx" ON "ReadinessException"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "StaffReadinessFlag_organisationId_staffId_clearedAt_idx" ON "StaffReadinessFlag"("organisationId", "staffId", "clearedAt");

-- CreateIndex
CREATE INDEX "StaffReadinessSnapshot_organisationId_staffId_evaluatedAt_idx" ON "StaffReadinessSnapshot"("organisationId", "staffId", "evaluatedAt");

-- AddForeignKey
ALTER TABLE "ReadinessRequirement" ADD CONSTRAINT "ReadinessRequirement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessScope" ADD CONSTRAINT "ReadinessScope_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ReadinessRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTrainingRecord" ADD CONSTRAINT "StaffTrainingRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTrainingRecord" ADD CONSTRAINT "StaffTrainingRecord_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ReadinessRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ReadinessRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRestriction" ADD CONSTRAINT "StaffRestriction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessException" ADD CONSTRAINT "ReadinessException_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessException" ADD CONSTRAINT "ReadinessException_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ReadinessRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReadinessFlag" ADD CONSTRAINT "StaffReadinessFlag_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReadinessSnapshot" ADD CONSTRAINT "StaffReadinessSnapshot_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Evidence is append-only: a verified or rejected training record never changes (corrections supersede it);
-- assessments, exceptions-as-granted and snapshots are immutable; restrictions and flags may only be lifted/cleared.
CREATE OR REPLACE FUNCTION csb_training_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Training records are never deleted';
  END IF;
  IF OLD."verificationStatus" <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Training record % is % and immutable', OLD.id, OLD."verificationStatus";
  END IF;
  IF NEW."staffId" <> OLD."staffId" OR NEW."requirementId" <> OLD."requirementId" OR NEW."completedAt" <> OLD."completedAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."enteredById" <> OLD."enteredById" THEN
    RAISE EXCEPTION 'A submitted training record can only be verified or rejected; record a new one to correct it';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER staff_training_record_guard BEFORE UPDATE OR DELETE ON "StaffTrainingRecord"
  FOR EACH ROW EXECUTE FUNCTION csb_training_record_guard();

CREATE TRIGGER competency_assessment_immutable BEFORE UPDATE OR DELETE ON "CompetencyAssessment"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER readiness_snapshot_immutable BEFORE UPDATE OR DELETE ON "StaffReadinessSnapshot"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

CREATE OR REPLACE FUNCTION csb_lift_only_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER staff_restriction_guard BEFORE DELETE ON "StaffRestriction"
  FOR EACH ROW EXECUTE FUNCTION csb_lift_only_guard();
CREATE TRIGGER readiness_exception_guard BEFORE DELETE ON "ReadinessException"
  FOR EACH ROW EXECUTE FUNCTION csb_lift_only_guard();
CREATE TRIGGER readiness_flag_guard BEFORE DELETE ON "StaffReadinessFlag"
  FOR EACH ROW EXECUTE FUNCTION csb_lift_only_guard();

-- Policy assignment and acknowledgement (specification Appendix E). Additive: new tables and nullable columns; the
-- (publicationId, userId) unique key is replaced by partial unique indexes so a correction can add a new row.

-- CreateEnum
CREATE TYPE "PolicyAssignmentScope" AS ENUM ('ORG', 'BRANCH', 'ROLE', 'JOB_TITLE', 'STAFF');

-- CreateEnum
CREATE TYPE "AcknowledgementState" AS ENUM ('ASSIGNED', 'OPENED', 'IN_PROGRESS', 'ACKNOWLEDGED', 'ASSESSMENT_REQUIRED', 'ASSESSMENT_PASSED', 'ASSESSMENT_FAILED', 'EXEMPTED', 'WITHDRAWN');

-- DropIndex
DROP INDEX "Acknowledgement_publicationId_userId_key";

-- AlterTable
ALTER TABLE "Acknowledgement" ADD COLUMN     "assessedAt" TIMESTAMP(3),
ADD COLUMN     "assessedById" TEXT,
ADD COLUMN     "assessmentMethod" TEXT,
ADD COLUMN     "assessmentNote" TEXT,
ADD COLUMN     "assessmentPassMark" INTEGER,
ADD COLUMN     "assessmentScore" INTEGER,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "exemptedAt" TIMESTAMP(3),
ADD COLUMN     "exemptedById" TEXT,
ADD COLUMN     "exemptionReason" TEXT,
ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ruleId" TEXT,
ADD COLUMN     "staffMemberId" TEXT,
ADD COLUMN     "state" "AcknowledgementState" NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnById" TEXT,
ADD COLUMN     "withdrawnReason" TEXT,
ADD COLUMN     "wording" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PolicyPublication" ADD COLUMN     "materialRevision" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PolicyAssignmentRule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "scope" "PolicyAssignmentScope" NOT NULL,
    "branchId" TEXT,
    "orgRole" "OrgRole",
    "jobTitle" TEXT,
    "staffMemberId" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "dueDays" INTEGER NOT NULL DEFAULT 14,
    "requiresAssessment" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawnReason" TEXT,

    CONSTRAINT "PolicyAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcknowledgementEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "acknowledgementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcknowledgementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyAssignmentRule_organisationId_policyId_idx" ON "PolicyAssignmentRule"("organisationId", "policyId");

-- CreateIndex
CREATE INDEX "AcknowledgementEvent_acknowledgementId_at_idx" ON "AcknowledgementEvent"("acknowledgementId", "at");

-- CreateIndex
CREATE INDEX "AcknowledgementEvent_organisationId_type_at_idx" ON "AcknowledgementEvent"("organisationId", "type", "at");

-- CreateIndex
CREATE INDEX "Acknowledgement_publicationId_userId_idx" ON "Acknowledgement"("publicationId", "userId");

-- CreateIndex
CREATE INDEX "Acknowledgement_publicationId_staffMemberId_idx" ON "Acknowledgement"("publicationId", "staffMemberId");

-- CreateIndex
CREATE INDEX "Acknowledgement_organisationId_state_idx" ON "Acknowledgement"("organisationId", "state");

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PolicyAssignmentRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignmentRule" ADD CONSTRAINT "PolicyAssignmentRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignmentRule" ADD CONSTRAINT "PolicyAssignmentRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgementEvent" ADD CONSTRAINT "AcknowledgementEvent_acknowledgementId_fkey" FOREIGN KEY ("acknowledgementId") REFERENCES "Acknowledgement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing rows keep their meaning.
UPDATE "Acknowledgement" SET "state" = 'ACKNOWLEDGED' WHERE "acknowledgedAt" IS NOT NULL;
UPDATE "Acknowledgement" a SET "staffMemberId" = s."id"
  FROM "StaffMember" s WHERE s."userId" = a."userId" AND s."organisationId" = a."organisationId" AND a."staffMemberId" IS NULL;

-- One current (not superseded) row per publication and sign-in, and per publication and staff member.
CREATE UNIQUE INDEX "Acknowledgement_current_user_key" ON "Acknowledgement"("publicationId", "userId") WHERE "supersededAt" IS NULL AND "userId" IS NOT NULL;
CREATE UNIQUE INDEX "Acknowledgement_current_staff_key" ON "Acknowledgement"("publicationId", "staffMemberId") WHERE "supersededAt" IS NULL AND "staffMemberId" IS NOT NULL;
ALTER TABLE "Acknowledgement" ADD CONSTRAINT "Acknowledgement_someone_check" CHECK ("userId" IS NOT NULL OR "staffMemberId" IS NOT NULL);

-- Once acknowledged, the evidence is frozen. Only an assessment outcome may follow, and the row may be marked superseded
-- by a correction (which is a new row). Staff cannot edit or delete their own history.
CREATE OR REPLACE FUNCTION csb_acknowledgement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."acknowledgedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Acknowledgement % is evidence and cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."supersededAt" IS NOT NULL AND (NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" OR NEW."state" <> OLD."state") THEN
    RAISE EXCEPTION 'Acknowledgement % was corrected and is kept as history', OLD.id;
  END IF;
  IF OLD."acknowledgedAt" IS NOT NULL THEN
    IF NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt" OR NEW."wording" IS DISTINCT FROM OLD."wording"
       OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt" OR NEW."publicationId" <> OLD."publicationId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId"
       -- Linking the person's staff record later is allowed; changing it is not.
       OR (OLD."staffMemberId" IS NOT NULL AND NEW."staffMemberId" IS DISTINCT FROM OLD."staffMemberId")
       OR NEW."organisationId" <> OLD."organisationId" THEN
      RAISE EXCEPTION 'Acknowledgement % is evidence and cannot be changed; record a correction instead', OLD.id;
    END IF;
    IF NEW."state" <> OLD."state" AND NOT (
         (OLD."state" IN ('ASSESSMENT_REQUIRED', 'ASSESSMENT_FAILED') AND NEW."state" IN ('ASSESSMENT_PASSED', 'ASSESSMENT_FAILED'))
       ) THEN
      RAISE EXCEPTION 'Acknowledgement % cannot move from % to %', OLD.id, OLD."state", NEW."state";
    END IF;
    IF OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
      RAISE EXCEPTION 'Acknowledgement % correction marker is fixed', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER acknowledgement_guard BEFORE UPDATE OR DELETE ON "Acknowledgement"
  FOR EACH ROW EXECUTE FUNCTION csb_acknowledgement_guard();

-- The event history is append-only.
CREATE TRIGGER acknowledgement_event_immutable BEFORE UPDATE OR DELETE ON "AcknowledgementEvent"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

-- Assignment rules are withdrawn, never deleted (except with their organisation or policy).
CREATE OR REPLACE FUNCTION csb_assignment_rule_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."withdrawnAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Assignment rule % is withdrawn and kept as history', OLD.id;
  END IF;
  IF NEW."policyId" <> OLD."policyId" OR NEW."scope" <> OLD."scope" OR NEW."organisationId" <> OLD."organisationId" THEN
    RAISE EXCEPTION 'An assignment rule cannot be repointed; withdraw it and create another';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER policy_assignment_rule_guard BEFORE UPDATE ON "PolicyAssignmentRule"
  FOR EACH ROW EXECUTE FUNCTION csb_assignment_rule_guard();

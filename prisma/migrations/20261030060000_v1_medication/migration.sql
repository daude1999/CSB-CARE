-- V1 medication (MAR): per-person medicines approved by a second person, append-only dose records, and an
-- organisation switch that stays off until an admin records a clinical review.
-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'STOPPED');

-- CreateEnum
CREATE TYPE "MarOutcome" AS ENUM ('GIVEN', 'PROMPTED', 'REFUSED', 'NOT_GIVEN', 'NOT_REQUIRED');

-- AlterTable
ALTER TABLE "RotaSettings" ADD COLUMN     "medicationEnabledAt" TIMESTAMP(3),
ADD COLUMN     "medicationEnabledById" TEXT,
ADD COLUMN     "medicationReviewNote" TEXT;

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "dose" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "support" TEXT NOT NULL,
    "timeRanges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "asRequired" BOOLEAN NOT NULL DEFAULT false,
    "maxDosesPerDay" INTEGER,
    "controlled" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "prescriber" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "MedicationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "stoppedById" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "replacesId" TEXT,
    "changeReason" TEXT,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "staffId" TEXT,
    "outcome" "MarOutcome" NOT NULL,
    "reason" TEXT,
    "witnessName" TEXT,
    "recordedById" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "MarRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Medication_organisationId_serviceUserId_status_idx" ON "Medication"("organisationId", "serviceUserId", "status");

-- CreateIndex
CREATE INDEX "MarRecord_visitId_idx" ON "MarRecord"("visitId");

-- CreateIndex
CREATE INDEX "MarRecord_medicationId_at_idx" ON "MarRecord"("medicationId", "at");

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarRecord" ADD CONSTRAINT "MarRecord_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarRecord" ADD CONSTRAINT "MarRecord_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Medication safety rules, enforced in the database as well as the code.
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_route_check" CHECK ("route" IN ('ORAL', 'TOPICAL', 'INHALED', 'EYE', 'EAR', 'NASAL', 'TRANSDERMAL', 'OTHER'));
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_support_check" CHECK ("support" IN ('PROMPT', 'ASSIST', 'ADMINISTER'));
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_due_check" CHECK ("asRequired" OR cardinality("timeRanges") > 0);
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

CREATE OR REPLACE FUNCTION csb_medication_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'An approved medicine is part of the record and cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'A medicine starts as a draft'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'STOPPED' THEN RAISE EXCEPTION 'A stopped medicine cannot change'; END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'STOPPED') THEN RAISE EXCEPTION 'An approved medicine can only be stopped'; END IF;
  IF NEW."status" = 'ACTIVE' AND OLD."status" = 'DRAFT' THEN
    IF NEW."approvedById" IS NULL OR NEW."approvedById" = NEW."createdById" THEN RAISE EXCEPTION 'Someone other than the person who entered a medicine must approve it'; END IF;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."name" <> OLD."name" OR NEW."dose" <> OLD."dose" OR NEW."route" <> OLD."route" OR NEW."support" <> OLD."support"
     OR NEW."timeRanges" <> OLD."timeRanges" OR NEW."asRequired" <> OLD."asRequired" OR NEW."controlled" <> OLD."controlled"
     OR NEW."strength" IS DISTINCT FROM OLD."strength" OR NEW."instructions" IS DISTINCT FROM OLD."instructions" OR NEW."startDate" <> OLD."startDate"
     OR NEW."maxDosesPerDay" IS DISTINCT FROM OLD."maxDosesPerDay" OR NEW."createdById" <> OLD."createdById") THEN
    RAISE EXCEPTION 'An approved medicine cannot be edited; record a change instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_guard BEFORE INSERT OR UPDATE OR DELETE ON "Medication"
  FOR EACH ROW EXECUTE FUNCTION csb_medication_guard();

-- MAR records: never deleted or edited; the only change allowed is marking a record superseded, once.
CREATE OR REPLACE FUNCTION csb_mar_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MAR records are evidence and cannot be deleted'; END IF;
  IF OLD."supersededAt" IS NOT NULL THEN RAISE EXCEPTION 'A superseded MAR record cannot change'; END IF;
  IF NEW."outcome" <> OLD."outcome" OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."at" <> OLD."at" OR NEW."visitId" <> OLD."visitId"
     OR NEW."medicationId" <> OLD."medicationId" OR NEW."recordedById" <> OLD."recordedById" OR NEW."staffId" IS DISTINCT FROM OLD."staffId"
     OR NEW."witnessName" IS DISTINCT FROM OLD."witnessName" OR NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId" THEN
    RAISE EXCEPTION 'MAR records cannot be edited; record a correction instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mar_record_guard BEFORE UPDATE OR DELETE ON "MarRecord"
  FOR EACH ROW EXECUTE FUNCTION csb_mar_record_guard();

-- One live record per scheduled dose per visit is enforced in the code (as-required doses may repeat).

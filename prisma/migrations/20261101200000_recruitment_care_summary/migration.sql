-- Recruitment inside HR & Workforce, and Care Summary inside Care Plans (owner's integrated care-intelligence brief, 1 Nov 2026). Additive only.
-- CreateEnum
CREATE TYPE "RecruitmentStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'ONBOARDING', 'READY', 'WITHDRAWN', 'UNSUCCESSFUL');

-- CreateEnum
CREATE TYPE "RightToWorkStatus" AS ENUM ('NOT_CHECKED', 'IN_PROGRESS', 'VERIFIED', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CONFIRMED', 'DECLINED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "CarePlan" ADD COLUMN     "sourceSummaryId" TEXT;

-- AlterTable
ALTER TABLE "RotaSettings" ADD COLUMN     "careSummaryEnabledAt" TIMESTAMP(3),
ADD COLUMN     "careSummaryEnabledById" TEXT,
ADD COLUMN     "careSummaryReviewNote" TEXT;

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "roleApplied" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "availability" TEXT,
    "experience" TEXT,
    "driving" TEXT NOT NULL DEFAULT 'NOT_ASKED',
    "rightToWork" "RightToWorkStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "source" TEXT,
    "stage" "RecruitmentStage" NOT NULL DEFAULT 'APPLIED',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationComplete" BOOLEAN NOT NULL DEFAULT true,
    "outstandingDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recruiterId" TEXT,
    "nextAction" TEXT,
    "nextActionDue" DATE,
    "contactConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentRecordedAt" TIMESTAMP(3),
    "offerMadeAt" TIMESTAMP(3),
    "offerResponse" TEXT,
    "offerRespondedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "retainUntil" DATE,
    "anonymisedAt" TIMESTAMP(3),
    "hrEmployeeId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStage" "RecruitmentStage",
    "toStage" "RecruitmentStage",
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CandidateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateNote" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateScreening" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "reviewOutcome" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateInterview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 45,
    "location" TEXT,
    "interviewerId" TEXT NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentSettings" (
    "organisationId" TEXT NOT NULL,
    "remindersOn" BOOLEAN NOT NULL DEFAULT true,
    "incompleteAfterDays" INTEGER NOT NULL DEFAULT 3,
    "screeningAfterDays" INTEGER NOT NULL DEFAULT 3,
    "interviewConfirmHours" INTEGER NOT NULL DEFAULT 48,
    "referencesAfterDays" INTEGER NOT NULL DEFAULT 7,
    "onboardingDocsAfterDays" INTEGER NOT NULL DEFAULT 5,
    "trainingAfterDays" INTEGER NOT NULL DEFAULT 7,
    "retentionMonths" INTEGER NOT NULL DEFAULT 6,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentSettings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "CareSummary" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sources" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "CareSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Candidate_organisationId_stage_idx" ON "Candidate"("organisationId", "stage");

-- CreateIndex
CREATE INDEX "Candidate_organisationId_branchId_idx" ON "Candidate"("organisationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organisationId_reference_key" ON "Candidate"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organisationId_hrEmployeeId_key" ON "Candidate"("organisationId", "hrEmployeeId");

-- CreateIndex
CREATE INDEX "CandidateEvent_candidateId_at_idx" ON "CandidateEvent"("candidateId", "at");

-- CreateIndex
CREATE INDEX "CandidateNote_candidateId_idx" ON "CandidateNote"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateScreening_candidateId_idx" ON "CandidateScreening"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateInterview_organisationId_startsAt_idx" ON "CandidateInterview"("organisationId", "startsAt");

-- CreateIndex
CREATE INDEX "CandidateInterview_candidateId_idx" ON "CandidateInterview"("candidateId");

-- CreateIndex
CREATE INDEX "CareSummary_organisationId_serviceUserId_createdAt_idx" ON "CareSummary"("organisationId", "serviceUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateEvent" ADD CONSTRAINT "CandidateEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateInterview" ADD CONSTRAINT "CandidateInterview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Fixed vocabularies, checked by the database as well as the application.
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_driving_check" CHECK ("driving" IN ('DRIVER_WITH_CAR', 'DRIVER_NO_CAR', 'NON_DRIVER', 'NOT_ASKED'));
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_offer_check" CHECK ("offerResponse" IS NULL OR "offerResponse" IN ('PENDING', 'ACCEPTED', 'DECLINED'));
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_closed_check" CHECK (("stage" IN ('WITHDRAWN', 'UNSUCCESSFUL')) = ("closedAt" IS NOT NULL));
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_channel_check" CHECK ("channel" IN ('PHONE', 'IN_PERSON', 'PAPER'));
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_review_check" CHECK ("reviewOutcome" IS NULL OR "reviewOutcome" IN ('PROCEED', 'HOLD'));
ALTER TABLE "CandidateInterview" ADD CONSTRAINT "CandidateInterview_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('PASSED', 'NOT_PASSED'));
ALTER TABLE "CandidateInterview" ADD CONSTRAINT "CandidateInterview_duration_check" CHECK ("durationMin" BETWEEN 10 AND 480);
ALTER TABLE "CareSummary" ADD CONSTRAINT "CareSummary_status_check" CHECK ("status" IN ('UNREVIEWED', 'REVIEWED', 'DISMISSED'));
ALTER TABLE "CareSummary" ADD CONSTRAINT "CareSummary_dates_check" CHECK ("fromDate" <= "toDate");

-- A candidate's history is never rewritten.
CREATE OR REPLACE FUNCTION candidate_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Candidate history cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER candidate_event_no_update BEFORE UPDATE ON "CandidateEvent" FOR EACH ROW EXECUTE FUNCTION candidate_event_immutable();

-- A summary's content and sources are frozen once stored; only its review fields may change.
CREATE OR REPLACE FUNCTION care_summary_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."output" IS DISTINCT FROM OLD."output" OR NEW."sources" IS DISTINCT FROM OLD."sources" OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."serviceUserId" IS DISTINCT FROM OLD."serviceUserId" OR NEW."fromDate" IS DISTINCT FROM OLD."fromDate" OR NEW."toDate" IS DISTINCT FROM OLD."toDate" THEN
    RAISE EXCEPTION 'A care summary cannot be changed once stored';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER care_summary_no_rewrite BEFORE UPDATE ON "CareSummary" FOR EACH ROW EXECUTE FUNCTION care_summary_frozen();

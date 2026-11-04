-- Missed call automation: evidence runs, carer confirmations (the booked-carer snapshot), append-only carer statements
-- and rules-based suggestions. Additive only: new tables and new RotaSettings columns, every switch off by default.

-- AlterTable
ALTER TABLE "RotaSettings" ADD COLUMN     "missedAutoConfirmAt" TIMESTAMP(3),
ADD COLUMN     "missedAutoConfirmById" TEXT,
ADD COLUMN     "missedAutoEvidenceAt" TIMESTAMP(3),
ADD COLUMN     "missedAutoEvidenceById" TEXT,
ADD COLUMN     "missedAutoSummaryAt" TIMESTAMP(3),
ADD COLUMN     "missedAutoSummaryById" TEXT,
ADD COLUMN     "missedConfirmMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "missedConfirmReminderMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "missedConfirmReminders" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MissedCallCarerConfirmation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "slot" "AssignmentSlot" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "userIdAtDetection" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "requestedAt" TIMESTAMP(3),
    "notificationId" TEXT,
    "notificationOpenedAt" TIMESTAMP(3),
    "responseDueAt" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissedCallCarerConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedCallCarerResponse" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "reportedArrival" TIMESTAMP(3),
    "reportedDeparture" TIMESTAMP(3),
    "careDelivered" TEXT,
    "unableReason" TEXT,
    "notifiedSomeone" BOOLEAN,
    "notifiedWho" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "contacted" TEXT,
    "explanation" TEXT NOT NULL,
    "supplementsId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedCallCarerResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedCallInvestigationRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "requestedById" TEXT,
    "jobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "fingerprint" TEXT,
    "error" TEXT,
    "processingVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MissedCallInvestigationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedCallInvestigationDraft" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "suggestedReason" TEXT,
    "classification" TEXT NOT NULL,
    "support" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "generator" TEXT NOT NULL DEFAULT 'rules-v1',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedCallInvestigationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissedCallCarerConfirmation_organisationId_staffId_status_idx" ON "MissedCallCarerConfirmation"("organisationId", "staffId", "status");

-- CreateIndex
CREATE INDEX "MissedCallCarerConfirmation_status_responseDueAt_idx" ON "MissedCallCarerConfirmation"("status", "responseDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "MissedCallCarerConfirmation_caseId_staffId_key" ON "MissedCallCarerConfirmation"("caseId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "MissedCallCarerResponse_submissionKey_key" ON "MissedCallCarerResponse"("submissionKey");

-- CreateIndex
CREATE INDEX "MissedCallCarerResponse_confirmationId_submittedAt_idx" ON "MissedCallCarerResponse"("confirmationId", "submittedAt");

-- CreateIndex
CREATE INDEX "MissedCallInvestigationRun_caseId_startedAt_idx" ON "MissedCallInvestigationRun"("caseId", "startedAt");

-- CreateIndex
CREATE INDEX "MissedCallInvestigationDraft_caseId_createdAt_idx" ON "MissedCallInvestigationDraft"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "MissedCallCarerConfirmation" ADD CONSTRAINT "MissedCallCarerConfirmation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallCarerConfirmation" ADD CONSTRAINT "MissedCallCarerConfirmation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallCarerResponse" ADD CONSTRAINT "MissedCallCarerResponse_confirmationId_fkey" FOREIGN KEY ("confirmationId") REFERENCES "MissedCallCarerConfirmation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallInvestigationRun" ADD CONSTRAINT "MissedCallInvestigationRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallInvestigationDraft" ADD CONSTRAINT "MissedCallInvestigationDraft_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallInvestigationDraft" ADD CONSTRAINT "MissedCallInvestigationDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissedCallInvestigationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One PENDING suggestion per case at a time.
CREATE UNIQUE INDEX "MissedCallInvestigationDraft_one_pending" ON "MissedCallInvestigationDraft"("caseId") WHERE "reviewStatus" = 'PENDING';

-- Carer statements: written only by the carer the confirmation belongs to, in its organisation, and never changed.
CREATE OR REPLACE FUNCTION csb_missed_response_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A carer statement cannot be changed. Add a further statement instead.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "MissedCallCarerConfirmation" c WHERE c.id = NEW."confirmationId" AND c."organisationId" = NEW."organisationId" AND c."staffId" = NEW."staffId") THEN
    RAISE EXCEPTION 'A carer statement must come from the carer the request was made to';
  END IF;
  IF NEW."supplementsId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "MissedCallCarerResponse" r WHERE r.id = NEW."supplementsId" AND r."confirmationId" = NEW."confirmationId") THEN
    RAISE EXCEPTION 'A further statement must add to a statement on the same request';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER missed_response_guard BEFORE INSERT OR UPDATE ON "MissedCallCarerResponse"
  FOR EACH ROW EXECUTE FUNCTION csb_missed_response_guard();

-- The booked-carer snapshot cannot be rewritten: who was booked, in which place, with which sign-in.
CREATE OR REPLACE FUNCTION csb_missed_confirmation_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW."organisationId", NEW."caseId", NEW."staffId", NEW."assignmentId", NEW.slot, NEW.position, NEW."userIdAtDetection", NEW."createdAt")
     IS DISTINCT FROM (OLD."organisationId", OLD."caseId", OLD."staffId", OLD."assignmentId", OLD.slot, OLD.position, OLD."userIdAtDetection", OLD."createdAt") THEN
    RAISE EXCEPTION 'Who was booked on a missed visit cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER missed_confirmation_guard BEFORE UPDATE ON "MissedCallCarerConfirmation"
  FOR EACH ROW EXECUTE FUNCTION csb_missed_confirmation_guard();

-- An evidence run is frozen once it has finished.
CREATE OR REPLACE FUNCTION csb_missed_run_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'UNCHANGED', 'FAILED') THEN
    RAISE EXCEPTION 'A finished evidence run cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER missed_run_guard BEFORE UPDATE ON "MissedCallInvestigationRun"
  FOR EACH ROW EXECUTE FUNCTION csb_missed_run_guard();

-- A suggestion's content is fixed; only its review is recorded, once, while it is pending.
CREATE OR REPLACE FUNCTION csb_missed_draft_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."reviewStatus" <> 'PENDING' THEN
    RAISE EXCEPTION 'This suggestion has already been reviewed';
  END IF;
  IF (NEW."organisationId", NEW."caseId", NEW."runId", NEW."suggestedReason", NEW.classification, NEW.support, NEW.summary::text, NEW.generator, NEW."createdAt")
     IS DISTINCT FROM (OLD."organisationId", OLD."caseId", OLD."runId", OLD."suggestedReason", OLD.classification, OLD.support, OLD.summary::text, OLD.generator, OLD."createdAt") THEN
    RAISE EXCEPTION 'A suggestion cannot be edited';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER missed_draft_guard BEFORE UPDATE ON "MissedCallInvestigationDraft"
  FOR EACH ROW EXECUTE FUNCTION csb_missed_draft_guard();

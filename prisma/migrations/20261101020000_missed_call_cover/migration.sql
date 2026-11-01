-- Find Cover for missed calls: linked recovery visits and a record of each replacement booked. Additive only.

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN "recoveryOfId" TEXT;

-- AlterTable
ALTER TABLE "MissedCallCase" ADD COLUMN "suInformedStatus" TEXT,
ADD COLUMN "suInformedNote" TEXT,
ADD COLUMN "suInformedById" TEXT,
ADD COLUMN "suInformedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MissedCallCover" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'RECOVERY_VISIT',
    "recoveryVisitId" TEXT NOT NULL,
    "slot" "AssignmentSlot" NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "originalStaffId" TEXT,
    "staffId" TEXT NOT NULL,
    "proposedStart" TIMESTAMP(3) NOT NULL,
    "proposedEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "recommendedRank" INTEGER,
    "suggestedStaffIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibility" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "warningsAccepted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warningReason" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifyStatus" TEXT NOT NULL,
    "notificationId" TEXT,

    CONSTRAINT "MissedCallCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_recoveryOfId_idx" ON "Visit"("recoveryOfId");
CREATE INDEX "MissedCallCover_caseId_idx" ON "MissedCallCover"("caseId");
CREATE INDEX "MissedCallCover_organisationId_staffId_idx" ON "MissedCallCover"("organisationId", "staffId");
CREATE INDEX "MissedCallCover_recoveryVisitId_idx" ON "MissedCallCover"("recoveryVisitId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_recoveryOfId_fkey" FOREIGN KEY ("recoveryOfId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MissedCallCover" ADD CONSTRAINT "MissedCallCover_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissedCallCover" ADD CONSTRAINT "MissedCallCover_recoveryVisitId_fkey" FOREIGN KEY ("recoveryVisitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A recovery visit belongs to the same organisation as the missed visit it recovers, and is never its own recovery.
CREATE OR REPLACE FUNCTION csb_visit_recovery_guard() RETURNS trigger AS $$
DECLARE o text;
BEGIN
  IF NEW."recoveryOfId" IS NOT NULL THEN
    IF NEW."recoveryOfId" = NEW.id THEN RAISE EXCEPTION 'A visit cannot recover itself'; END IF;
    SELECT "organisationId" INTO o FROM "Visit" WHERE id = NEW."recoveryOfId";
    IF o IS DISTINCT FROM NEW."organisationId" THEN RAISE EXCEPTION 'Recovery visit organisation must match the missed visit'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_recovery_guard BEFORE INSERT OR UPDATE OF "recoveryOfId" ON "Visit"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_recovery_guard();

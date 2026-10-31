-- CreateEnum
CREATE TYPE "MissedCallStage" AS ENUM ('NEW', 'INVESTIGATING', 'AWAITING_SIGNOFF', 'CLOSED');

-- AlterTable
ALTER TABLE "RotaSettings" ADD COLUMN     "repeatClientCount" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "repeatOffenderCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "repeatWindowDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "MissedCallCase" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "staffId" TEXT,
    "serviceUserId" TEXT NOT NULL,
    "areaId" TEXT,
    "callTypeId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage" "MissedCallStage" NOT NULL DEFAULT 'NEW',
    "deadline" TIMESTAMP(3),
    "coordinatorId" TEXT,
    "coordinatorAssignedAt" TIMESTAMP(3),
    "reasonCode" TEXT,
    "reasonDetail" TEXT,
    "findings" TEXT,
    "reasonRecordedById" TEXT,
    "reasonRecordedAt" TIMESTAMP(3),
    "replacementType" TEXT,
    "replacementStaffId" TEXT,
    "replacementArrivedAt" TIMESTAMP(3),
    "clientInformed" TEXT,
    "replacementNote" TEXT,
    "replacementWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replacementById" TEXT,
    "replacementAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalatedById" TEXT,
    "escalationNote" TEXT,
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "preventable" BOOLEAN,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "signOffNote" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissedCallCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedCallAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedCallAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedCallComment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "body" TEXT NOT NULL,
    "evidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedCallComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissedCallCase_visitId_key" ON "MissedCallCase"("visitId");

-- CreateIndex
CREATE INDEX "MissedCallCase_organisationId_scheduledStart_idx" ON "MissedCallCase"("organisationId", "scheduledStart");

-- CreateIndex
CREATE INDEX "MissedCallCase_organisationId_stage_idx" ON "MissedCallCase"("organisationId", "stage");

-- CreateIndex
CREATE INDEX "MissedCallCase_organisationId_staffId_idx" ON "MissedCallCase"("organisationId", "staffId");

-- CreateIndex
CREATE INDEX "MissedCallCase_organisationId_serviceUserId_idx" ON "MissedCallCase"("organisationId", "serviceUserId");

-- CreateIndex
CREATE INDEX "MissedCallAction_organisationId_ownerId_doneAt_idx" ON "MissedCallAction"("organisationId", "ownerId", "doneAt");

-- CreateIndex
CREATE INDEX "MissedCallAction_caseId_idx" ON "MissedCallAction"("caseId");

-- CreateIndex
CREATE INDEX "MissedCallComment_caseId_createdAt_idx" ON "MissedCallComment"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "MissedCallCase" ADD CONSTRAINT "MissedCallCase_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallAction" ADD CONSTRAINT "MissedCallAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCallComment" ADD CONSTRAINT "MissedCallComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every visit that is already missed gets its case, so history starts complete.
INSERT INTO "MissedCallCase" ("id", "organisationId", "visitId", "staffId", "serviceUserId", "areaId", "callTypeId", "scheduledStart", "detectedAt", "stage", "deadline", "updatedAt")
SELECT 'mc_' || substr(md5(v."id"), 1, 22), v."organisationId", v."id",
       (SELECT a."staffId" FROM "VisitAssignment" a WHERE a."visitId" = v."id" AND a."removedAt" IS NULL ORDER BY (a."slot" = 'PRIMARY') DESC, a."slot" LIMIT 1),
       v."serviceUserId", v."areaId", v."callTypeId", v."scheduledStart", v."statusChangedAt", 'NEW', v."statusChangedAt" + interval '30 minutes', now()
FROM "Visit" v
WHERE v."status" = 'MISSED'
ON CONFLICT ("visitId") DO NOTHING;

-- Comments are a permanent record.
CREATE OR REPLACE FUNCTION missed_call_comment_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Missed-call comments cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER missed_call_comment_immutable BEFORE UPDATE ON "MissedCallComment" FOR EACH ROW EXECUTE FUNCTION missed_call_comment_immutable();

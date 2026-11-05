-- CreateTable
CREATE TABLE "CallNote" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "communicationAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "contactId" TEXT,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "originalText" TEXT NOT NULL,
    "clarification" TEXT,
    "sourceDocumentId" TEXT,
    "sourceLabel" TEXT,
    "intakeId" TEXT,
    "intakeFactId" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "reader" TEXT,
    "proposal" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "urgentKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalatedAt" TIMESTAMP(3),
    "escalationNote" TEXT,
    "escalationById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CallNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNoteItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "callNoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "quote" TEXT,
    "quoteFound" BOOLEAN NOT NULL DEFAULT true,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "aiKind" TEXT,
    "aiDestination" TEXT,
    "duplicate" TEXT NOT NULL DEFAULT 'NEW',
    "duplicateRef" TEXT,
    "duplicateLabel" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'KEEP',
    "reviewItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNoteRevision" (
    "id" TEXT NOT NULL,
    "callNoteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNoteLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "callNoteId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallNoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNoteTask" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "callNoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidenceDocumentId" TEXT,
    "completionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CallNoteTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallNoteReferenceCounter" (
    "organisationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CallNoteReferenceCounter_pkey" PRIMARY KEY ("organisationId","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallNote_intakeFactId_key" ON "CallNote"("intakeFactId");

-- CreateIndex
CREATE INDEX "CallNote_organisationId_serviceUserId_communicationAt_idx" ON "CallNote"("organisationId", "serviceUserId", "communicationAt");

-- CreateIndex
CREATE INDEX "CallNote_organisationId_status_idx" ON "CallNote"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CallNote_organisationId_reference_key" ON "CallNote"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CallNote_organisationId_submissionKey_key" ON "CallNote"("organisationId", "submissionKey");

-- CreateIndex
CREATE INDEX "CallNoteItem_callNoteId_position_idx" ON "CallNoteItem"("callNoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CallNoteRevision_callNoteId_version_key" ON "CallNoteRevision"("callNoteId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CallNoteLink_callNoteId_targetType_targetId_key" ON "CallNoteLink"("callNoteId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "CallNoteTask_organisationId_status_dueOn_idx" ON "CallNoteTask"("organisationId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "CallNoteTask_callNoteId_idx" ON "CallNoteTask"("callNoteId");

-- CreateIndex
CREATE INDEX "CallNoteTask_assigneeId_status_idx" ON "CallNoteTask"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "CallNote" ADD CONSTRAINT "CallNote_serviceUserId_organisationId_fkey" FOREIGN KEY ("serviceUserId", "organisationId") REFERENCES "ServiceUser"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNoteItem" ADD CONSTRAINT "CallNoteItem_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNoteRevision" ADD CONSTRAINT "CallNoteRevision_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNoteLink" ADD CONSTRAINT "CallNoteLink_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallNoteTask" ADD CONSTRAINT "CallNoteTask_callNoteId_fkey" FOREIGN KEY ("callNoteId") REFERENCES "CallNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Call Notes are communication history: a revision is never edited or deleted, a note is never deleted, and the
-- original text and the organiser's proposal are frozen once the note leaves draft (corrections add a revision).
CREATE TRIGGER call_note_revision_immutable BEFORE UPDATE OR DELETE ON "CallNoteRevision"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

CREATE OR REPLACE FUNCTION csb_call_note_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Call Notes are never deleted';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."originalText" IS DISTINCT FROM OLD."originalText" OR NEW."proposal"::text IS DISTINCT FROM OLD."proposal"::text OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."serviceUserId" IS DISTINCT FROM OLD."serviceUserId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'The original text, source, reference and author of a saved Call Note cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER call_note_guard BEFORE UPDATE OR DELETE ON "CallNote"
  FOR EACH ROW EXECUTE FUNCTION csb_call_note_guard();

-- Intakes created before Call Notes existed get the new Call Notes section, so a manager can decide it.
INSERT INTO "CareIntakeSection" ("id", "organisationId", "intakeId", "section")
SELECT 'cns' || substr(md5(i."id"), 1, 22), i."organisationId", i."id", 'CALL_NOTES'
FROM "CareIntake" i
WHERE NOT EXISTS (SELECT 1 FROM "CareIntakeSection" s WHERE s."intakeId" = i."id" AND s."section" = 'CALL_NOTES');

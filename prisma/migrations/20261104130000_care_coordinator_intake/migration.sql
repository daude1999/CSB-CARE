-- AI Care Coordinator intake: documents, source-linked facts, coordinator decisions, manager section approvals and
-- per-section apply status. Additive only: new tables and three nullable RotaSettings columns (AI reading off by default).

ALTER TABLE "RotaSettings" ADD COLUMN     "careCoordinatorAiEnabledAt" TIMESTAMP(3),
ADD COLUMN     "careCoordinatorAiEnabledById" TEXT,
ADD COLUMN     "careCoordinatorAiReviewNote" TEXT;

-- CreateTable
CREATE TABLE "CareIntakeReviewItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "intakeId" TEXT,
    "factId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRef" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "CareIntakeReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntake" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "serviceUserId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'NEW',
    "areaId" TEXT,
    "reader" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notDuplicateById" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CareIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL,
    "section" "ServiceUserDocumentSection" NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuerKind" TEXT,
    "documentDate" DATE,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "pageText" JSONB NOT NULL DEFAULT '[]',
    "readStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "readNote" TEXT,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "filedDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareIntakeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeFact" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "proposed" JSONB NOT NULL,
    "value" JSONB NOT NULL,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER,
    "quote" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "temporal" TEXT NOT NULL DEFAULT 'CURRENT',
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "existingValue" JSONB,
    "conflict" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "question" TEXT,
    "assignedToId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "appliedRef" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareIntakeFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareIntakeSection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "applyStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "applyResult" JSONB,
    "applyError" TEXT,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CareIntakeSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareIntakeReviewItem_organisationId_serviceUserId_status_idx" ON "CareIntakeReviewItem"("organisationId", "serviceUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeReviewItem_factId_key" ON "CareIntakeReviewItem"("factId");

-- CreateIndex
CREATE INDEX "CareIntake_organisationId_status_idx" ON "CareIntake"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntake_organisationId_reference_key" ON "CareIntake"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "CareIntakeDocument_intakeId_idx" ON "CareIntakeDocument"("intakeId");

-- CreateIndex
CREATE INDEX "CareIntakeFact_intakeId_section_idx" ON "CareIntakeFact"("intakeId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "CareIntakeSection_intakeId_section_key" ON "CareIntakeSection"("intakeId", "section");

-- AddForeignKey
ALTER TABLE "CareIntakeReviewItem" ADD CONSTRAINT "CareIntakeReviewItem_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeDocument" ADD CONSTRAINT "CareIntakeDocument_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "CareIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeFact" ADD CONSTRAINT "CareIntakeFact_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "CareIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareIntakeSection" ADD CONSTRAINT "CareIntakeSection_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "CareIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- What was read from a document, and where it came from, can never be rewritten: edits go into "value".
CREATE OR REPLACE FUNCTION csb_intake_fact_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW."organisationId", NEW."intakeId", NEW.proposed::text, NEW."sourceDocumentId", NEW."sourcePage", NEW.quote, NEW.origin, NEW."createdAt")
     IS DISTINCT FROM (OLD."organisationId", OLD."intakeId", OLD.proposed::text, OLD."sourceDocumentId", OLD."sourcePage", OLD.quote, OLD.origin, OLD."createdAt") THEN
    RAISE EXCEPTION 'What was read from a document and its source cannot be changed';
  END IF;
  IF OLD."appliedAt" IS NOT NULL AND (NEW.value::text IS DISTINCT FROM OLD.value::text OR NEW.decision IS DISTINCT FROM OLD.decision) THEN
    RAISE EXCEPTION 'This fact has already been saved to the record and cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER intake_fact_guard BEFORE UPDATE ON "CareIntakeFact" FOR EACH ROW EXECUTE FUNCTION csb_intake_fact_guard();

-- An uploaded original is never replaced: the stored file and its fingerprint are fixed.
CREATE OR REPLACE FUNCTION csb_intake_document_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW."organisationId", NEW."intakeId", NEW."storageKey", NEW.sha256, NEW."sizeBytes", NEW.filename, NEW."createdAt")
     IS DISTINCT FROM (OLD."organisationId", OLD."intakeId", OLD."storageKey", OLD.sha256, OLD."sizeBytes", OLD.filename, OLD."createdAt") THEN
    RAISE EXCEPTION 'An uploaded original document cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER intake_document_guard BEFORE UPDATE ON "CareIntakeDocument" FOR EACH ROW EXECUTE FUNCTION csb_intake_document_guard();

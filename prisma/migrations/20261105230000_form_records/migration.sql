-- Forms PR 2/3: on-screen forms. Definitions, immutable published versions, completed records pinned to a version,
-- and their append-only history. Additive only.
-- CreateTable
CREATE TABLE "FormDefinition" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "completeRoles" "OrgRole"[],
    "reviewRoles" "OrgRole"[],
    "subjectType" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormVersion" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "instructions" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "subjectType" TEXT,
    "subjectId" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewerId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "voidReason" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormRecordEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormRecordEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormDefinition_currentVersionId_key" ON "FormDefinition"("currentVersionId");

-- CreateIndex
CREATE INDEX "FormDefinition_organisationId_idx" ON "FormDefinition"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_definitionId_versionNumber_key" ON "FormVersion"("definitionId", "versionNumber");

-- CreateIndex
CREATE INDEX "FormRecord_organisationId_status_idx" ON "FormRecord"("organisationId", "status");

-- CreateIndex
CREATE INDEX "FormRecord_createdById_idx" ON "FormRecord"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "FormRecord_organisationId_reference_key" ON "FormRecord"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "FormRecordEvent_recordId_idx" ON "FormRecordEvent"("recordId");

-- AddForeignKey
ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "FormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "FormDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecordEvent" ADD CONSTRAINT "FormRecordEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "FormRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Integrity rules enforced by the database

ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'));
ALTER TABLE "FormDefinition" ADD CONSTRAINT "FormDefinition_sensitivity_check" CHECK ("sensitivity" IN ('CONFIDENTIAL', 'INTERNAL'));
CREATE UNIQUE INDEX "FormDefinition_org_ref_key" ON "FormDefinition"(COALESCE("organisationId", ''), "ref");
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_status_check" CHECK ("status" IN ('PUBLISHED', 'SUPERSEDED'));
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'VOIDED'));
ALTER TABLE "FormRecordEvent" ADD CONSTRAINT "FormRecordEvent_type_check" CHECK ("type" IN ('CREATED', 'SAVED', 'SUBMITTED', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'VOIDED', 'PRINTED'));

-- A published version's fields never change; it can only be marked superseded. Versions are never deleted.
CREATE OR REPLACE FUNCTION csb_form_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Form versions are never deleted';
  END IF;
  IF NEW."schemaJson" IS DISTINCT FROM OLD."schemaJson" OR NEW."instructions" <> OLD."instructions"
     OR NEW."versionNumber" <> OLD."versionNumber" OR NEW."definitionId" <> OLD."definitionId"
     OR NEW."contentHash" <> OLD."contentHash" OR NEW."changeSummary" <> OLD."changeSummary"
     OR NEW."publishedAt" <> OLD."publishedAt"
     OR NOT (NEW."status" = OLD."status" OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'A published form version cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER form_version_guard BEFORE UPDATE OR DELETE ON "FormVersion" FOR EACH ROW EXECUTE FUNCTION csb_form_version_guard();

-- A record: its version belongs to its form, the form is the organisation's or a CSB master, its identity never
-- changes, answers change only while a draft or returned for correction, and status follows the workflow.
CREATE OR REPLACE FUNCTION csb_form_record_guard() RETURNS trigger AS $$
DECLARE
  def_org TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Form records are never deleted; void them instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'A form record starts as a draft';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "FormVersion" v WHERE v.id = NEW."versionId" AND v."definitionId" = NEW."definitionId" AND v."status" = 'PUBLISHED') THEN
      RAISE EXCEPTION 'A form record must use a published version of its own form';
    END IF;
    SELECT "organisationId" INTO def_org FROM "FormDefinition" WHERE id = NEW."definitionId";
    IF def_org IS NOT NULL AND def_org <> NEW."organisationId" THEN
      RAISE EXCEPTION 'A form record must use a form of its own organisation or a CSB form';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."organisationId" <> OLD."organisationId" OR NEW."definitionId" <> OLD."definitionId" OR NEW."versionId" <> OLD."versionId"
     OR NEW."reference" <> OLD."reference" OR NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType" OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId" THEN
    RAISE EXCEPTION 'A form record''s form, version, reference and author cannot be changed';
  END IF;
  IF NEW."answers" IS DISTINCT FROM OLD."answers" AND OLD."status" NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Answers are frozen once a form is submitted';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'VOIDED'))
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'RETURNED', 'VOIDED'))
    OR (OLD."status" = 'RETURNED' AND NEW."status" IN ('SUBMITTED', 'VOIDED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'VOIDED')) THEN
    RAISE EXCEPTION 'A form record cannot move from % to %', OLD."status", NEW."status";
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided form record cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER form_record_guard BEFORE INSERT OR UPDATE OR DELETE ON "FormRecord" FOR EACH ROW EXECUTE FUNCTION csb_form_record_guard();

-- History is append-only.
CREATE OR REPLACE FUNCTION csb_form_event_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Form record history cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER form_event_guard BEFORE UPDATE OR DELETE ON "FormRecordEvent" FOR EACH ROW EXECUTE FUNCTION csb_form_event_guard();

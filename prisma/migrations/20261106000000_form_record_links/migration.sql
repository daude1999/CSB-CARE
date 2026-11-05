-- Forms PR 4: link form records to the CRM record they are about (service user or staff member). Additive only.
-- AlterTable
ALTER TABLE "FormDefinition" ADD COLUMN     "linkTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "FormRecordLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "serviceUserId" TEXT,
    "staffMemberId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removeReason" TEXT,

    CONSTRAINT "FormRecordLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormRecordLink_recordId_idx" ON "FormRecordLink"("recordId");

-- CreateIndex
CREATE INDEX "FormRecordLink_serviceUserId_idx" ON "FormRecordLink"("serviceUserId");

-- CreateIndex
CREATE INDEX "FormRecordLink_staffMemberId_idx" ON "FormRecordLink"("staffMemberId");

-- AddForeignKey
ALTER TABLE "FormRecordLink" ADD CONSTRAINT "FormRecordLink_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "FormRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecordLink" ADD CONSTRAINT "FormRecordLink_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecordLink" ADD CONSTRAINT "FormRecordLink_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "FormRecordLink" ADD CONSTRAINT "FormRecordLink_entity_check" CHECK (
  ("entityType" = 'SERVICE_USER' AND "staffMemberId" IS NULL) OR ("entityType" = 'STAFF_MEMBER' AND "serviceUserId" IS NULL));
ALTER TABLE "FormRecordLink" ADD CONSTRAINT "FormRecordLink_removed_check" CHECK (
  ("removedAt" IS NULL AND "removedById" IS NULL AND "removeReason" IS NULL) OR ("removedAt" IS NOT NULL AND "removedById" IS NOT NULL AND "removeReason" IS NOT NULL));
-- A record is linked to the same person at most once at a time.
CREATE UNIQUE INDEX "FormRecordLink_active_key" ON "FormRecordLink"("recordId", COALESCE("serviceUserId", ''), COALESCE("staffMemberId", '')) WHERE "removedAt" IS NULL;

-- Link history gets two new event types.
ALTER TABLE "FormRecordEvent" DROP CONSTRAINT "FormRecordEvent_type_check";
ALTER TABLE "FormRecordEvent" ADD CONSTRAINT "FormRecordEvent_type_check" CHECK ("type" IN ('CREATED', 'SAVED', 'SUBMITTED', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'VOIDED', 'PRINTED', 'LINKED', 'UNLINKED'));

-- A link joins records of one organisation, to a kind of record the form allows, on a record that is not voided.
-- Afterwards it can only be removed (with who and why); it is never edited or re-pointed.
CREATE OR REPLACE FUNCTION csb_form_record_link_guard() RETURNS trigger AS $$
DECLARE
  rec_org TEXT;
  rec_status TEXT;
  allowed TEXT[];
  target_org TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT r."organisationId", r."status", d."linkTypes" INTO rec_org, rec_status, allowed
      FROM "FormRecord" r JOIN "FormDefinition" d ON d.id = r."definitionId" WHERE r.id = NEW."recordId";
    IF rec_org IS NULL OR rec_org <> NEW."organisationId" THEN
      RAISE EXCEPTION 'A form link must be in the form record''s organisation';
    END IF;
    IF rec_status = 'VOIDED' THEN
      RAISE EXCEPTION 'A voided form cannot be linked';
    END IF;
    IF NOT (NEW."entityType" = ANY(allowed)) THEN
      RAISE EXCEPTION 'This form cannot be linked to that kind of record';
    END IF;
    IF NEW."entityType" = 'SERVICE_USER' THEN
      SELECT "organisationId" INTO target_org FROM "ServiceUser" WHERE id = NEW."serviceUserId";
    ELSE
      SELECT "organisationId" INTO target_org FROM "StaffMember" WHERE id = NEW."staffMemberId";
    END IF;
    IF target_org IS NULL OR target_org <> NEW."organisationId" THEN
      RAISE EXCEPTION 'A form can only be linked to a person in its own organisation';
    END IF;
    IF NEW."removedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A new form link cannot start removed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."removedAt" IS NOT NULL OR NEW."removedAt" IS NULL
     OR NEW."organisationId" <> OLD."organisationId" OR NEW."recordId" <> OLD."recordId" OR NEW."entityType" <> OLD."entityType"
     OR NEW."serviceUserId" IS DISTINCT FROM OLD."serviceUserId" OR NEW."staffMemberId" IS DISTINCT FROM OLD."staffMemberId"
     OR NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A form link can only be removed, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER form_record_link_guard BEFORE INSERT OR UPDATE ON "FormRecordLink" FOR EACH ROW EXECUTE FUNCTION csb_form_record_link_guard();

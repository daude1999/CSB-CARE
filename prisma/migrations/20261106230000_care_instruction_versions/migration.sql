-- Carer instruction versions and acknowledgements (AI CSB Coordinator brief, 6 Nov 2026, phase 9). Additive only.
-- Each change to a repeating visit's instructions (notes or task list) is kept as a numbered version. Carers
-- booked on the visit confirm they have read a changed version. Both are history and never edited.
CREATE TABLE "CareInstructionVersion" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "serviceUserId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "notes" TEXT,
  "tasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "changeSummary" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareInstructionVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CareInstructionVersion_templateId_version_key" ON "CareInstructionVersion"("templateId", "version");
CREATE INDEX "CareInstructionVersion_organisationId_serviceUserId_idx" ON "CareInstructionVersion"("organisationId", "serviceUserId");
ALTER TABLE "CareInstructionVersion" ADD CONSTRAINT "CareInstructionVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "VisitTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CareInstructionAck" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareInstructionAck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CareInstructionAck_versionId_staffId_key" ON "CareInstructionAck"("versionId", "staffId");
ALTER TABLE "CareInstructionAck" ADD CONSTRAINT "CareInstructionAck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CareInstructionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER csb_care_instruction_version_no_update BEFORE UPDATE ON "CareInstructionVersion" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();
CREATE TRIGGER csb_care_instruction_ack_no_update BEFORE UPDATE ON "CareInstructionAck" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();

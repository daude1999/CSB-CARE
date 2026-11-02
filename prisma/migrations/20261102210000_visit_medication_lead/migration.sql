-- Medication Lead: who is responsible for medication on a visit, with full history. Additive only.
CREATE TABLE "VisitMedicationLead" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endReason" TEXT,
    CONSTRAINT "VisitMedicationLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisitMedicationLead_visitId_idx" ON "VisitMedicationLead"("visitId");
CREATE INDEX "VisitMedicationLead_organisationId_staffId_idx" ON "VisitMedicationLead"("organisationId", "staffId");
ALTER TABLE "VisitMedicationLead" ADD CONSTRAINT "VisitMedicationLead_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitMedicationLead" ADD CONSTRAINT "VisitMedicationLead_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitMedicationLead" ADD CONSTRAINT visit_medication_lead_source_chk CHECK ("source" IN ('AUTO', 'COORDINATOR'));

-- At most one live Medication Lead per visit.
CREATE UNIQUE INDEX visit_medication_lead_live_uniq ON "VisitMedicationLead" ("visitId") WHERE "endedAt" IS NULL;

-- History is kept: a row can only be ended (once), never edited or deleted.
CREATE OR REPLACE FUNCTION csb_visit_medication_lead_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Removing a visit cascades; any other delete is refused.
    IF EXISTS (SELECT 1 FROM "Visit" WHERE id = OLD."visitId") THEN
      RAISE EXCEPTION 'Medication Lead history cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."endedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'An ended Medication Lead record cannot be changed';
  END IF;
  IF NEW."visitId" <> OLD."visitId" OR NEW."staffId" <> OLD."staffId" OR NEW."source" <> OLD."source"
     OR NEW."assignedById" <> OLD."assignedById" OR NEW."assignedAt" <> OLD."assignedAt"
     OR NEW."organisationId" <> OLD."organisationId" OR NEW."reason" IS DISTINCT FROM OLD."reason" THEN
    RAISE EXCEPTION 'A Medication Lead record can only be ended, not edited';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_visit_medication_lead_immutable BEFORE UPDATE OR DELETE ON "VisitMedicationLead"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_medication_lead_immutable();

-- The lead must be a carer booked on the visit (not a shadow) when the responsibility starts.
CREATE OR REPLACE FUNCTION csb_visit_medication_lead_booked() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "VisitAssignment" a WHERE a."visitId" = NEW."visitId" AND a."staffId" = NEW."staffId" AND a."removedAt" IS NULL AND a.slot <> 'SHADOW') THEN
    RAISE EXCEPTION 'The Medication Lead must be a carer booked on this visit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_visit_medication_lead_booked BEFORE INSERT ON "VisitMedicationLead"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_medication_lead_booked();

-- When a carer leaves a visit (removed, replaced or swapped), their medication responsibility ends with them.
CREATE OR REPLACE FUNCTION csb_visit_assignment_end_medication_lead() RETURNS trigger AS $$
BEGIN
  IF NEW."removedAt" IS NOT NULL AND OLD."removedAt" IS NULL THEN
    UPDATE "VisitMedicationLead"
       SET "endedAt" = NEW."removedAt", "endedById" = NEW."removedById",
           "endReason" = 'Carer no longer on the visit' || COALESCE(': ' || NEW."removeReason", '')
     WHERE "visitId" = NEW."visitId" AND "staffId" = NEW."staffId" AND "endedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_visit_assignment_end_medication_lead AFTER UPDATE OF "removedAt" ON "VisitAssignment"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_assignment_end_medication_lead();

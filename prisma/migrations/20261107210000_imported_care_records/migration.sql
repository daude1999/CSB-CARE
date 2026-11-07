-- Imported care records (owner's brief of 7 Nov 2026, "Remove redundant approval workflows"). Additive only.
-- A care plan or risk assessment saved from a council support plan records where it came from, so it is never shown
-- as written by staff or as a completed clinical assessment when CSB AI inferred it.
--   origin: MANUAL (written in CSB), DOCUMENT (taken from a source document), AI_INFERRED (CSB AI wrote it from the
--   document's narrative; not a completed assessment).

ALTER TABLE "CarePlan" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "CarePlan" ADD COLUMN "sourceIntakeId" TEXT;
ALTER TABLE "CarePlan" ADD COLUMN "sourceNote" TEXT;

ALTER TABLE "RiskAssessment" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "RiskAssessment" ADD COLUMN "sourceIntakeId" TEXT;
ALTER TABLE "RiskAssessment" ADD COLUMN "sourceNote" TEXT;

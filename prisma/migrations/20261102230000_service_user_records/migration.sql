-- Service user records: risk assessment versions, required actions and responsible person; who was told about an
-- incident. Additive only: nothing existing is renamed, dropped or rewritten.
ALTER TABLE "RiskAssessment" ADD COLUMN "requiredActions" TEXT;
ALTER TABLE "RiskAssessment" ADD COLUMN "responsiblePerson" TEXT;
ALTER TABLE "Incident" ADD COLUMN "peopleNotified" TEXT;

CREATE TABLE "RiskAssessmentVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "riskAssessmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "change" TEXT NOT NULL,
    "reason" TEXT,
    "type" "RiskType" NOT NULL,
    "title" TEXT NOT NULL,
    "hazards" TEXT NOT NULL,
    "controls" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "reviewDue" DATE NOT NULL,
    "requiredActions" TEXT,
    "responsiblePerson" TEXT,
    "status" "RecordStatus" NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskAssessmentVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiskAssessmentVersion_riskAssessmentId_version_key" ON "RiskAssessmentVersion"("riskAssessmentId", "version");
CREATE INDEX "RiskAssessmentVersion_organisationId_idx" ON "RiskAssessmentVersion"("organisationId");
ALTER TABLE "RiskAssessmentVersion" ADD CONSTRAINT "RiskAssessmentVersion_riskAssessmentId_fkey" FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAssessmentVersion" ADD CONSTRAINT risk_assessment_version_change_chk CHECK ("change" IN ('CREATED', 'REVIEWED', 'ARCHIVED', 'RECORDED_BEFORE_HISTORY'));

-- Saved versions are permanent: never edited, and deleted only when the assessment itself goes (a person's record is removed).
CREATE OR REPLACE FUNCTION csb_risk_assessment_version_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "RiskAssessment" WHERE id = OLD."riskAssessmentId") THEN
      RAISE EXCEPTION 'Risk assessment versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Risk assessment versions cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_risk_assessment_version_immutable BEFORE UPDATE OR DELETE ON "RiskAssessmentVersion"
  FOR EACH ROW EXECUTE FUNCTION csb_risk_assessment_version_immutable();

-- Today's assessments start their history with their current content. Earlier changes stay in the audit log.
INSERT INTO "RiskAssessmentVersion" ("id", "organisationId", "riskAssessmentId", "version", "change", "type", "title", "hazards", "controls", "level", "reviewDue", "status", "changedById", "changedAt")
SELECT 'rav_' || r.id, r."organisationId", r.id, r.version, 'RECORDED_BEFORE_HISTORY', r.type, r.title, r.hazards, r.controls, r.level, r."reviewDue", r.status, r."assessedById", r."assessedAt"
  FROM "RiskAssessment" r;

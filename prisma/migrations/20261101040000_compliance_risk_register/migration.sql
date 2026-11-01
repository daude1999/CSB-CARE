-- Policy & Compliance: an organisational risk register, linked to corrective actions. Additive only.
CREATE TABLE "ComplianceRisk" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "branchId" TEXT,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "likelihood" INTEGER NOT NULL,
  "impact" INTEGER NOT NULL,
  "existingControls" TEXT NOT NULL,
  "controlEffectiveness" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
  "residualLikelihood" INTEGER NOT NULL,
  "residualImpact" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reviewDate" TIMESTAMP(3) NOT NULL,
  "lastReviewedAt" TIMESTAMP(3),
  "lastReviewedById" TEXT,
  "findingId" TEXT,
  "createdById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3),
  "closedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceRisk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ComplianceRisk_scores_check" CHECK ("likelihood" BETWEEN 1 AND 5 AND "impact" BETWEEN 1 AND 5 AND "residualLikelihood" BETWEEN 1 AND 5 AND "residualImpact" BETWEEN 1 AND 5),
  CONSTRAINT "ComplianceRisk_status_check" CHECK ("status" IN ('OPEN', 'MONITORING', 'CLOSED'))
);
CREATE UNIQUE INDEX "ComplianceRisk_organisationId_ref_key" ON "ComplianceRisk"("organisationId", "ref");
CREATE INDEX "ComplianceRisk_organisationId_status_idx" ON "ComplianceRisk"("organisationId", "status");

CREATE TABLE "RiskEvent" (
  "id" TEXT NOT NULL,
  "riskId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT,
  "changes" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiskEvent_riskId_createdAt_idx" ON "RiskEvent"("riskId", "createdAt");
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ComplianceRisk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A risk's history is evidence: it is never edited or deleted.
CREATE TRIGGER risk_event_immutable BEFORE UPDATE OR DELETE ON "RiskEvent"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

ALTER TABLE "ComplianceAction" ADD COLUMN "riskId" TEXT;
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ComplianceRisk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ComplianceAction_riskId_idx" ON "ComplianceAction"("riskId");

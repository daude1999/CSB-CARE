-- CreateEnum
CREATE TYPE "CqcKeyQuestion" AS ENUM ('SAFE', 'EFFECTIVE', 'CARING', 'RESPONSIVE', 'WELL_LED');

-- AlterTable
ALTER TABLE "ComplianceAction" ADD COLUMN     "actionType" TEXT,
ADD COLUMN     "cqcAssessmentId" TEXT,
ADD COLUMN     "cqcCriterionId" TEXT,
ADD COLUMN     "evidenceRequired" TEXT,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "rcaFindingId" TEXT,
ADD COLUMN     "rcaId" TEXT;

-- CreateTable
CREATE TABLE "CqcFramework" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "basis" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceCheckedAt" TIMESTAMP(3),
    "notes" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CqcFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CqcCriterion" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "keyQuestion" "CqcKeyQuestion" NOT NULL,
    "title" TEXT NOT NULL,
    "qualityStatement" TEXT NOT NULL,
    "regulations" TEXT[],
    "guidance" TEXT NOT NULL,
    "evidenceExamples" TEXT[],
    "keywords" TEXT[],
    "discoveryKinds" TEXT[],
    "essential" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CqcCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CqcAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branchId" TEXT,
    "serviceTypeCode" TEXT,
    "frameworkId" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "assessorId" TEXT NOT NULL,
    "managementComment" TEXT,
    "nextDueAt" DATE,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "returnedReason" TEXT,
    "previousId" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CqcAssessmentResult" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "findings" TEXT,
    "naReason" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CqcAssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CqcEvidenceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "branchId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "origin" TEXT NOT NULL,
    "note" TEXT,
    "validUntil" TIMESTAMP(3),
    "linkedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqcEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CqcReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "branchId" TEXT,
    "serviceTypeCode" TEXT,
    "frameworkId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "overall" INTEGER,
    "confidence" TEXT NOT NULL,
    "byQuestion" JSONB NOT NULL,
    "figures" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "takenById" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CqcReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaInvestigation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branchId" TEXT,
    "serviceUserId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "peopleInvolved" TEXT,
    "immediateImpact" TEXT,
    "harm" TEXT,
    "immediateActions" TEXT,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "fiveWhys" JSONB NOT NULL DEFAULT '[]',
    "causeEffectNotes" TEXT,
    "immediateCause" TEXT,
    "underlyingCauses" TEXT,
    "uncertainties" TEXT,
    "conclusions" TEXT,
    "closureNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closureException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RcaInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaSourceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "externalRef" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaFinding" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "factorArea" TEXT,
    "text" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "RcaFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaEscalation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "externalRef" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CqcFramework_version_key" ON "CqcFramework"("version");

-- CreateIndex
CREATE UNIQUE INDEX "CqcCriterion_frameworkId_code_key" ON "CqcCriterion"("frameworkId", "code");

-- CreateIndex
CREATE INDEX "CqcAssessment_organisationId_status_idx" ON "CqcAssessment"("organisationId", "status");

-- CreateIndex
CREATE INDEX "CqcAssessment_organisationId_branchId_idx" ON "CqcAssessment"("organisationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "CqcAssessment_organisationId_reference_key" ON "CqcAssessment"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CqcAssessmentResult_assessmentId_criterionId_key" ON "CqcAssessmentResult"("assessmentId", "criterionId");

-- CreateIndex
CREATE INDEX "CqcEvidenceLink_organisationId_status_idx" ON "CqcEvidenceLink"("organisationId", "status");

-- CreateIndex
CREATE INDEX "CqcEvidenceLink_organisationId_sourceType_sourceId_idx" ON "CqcEvidenceLink"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CqcEvidenceLink_organisationId_criterionId_sourceType_sourc_key" ON "CqcEvidenceLink"("organisationId", "criterionId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CqcReadinessSnapshot_organisationId_takenAt_idx" ON "CqcReadinessSnapshot"("organisationId", "takenAt");

-- CreateIndex
CREATE INDEX "RcaInvestigation_organisationId_status_idx" ON "RcaInvestigation"("organisationId", "status");

-- CreateIndex
CREATE INDEX "RcaInvestigation_organisationId_branchId_idx" ON "RcaInvestigation"("organisationId", "branchId");

-- CreateIndex
CREATE INDEX "RcaInvestigation_organisationId_dueDate_idx" ON "RcaInvestigation"("organisationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "RcaInvestigation_organisationId_reference_key" ON "RcaInvestigation"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "RcaSourceLink_organisationId_sourceType_sourceId_idx" ON "RcaSourceLink"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RcaSourceLink_rcaId_sourceType_sourceId_key" ON "RcaSourceLink"("rcaId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RcaReview_rcaId_createdAt_idx" ON "RcaReview"("rcaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RcaEscalation_rcaId_kind_key" ON "RcaEscalation"("rcaId", "kind");

-- CreateIndex
CREATE INDEX "ComplianceAction_rcaId_idx" ON "ComplianceAction"("rcaId");

-- CreateIndex
CREATE INDEX "ComplianceAction_cqcAssessmentId_idx" ON "ComplianceAction"("cqcAssessmentId");

-- AddForeignKey
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_rcaFindingId_fkey" FOREIGN KEY ("rcaFindingId") REFERENCES "RcaFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_cqcAssessmentId_fkey" FOREIGN KEY ("cqcAssessmentId") REFERENCES "CqcAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAction" ADD CONSTRAINT "ComplianceAction_cqcCriterionId_fkey" FOREIGN KEY ("cqcCriterionId") REFERENCES "CqcCriterion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcCriterion" ADD CONSTRAINT "CqcCriterion_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "CqcFramework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcAssessment" ADD CONSTRAINT "CqcAssessment_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "CqcFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcAssessmentResult" ADD CONSTRAINT "CqcAssessmentResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CqcAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcAssessmentResult" ADD CONSTRAINT "CqcAssessmentResult_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CqcCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcEvidenceLink" ADD CONSTRAINT "CqcEvidenceLink_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CqcCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CqcReadinessSnapshot" ADD CONSTRAINT "CqcReadinessSnapshot_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CqcAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaSourceLink" ADD CONSTRAINT "RcaSourceLink_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaFinding" ADD CONSTRAINT "RcaFinding_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaReview" ADD CONSTRAINT "RcaReview_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaEscalation" ADD CONSTRAINT "RcaEscalation_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "RcaInvestigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RCA reviews (manager reviews, effectiveness reviews, closures, reopenings) and readiness snapshots are permanent
-- records: once written they are never changed or removed.
CREATE TRIGGER rca_review_immutable BEFORE UPDATE OR DELETE ON "RcaReview"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();
CREATE TRIGGER cqc_snapshot_immutable BEFORE UPDATE OR DELETE ON "CqcReadinessSnapshot"
  FOR EACH ROW EXECUTE FUNCTION evx_immutable();

-- Post-hospital discharge review (AI CSB Coordinator brief, 6 Nov 2026, phase 7). Additive only.
-- One review per discharge document read by the Care Coordinator, linked to its source. It never replaces the
-- council support plan and never authorises medication; urgent findings alert managers in-app.
CREATE TABLE "DischargeReview" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "serviceUserId" TEXT NOT NULL,
  "intakeId" TEXT,
  "intakeDocumentId" TEXT,
  "documentId" TEXT,
  "documentName" TEXT NOT NULL,
  "dischargeDate" DATE,
  "urgent" BOOLEAN NOT NULL DEFAULT false,
  "urgentReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "checks" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedById" TEXT,
  "completedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "lockVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "DischargeReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT discharge_review_status_chk CHECK ("status" IN ('OPEN', 'COMPLETED'))
);
CREATE UNIQUE INDEX "DischargeReview_intakeDocumentId_key" ON "DischargeReview"("intakeDocumentId");
CREATE INDEX "DischargeReview_organisationId_serviceUserId_status_idx" ON "DischargeReview"("organisationId", "serviceUserId", "status");
ALTER TABLE "DischargeReview" ADD CONSTRAINT "DischargeReview_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

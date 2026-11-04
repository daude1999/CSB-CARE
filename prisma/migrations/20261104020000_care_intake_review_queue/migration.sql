CREATE TABLE "CareIntakeReviewItem" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "serviceUserId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sourceRef" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  CONSTRAINT "CareIntakeReviewItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CareIntakeReviewItem_organisationId_serviceUserId_status_idx"
 ON "CareIntakeReviewItem"("organisationId","serviceUserId","status");
ALTER TABLE "CareIntakeReviewItem" ADD CONSTRAINT "CareIntakeReviewItem_serviceUserId_fkey"
 FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

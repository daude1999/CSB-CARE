-- Shared rate-limit counters (additive; no existing table changes).
CREATE TABLE "RateLimitWindow" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("key","windowStart")
);

CREATE INDEX "RateLimitWindow_windowStart_idx" ON "RateLimitWindow"("windowStart");

-- Indexes for measured query patterns (additive).
-- The Monitor's "alerts reached the office" figure: alerts raised in the last day for one organisation.
CREATE INDEX "RotaAlert_organisationId_raisedAt_idx" ON "RotaAlert"("organisationId", "raisedAt");
-- A service user's recent incidents on their record.
CREATE INDEX "Incident_serviceUserId_occurredAt_idx" ON "Incident"("serviceUserId", "occurredAt");
-- Evidence listed beside the record it supports.
CREATE INDEX "EvidenceDocument_organisationId_linkedType_linkedId_idx" ON "EvidenceDocument"("organisationId", "linkedType", "linkedId");

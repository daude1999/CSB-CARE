-- Archive for service users (owner's request, 8 Nov 2026). Additive: three nullable columns and an index.
-- A null archivedAt (every existing row) means "not archived", so nothing changes for current records.
ALTER TABLE "ServiceUser" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ServiceUser" ADD COLUMN "archivedById" TEXT;
ALTER TABLE "ServiceUser" ADD COLUMN "archiveReason" TEXT;
CREATE INDEX "ServiceUser_organisationId_archivedAt_idx" ON "ServiceUser"("organisationId", "archivedAt");

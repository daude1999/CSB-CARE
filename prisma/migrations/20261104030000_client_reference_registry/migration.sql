-- Keep existing SU- references as historical IDs. Backfill stable CSB references
-- once, then allocate new numbers atomically from ServiceUserReferenceCounter.
ALTER TABLE "ServiceUser" ADD COLUMN "csbReference" TEXT;
WITH ordered AS (
  SELECT id, "organisationId",
    ROW_NUMBER() OVER (PARTITION BY "organisationId" ORDER BY "createdAt", id) AS n
  FROM "ServiceUser"
)
UPDATE "ServiceUser" s
SET "csbReference" = 'CSB-' || LPAD(ordered.n::text,6,'0')
FROM ordered WHERE s.id = ordered.id;
CREATE UNIQUE INDEX "ServiceUser_organisationId_csbReference_key"
 ON "ServiceUser"("organisationId","csbReference");
CREATE TABLE "ServiceUserReferenceCounter" (
  "organisationId" TEXT NOT NULL PRIMARY KEY,
  "nextNumber" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "ServiceUserReferenceCounter" ("organisationId","nextNumber")
SELECT "organisationId",COUNT(*)::integer+1 FROM "ServiceUser" GROUP BY "organisationId";
CREATE TABLE "ServiceUserExternalReference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL,
  "serviceUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "issuerKey" TEXT NOT NULL,
  "valueCipher" TEXT NOT NULL,
  "valueHash" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verificationNote" TEXT,
  "sourceDocumentId" TEXT,
  "sourcePage" INTEGER,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3)
);
ALTER TABLE "ServiceUserExternalReference"
 ADD CONSTRAINT "ServiceUserExternalReference_serviceUserId_organisationId_fkey"
 FOREIGN KEY ("serviceUserId","organisationId") REFERENCES "ServiceUser"("id","organisationId")
 ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ServiceUserExternalReference_unique_client_key"
 ON "ServiceUserExternalReference"("organisationId","serviceUserId","type","issuerKey","valueHash");
CREATE INDEX "ServiceUserExternalReference_lookup_idx"
 ON "ServiceUserExternalReference"("organisationId","type","valueHash");
CREATE INDEX "ServiceUserExternalReference_client_idx"
 ON "ServiceUserExternalReference"("organisationId","serviceUserId");

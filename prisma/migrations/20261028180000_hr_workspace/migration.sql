-- HR & Workforce portal: the CSB HR Hub moves into the platform. Additive only.
ALTER TABLE "Membership" ADD COLUMN "hrUserId" TEXT;

CREATE TABLE "HrWorkspace" (
    "organisationId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrWorkspace_pkey" PRIMARY KEY ("organisationId")
);

CREATE TABLE "HrFile" (
    "key" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrFile_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "HrFile_organisationId_idx" ON "HrFile"("organisationId");

ALTER TABLE "HrWorkspace" ADD CONSTRAINT "HrWorkspace_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

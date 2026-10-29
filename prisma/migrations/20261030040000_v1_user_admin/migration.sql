-- V1 item 7: user administration. Additive: member deactivation and one-time invitation and reset links (hash only).
-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "rolesBeforeDeactivation" "OrgRole"[] DEFAULT ARRAY[]::"OrgRole"[];

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "roles" "OrgRole"[] DEFAULT ARRAY[]::"OrgRole"[],
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jobTitle" TEXT,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountToken_organisationId_kind_idx" ON "AccountToken"("organisationId", "kind");

-- AddForeignKey
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_kind_check" CHECK ("kind" IN ('INVITE', 'RESET'));

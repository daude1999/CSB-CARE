-- CreateEnum
CREATE TYPE "GeoLevel" AS ENUM ('NATIONAL', 'REGIONAL', 'LOCAL');

-- CreateEnum
CREATE TYPE "PolicyScopeMode" AS ENUM ('NATIONAL', 'SHARED_WITH_APPENDICES', 'BRANCH_SPECIFIC');

-- AlterEnum
ALTER TYPE "PolicyAssignmentScope" ADD VALUE 'WORKS_IN_BRANCH';

-- AlterEnum
ALTER TYPE "VersionOrigin" ADD VALUE 'GENERATED';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "occurredLocalAuthorityCode" TEXT;

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "parentPolicyId" TEXT,
ADD COLUMN     "scopeMode" "PolicyScopeMode" NOT NULL DEFAULT 'NATIONAL';

-- AlterTable
ALTER TABLE "PolicyPublication" ADD COLUMN     "governanceChecks" JSONB;

-- AlterTable
ALTER TABLE "RegulatorySource" ADD COLUMN     "addedByOrganisationId" TEXT,
ADD COLUMN     "documentReference" TEXT,
ADD COLUMN     "effectiveOn" DATE,
ADD COLUMN     "geoLevel" "GeoLevel" NOT NULL DEFAULT 'NATIONAL',
ADD COLUMN     "issuingOrganisation" TEXT,
ADD COLUMN     "lifecycle" TEXT NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "localAuthorityCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishedOn" DATE,
ADD COLUMN     "referenceSummary" TEXT,
ADD COLUMN     "regionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supersededById" TEXT,
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "versionLabel" TEXT;

-- AlterTable
ALTER TABLE "ServiceUser" ADD COLUMN     "careLocationLocalAuthorityCode" TEXT,
ADD COLUMN     "fundingAuthority" TEXT,
ADD COLUMN     "residenceLocalAuthorityCode" TEXT,
ADD COLUMN     "safeguardingLocalAuthorityCode" TEXT;

-- CreateTable
CREATE TABLE "LocalAuthority" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "subRegion" TEXT,
    "addedByOrganisationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalAuthority_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "BranchPolicyProfile" (
    "branchId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "branchReference" TEXT,
    "postcode" TEXT,
    "localAuthorityCode" TEXT,
    "regionCode" TEXT,
    "safeguardingAdultsBoard" TEXT,
    "safeguardingChildrenPartnership" TEXT,
    "regionalGuidance" TEXT,
    "localProcedures" TEXT,
    "referralUrl" TEXT,
    "safeguardingContacts" TEXT,
    "outOfHoursContacts" TEXT,
    "integratedCareBoard" TEXT,
    "commissioningArrangements" TEXT,
    "extraSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactsVerifiedAt" TIMESTAMP(3),
    "contactsVerifiedById" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifiedById" TEXT,
    "nextReviewDate" DATE,
    "responsibleManagerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPolicyProfile_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "OrgSourceReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastCheckedAt" TIMESTAMP(3),
    "nextReviewDate" DATE,
    "reviewerId" TEXT,
    "note" TEXT,
    "verifiedContentHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSourceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyBranchScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "appendixKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyBranchScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySourceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "branchKey" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyGenerationRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "revisionId" TEXT,
    "mode" "PolicyScopeMode" NOT NULL,
    "branchIds" TEXT[],
    "basis" TEXT NOT NULL,
    "basisPolicyId" TEXT,
    "method" TEXT NOT NULL,
    "provider" TEXT,
    "sourceSnapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyGenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySourceGap" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "branchId" TEXT,
    "sourceId" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySourceGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafeguardingAuthorityDecision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "incidentId" TEXT,
    "safeguardingLocalAuthorityCode" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafeguardingAuthorityDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchPolicyProfile_organisationId_idx" ON "BranchPolicyProfile"("organisationId");

-- CreateIndex
CREATE INDEX "OrgSourceReview_sourceId_idx" ON "OrgSourceReview"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSourceReview_organisationId_sourceId_key" ON "OrgSourceReview"("organisationId", "sourceId");

-- CreateIndex
CREATE INDEX "PolicyBranchScope_organisationId_branchId_idx" ON "PolicyBranchScope"("organisationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyBranchScope_policyId_branchId_key" ON "PolicyBranchScope"("policyId", "branchId");

-- CreateIndex
CREATE INDEX "PolicySourceLink_organisationId_sourceId_idx" ON "PolicySourceLink"("organisationId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicySourceLink_policyId_sourceId_branchKey_key" ON "PolicySourceLink"("policyId", "sourceId", "branchKey");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyGenerationRun_revisionId_key" ON "PolicyGenerationRun"("revisionId");

-- CreateIndex
CREATE INDEX "PolicyGenerationRun_organisationId_policyId_idx" ON "PolicyGenerationRun"("organisationId", "policyId");

-- CreateIndex
CREATE INDEX "PolicySourceGap_organisationId_policyId_idx" ON "PolicySourceGap"("organisationId", "policyId");

-- CreateIndex
CREATE INDEX "SafeguardingAuthorityDecision_organisationId_serviceUserId_idx" ON "SafeguardingAuthorityDecision"("organisationId", "serviceUserId");

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_parentPolicyId_fkey" FOREIGN KEY ("parentPolicyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPolicyProfile" ADD CONSTRAINT "BranchPolicyProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPolicyProfile" ADD CONSTRAINT "BranchPolicyProfile_localAuthorityCode_fkey" FOREIGN KEY ("localAuthorityCode") REFERENCES "LocalAuthority"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSourceReview" ADD CONSTRAINT "OrgSourceReview_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBranchScope" ADD CONSTRAINT "PolicyBranchScope_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBranchScope" ADD CONSTRAINT "PolicyBranchScope_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySourceLink" ADD CONSTRAINT "PolicySourceLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySourceLink" ADD CONSTRAINT "PolicySourceLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyGenerationRun" ADD CONSTRAINT "PolicyGenerationRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySourceGap" ADD CONSTRAINT "PolicySourceGap_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PolicyGenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafeguardingAuthorityDecision" ADD CONSTRAINT "SafeguardingAuthorityDecision_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ServiceUserExternalReference_client_idx" RENAME TO "ServiceUserExternalReference_organisationId_serviceUserId_idx";

-- RenameIndex
ALTER INDEX "ServiceUserExternalReference_lookup_idx" RENAME TO "ServiceUserExternalReference_organisationId_type_valueHash_idx";

-- RenameIndex
ALTER INDEX "ServiceUserExternalReference_unique_client_key" RENAME TO "ServiceUserExternalReference_organisationId_serviceUserId_t_key";


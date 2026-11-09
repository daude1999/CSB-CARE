-- Evantix Platform Admin Centre (owner's brief of 8 Nov 2026). Additive only: new tables, one new User column with a
-- default, and AccountToken.organisationId made optional for platform-level account recovery links. Existing
-- organisations, users, memberships and sessions are untouched; each existing organisation gets a customer account.

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportAccessStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'DECLINED', 'REVOKED');

-- AlterTable
ALTER TABLE "AccountToken" ALTER COLUMN "organisationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "companyNumber" TEXT,
    "address" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "country" TEXT NOT NULL DEFAULT 'England',
    "mainContactName" TEXT,
    "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cqcProviderId" TEXT,
    "cqcLocationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cqcCheckedAt" TIMESTAMP(3),
    "cqcCheckedById" TEXT,
    "onboardingKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "monthlyPricePence" INTEGER,
    "annualPricePence" INTEGER,
    "includedUsers" INTEGER,
    "includedBranches" INTEGER,
    "storageMb" INTEGER,
    "aiRequestsPerMonth" INTEGER,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportLevel" TEXT,
    "addOns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSubscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3),
    "renewsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "userAllowance" INTEGER,
    "branchAllowance" INTEGER,
    "storageMb" INTEGER,
    "aiRequestsPerMonth" INTEGER,
    "providerRef" TEXT,
    "changeReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantModuleEntitlement" (
    "organisationId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantModuleEntitlement_pkey" PRIMARY KEY ("organisationId","moduleKey")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "success" BOOLEAN NOT NULL,
    "errorReason" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scopes" TEXT[],
    "durationHours" INTEGER NOT NULL,
    "authorisation" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "status" "SupportAccessStatus" NOT NULL DEFAULT 'REQUESTED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_reference_key" ON "CustomerAccount"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_onboardingKey_key" ON "CustomerAccount"("onboardingKey");

-- CreateIndex
CREATE INDEX "CustomerAccount_status_idx" ON "CustomerAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "CustomerSubscription_organisationId_createdAt_idx" ON "CustomerSubscription"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerSubscription_isCurrent_status_idx" ON "CustomerSubscription"("isCurrent", "status");

-- CreateIndex
CREATE INDEX "AiUsageEvent_organisationId_createdAt_idx" ON "AiUsageEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_organisationId_status_idx" ON "SupportAccessGrant"("organisationId", "status");

-- AddForeignKey
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantModuleEntitlement" ADD CONSTRAINT "TenantModuleEntitlement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one current subscription per organisation.
CREATE UNIQUE INDEX "CustomerSubscription_one_current" ON "CustomerSubscription"("organisationId") WHERE "isCurrent";

-- Permanent customer references (EVX-0001, ...), never reused.
CREATE SEQUENCE "customer_reference_seq" START 1;

-- Every existing organisation becomes an active customer, in the order it was created. No subscription or module rows
-- are created: an organisation without module rows keeps every module it has today.
INSERT INTO "CustomerAccount" ("organisationId", "reference", "status", "legalName", "updatedAt")
SELECT o."id", 'EVX-' || lpad(nextval('customer_reference_seq')::text, 4, '0'), 'ACTIVE', o."name", CURRENT_TIMESTAMP
FROM (SELECT "id", "name" FROM "Organisation" ORDER BY "createdAt", "id") o;

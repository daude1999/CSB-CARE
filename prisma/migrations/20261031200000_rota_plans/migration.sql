-- CreateEnum
CREATE TYPE "RotaPlanStatus" AS ENUM ('DRAFT', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "RotaPlanChangeKind" AS ENUM ('ASSIGN', 'RETIME');

-- CreateEnum
CREATE TYPE "RotaPlanDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "RotaPlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "areaId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'TIME_GAP',
    "gapMinutes" INTEGER NOT NULL,
    "maxShiftMinutes" INTEGER NOT NULL,
    "respectWeeklyLimits" BOOLEAN NOT NULL DEFAULT true,
    "status" "RotaPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "discardedById" TEXT,
    "discardedAt" TIMESTAMP(3),

    CONSTRAINT "RotaPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaPlanChange" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "visitId" TEXT NOT NULL,
    "kind" "RotaPlanChangeKind" NOT NULL,
    "slot" "AssignmentSlot",
    "staffId" TEXT,
    "fromStart" TIMESTAMP(3),
    "fromEnd" TIMESTAMP(3),
    "toStart" TIMESTAMP(3),
    "toEnd" TIMESTAMP(3),
    "eligibility" TEXT,
    "score" INTEGER,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visitLockVersion" INTEGER NOT NULL,
    "decision" "RotaPlanDecision" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "RotaPlanChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RotaPlan_organisationId_createdAt_idx" ON "RotaPlan"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "RotaPlanChange_planId_position_idx" ON "RotaPlanChange"("planId", "position");

-- CreateIndex
CREATE INDEX "RotaPlanChange_organisationId_visitId_idx" ON "RotaPlanChange"("organisationId", "visitId");

-- AddForeignKey
ALTER TABLE "RotaPlanChange" ADD CONSTRAINT "RotaPlanChange_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RotaPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;


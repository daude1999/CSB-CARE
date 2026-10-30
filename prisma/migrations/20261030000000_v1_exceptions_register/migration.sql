-- V1 item 3: exceptions register. Additive: owner, deadline and escalation on rota alerts. Existing alerts keep no deadline,
-- so nothing already open is escalated by this change.
-- AlterTable
ALTER TABLE "RotaAlert" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationNote" TEXT,
ADD COLUMN     "escalationState" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "evidenceNote" TEXT,
ADD COLUMN     "ownerAssignedAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "RotaAlert_organisationId_deadline_idx" ON "RotaAlert"("organisationId", "deadline");


ALTER TABLE "RotaAlert" ADD CONSTRAINT "RotaAlert_escalationState_check" CHECK ("escalationState" IN ('NONE', 'ESCALATED', 'RESOLVED_AFTER_ESCALATION'));

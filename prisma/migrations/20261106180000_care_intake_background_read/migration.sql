-- Background reading of intake documents (AI CSB Coordinator, 6 Nov 2026). Additive only: nullable columns, so
-- existing documents keep working and older code ignores them.
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readStage" TEXT;
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readStageAt" TIMESTAMP(3);
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readJobId" TEXT;
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readStageNote" TEXT;

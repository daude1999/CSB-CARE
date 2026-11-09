-- Automatic setup by CSB AI (owner's brief, 7 Nov 2026). Additive only: new nullable or defaulted columns.

ALTER TABLE "CareIntake" ADD COLUMN "setupStatus" TEXT;
ALTER TABLE "CareIntake" ADD COLUMN "setupStage" TEXT;
ALTER TABLE "CareIntake" ADD COLUMN "setupStartedAt" TIMESTAMP(3);
ALTER TABLE "CareIntake" ADD COLUMN "setupFinishedAt" TIMESTAMP(3);
ALTER TABLE "CareIntake" ADD COLUMN "setupById" TEXT;
ALTER TABLE "CareIntake" ADD COLUMN "setupReport" JSONB;

ALTER TABLE "CareIntakeFact" ADD COLUMN "decisionSource" TEXT NOT NULL DEFAULT 'HUMAN';

ALTER TABLE "CareIntakeReviewItem" ADD COLUMN "severity" TEXT;
ALTER TABLE "CareIntakeReviewItem" ADD COLUMN "title" TEXT;
ALTER TABLE "CareIntakeReviewItem" ADD COLUMN "recordTab" TEXT;
ALTER TABLE "CareIntakeReviewItem" ADD COLUMN "automated" BOOLEAN NOT NULL DEFAULT false;

-- Honest provenance for facts the earlier "prepare drafts" step accepted automatically (6 Nov 2026): they carry the
-- automatic note and the id of the person whose upload started it, but nobody reviewed them. Mark them as CSB AI's
-- decisions. decidedById is kept (who started it); no human decision is changed.
UPDATE "CareIntakeFact" SET "decisionSource" = 'AUTOMATION'
WHERE "decisionNote" LIKE 'Accepted for drafting by the AI CSB Coordinator%';

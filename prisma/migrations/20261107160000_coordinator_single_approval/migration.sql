-- Care Coordinator intake: one authorised coordinator reviews, approves and saves (owner's brief, 7 Nov 2026).
-- Additive and data-only apart from one nullable column. Nothing is deleted: documents, facts, decisions and the
-- audit history of every intake are kept, so intakes that were waiting for a manager resume without a new upload.

-- 1. When a section's current save started, so two people pressing Save at once cannot both run it.
ALTER TABLE "CareIntakeSection" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- 2. Intakes that were waiting for a manager, or approved but not fully saved, go back to coordinator review.
--    Sections a manager already approved keep that approval (and its name); saved sections stay saved.
UPDATE "CareIntake" SET "status" = 'DRAFT', "lockVersion" = "lockVersion" + 1 WHERE "status" IN ('SUBMITTED', 'APPROVED');

-- 3. Sections a manager returned or asked about are open for the coordinator again. The manager's reason stays on the
--    row (and in the audit log) so the coordinator can still read it.
UPDATE "CareIntakeSection" SET "status" = 'OPEN', "lockVersion" = "lockVersion" + 1 WHERE "status" IN ('RETURNED', 'INFO_REQUESTED');

-- 4. A save that was interrupted (left APPLYING) can be retried by the coordinator.
UPDATE "CareIntake" SET "status" = 'DRAFT', "lockVersion" = "lockVersion" + 1 WHERE "status" = 'APPLYING';

-- Complete Calls (Daily Rota bulk action): the office's after-the-event confirmation that a visit's care was delivered.
-- Additive only: new nullable columns, so every existing visit is unchanged (null = completed from recorded attendance).
CREATE TYPE "VisitCompletionSource" AS ENUM ('OFFICE_CONFIRMED');

ALTER TABLE "Visit"
  ADD COLUMN "completionSource" "VisitCompletionSource",
  ADD COLUMN "completionReason" TEXT,
  ADD COLUMN "completionVerifiedBy" TEXT,
  ADD COLUMN "completedById" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedFromStatus" "VisitStatus";

-- An office confirmation only ever describes a completed visit, and always says why and who confirmed it.
ALTER TABLE "Visit" ADD CONSTRAINT visit_office_completion_chk CHECK (
  "completionSource" IS NULL OR (
    status = 'COMPLETED' AND "completionReason" IS NOT NULL AND "completionVerifiedBy" IS NOT NULL
    AND "completedById" IS NOT NULL AND "completedAt" IS NOT NULL AND "completedFromStatus" IS NOT NULL
  )
);

-- AI CSB Coordinator, phase 1 (6 Nov 2026): how each intake document was last read, so the screen can tell
-- "uploaded, AI reading failed, basic reader used" apart from a successful AI reading. Additive and nullable.
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readMethod" TEXT;
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readFailure" TEXT;
ALTER TABLE "CareIntakeDocument" ADD COLUMN "readAt" TIMESTAMP(3);

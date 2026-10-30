-- V1 item 6: attendance verification. Additive: checks on timesheet lines and clock correction requests.
-- AlterTable
ALTER TABLE "TimesheetLine" ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "ClockCorrectionRequest" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" "ClockKind" NOT NULL,
    "requestedTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'CARER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "clockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClockCorrectionRequest_organisationId_status_idx" ON "ClockCorrectionRequest"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ClockCorrectionRequest_visitId_idx" ON "ClockCorrectionRequest"("visitId");

-- AddForeignKey
ALTER TABLE "ClockCorrectionRequest" ADD CONSTRAINT "ClockCorrectionRequest_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Clock correction requests are evidence: never deleted, the request itself never changes, a decision is final,
-- and a carer's request is decided by someone other than the person who asked. Office entries arrive already approved.
ALTER TABLE "ClockCorrectionRequest" ADD CONSTRAINT "ClockCorrectionRequest_origin_check" CHECK ("origin" IN ('CARER', 'OFFICE'));
ALTER TABLE "ClockCorrectionRequest" ADD CONSTRAINT "ClockCorrectionRequest_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));

CREATE OR REPLACE FUNCTION csb_clock_request_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Clock correction requests are evidence and cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' AND NEW."origin" <> 'OFFICE' THEN
      RAISE EXCEPTION 'A carer''s correction request starts as pending';
    END IF;
    IF NEW."status" <> 'PENDING' AND (NEW."decidedById" IS NULL OR NEW."decidedAt" IS NULL) THEN
      RAISE EXCEPTION 'A decided request records who decided it and when';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided clock correction request cannot change';
  END IF;
  IF NEW."visitId" <> OLD."visitId" OR NEW."staffId" <> OLD."staffId" OR NEW."kind" <> OLD."kind" OR NEW."requestedTime" <> OLD."requestedTime"
     OR NEW."reason" <> OLD."reason" OR NEW."origin" <> OLD."origin" OR NEW."requestedById" <> OLD."requestedById" OR NEW."organisationId" <> OLD."organisationId" THEN
    RAISE EXCEPTION 'The request itself cannot be changed';
  END IF;
  IF NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'A request can only be approved or rejected';
  END IF;
  IF NEW."decidedById" IS NULL OR NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION 'A decision records who decided it and when';
  END IF;
  IF NEW."decidedById" = OLD."requestedById" THEN
    RAISE EXCEPTION 'Someone other than the requester must decide a clock correction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clock_request_guard BEFORE INSERT OR UPDATE OR DELETE ON "ClockCorrectionRequest"
  FOR EACH ROW EXECUTE FUNCTION csb_clock_request_guard();

-- A line's check is recorded once and kept: it can be added, never changed or removed while the line exists.
CREATE OR REPLACE FUNCTION csb_timesheet_line_check_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."verifiedAt" IS NOT NULL AND (NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" OR NEW."verifiedById" IS DISTINCT FROM OLD."verifiedById") THEN
    RAISE EXCEPTION 'A checked timesheet line keeps its check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER timesheet_line_check_guard BEFORE UPDATE ON "TimesheetLine"
  FOR EACH ROW EXECUTE FUNCTION csb_timesheet_line_check_guard();

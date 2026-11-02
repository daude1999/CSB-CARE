-- Find Replacement Cover: contact details and communication attempts. Additive only: new nullable columns, one new table.
-- Existing contacts get isPrimary = false and no authority, so nothing is invented for existing records.

-- AlterTable
ALTER TABLE "ServiceUser" ADD COLUMN     "altPhone" TEXT,
ADD COLUMN     "preferredContactMethod" TEXT;

-- AlterTable
ALTER TABLE "ServiceUserContact" ADD COLUMN     "altPhone" TEXT,
ADD COLUMN     "authorityScope" TEXT,
ADD COLUMN     "authorityType" TEXT,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredContactMethod" TEXT;

-- CreateTable
CREATE TABLE "CoverContactAttempt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "missedCallCaseId" TEXT,
    "missedCallCoverId" TEXT,
    "recipientKind" TEXT NOT NULL,
    "contactId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientRelationship" TEXT,
    "recipientAddress" TEXT,
    "recipientAuthority" TEXT,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notApplicableReason" TEXT,
    "notes" TEXT,
    "arrangement" JSONB NOT NULL,
    "arrangementKey" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpOwnerId" TEXT,
    "followUpDueAt" TIMESTAMP(3),
    "followUpDoneAt" TIMESTAMP(3),
    "followUpDoneById" TEXT,
    "followUpDoneNote" TEXT,
    "correctsId" TEXT,
    "correctionReason" TEXT,
    "clientToken" TEXT NOT NULL,

    CONSTRAINT "CoverContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverContactAttempt_organisationId_visitId_contactedAt_idx" ON "CoverContactAttempt"("organisationId", "visitId", "contactedAt");

-- CreateIndex
CREATE INDEX "CoverContactAttempt_organisationId_followUpOwnerId_followUp_idx" ON "CoverContactAttempt"("organisationId", "followUpOwnerId", "followUpDoneAt");

-- CreateIndex
CREATE INDEX "CoverContactAttempt_missedCallCaseId_idx" ON "CoverContactAttempt"("missedCallCaseId");

-- CreateIndex
CREATE INDEX "CoverContactAttempt_serviceUserId_idx" ON "CoverContactAttempt"("serviceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverContactAttempt_organisationId_clientToken_key" ON "CoverContactAttempt"("organisationId", "clientToken");

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "ServiceUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_missedCallCaseId_fkey" FOREIGN KEY ("missedCallCaseId") REFERENCES "MissedCallCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_missedCallCoverId_fkey" FOREIGN KEY ("missedCallCoverId") REFERENCES "MissedCallCover"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ServiceUserContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverContactAttempt" ADD CONSTRAINT "CoverContactAttempt_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "CoverContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Communication attempts are history. Only the follow-up may be closed, once; the links set to NULL when a contact or
-- cover record is removed are allowed. Everything else is refused, so an entry can never be silently rewritten. A
-- correction is a new row with correctsId.
CREATE OR REPLACE FUNCTION csb_cover_attempt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "Visit" v WHERE v.id = NEW."visitId" AND v."organisationId" = NEW."organisationId" AND v."serviceUserId" = NEW."serviceUserId") THEN
      RAISE EXCEPTION 'Contact attempt visit must belong to the same organisation and service user';
    END IF;
    IF NEW."contactId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ServiceUserContact" c WHERE c.id = NEW."contactId" AND c."organisationId" = NEW."organisationId" AND c."serviceUserId" = NEW."serviceUserId") THEN
      RAISE EXCEPTION 'Contact attempt recipient must be one of this service user''s contacts';
    END IF;
    IF NEW."missedCallCaseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "MissedCallCase" m WHERE m.id = NEW."missedCallCaseId" AND m."organisationId" = NEW."organisationId" AND m."serviceUserId" = NEW."serviceUserId") THEN
      RAISE EXCEPTION 'Contact attempt case must belong to the same organisation and service user';
    END IF;
    IF NEW."correctsId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CoverContactAttempt" a WHERE a.id = NEW."correctsId" AND a."organisationId" = NEW."organisationId" AND a."serviceUserId" = NEW."serviceUserId") THEN
      RAISE EXCEPTION 'A correction must correct an entry for the same service user';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."contactId" IS NOT DISTINCT FROM OLD."contactId" OR NEW."contactId" IS NULL)
     AND (NEW."missedCallCoverId" IS NOT DISTINCT FROM OLD."missedCallCoverId" OR NEW."missedCallCoverId" IS NULL)
     AND (NEW.id, NEW."organisationId", NEW."serviceUserId", NEW."visitId", NEW."missedCallCaseId", NEW."recipientKind", NEW."recipientName", NEW."recipientRelationship", NEW."recipientAddress", NEW."recipientAuthority", NEW.method, NEW.outcome, NEW."notApplicableReason", NEW.notes, NEW.arrangement::text, NEW."arrangementKey", NEW."contactedAt", NEW."createdAt", NEW."createdById", NEW."followUpRequired", NEW."followUpOwnerId", NEW."followUpDueAt", NEW."correctsId", NEW."correctionReason", NEW."clientToken")
         IS NOT DISTINCT FROM
         (OLD.id, OLD."organisationId", OLD."serviceUserId", OLD."visitId", OLD."missedCallCaseId", OLD."recipientKind", OLD."recipientName", OLD."recipientRelationship", OLD."recipientAddress", OLD."recipientAuthority", OLD.method, OLD.outcome, OLD."notApplicableReason", OLD.notes, OLD.arrangement::text, OLD."arrangementKey", OLD."contactedAt", OLD."createdAt", OLD."createdById", OLD."followUpRequired", OLD."followUpOwnerId", OLD."followUpDueAt", OLD."correctsId", OLD."correctionReason", OLD."clientToken")
     AND (OLD."followUpDoneAt" IS NULL OR (NEW."followUpDoneAt" IS NOT DISTINCT FROM OLD."followUpDoneAt" AND NEW."followUpDoneById" IS NOT DISTINCT FROM OLD."followUpDoneById" AND NEW."followUpDoneNote" IS NOT DISTINCT FROM OLD."followUpDoneNote"))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Communication attempts cannot be changed. Record a correction instead.';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER cover_attempt_guard BEFORE INSERT OR UPDATE ON "CoverContactAttempt"
  FOR EACH ROW EXECUTE FUNCTION csb_cover_attempt_guard();

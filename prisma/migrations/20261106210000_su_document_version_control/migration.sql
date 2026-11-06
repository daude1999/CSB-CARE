-- Support plan version control (AI CSB Coordinator brief, 6 Nov 2026, phase 8). Additive only.
-- Each version keeps its own dates, set once when the file is added (versions stay immutable). Its status
-- (Pending review, Current, Superseded, Withdrawn, Rejected) is an append-only log, so the history of every
-- decision is kept and nothing is ever overwritten.
ALTER TABLE "ServiceUserDocumentVersion" ADD COLUMN "documentDate" DATE;
ALTER TABLE "ServiceUserDocumentVersion" ADD COLUMN "receivedOn" DATE;
ALTER TABLE "ServiceUserDocumentVersion" ADD COLUMN "effectiveFrom" DATE;
ALTER TABLE "ServiceUserDocumentVersion" ADD COLUMN "intakeId" TEXT;

CREATE TABLE "ServiceUserDocumentVersionStatus" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "actorId" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceUserDocumentVersionStatus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT su_doc_version_status_chk CHECK ("status" IN ('PENDING_REVIEW', 'CURRENT', 'SUPERSEDED', 'WITHDRAWN', 'REJECTED'))
);
CREATE INDEX "ServiceUserDocumentVersionStatus_documentId_at_idx" ON "ServiceUserDocumentVersionStatus"("documentId", "at");
ALTER TABLE "ServiceUserDocumentVersionStatus" ADD CONSTRAINT "ServiceUserDocumentVersionStatus_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ServiceUserDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The status log is history: rows are never edited, and a status belongs to its document's organisation.
CREATE TRIGGER csb_su_document_version_status_no_update BEFORE UPDATE ON "ServiceUserDocumentVersionStatus" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();
CREATE OR REPLACE FUNCTION csb_su_document_version_status_same_org() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ServiceUserDocumentVersion" v WHERE v.id = NEW."versionId" AND v."documentId" = NEW."documentId" AND v."organisationId" = NEW."organisationId") THEN
    RAISE EXCEPTION 'A version status must belong to the version''s document and organisation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_su_document_version_status_same_org BEFORE INSERT ON "ServiceUserDocumentVersionStatus" FOR EACH ROW EXECUTE FUNCTION csb_su_document_version_status_same_org();

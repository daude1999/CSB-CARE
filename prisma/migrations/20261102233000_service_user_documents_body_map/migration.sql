-- Service user documents (Council and Other), Digital Body Map, and database-backed private file storage. Additive only.
-- CreateEnum
CREATE TYPE "ServiceUserDocumentSection" AS ENUM ('COUNCIL', 'OTHER');

-- CreateEnum
CREATE TYPE "BodyMapView" AS ENUM ('FRONT', 'BACK', 'LEFT', 'RIGHT');

-- CreateEnum
CREATE TYPE "BodyMapStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "StoredObject" (
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ServiceUserDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "section" "ServiceUserDocumentSection" NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "receivedOn" DATE,
    "effectiveFrom" DATE,
    "expiresOn" DATE,
    "notes" TEXT,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lockVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ServiceUserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceUserDocumentVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL,
    "changeNote" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapObservation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "view" "BodyMapView" NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "region" TEXT NOT NULL,
    "locationDetail" TEXT,
    "category" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "size" TEXT,
    "appearance" TEXT,
    "pain" TEXT NOT NULL,
    "actionTaken" TEXT,
    "personNotified" TEXT,
    "followUpOn" DATE,
    "status" "BodyMapStatus" NOT NULL DEFAULT 'OPEN',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentDecision" TEXT,
    "incidentDecisionNote" TEXT,
    "incidentDecidedById" TEXT,
    "incidentDecidedAt" TIMESTAMP(3),
    "incidentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BodyMapObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "nextFollowUpOn" DATE,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BodyMapReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapPhoto" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMapPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserDocument_organisationId_serviceUserId_section_idx" ON "ServiceUserDocument"("organisationId", "serviceUserId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserDocumentVersion_documentId_version_key" ON "ServiceUserDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "BodyMapObservation_organisationId_serviceUserId_observedAt_idx" ON "BodyMapObservation"("organisationId", "serviceUserId", "observedAt");

-- CreateIndex
CREATE INDEX "BodyMapObservation_organisationId_status_followUpOn_idx" ON "BodyMapObservation"("organisationId", "status", "followUpOn");

-- AddForeignKey
ALTER TABLE "ServiceUserDocument" ADD CONSTRAINT "ServiceUserDocument_serviceUserId_organisationId_fkey" FOREIGN KEY ("serviceUserId", "organisationId") REFERENCES "ServiceUser"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceUserDocumentVersion" ADD CONSTRAINT "ServiceUserDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ServiceUserDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapObservation" ADD CONSTRAINT "BodyMapObservation_serviceUserId_organisationId_fkey" FOREIGN KEY ("serviceUserId", "organisationId") REFERENCES "ServiceUser"("id", "organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapObservation" ADD CONSTRAINT "BodyMapObservation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapReview" ADD CONSTRAINT "BodyMapReview_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapPhoto" ADD CONSTRAINT "BodyMapPhoto_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Uploaded files, photos and reviews are history: rows are never edited.
CREATE OR REPLACE FUNCTION csb_su_record_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed once saved', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_su_document_version_no_update BEFORE UPDATE ON "ServiceUserDocumentVersion" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();
CREATE TRIGGER csb_body_map_review_no_update BEFORE UPDATE ON "BodyMapReview" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();
CREATE TRIGGER csb_body_map_photo_no_update BEFORE UPDATE ON "BodyMapPhoto" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();

-- What was observed stays exactly as first recorded; only status, follow-up date and the incident decision move on.
CREATE OR REPLACE FUNCTION csb_body_map_original_kept() RETURNS trigger AS $$
BEGIN
  IF NEW."organisationId" <> OLD."organisationId" OR NEW."serviceUserId" <> OLD."serviceUserId" OR NEW."view" <> OLD."view"
     OR NEW."x" <> OLD."x" OR NEW."y" <> OLD."y" OR NEW."region" <> OLD."region" OR NEW."locationDetail" IS DISTINCT FROM OLD."locationDetail"
     OR NEW."category" <> OLD."category" OR NEW."observedAt" <> OLD."observedAt" OR NEW."description" <> OLD."description"
     OR NEW."size" IS DISTINCT FROM OLD."size" OR NEW."appearance" IS DISTINCT FROM OLD."appearance" OR NEW."pain" <> OLD."pain"
     OR NEW."actionTaken" IS DISTINCT FROM OLD."actionTaken" OR NEW."personNotified" IS DISTINCT FROM OLD."personNotified"
     OR NEW."recordedById" <> OLD."recordedById" OR NEW."recordedAt" <> OLD."recordedAt" THEN
    RAISE EXCEPTION 'The original body map observation cannot be changed; add a follow-up instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_body_map_original_kept BEFORE UPDATE ON "BodyMapObservation" FOR EACH ROW EXECUTE FUNCTION csb_body_map_original_kept();

-- A linked incident must belong to the same organisation and be about the same person.
CREATE OR REPLACE FUNCTION csb_body_map_incident_same_person() RETURNS trigger AS $$
BEGIN
  IF NEW."incidentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Incident" i WHERE i.id = NEW."incidentId" AND i."organisationId" = NEW."organisationId" AND i."serviceUserId" = NEW."serviceUserId"
  ) THEN
    RAISE EXCEPTION 'A body map observation can only be linked to an incident about the same person';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_body_map_incident_same_person BEFORE INSERT OR UPDATE OF "incidentId" ON "BodyMapObservation" FOR EACH ROW EXECUTE FUNCTION csb_body_map_incident_same_person();

-- Versions belong to the document's organisation.
CREATE OR REPLACE FUNCTION csb_su_document_version_same_org() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ServiceUserDocument" d WHERE d.id = NEW."documentId" AND d."organisationId" = NEW."organisationId") THEN
    RAISE EXCEPTION 'A document version must belong to the document''s organisation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_su_document_version_same_org BEFORE INSERT ON "ServiceUserDocumentVersion" FOR EACH ROW EXECUTE FUNCTION csb_su_document_version_same_org();

ALTER TABLE "BodyMapObservation" ADD CONSTRAINT body_map_pain_chk CHECK ("pain" IN ('NONE', 'MILD', 'MODERATE', 'SEVERE', 'NOT_ABLE_TO_SAY'));
ALTER TABLE "BodyMapObservation" ADD CONSTRAINT body_map_position_chk CHECK ("x" >= 0 AND "x" <= 100 AND "y" >= 0 AND "y" <= 100);
ALTER TABLE "BodyMapObservation" ADD CONSTRAINT body_map_incident_decision_chk CHECK ("incidentDecision" IS NULL OR "incidentDecision" IN ('LINKED', 'NOT_REQUIRED'));

-- Body Map: manual notes, AI-Assisted Recommendations (with human review), follow-up tasks and medication
-- application sites. Additive only: existing observations, reviews and photos are unchanged.

-- AlterTable
ALTER TABLE "BodyMapObservation" ADD COLUMN     "reviewerId" TEXT;

-- AlterTable
ALTER TABLE "BodyMapPhoto" ADD COLUMN     "noteId" TEXT;

-- AlterTable
ALTER TABLE "RotaSettings" ADD COLUMN     "bodyMapAiEnabledAt" TIMESTAMP(3),
ADD COLUMN     "bodyMapAiEnabledById" TEXT,
ADD COLUMN     "bodyMapAiReviewNote" TEXT;

-- CreateTable
CREATE TABLE "BodyMapNote" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMapNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapRecommendationRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "basisHash" TEXT NOT NULL,
    "observationVersion" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "BodyMapRecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapRecommendation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "actionKind" TEXT,
    "facts" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reviewStartedById" TEXT,
    "reviewStartedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMapRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMapTask" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "assigneeId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BodyMapTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationApplicationSite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "view" "BodyMapView" NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "region" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endReason" TEXT,

    CONSTRAINT "MedicationApplicationSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BodyMapNote_observationId_createdAt_idx" ON "BodyMapNote"("observationId", "createdAt");

-- CreateIndex
CREATE INDEX "BodyMapRecommendationRun_observationId_createdAt_idx" ON "BodyMapRecommendationRun"("observationId", "createdAt");

-- CreateIndex
CREATE INDEX "BodyMapRecommendation_organisationId_status_idx" ON "BodyMapRecommendation"("organisationId", "status");

-- CreateIndex
CREATE INDEX "BodyMapRecommendation_observationId_idx" ON "BodyMapRecommendation"("observationId");

-- CreateIndex
CREATE INDEX "BodyMapTask_organisationId_status_dueOn_idx" ON "BodyMapTask"("organisationId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "BodyMapTask_observationId_idx" ON "BodyMapTask"("observationId");

-- CreateIndex
CREATE INDEX "MedicationApplicationSite_organisationId_serviceUserId_idx" ON "MedicationApplicationSite"("organisationId", "serviceUserId");

-- CreateIndex
CREATE INDEX "MedicationApplicationSite_medicationId_idx" ON "MedicationApplicationSite"("medicationId");

-- AddForeignKey
ALTER TABLE "BodyMapNote" ADD CONSTRAINT "BodyMapNote_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapRecommendationRun" ADD CONSTRAINT "BodyMapRecommendationRun_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapRecommendation" ADD CONSTRAINT "BodyMapRecommendation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapRecommendation" ADD CONSTRAINT "BodyMapRecommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BodyMapRecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMapTask" ADD CONSTRAINT "BodyMapTask_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "BodyMapObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationApplicationSite" ADD CONSTRAINT "MedicationApplicationSite_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Notes are history: never edited.
CREATE TRIGGER csb_body_map_note_no_update BEFORE UPDATE ON "BodyMapNote" FOR EACH ROW EXECUTE FUNCTION csb_su_record_no_update();

-- The same information is never sent to the AI provider twice for one observation (failed attempts may be retried).
CREATE UNIQUE INDEX "BodyMapRecommendationRun_basis_key" ON "BodyMapRecommendationRun"("observationId", "basisHash") WHERE "status" <> 'FAILED';
ALTER TABLE "BodyMapRecommendationRun" ADD CONSTRAINT body_map_run_status_chk CHECK ("status" IN ('COMPLETED', 'NONE', 'FAILED'));
ALTER TABLE "BodyMapRecommendationRun" ADD CONSTRAINT body_map_run_trigger_chk CHECK ("trigger" IN ('AUTO', 'MANUAL'));

-- A run is a record of what happened: only "superseded by a later run" may be set, once.
CREATE OR REPLACE FUNCTION csb_body_map_run_kept() RETURNS trigger AS $$
BEGIN
  IF row(NEW."organisationId", NEW."observationId", NEW."trigger", NEW."basisHash", NEW."observationVersion", NEW."provider", NEW."model", NEW."isSimulated", NEW."status", NEW."error", NEW."gaps", NEW."sources", NEW."requestedById", NEW."createdAt")
     IS DISTINCT FROM row(OLD."organisationId", OLD."observationId", OLD."trigger", OLD."basisHash", OLD."observationVersion", OLD."provider", OLD."model", OLD."isSimulated", OLD."status", OLD."error", OLD."gaps", OLD."sources", OLD."requestedById", OLD."createdAt")
     OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt") THEN
    RAISE EXCEPTION 'A recommendation run cannot be changed once saved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_body_map_run_kept BEFORE UPDATE ON "BodyMapRecommendationRun" FOR EACH ROW EXECUTE FUNCTION csb_body_map_run_kept();

-- The suggestion shown to the reviewer is kept exactly; only its review moves on, along a fixed path.
ALTER TABLE "BodyMapRecommendation" ADD CONSTRAINT body_map_rec_status_chk CHECK ("status" IN ('NEW', 'UNDER_REVIEW', 'ACCEPTED', 'DISMISSED', 'ACTION_CREATED'));
ALTER TABLE "BodyMapRecommendation" ADD CONSTRAINT body_map_rec_category_chk CHECK ("category" IN ('OBSERVATION_FOLLOW_UP', 'CARE_PLAN_REVIEW', 'RISK_REVIEW', 'INCIDENT_SAFEGUARDING', 'MEDICATION_REVIEW', 'HISTORICAL_COMPARISON'));
CREATE OR REPLACE FUNCTION csb_body_map_rec_kept() RETURNS trigger AS $$
BEGIN
  IF row(NEW."organisationId", NEW."observationId", NEW."runId", NEW."position", NEW."category", NEW."title", NEW."explanation", NEW."suggestedAction", NEW."actionKind", NEW."facts", NEW."sources", NEW."createdAt")
     IS DISTINCT FROM row(OLD."organisationId", OLD."observationId", OLD."runId", OLD."position", OLD."category", OLD."title", OLD."explanation", OLD."suggestedAction", OLD."actionKind", OLD."facts", OLD."sources", OLD."createdAt") THEN
    RAISE EXCEPTION 'The text of an AI-assisted recommendation cannot be changed';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'NEW' AND NEW."status" IN ('UNDER_REVIEW', 'ACCEPTED', 'DISMISSED', 'ACTION_CREATED'))
    OR (OLD."status" = 'UNDER_REVIEW' AND NEW."status" IN ('ACCEPTED', 'DISMISSED', 'ACTION_CREATED'))
    OR (OLD."status" = 'ACCEPTED' AND NEW."status" = 'ACTION_CREATED')) THEN
    RAISE EXCEPTION 'A recommendation cannot move from % to %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER csb_body_map_rec_kept BEFORE UPDATE ON "BodyMapRecommendation" FOR EACH ROW EXECUTE FUNCTION csb_body_map_rec_kept();

ALTER TABLE "BodyMapTask" ADD CONSTRAINT body_map_task_status_chk CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED'));
ALTER TABLE "BodyMapTask" ADD CONSTRAINT body_map_task_kind_chk CHECK ("kind" IN ('FOLLOW_UP', 'CARE_PLAN_REVIEW', 'RISK_REVIEW', 'INCIDENT_ASSESSMENT', 'MANAGER_REVIEW'));

ALTER TABLE "MedicationApplicationSite" ADD CONSTRAINT medication_site_position_chk CHECK ("x" >= 0 AND "x" <= 100 AND "y" >= 0 AND "y" <= 100);

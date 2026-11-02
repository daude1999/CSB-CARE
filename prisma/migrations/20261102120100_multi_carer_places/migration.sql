-- Numbered carer places. Additive and safe for existing data:
--   * every existing assignment keeps its slot; PRIMARY becomes place 1, SECOND place 2, SHADOW place 0;
--   * places 3 and above are stored as ADDITIONAL with their number;
--   * the old "one live assignment per slot" rule becomes "one live assignment per place";
--   * the same person still never fills two places on one visit, and the no-double-booking rule is unchanged.

ALTER TABLE "VisitAssignment" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VisitTemplate" ADD COLUMN "extraPreferredStaffIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RotaPlanChange" ADD COLUMN "slotPosition" INTEGER;
ALTER TABLE "MissedCallCover" ADD COLUMN "slotPosition" INTEGER;

-- Keep the place number in step with the slot. Places 1 and 2 are always PRIMARY and SECOND.
CREATE OR REPLACE FUNCTION csb_visit_assignment_position() RETURNS trigger AS $$
BEGIN
  IF NEW.slot = 'PRIMARY' THEN NEW."position" := 1;
  ELSIF NEW.slot = 'SECOND' THEN NEW."position" := 2;
  ELSIF NEW.slot = 'SHADOW' THEN NEW."position" := 0;
  ELSIF NEW."position" IS NULL OR NEW."position" < 3 OR NEW."position" > 20 THEN
    RAISE EXCEPTION 'An additional carer place must be numbered 3 to 20';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER visit_assignment_position BEFORE INSERT OR UPDATE OF slot, "position" ON "VisitAssignment"
  FOR EACH ROW EXECUTE FUNCTION csb_visit_assignment_position();

-- Backfill. The trigger above also fires for these rows and sets the same values.
UPDATE "VisitAssignment" SET "position" = CASE slot WHEN 'PRIMARY' THEN 1 WHEN 'SECOND' THEN 2 ELSE 0 END;

-- One live assignment per place (replaces the per-slot rule, which cannot hold once ADDITIONAL repeats).
CREATE UNIQUE INDEX visit_assignment_place_uniq ON "VisitAssignment" ("visitId", "position") WHERE "removedAt" IS NULL;
DROP INDEX IF EXISTS visit_assignment_slot_uniq;

-- How many carers a visit or template may need.
-- The original checks allowed only 1 or 2 carers. Replace them with the same rules and a 1..20 carer range.
ALTER TABLE "Visit" DROP CONSTRAINT IF EXISTS visit_values_chk;
ALTER TABLE "Visit" ADD CONSTRAINT visit_values_chk CHECK ("scheduledEnd" > "scheduledStart" AND "carersRequired" BETWEEN 1 AND 20);
ALTER TABLE "VisitTemplate" DROP CONSTRAINT IF EXISTS visit_template_values_chk;
ALTER TABLE "VisitTemplate" ADD CONSTRAINT visit_template_values_chk CHECK (
  "startMinute" BETWEEN 0 AND 1439 AND "durationMin" BETWEEN 5 AND 1440 AND "carersRequired" BETWEEN 1 AND 20
  AND cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7]
  AND cardinality("cycleWeeks") > 0 AND "cycleWeeks" <@ ARRAY[1,2,3,4]
  AND ("preferredStaff2Id" IS NULL OR "preferredStaff1Id" IS NULL OR "preferredStaff1Id" <> "preferredStaff2Id"));

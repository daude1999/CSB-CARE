-- V1 item 4: carer task recording. A carer records each task on a visit once; the first record stands.
-- Additive: a partial unique index (office-recorded rows without a carer are not limited) and a check on note kinds.
CREATE UNIQUE INDEX "VisitTaskOutcome_task_staff_key" ON "VisitTaskOutcome" ("visitTaskId", "staffId") WHERE "staffId" IS NOT NULL;

ALTER TABLE "VisitNote" ADD CONSTRAINT "VisitNote_category_check"
  CHECK ("category" IN ('GENERAL', 'HANDOVER', 'CONCERN', 'SHORT_VISIT', 'CLOCK_OUT')) NOT VALID;

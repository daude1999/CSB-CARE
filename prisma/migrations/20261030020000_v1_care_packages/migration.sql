-- V1 item 5: care packages. Additive: at most one active package per person, and dates that make sense.
CREATE UNIQUE INDEX "CarePackage_one_active_key" ON "CarePackage" ("serviceUserId") WHERE "status" = 'ACTIVE';

ALTER TABLE "CarePackage" ADD CONSTRAINT "CarePackage_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "CarePackage" ADD CONSTRAINT "CarePackage_minutes_check" CHECK ("commissionedMinutesPerWeek" IS NULL OR "commissionedMinutesPerWeek" BETWEEN 0 AND 20160);

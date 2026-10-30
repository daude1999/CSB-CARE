-- V1 item 9: hand-set stop order on run routes, and a reason kept with a mileage decision.
-- AlterTable
ALTER TABLE "MileageClaim" ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "routeOrder" INTEGER;

-- AlterTable
ALTER TABLE "VisitTemplate" ADD COLUMN     "routeOrder" INTEGER;


ALTER TABLE "Visit" ADD CONSTRAINT "Visit_routeOrder_check" CHECK ("routeOrder" IS NULL OR "routeOrder" >= 0);
ALTER TABLE "VisitTemplate" ADD CONSTRAINT "VisitTemplate_routeOrder_check" CHECK ("routeOrder" IS NULL OR "routeOrder" >= 0);

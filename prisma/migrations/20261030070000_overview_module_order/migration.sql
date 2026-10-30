-- Overview redesign: each member may arrange the module boxes on the Overview. Additive; empty means the standard order.
ALTER TABLE "Membership" ADD COLUMN "overviewOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

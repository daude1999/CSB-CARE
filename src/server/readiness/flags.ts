import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "@/server/audit-log";

type Db = Tx | Prisma.TransactionClient;

/**
 * Raises "review required" for one person. Used by the HR projection (role or branch change), absences, incidents,
 * requirement changes and managers. One open flag per reason; clearing it records the outcome.
 */
export async function raiseReviewFlag(tx: Db, organisationId: string, staffId: string, reason: string, raisedById: string | null) {
  const open = await tx.staffReadinessFlag.findFirst({ where: { organisationId, staffId, clearedAt: null, reason } });
  if (open) return open;
  const row = await tx.staffReadinessFlag.create({ data: { organisationId, staffId, reason, raisedById } });
  await audit({ organisationId, actorId: raisedById, action: "readiness.review.raised", entityType: "StaffReadinessFlag", entityId: row.id, data: { staffId, reason } }, tx);
  return row;
}

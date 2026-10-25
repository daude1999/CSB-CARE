import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

/** Append-only audit trail (UPDATE/DELETE are blocked by a database trigger). */
export async function audit(
  entry: { organisationId?: string | null; actorId?: string | null; action: string; entityType: string; entityId: string; data?: Prisma.InputJsonValue },
  tx: Tx = db,
) {
  await tx.auditLog.create({
    data: {
      organisationId: entry.organisationId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data: entry.data ?? {},
    },
  });
}

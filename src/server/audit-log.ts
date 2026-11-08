import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

/**
 * Work done by CSB AI on someone's behalf (automatic setup of an intake, 7 Nov 2026). Every audit entry written inside
 * runAsAutomation() keeps the person who started it as actorId and is marked { automation: { by: "CSB AI", ... } }, so
 * the history never shows automated work as that person's own review or approval.
 */
export interface AutomationActor { by: "CSB AI"; initiatedById: string; run: string }
const automation = new AsyncLocalStorage<AutomationActor>();

export function runAsAutomation<T>(actor: Omit<AutomationActor, "by">, fn: () => Promise<T>): Promise<T> {
  return automation.run({ by: "CSB AI", ...actor }, fn);
}
export const currentAutomation = () => automation.getStore() ?? null;

/** The automation marker of an audit entry's data, or null when a person did it. */
export function automationOf(data: unknown): AutomationActor | null {
  const a = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).automation : null;
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  return r.by === "CSB AI" && typeof r.initiatedById === "string" ? { by: "CSB AI", initiatedById: r.initiatedById, run: typeof r.run === "string" ? r.run : "" } : null;
}

/** Append-only audit trail (UPDATE/DELETE are blocked by a database trigger). */
export async function audit(
  entry: { organisationId?: string | null; actorId?: string | null; action: string; entityType: string; entityId: string; data?: Prisma.InputJsonValue },
  tx: Tx = db,
) {
  const auto = currentAutomation();
  const base = entry.data ?? {};
  const data = auto && typeof base === "object" && base !== null && !Array.isArray(base) ? { ...(base as Record<string, Prisma.InputJsonValue>), automation: { ...auto } } : base;
  await tx.auditLog.create({
    data: {
      organisationId: entry.organisationId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      data,
    },
  });
}

import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";

/** The module boxes on the Overview, in the standard order. */
export const OVERVIEW_MODULES = ["policy", "rota", "hr", "reporting", "admin"] as const;
export type OverviewModule = (typeof OVERVIEW_MODULES)[number];

const orderSchema = z
  .array(z.enum(OVERVIEW_MODULES))
  .max(OVERVIEW_MODULES.length)
  .refine((ids) => new Set(ids).size === ids.length, "Each module can appear only once.");

/** Puts `keys` into the member's saved order. Modules not in the saved order keep their standard place at the end. */
export function arrange<T extends string>(keys: readonly T[], saved: readonly string[]): T[] {
  const rank = (k: T) => {
    const i = saved.indexOf(k);
    return i === -1 ? saved.length + OVERVIEW_MODULES.indexOf(k as OverviewModule) : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

/** The member's saved order in their active organisation, or [] for the standard order. */
export async function overviewOrder(ctx: Ctx): Promise<string[]> {
  if (!ctx.organisationId) return [];
  const m = await db.membership.findUnique({ where: { userId_organisationId: { userId: ctx.userId, organisationId: ctx.organisationId } }, select: { overviewOrder: true } });
  return m?.overviewOrder ?? [];
}

/**
 * Saves the member's own order of the module boxes. A personal display preference: it changes nothing anyone else
 * sees, so it needs no permission beyond being a member. An empty list restores the standard order.
 */
export async function saveOverviewOrder(ctx: Ctx, order: unknown): Promise<void> {
  if (!ctx.organisationId) throw new ValidationError("Choose an organisation before arranging the Overview.");
  const parsed = orderSchema.safeParse(order);
  if (!parsed.success) throw new ValidationError("That module order is not valid. Please try again.");
  const { count } = await db.membership.updateMany({ where: { userId: ctx.userId, organisationId: ctx.organisationId }, data: { overviewOrder: parsed.data } });
  if (!count) throw new NotFoundError("Your membership of this organisation was not found.");
}

import type { AssignmentSlot } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { deriveFlags, memberNames, visitCandidates } from "./queries";
import { rotaSettings } from "./settings";
import { swapCandidates } from "./swap";
import { getVisit } from "./visits";

/**
 * Everything the Daily Rota's Visit Details panel needs for one visit: the visit and its history, its flags, and, for
 * members who may change the rota, the ranked carers for each slot and the visits it could swap with. Uses the same
 * functions as the visit page, so the panel and the page always offer the same choices. Returns null for a visit the
 * member may not see (or that does not exist), so a stale link simply closes the panel.
 */
export async function visitInspector(ctx: Ctx, visitId: string) {
  let v: Awaited<ReturnType<typeof getVisit>>;
  try {
    v = await getVisit(ctx, visitId);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
  const settings = await rotaSettings(db, v.organisationId);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const live = v.assignments.filter((a) => !a.removedAt);
  const editable = canEdit && v.status === "SCHEDULED";
  const assignable = canEdit && ["SCHEDULED", "MISSED"].includes(v.status);
  const slots: AssignmentSlot[] = v.carersRequired > 1 ? ["PRIMARY", "SECOND"] : ["PRIMARY"];
  const swappable = editable ? live.filter((a) => a.slot !== "SHADOW").map((a) => a.slot) : [];
  const [candidates, swaps, names] = await Promise.all([
    assignable ? Promise.all(slots.map(async (s) => ({ slot: s, list: await visitCandidates(ctx, v, s) }))) : Promise.resolve([]),
    Promise.all(swappable.map(async (s) => ({ slot: s, list: await swapCandidates(ctx, v.id, s) }))),
    memberNames(ctx, [...v.events.map((e) => e.actorId), ...v.visitNotes.map((n) => n.authorUserId)]),
  ]);
  return { visit: v, live, flags: deriveFlags(v, settings), editable, assignable, canEdit, slots, candidates, swaps, names };
}

export type VisitInspectorData = NonNullable<Awaited<ReturnType<typeof visitInspector>>>;

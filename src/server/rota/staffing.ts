import { z } from "zod";
import { MAX_CARERS, parsePlace, placeKey, placeLabel, placeNumber, type PlaceKey } from "@/lib/carer-places";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { assignInTx, isOverlapViolation, lockVisit, unassignInTx } from "./assign";
import { rotaScope } from "./scope";
import { updateVisitInTx } from "./visits";

/**
 * Saving a set of carer changes from the Visit Details panel in one go.
 *
 * The coordinator drafts the staffing (who fills each numbered place, and how many places the visit needs) and presses
 * Save Changes. Every change then runs in one transaction through the shared assignment path, so the eligibility
 * service, the double-booking guard, the visit history, the audit log and the Medication Lead rules all apply exactly
 * as for a single change. If any one change is refused, nothing is saved: the visit is never left half re-staffed.
 */

const DEFAULT_REASON = "Removed by the office";

const schema = z.object({
  visitId: z.string().min(1, "Choose a visit"),
  /** The visit version the coordinator was looking at. A colleague's newer save is never overwritten. */
  lockVersion: z.number().int().nonnegative(),
  /** How many carer places the visit should need after the save. */
  carersRequired: z.number().int().min(1, "A visit needs at least one carer").max(MAX_CARERS, `A visit can need at most ${MAX_CARERS} carers`),
  /** The places to change: the carer who should fill each one, or null to leave it empty. */
  places: z
    .array(
      z.object({
        place: z.string().transform((v, c) => {
          const p = parsePlace(v);
          if (!p || p === "SHADOW") {
            c.addIssue({ code: "custom", message: "Choose a carer place" });
            return z.NEVER;
          }
          return p;
        }),
        staffId: z.string().min(1).nullable(),
      }),
    )
    .max(MAX_CARERS),
  /** The coordinator has read the warnings shown for the carers they chose. */
  acceptWarnings: z.boolean().default(false),
  removeReason: z.string().trim().max(300).optional(),
});
export type StaffingInput = z.input<typeof schema>;

/** A refusal tied to one place, so the panel can point at the row that needs attention. */
export class StaffingPlaceError extends ValidationError {
  constructor(
    message: string,
    public readonly place: PlaceKey,
  ) {
    super(message);
  }
}

export interface StaffingResult {
  /** How many places changed (added, replaced or removed carers) plus a change to the number of places. */
  changes: number;
  summary: string;
}

export async function saveVisitStaffing(ctx: Ctx, raw: StaffingInput): Promise<StaffingResult> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the carer changes");
  const d = parsed.data;
  const seen = new Set<string>();
  for (const p of d.places) {
    if (seen.has(p.place)) throw new ValidationError(`${placeLabel(p.place)} is listed twice`);
    seen.add(p.place);
    const n = placeNumber(p.place)!;
    if (n > d.carersRequired && p.staffId) throw new ValidationError(`${placeLabel(p.place)} is beyond the ${d.carersRequired} carer place${d.carersRequired === 1 ? "" : "s"} this visit will need`);
  }
  const chosen = d.places.map((p) => p.staffId).filter((x): x is string => !!x);
  if (new Set(chosen).size !== chosen.length) throw new ValidationError("The same carer is chosen for two places. Choose a different carer for one of them.");
  const scope = await rotaScope(ctx, "rota.edit");
  const reason = d.removeReason && d.removeReason.length >= 3 ? d.removeReason : DEFAULT_REASON;

  try {
    return await db.$transaction(
      async (tx) => {
        const visit = await lockVisit(tx, scope, d.visitId);
        if (visit.lockVersion !== d.lockVersion) throw new ConflictError("Someone else changed this visit after you opened it, so nothing was saved. Reload the visit to see their changes, then make yours again.");
        if (!["SCHEDULED", "MISSED"].includes(visit.status)) throw new ValidationError(`Carers cannot be changed on a ${visit.status.toLowerCase().replace("_", " ")} visit. Use an office correction on the full visit page instead.`);
        const before = await tx.visitAssignment.findMany({ where: { visitId: visit.id, removedAt: null }, select: { slot: true, position: true, staffId: true } });
        const current = new Map(before.filter((a) => a.slot !== "SHADOW").map((a) => [placeKey(a), a.staffId] as const));

        // Only real changes; choosing the carer who is already there does nothing.
        const changes = d.places.filter((p) => (current.get(p.place) ?? null) !== p.staffId);
        const countChanges = d.carersRequired !== visit.carersRequired;
        if (!changes.length && !countChanges) throw new ValidationError("There are no changes to save");
        if (countChanges && visit.status !== "SCHEDULED") throw new ValidationError(`The number of carers cannot be changed on a ${visit.status.toLowerCase()} visit`);

        const step = async <T>(place: PlaceKey, fn: () => Promise<T>) => {
          try {
            return await fn();
          } catch (e) {
            if (isOverlapViolation(e)) throw new StaffingPlaceError(`${placeLabel(place)}: this carer has just been booked for an overlapping visit. Choose someone else.`, place);
            if (e instanceof AppError) throw new StaffingPlaceError(`${placeLabel(place)}: ${e.message}`, place);
            throw e;
          }
        };

        // 1. More places first, so new places exist before they are filled.
        if (countChanges && d.carersRequired > visit.carersRequired) await updateVisitInTx(tx, scope, ctx.userId, visit.id, { carersRequired: d.carersRequired }, { source: "visit-panel" });

        // 2. Take people out: places being emptied, and places whose carer is moving to another place on this visit.
        const movingStaff = new Set(changes.map((c) => c.staffId).filter((s): s is string => !!s && [...current.values()].includes(s)));
        const clearFirst = changes.filter((c) => current.has(c.place) && (c.staffId === null || movingStaff.has(current.get(c.place)!)));
        for (const c of clearFirst) {
          const leaving = current.get(c.place)!;
          await step(c.place, () => unassignInTx(tx, scope, ctx.userId, { visitId: visit.id, slot: c.place, reason: c.staffId === null ? reason : "Moved to another place on this visit" }));
          current.delete(c.place);
          if (c.staffId === null) movingStaff.delete(leaving);
        }

        // 3. Fill and replace, in place order. A replacement is recorded as "Carer replaced" in the history.
        for (const c of changes.filter((x) => x.staffId).sort((a, b) => placeNumber(a.place)! - placeNumber(b.place)!)) {
          await step(c.place, () => assignInTx(tx, scope, ctx.userId, { visitId: visit.id, slot: c.place, staffId: c.staffId!, acceptWarnings: d.acceptWarnings }, { source: "visit-panel", reason: current.has(c.place) ? "Replaced from the Visit Details panel" : undefined }));
        }

        // 4. Fewer places last. The visit refuses this while a place to be dropped still has a carer in it.
        if (countChanges && d.carersRequired < visit.carersRequired) await updateVisitInTx(tx, scope, ctx.userId, visit.id, { carersRequired: d.carersRequired }, { source: "visit-panel" });

        const after = await tx.visitAssignment.findMany({ where: { visitId: visit.id, removedAt: null }, select: { slot: true, position: true, staffId: true } });
        const map = (rows: typeof before) => Object.fromEntries(rows.map((a) => [placeKey(a), a.staffId]));
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "visit.staffing_saved", entityType: "Visit", entityId: visit.id, data: { before: { carersRequired: visit.carersRequired, places: map(before) }, after: { carersRequired: d.carersRequired, places: map(after) }, source: "visit-panel" } }, tx);

        const n = changes.length + (countChanges ? 1 : 0);
        return { changes: n, summary: n === 1 ? "1 change saved" : `${n} changes saved` };
      },
      { isolationLevel: "ReadCommitted", timeout: 20_000 },
    );
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("A carer has just been booked for an overlapping visit, so nothing was saved. Choose someone else.");
    throw e;
  }
}

import type { AssignmentSlot, Prisma, RotaSettings, VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, isIsoDate, londonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { rankCarers } from "@/server/workforce/eligibility";
import { rotaSettings } from "./settings";
import { rotaScope, visitWhere } from "./scope";

/**
 * Derived visit indicators. They are computed on read from stored times and settings, so they never go stale:
 * late, short, unassigned and needs-review are not stored statuses.
 */
export interface VisitFlags {
  late: boolean;
  lateBy: number | null;
  short: boolean;
  unassignedSlots: number;
  review: string[];
  overdueStart: boolean;
}

export function deriveFlags(
  v: { status: VisitStatus; scheduledStart: Date; scheduledEnd: Date; actualStart: Date | null; actualEnd: Date | null; carersRequired: number; assignments: { slot: string; removedAt: Date | null; reviewReason: string | null }[] },
  settings: Pick<RotaSettings, "lateAfterMin" | "shortVisitPercent">,
  now = new Date(),
): VisitFlags {
  const live = v.assignments.filter((a) => !a.removedAt);
  const lateMs = settings.lateAfterMin * 60000;
  const startDelay = v.actualStart ? v.actualStart.getTime() - v.scheduledStart.getTime() : null;
  const overdueStart = v.status === "SCHEDULED" && now.getTime() > v.scheduledStart.getTime() + lateMs;
  const late = overdueStart || (startDelay !== null && startDelay > lateMs);
  const planned = v.scheduledEnd.getTime() - v.scheduledStart.getTime();
  const delivered = v.actualStart && v.actualEnd ? v.actualEnd.getTime() - v.actualStart.getTime() : null;
  return {
    late,
    lateBy: startDelay !== null ? Math.round(startDelay / 60000) : overdueStart ? Math.round((now.getTime() - v.scheduledStart.getTime()) / 60000) : null,
    short: v.status === "COMPLETED" && delivered !== null && delivered < (planned * settings.shortVisitPercent) / 100,
    unassignedSlots: ["CANCELLED", "NOT_DELIVERED", "COMPLETED"].includes(v.status) ? 0 : Math.max(0, v.carersRequired - live.filter((a) => a.slot !== "SHADOW").length),
    review: ["SCHEDULED", "MISSED"].includes(v.status) ? live.map((a) => a.reviewReason).filter((x): x is string => !!x) : [],
    overdueStart,
  };
}

export interface VisitFilters {
  date?: string;
  to?: string;
  staffId?: string;
  serviceUserId?: string;
  areaId?: string;
  callTypeId?: string;
  status?: VisitStatus;
  unassigned?: boolean;
  review?: boolean;
  includeCancelled?: boolean;
  q?: string;
}

export const visitListInclude = {
  serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, postcode: true } },
  callType: { select: { id: true, name: true } },
  area: { select: { id: true, name: true, colour: true } },
  runRoute: { select: { id: true, name: true, colour: true, textColour: true } },
  assignments: { where: { removedAt: null }, select: { id: true, slot: true, staffId: true, removedAt: true, acknowledgedAt: true, reviewReason: true, eligibility: true, staff: { select: { id: true, displayName: true } } } },
  tasks: { select: { id: true } },
} satisfies Prisma.VisitInclude;

export type VisitRow = Prisma.VisitGetPayload<{ include: typeof visitListInclude }> & { flags: VisitFlags };

export async function listVisits(ctx: Ctx, f: VisitFilters, take = 1000): Promise<{ rows: VisitRow[]; settings: RotaSettings; truncated: boolean }> {
  const scope = await rotaScope(ctx, "rota.view");
  const settings = await rotaSettings(db, scope.organisationId);
  const date = f.date && isIsoDate(f.date) ? f.date : londonDate();
  const to = f.to && isIsoDate(f.to) && f.to >= date ? f.to : date;
  const where: Prisma.VisitWhereInput = {
    ...visitWhere(scope),
    date: { gte: dbDate(date), lte: dbDate(to) },
    ...(f.status ? { status: f.status } : f.includeCancelled ? {} : { status: { not: "CANCELLED" } }),
    ...(f.serviceUserId ? { serviceUserId: f.serviceUserId } : {}),
    ...(f.areaId ? { areaId: f.areaId } : {}),
    ...(f.callTypeId ? { callTypeId: f.callTypeId } : {}),
    ...(f.staffId ? { assignments: { some: { staffId: f.staffId, removedAt: null } } } : {}),
    ...(f.q
      ? { OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { serviceUser: { lastName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { firstName: { contains: f.q, mode: "insensitive" } } }, { serviceUser: { postcode: { contains: f.q, mode: "insensitive" } } }] }
      : {}),
  };
  const rows = await db.visit.findMany({ where, include: visitListInclude, orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }], take: take + 1 });
  const now = new Date();
  let out = rows.slice(0, take).map((r) => ({ ...r, flags: deriveFlags(r, settings, now) }));
  if (f.unassigned) out = out.filter((r) => r.flags.unassignedSlots > 0);
  if (f.review) out = out.filter((r) => r.flags.review.length > 0);
  return { rows: out, settings, truncated: rows.length > take };
}

/** Lists for filter controls, scoped like everything else. */
export async function rotaLookups(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const [areas, callTypes, careTasks, serviceUsers, staff, routes] = await Promise.all([
    db.area.findMany({ where: { organisationId: org, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, orderBy: { name: "asc" } }),
    db.callType.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    db.careTask.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    db.serviceUser.findMany({ where: { organisationId: org, status: { in: ["ACTIVE", "PAUSED", "ASSESSMENT"] }, ...(scope.areaIds ? { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : {}) }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, areaId: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.staffMember.findMany({ where: { organisationId: org, employmentStatus: { not: "ARCHIVED" }, hrMissing: false }, select: { id: true, displayName: true, jobTitle: true, employmentStatus: true, areas: { select: { areaId: true } } }, orderBy: { displayName: "asc" } }),
    db.runRouteTemplate.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
  ]);
  return { scope, areas, callTypes, careTasks, serviceUsers, staff, routes };
}

export const suName = (su: { firstName: string; lastName: string; preferredName?: string | null }) => `${su.preferredName || su.firstName} ${su.lastName}`;

export function weekDates(monday: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Carers ranked for one slot of a visit (eligible first), with each person's reasons, for the assign picker. */
export async function visitCandidates(ctx: Ctx, visit: { id: string; serviceUserId: string; areaId: string | null; scheduledStart: Date; scheduledEnd: Date; timeLocked: boolean; assignments: { slot: string; staffId: string; removedAt: Date | null }[] }, slot: AssignmentSlot) {
  const scope = await rotaScope(ctx, "rota.view");
  const others = visit.assignments.filter((a) => !a.removedAt && a.slot !== slot).map((a) => a.staffId);
  const ranked = await rankCarers(db, scope.organisationId, { start: visit.scheduledStart, end: visit.scheduledEnd, slot, visitId: visit.id, serviceUserId: visit.serviceUserId, areaId: visit.areaId, timeLocked: visit.timeLocked });
  return ranked.filter((r) => !others.includes(r.result.staffId)).map((r) => ({ id: r.result.staffId, name: r.staff?.displayName ?? "", state: r.result.state, reasons: [...r.result.blocking, ...r.result.warnings].map((x) => x.message) }));
}

/** Display names for the people who acted on records (audit actors), limited to the caller's organisation. */
export async function memberNames(ctx: Ctx, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length || !ctx.organisationId) return new Map<string, string>();
  const ms = await db.membership.findMany({ where: { organisationId: ctx.organisationId, userId: { in: ids } }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(ms.map((m) => [m.userId, m.user.name]));
}

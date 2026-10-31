import type { AbsenceKind, AssignmentSlot } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, isIsoDate, londonDate, londonToUtc } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { deriveFlags, visitListInclude, type VisitRow } from "./queries";
import { rotaScope, staffDirectoryWhere, visitWhere } from "./scope";
import { rotaSettings } from "./settings";

/**
 * Sickness, holiday and replacement cover. Absences recorded in HR never move a visit (HR changes flag visits and never
 * reassign them); this board gathers the bookings an absence or an HR change has put at risk, so the office can choose
 * a replacement through the normal assignment path, which re-runs the eligibility service.
 */

export const COVER_KINDS: AbsenceKind[] = ["SICKNESS", "HOLIDAY", "COMPASSIONATE", "TRAINING", "UNPAID", "OTHER"];
export const KIND_LABEL: Record<AbsenceKind, string> = { SICKNESS: "Sickness", HOLIDAY: "Holiday", COMPASSIONATE: "Compassionate leave", TRAINING: "Training", UNPAID: "Unpaid leave", OTHER: "Other absence" };

export interface CoverFilters {
  from?: string;
  days?: number;
  kind?: string;
  area?: string;
}

export interface CoverItem {
  visit: VisitRow;
  slot: AssignmentSlot;
  staffId: string;
  staffName: string;
  /** Why the booking needs cover: the absence, or the HR change recorded on the booking. */
  reason: string;
}

export interface CoverAbsence {
  id: string;
  staffId: string;
  staffName: string;
  kind: AbsenceKind;
  status: string;
  startsAt: Date;
  endsAt: Date;
  items: CoverItem[];
}

export async function coverBoard(ctx: Ctx, f: CoverFilters, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.view");
  const org = scope.organisationId;
  const from = f.from && isIsoDate(f.from) ? f.from : londonDate(now);
  const days = Math.min(Math.max(Math.trunc(f.days ?? 14) || 14, 1), 28);
  const kind = COVER_KINDS.find((k) => k === f.kind);
  const windowStart = new Date(Math.max(now.getTime(), londonToUtc(from, 0).getTime()));
  const windowEnd = londonToUtc(addDays(from, days), 0);
  const area = f.area && (!scope.areaIds || scope.areaIds.includes(f.area)) ? f.area : undefined;

  const absences = await db.staffAbsence.findMany({
    where: { organisationId: org, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { lt: windowEnd }, endsAt: { gt: windowStart }, ...(kind ? { kind } : {}), staff: staffDirectoryWhere(scope, { status: "all" }) },
    select: { id: true, staffId: true, kind: true, status: true, startsAt: true, endsAt: true, staff: { select: { displayName: true } } },
    orderBy: [{ startsAt: "asc" }],
  });
  const absentIds = [...new Set(absences.map((a) => a.staffId))];

  // Bookings still held by an absent carer, plus any booking an HR change has flagged for review.
  const held = await db.visitAssignment.findMany({
    where: {
      organisationId: org,
      removedAt: null,
      slot: { not: "SHADOW" },
      startsAt: { lt: windowEnd },
      endsAt: { gt: windowStart },
      OR: [{ staffId: { in: absentIds } }, ...(kind ? [] : [{ reviewReason: { not: null } }])],
      visit: { AND: [visitWhere(scope)], status: "SCHEDULED", ...(area ? { areaId: area } : {}) },
    },
    select: { visitId: true, slot: true, staffId: true, startsAt: true, endsAt: true, reviewReason: true, staff: { select: { displayName: true } } },
    orderBy: { startsAt: "asc" },
  });
  const settings = await rotaSettings(db, org);
  const visits = new Map(
    (await db.visit.findMany({ where: { id: { in: [...new Set(held.map((h) => h.visitId))] } }, include: visitListInclude })).map((v) => [v.id, { ...v, flags: deriveFlags(v, settings, now) }]),
  );

  const byAbsence = new Map<string, CoverItem[]>();
  const flagged: CoverItem[] = [];
  for (const h of held) {
    const visit = visits.get(h.visitId);
    if (!visit) continue;
    const abs = absences.find((a) => a.staffId === h.staffId && a.startsAt < h.endsAt && a.endsAt > h.startsAt);
    if (abs) {
      const label = `${KIND_LABEL[abs.kind].toLowerCase()}${abs.status === "REQUESTED" ? " (requested, not yet approved)" : ""}`;
      byAbsence.set(abs.id, [...(byAbsence.get(abs.id) ?? []), { visit, slot: h.slot, staffId: h.staffId, staffName: h.staff.displayName, reason: `${h.staff.displayName} is on ${label}` }]);
    } else if (h.reviewReason) {
      flagged.push({ visit, slot: h.slot, staffId: h.staffId, staffName: h.staff.displayName, reason: h.reviewReason });
    }
  }

  const list: CoverAbsence[] = absences.map((a) => ({ id: a.id, staffId: a.staffId, staffName: a.staff.displayName, kind: a.kind, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, items: byAbsence.get(a.id) ?? [] }));
  const items = [...list.flatMap((a) => a.items), ...flagged];
  const counts = {
    absences: list.length,
    bookings: items.length,
    visits: new Set(items.map((i) => i.visit.id)).size,
    doubleUps: new Set(items.filter((i) => i.visit.carersRequired > 1).map((i) => i.visit.id)).size,
    flagged: flagged.length,
  };
  return { from, days, to: addDays(from, days - 1), kind: kind ?? null, area: area ?? null, absences: list, flagged, items, counts };
}

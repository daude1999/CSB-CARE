import type { VisitStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { londonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { EXCEPTION_KINDS, listExceptions } from "./exceptions";

/**
 * Visit states in plain words, kept distinct so the office never confuses "nobody has clocked in yet" with a call
 * someone has recorded as missed, or a call the person declined (not delivered) with one the office cancelled.
 */
export function visitStateLabel(v: { status: VisitStatus; scheduledStart: Date; actualStart: Date | null }, now = new Date(), lateAfterMin = 15) {
  const late = (v.actualStart ?? now).getTime() - v.scheduledStart.getTime() > lateAfterMin * 60_000;
  switch (v.status) {
    case "MISSED": return { label: "Recorded missed", tone: "rose" as const };
    case "NOT_DELIVERED": return { label: "Not delivered", tone: "rose" as const };
    case "CANCELLED": return { label: "Cancelled", tone: "slate" as const };
    case "COMPLETED": return late && v.actualStart ? { label: "Completed late", tone: "amber" as const } : { label: "Completed", tone: "green" as const };
    case "IN_PROGRESS": return late ? { label: "In progress, started late", tone: "amber" as const } : { label: "In progress", tone: "teal" as const };
    default: return late ? { label: "No attendance recorded", tone: "amber" as const } : { label: "Scheduled", tone: "slate" as const };
  }
}

/** Kinds that a later alert on the same visit replaces: a call that became missed no longer needs its "late" alert. */
const SUPERSEDED_BY: Record<string, string[]> = { LATE: ["MISSED", "NOT_DELIVERED"], OVERRUN: ["NOT_DELIVERED"] };

/**
 * The Monitor's open alerts: one entry per visit and kind, with what happened, who it concerns, when, why, the source
 * record, who is reviewing it and the actions that already exist for it. Counts come from the exceptions register.
 */
export async function monitorAlerts(ctx: Ctx, opts: { areaId?: string; lateAfterMin?: number } = {}, now = new Date()) {
  const { rows, names } = await listExceptions(ctx, { state: "open", area: opts.areaId }, { take: 200 });
  const visitIds = [...new Set(rows.map((r) => r.visitId).filter((x): x is string => !!x))];
  const visits = visitIds.length
    ? await db.visit.findMany({ where: { id: { in: visitIds } }, select: { id: true, reference: true, status: true, scheduledStart: true, actualStart: true, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } }, assignments: { where: { removedAt: null }, select: { staff: { select: { id: true, displayName: true } } } } } })
    : [];
  const byVisit = new Map(visits.map((v) => [v.id, v]));
  const staffIds = rows.map((r) => r.staffId).filter((x): x is string => !!x);
  const staff = staffIds.length ? await db.staffMember.findMany({ where: { id: { in: staffIds }, organisationId: ctx.organisationId ?? "" }, select: { id: true, displayName: true } }) : [];
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));

  const kindsOnVisit = new Map<string, Set<string>>();
  for (const r of rows) if (r.visitId) kindsOnVisit.set(r.visitId, (kindsOnVisit.get(r.visitId) ?? new Set()).add(r.kind));
  const seen = new Set<string>();
  let folded = 0;
  let older = 0;
  const today = londonDate(now);
  const out = [];
  for (const r of rows) {
    const onDay = r.visitId ? byVisit.get(r.visitId) : null;
    // The Monitor is about today. Alerts from earlier days stay in the Exceptions register and are counted, not listed.
    if ((onDay ? londonDate(onDay.scheduledStart) : londonDate(r.raisedAt)) !== today) {
      older++;
      continue;
    }
    const key = `${r.visitId ?? r.id}:${r.kind}`;
    const replacedBy = r.visitId ? (SUPERSEDED_BY[r.kind] ?? []).find((k) => kindsOnVisit.get(r.visitId!)?.has(k)) : undefined;
    if (seen.has(key) || replacedBy) {
      folded++;
      continue;
    }
    seen.add(key);
    const v = r.visitId ? byVisit.get(r.visitId) ?? null : null;
    const person = v ? `${v.serviceUser.preferredName ?? v.serviceUser.firstName} ${v.serviceUser.lastName}` : null;
    const carers = r.staffId ? [staffName.get(r.staffId) ?? "Former staff"] : v ? v.assignments.map((a) => a.staff.displayName) : [];
    const actions: { label: string; href: string }[] = [];
    if (v) actions.push({ label: "Open visit", href: `/rota/visits/${v.id}#attendance` });
    if (r.kind === "MISSED") actions.push({ label: "Missed Calls", href: "/rota/missed?period=day" });
    if (r.kind === "ALLOCATION_REVIEW" || r.kind === "UNASSIGNED") actions.push({ label: "Find Cover", href: v ? `/rota/unassigned?when=custom&from=${londonDate(v.scheduledStart)}&to=${londonDate(v.scheduledStart)}&cover=${v.id}` : "/rota/unassigned" });
    actions.push({ label: "Owner and resolve", href: `/rota/exceptions?kind=${r.kind}` });
    out.push({
      id: r.id,
      kind: r.kind,
      what: EXCEPTION_KINDS[r.kind] ?? r.kind,
      severity: r.severity,
      why: r.message,
      raisedAt: r.raisedAt,
      deadline: r.deadline,
      overdue: r.overdue,
      person: v ? { id: v.serviceUser.id, name: person! } : null,
      carers,
      visit: v ? { id: v.id, reference: v.reference, scheduledStart: v.scheduledStart, state: visitStateLabel(v, now, opts.lateAfterMin) } : null,
      actions,
      reviewer: r.escalationState === "ESCALATED" ? "Care managers (escalated)" : r.ownerId ? names.get(r.ownerId) ?? "Former member" : "No owner yet",
    });
  }
  return { alerts: out, folded, older };
}

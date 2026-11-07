import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { addDays, dbDate, isIsoDate, londonDate, londonDayBounds, londonTime } from "@/lib/london";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { priorityOf, type Priority } from "@/server/rota/unassigned";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { evaluate, loadFacts, loadPreferenceFacts, rankCarersMany, TRAVEL_GAP_MIN, type PreferenceFacts } from "@/server/workforce/eligibility";

/**
 * Whole-shift check for the Care Coordinator: tomorrow's visits by default (any date can be chosen).
 *
 * It reads the rota and lists what needs a person: open carer places (with up to three suggested carers each, ranked
 * by the eligibility service with continuity first), carers booked twice or with too little travel time, carers whose
 * compliance or availability no longer fits a booking, unpublished visits, and the outstanding approvals that block
 * care. It changes nothing. Every line says whether it is a FACT from the records or a RECOMMENDATION; the office acts
 * on the usual screens (assignment always goes through eligibility, publishing and messages need a person).
 */

export interface ShiftLine { kind: "FACT" | "RECOMMENDATION"; text: string; href?: string }

export async function shiftCheck(ctx: Ctx, dateIn?: string, now = new Date()) {
  requireOrgPermission(ctx, "rota.edit");
  const scope = await rotaScope(ctx, "rota.edit");
  const date = dateIn && isIsoDate(dateIn) ? dateIn : addDays(londonDate(now), 1);
  if (date < addDays(londonDate(now), -7) || date > addDays(londonDate(now), 60)) throw new ValidationError("Choose a date within the last week or the next 60 days");
  const org = scope.organisationId;
  const { start: from, end: to } = londonDayBounds(date);
  const visits = await db.visit.findMany({
    where: { organisationId: org, date: dbDate(date), status: { notIn: ["CANCELLED"] }, serviceUser: serviceUserWhere(scope) },
    include: {
      serviceUser: { select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true, riskLevel: true } },
      callType: { select: { name: true } },
      assignments: { where: { removedAt: null }, select: { id: true, staffId: true, slot: true, staff: { select: { displayName: true } } } },
      tasks: { select: { careTaskId: true } },
    },
    orderBy: { scheduledStart: "asc" },
  });
  const name = (su: { preferredName: string | null; firstName: string; lastName: string }) => `${su.preferredName ?? su.firstName} ${su.lastName}`;
  const placed = (v: (typeof visits)[number]) => v.assignments.filter((a) => a.slot !== "SHADOW").length;
  const uncovered = visits.filter((v) => v.status === "SCHEDULED" && placed(v) < v.carersRequired);

  // Suggested carers for open places, continuity first among equally eligible carers.
  const ranked = uncovered.length ? await rankCarersMany(db, org, uncovered.map((v) => ({ start: v.scheduledStart, end: v.scheduledEnd, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds: v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x), otherSlotStaffIds: v.assignments.map((a) => a.staffId) }))) : [];
  const history = uncovered.length ? await db.visitAssignment.findMany({ where: { organisationId: org, removedAt: null, visit: { serviceUserId: { in: [...new Set(uncovered.map((v) => v.serviceUserId))] }, date: { gte: dbDate(addDays(date, -42)), lt: dbDate(date) } } }, select: { staffId: true, visit: { select: { serviceUserId: true } } } }) : [];
  const regular = (suId: string, staffId: string) => history.some((h) => h.staffId === staffId && h.visit.serviceUserId === suId);
  const open = uncovered.map((v, i) => {
    const p = priorityOf({ status: v.status, scheduledStart: v.scheduledStart, riskLevel: v.serviceUser.riskLevel }, now);
    const options = (ranked[i] ?? [])
      .filter((x) => x.result.state !== "NOT_ELIGIBLE" && !v.assignments.some((a) => a.staffId === x.staff!.id))
      .sort((a, b) => (a.result.state === b.result.state ? Number(regular(v.serviceUserId, b.staff!.id)) - Number(regular(v.serviceUserId, a.staff!.id)) : 0))
      .slice(0, 3)
      .map((x) => ({ staffId: x.staff!.id, name: x.staff!.displayName, state: x.result.state, continuity: regular(v.serviceUserId, x.staff!.id), notes: [...x.result.warnings, ...x.result.advice].map((r) => r.message).slice(0, 2) }));
    return { visitId: v.id, reference: v.reference, time: `${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)}`, start: v.scheduledStart, person: name(v.serviceUser), serviceUserId: v.serviceUserId, callType: v.callType.name, missing: v.carersRequired - placed(v), priority: p.priority as Priority, why: p.why, published: !!v.publishedAt, options };
  });

  // Carers booked twice, or with little time to travel between visits.
  const byStaff = new Map<string, { name: string; items: { visitId: string; reference: string; person: string; start: Date; end: Date }[] }>();
  for (const v of visits) for (const a of v.assignments) {
    const e = byStaff.get(a.staffId) ?? { name: a.staff.displayName, items: [] };
    e.items.push({ visitId: v.id, reference: v.reference, person: name(v.serviceUser), start: v.scheduledStart, end: v.scheduledEnd });
    byStaff.set(a.staffId, e);
  }
  const clashes: { staffId: string; name: string; kind: "OVERLAP" | "TIGHT"; text: string; visitIds: string[] }[] = [];
  for (const [staffId, e] of byStaff) {
    const items = e.items.sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!, cur = items[i]!;
      const gap = (cur.start.getTime() - prev.end.getTime()) / 60000;
      if (gap < 0) clashes.push({ staffId, name: e.name, kind: "OVERLAP", text: `${e.name} is booked on ${prev.reference} (${prev.person}, until ${londonTime(prev.end)}) and ${cur.reference} (${cur.person}, from ${londonTime(cur.start)}) at the same time.`, visitIds: [prev.visitId, cur.visitId] });
      else if (gap < TRAVEL_GAP_MIN) clashes.push({ staffId, name: e.name, kind: "TIGHT", text: `${e.name} has ${Math.round(gap)} minutes between ${prev.person} (${londonTime(prev.end)}) and ${cur.person} (${londonTime(cur.start)}). Check travel time.`, visitIds: [prev.visitId, cur.visitId] });
    }
  }

  // Bookings that the rules would no longer allow, or would flag (compliance, absence, availability, restrictions).
  const staffIds = [...byStaff.keys()];
  const compliance: { staffId: string; name: string; visitId: string; reference: string; person: string; state: string; reasons: string[] }[] = [];
  if (staffIds.length) {
    const [settings, facts] = await Promise.all([rotaSettings(db, org), loadFacts(db, org, staffIds, from, to)]);
    const prefs = new Map<string, PreferenceFacts | null>();
    for (const v of visits) {
      if (!prefs.has(v.serviceUserId)) prefs.set(v.serviceUserId, await loadPreferenceFacts(db, org, v.serviceUserId));
      for (const a of v.assignments) {
        const r = evaluate(settings, facts, { staffId: a.staffId, start: v.scheduledStart, end: v.scheduledEnd, slot: a.slot, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds: v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x) }, prefs.get(v.serviceUserId) ?? null, { otherSlotStaffIds: v.assignments.filter((o) => o.id !== a.id).map((o) => o.staffId) });
        const reasons = [...r.blocking, ...r.warnings].map((x) => x.message).filter((m) => !/already booked/i.test(m));
        if (r.state !== "ELIGIBLE" && reasons.length) compliance.push({ staffId: a.staffId, name: a.staff.displayName, visitId: v.id, reference: v.reference, person: name(v.serviceUser), state: r.state, reasons: reasons.slice(0, 3) });
      }
    }
  }

  // Approvals and checks that block care, for the coordinator's attention.
  const [intakesWaiting, riskDrafts, medDrafts, plansInReview, reconciliation] = await Promise.all([
    // Intakes with a section that was approved but not saved (it failed): the coordinator retries them.
    db.careIntake.count({ where: { organisationId: org, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }, sections: { some: { status: "APPROVED", applyStatus: "FAILED" } } } }),
    db.riskAssessment.count({ where: { organisationId: org, status: "DRAFT", serviceUser: serviceUserWhere(scope) } }),
    db.medication.count({ where: { organisationId: org, status: "DRAFT", serviceUser: serviceUserWhere(scope) } }),
    db.carePlan.count({ where: { organisationId: org, status: "IN_REVIEW", serviceUser: serviceUserWhere(scope) } }),
    hasOrgPermission(ctx, "serviceUser.sensitive") ? db.careIntakeReviewItem.count({ where: { organisationId: org, status: "OPEN", category: "MEDICATION", serviceUser: serviceUserWhere(scope) } }) : Promise.resolve(null),
  ]);
  const unpublished = visits.filter((v) => !v.publishedAt && v.status === "SCHEDULED").length;
  const urgent: ShiftLine[] = [
    ...open.filter((o) => o.priority === "URGENT").map((o) => ({ kind: "FACT" as const, text: `${o.time} ${o.person} (${o.callType}) has ${o.missing} open place${o.missing === 1 ? "" : "s"}: ${o.why.toLowerCase()}.`, href: `/rota/visits/${o.visitId}` })),
    ...clashes.filter((c) => c.kind === "OVERLAP").map((c) => ({ kind: "FACT" as const, text: c.text, href: `/rota/visits/${c.visitIds[0]}` })),
    ...(unpublished ? [{ kind: "FACT" as const, text: `${unpublished} visit${unpublished === 1 ? " is" : "s are"} not published, so carers cannot see ${unpublished === 1 ? "it" : "them"}. A coordinator publishes after checking.`, href: `/rota/visits?date=${date}` }] : []),
    ...(intakesWaiting ? [{ kind: "FACT" as const, text: `${intakesWaiting} Care Coordinator intake${intakesWaiting === 1 ? " has" : "s have"} a section that was approved but not saved. Open ${intakesWaiting === 1 ? "it" : "them"} and press Approve & Save to CRM again.`, href: "/rota/coordinator" }] : []),
    ...(plansInReview ? [{ kind: "FACT" as const, text: `${plansInReview} care plan${plansInReview === 1 ? " is" : "s are"} waiting for approval.`, href: "/rota/care-plans?filter=review" }] : []),
    ...(riskDrafts ? [{ kind: "FACT" as const, text: `${riskDrafts} draft risk assessment${riskDrafts === 1 ? " needs" : "s need"} an independent review.` }] : []),
    ...(medDrafts ? [{ kind: "FACT" as const, text: `${medDrafts} draft medicine${medDrafts === 1 ? " needs" : "s need"} a second person's approval.` }] : []),
    ...(reconciliation ? [{ kind: "FACT" as const, text: `${reconciliation} medication reconciliation item${reconciliation === 1 ? " is" : "s are"} open.` }] : []),
  ];
  const handover: ShiftLine[] = [
    { kind: "FACT", text: `${visits.length} visit${visits.length === 1 ? "" : "s"} on ${date}; ${visits.length - uncovered.length} fully staffed, ${uncovered.length} with open places (${open.reduce((n, o) => n + o.missing, 0)} places).` },
    ...open.map((o) => ({ kind: "RECOMMENDATION" as const, text: o.options.length ? `${o.time} ${o.person}: consider ${o.options.map((x) => `${x.name}${x.continuity ? " (knows the person)" : ""}${x.state === "REQUIRES_REVIEW" ? " (check first)" : ""}`).join(", ")}.` : `${o.time} ${o.person}: no eligible carer found. Ask a manager about agency or rearranging visits.`, href: `/rota/visits/${o.visitId}` })),
    ...clashes.map((c) => ({ kind: (c.kind === "OVERLAP" ? "FACT" : "RECOMMENDATION") as ShiftLine["kind"], text: c.text, href: `/rota/visits/${c.visitIds[0]}` })),
    ...compliance.map((c) => ({ kind: "FACT" as const, text: `${c.name} on ${c.reference} (${c.person}): ${c.reasons.join("; ")}.`, href: `/rota/visits/${c.visitId}` })),
  ];
  return { date, generatedAt: now, visits: visits.length, staffed: visits.length - uncovered.length, open, clashes, compliance, urgent, handover, counts: { intakesWaiting, riskDrafts, medDrafts, plansInReview, reconciliation, unpublished } };
}
export type ShiftCheck = Awaited<ReturnType<typeof shiftCheck>>;

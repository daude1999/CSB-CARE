import { randomUUID } from "node:crypto";
import type { AssignmentSlot, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { addDays, cycleWeekOf, dbDate, fromDbDate, isoWeekday, londonDate, londonMinute, londonToUtc, mondayOf } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { priceVisit, type Band } from "@/server/finance/pricing";
import { evaluate, loadFacts, type Facts, type PreferenceFacts } from "@/server/workforce/eligibility";
import { raiseAlert } from "@/server/workforce/impact";
import { parseWeek } from "./build";
import { rotaScope, staffDirectoryWhere, visitWhere, type Scope } from "./scope";
import { rotaSettings } from "./settings";
import { visitReference } from "./visits";

/**
 * One-Click Roll Forward: copies an existing built week (with every change made to it by hand) into the next 1, 2 or
 * 4 weeks as unpublished drafts. Unlike Build Rota, which starts from the recurring templates, it starts from the visits
 * the office actually ran. Every carer is re-checked with the shared eligibility rules for the new date; anyone who
 * cannot take the visit now is left off it with the reason, never copied blindly. Visits that already exist in the
 * destination (from a template build or an earlier roll forward) are left alone, so running it twice adds nothing.
 */

type Tx = Prisma.TransactionClient;
export const ROLL_WEEKS = [1, 2, 4] as const;
export type RollWeeks = (typeof ROLL_WEEKS)[number];

export interface RolledSlot {
  slot: AssignmentSlot;
  /** The carer on the source visit, if any. */
  fromStaffId: string | null;
  fromName: string | null;
  staffId: string | null;
  staffName: string | null;
  state: "KEPT" | "REVIEW" | "UNCOVERED";
  reason?: string;
}
export interface RolledVisit {
  sourceVisitId: string;
  sourceReference: string;
  sourceDate: string;
  serviceUserId: string;
  serviceUserName: string;
  callType: string;
  areaId: string | null;
  templateId: string | null;
  date: string;
  weekStart: string;
  start: Date;
  end: Date;
  durationMin: number;
  carersRequired: number;
  slots: RolledSlot[];
  /** Estimated basic pay for the carers kept on it, in pence; null when a kept carer has no pay rate. */
  payPence: number | null;
}
export interface RollSkipped {
  sourceReference: string;
  serviceUserName: string;
  date: string;
  reason: string;
}
export interface RollPlan {
  sourceWeek: string;
  targetWeeks: string[];
  areaIds: string[];
  sourceVisits: number;
  visits: RolledVisit[];
  skipped: RollSkipped[];
  /** Visits already in the destination for the same call; left as they are. */
  existing: number;
  counts: { create: number; kept: number; review: number; uncovered: number; doubleUpsShort: number };
  forecastMinutes: number;
  estimatedPayPence: number;
  slotsWithoutRate: number;
  /** Why nothing can be rolled forward, when visits is empty. */
  blockers: string[];
}

const nameOf = (su: { firstName: string; lastName: string; preferredName: string | null }) => `${su.preferredName || su.firstName} ${su.lastName}`;

export function parseRollInput(input: { sourceWeek: string; targetWeek: string; weeks: number }) {
  const sourceWeek = parseWeek(input.sourceWeek);
  const targetWeek = parseWeek(input.targetWeek);
  if (!ROLL_WEEKS.includes(input.weeks as RollWeeks)) throw new ValidationError("Roll forward 1, 2 or 4 weeks");
  if (targetWeek <= sourceWeek) throw new ValidationError("The new rota must start after the week you copy from");
  if (targetWeek < mondayOf(londonDate())) throw new ValidationError("The new rota cannot start in a week that has finished");
  return { sourceWeek, targetWeek, weeks: input.weeks as RollWeeks };
}

async function allowedStaff(tx: Tx, scope: Scope): Promise<Set<string> | null> {
  if (!scope.areaIds && !scope.branchIds) return null;
  return new Set((await tx.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, { status: "all" }), employmentStatus: { not: "ARCHIVED" } }, select: { id: true } })).map((s) => s.id));
}

async function plan(tx: Tx, scope: Scope, input: { sourceWeek: string; targetWeek: string; weeks: RollWeeks; areaIds: string[] }, now = new Date()): Promise<RollPlan> {
  const org = scope.organisationId;
  const settings = await rotaSettings(tx, org);
  const allAreas = await tx.area.findMany({ where: { organisationId: org, active: true }, select: { id: true } });
  const permitted = allAreas.map((a) => a.id).filter((id) => !scope.areaIds || scope.areaIds.includes(id));
  const areaIds = input.areaIds.length ? input.areaIds.filter((id) => permitted.includes(id)) : permitted;
  if (input.areaIds.length && areaIds.length !== input.areaIds.length) throw new ValidationError("One of the chosen areas is not available to you");
  const targetWeeks = Array.from({ length: input.weeks }, (_, i) => addDays(input.targetWeek, i * 7));
  const rangeStart = targetWeeks[0]!;
  const rangeEnd = addDays(targetWeeks[targetWeeks.length - 1]!, 6);
  const from = londonToUtc(rangeStart, 0);
  const to = londonToUtc(addDays(rangeEnd, 2), 0);

  const source = await tx.visit.findMany({
    where: {
      AND: [visitWhere(scope), input.areaIds.length ? { areaId: { in: areaIds } } : {}],
      date: { gte: dbDate(input.sourceWeek), lte: dbDate(addDays(input.sourceWeek, 6)) },
      status: { not: "CANCELLED" },
    },
    include: {
      serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, status: true, carerGenderPreference: true, carerPreferences: true } },
      callType: { select: { name: true } },
      assignments: { where: { removedAt: null }, select: { slot: true, staffId: true, staff: { select: { displayName: true } } } },
      tasks: { select: { careTaskId: true } },
    },
    orderBy: [{ scheduledStart: "asc" }, { reference: "asc" }],
  });

  const [existing, absences, allowed, payRates, bankHolidays] = await Promise.all([
    tx.visit.findMany({ where: { organisationId: org, date: { gte: dbDate(rangeStart), lte: dbDate(rangeEnd) } }, select: { templateId: true, date: true, serviceUserId: true, scheduledStart: true } }),
    tx.serviceUserAbsence.findMany({ where: { organisationId: org, cancelledAt: null, serviceUserId: { in: [...new Set(source.map((v) => v.serviceUserId))] }, startsAt: { lt: to }, OR: [{ endsAt: null }, { endsAt: { gt: from } }] } }),
    allowedStaff(tx, scope),
    tx.staffPayRate.findMany({ where: { organisationId: org, effectiveFrom: { lte: dbDate(rangeEnd) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(rangeStart) } }] }, include: { rateCard: { include: { bands: true } } } }),
    tx.bankHoliday.findMany({ where: { organisationId: org, date: { gte: dbDate(rangeStart), lte: dbDate(rangeEnd) } }, select: { date: true } }),
  ]);
  const byTemplate = new Set(existing.filter((e) => e.templateId).map((e) => `${e.templateId}|${fromDbDate(e.date)}`));
  const bySuTime = new Set(existing.map((e) => `${e.serviceUserId}|${e.scheduledStart.getTime()}`));
  const holidays = new Set(bankHolidays.map((b) => fromDbDate(b.date)));
  const bandsFor = (staffId: string, date: string): Band[] | null => {
    const r = payRates.find((p) => p.staffId === staffId && fromDbDate(p.effectiveFrom) <= date && (!p.effectiveTo || fromDbDate(p.effectiveTo) >= date));
    return r ? r.rateCard.bands : null;
  };
  const staffIds = [...new Set(source.flatMap((v) => v.assignments.map((a) => a.staffId)))];
  const facts: Facts = await loadFacts(tx, org, staffIds, from, to);

  const offsetDays = Math.round((Date.parse(input.targetWeek) - Date.parse(input.sourceWeek)) / 86_400_000);
  const visits: RolledVisit[] = [];
  const skipped: RollSkipped[] = [];
  let existingCount = 0;
  for (const [k, week] of targetWeeks.entries()) {
    for (const v of source) {
      const sourceDate = fromDbDate(v.date);
      const date = addDays(sourceDate, offsetDays + k * 7);
      const durationMin = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
      const start = londonToUtc(date, londonMinute(v.scheduledStart));
      const end = new Date(start.getTime() + durationMin * 60000);
      const suName = nameOf(v.serviceUser);
      const skip = (reason: string) => skipped.push({ sourceReference: v.reference, serviceUserName: suName, date, reason });
      if ((v.templateId && byTemplate.has(`${v.templateId}|${date}`)) || bySuTime.has(`${v.serviceUserId}|${start.getTime()}`)) {
        existingCount++;
        continue;
      }
      if (start <= now) {
        skip("Start time has already passed");
        continue;
      }
      if (v.serviceUser.status !== "ACTIVE") {
        skip(`Care is ${v.serviceUser.status.toLowerCase()}`);
        continue;
      }
      const away = absences.find((a) => a.serviceUserId === v.serviceUserId && a.startsAt < end && (!a.endsAt || a.endsAt > start));
      if (away) {
        skip(`Service user away (${away.reason.toLowerCase()})`);
        continue;
      }
      const prefs: PreferenceFacts = { carerGenderPreference: v.serviceUser.carerGenderPreference, preferences: v.serviceUser.carerPreferences };
      const careTaskIds = v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
      const wanted: AssignmentSlot[] = ["PRIMARY", ...(v.carersRequired > 1 ? (["SECOND"] as const) : []), ...(v.assignments.some((a) => a.slot === "SHADOW") ? (["SHADOW"] as const) : [])];
      const slots: RolledSlot[] = [];
      const planId = `roll-${visits.length}`;
      for (const slot of wanted) {
        const src = v.assignments.find((a) => a.slot === slot);
        if (!src) {
          slots.push({ slot, fromStaffId: null, fromName: null, staffId: null, staffName: null, state: "UNCOVERED", reason: "No carer on the visit copied from" });
          continue;
        }
        const name = src.staff.displayName;
        const drop = (reason: string) => {
          if (slot !== "SHADOW") slots.push({ slot, fromStaffId: src.staffId, fromName: name, staffId: null, staffName: null, state: "UNCOVERED", reason });
        };
        if (allowed && !allowed.has(src.staffId)) {
          drop(`${name} works in a branch or area outside yours`);
          continue;
        }
        const r = evaluate(settings, facts, { staffId: src.staffId, start, end, slot, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds }, prefs, { otherSlotStaffIds: slots.map((s) => s.staffId).filter((x): x is string => !!x) });
        if (r.state === "NOT_ELIGIBLE") {
          drop(`${name}: ${r.blocking.map((b) => b.message).join("; ")}`);
          continue;
        }
        slots.push({ slot, fromStaffId: src.staffId, fromName: name, staffId: src.staffId, staffName: name, state: r.state === "ELIGIBLE" ? "KEPT" : "REVIEW", reason: r.state === "ELIGIBLE" ? undefined : r.warnings.map((w) => w.message).join("; ") });
        // Book the carer in memory so later visits in this roll forward see the booking.
        facts.assignments.push({ id: `${planId}-${slot}`, staffId: src.staffId, visitId: planId, slot, startsAt: start, endsAt: end, visit: { reference: "this roll forward" } });
      }
      let payPence: number | null = 0;
      for (const s of slots.filter((x) => x.staffId && x.slot !== "SHADOW")) {
        const bands = bandsFor(s.staffId!, date);
        const priced = bands ? priceVisit(bands, { weekday: isoWeekday(date), startMinute: londonMinute(start), minutes: durationMin, bankHoliday: holidays.has(date) }) : null;
        if (!priced) payPence = null;
        else if (payPence !== null) payPence += priced.amountPence;
      }
      visits.push({ sourceVisitId: v.id, sourceReference: v.reference, sourceDate, serviceUserId: v.serviceUserId, serviceUserName: suName, callType: v.callType.name, areaId: v.areaId, templateId: v.templateId, date, weekStart: week, start, end, durationMin, carersRequired: v.carersRequired, slots, payPence });
    }
  }

  const core = visits.flatMap((v) => v.slots.filter((s) => s.slot !== "SHADOW"));
  const kept = core.filter((s) => s.state === "KEPT").length;
  const review = core.filter((s) => s.state === "REVIEW").length;
  const uncovered = core.filter((s) => s.state === "UNCOVERED").length;
  const doubleUpsShort = visits.filter((v) => v.carersRequired > 1 && v.slots.filter((s) => s.slot !== "SHADOW" && s.staffId).length < v.carersRequired).length;
  const blockers: string[] = [];
  if (!visits.length) {
    if (scope.areaIds && !scope.areaIds.length) blockers.push("Your account is not linked to any area, so there is nothing you can roll forward.");
    else if (!source.length) blockers.push("The week you chose to copy from has no visits in your areas. Choose a week that has been built.");
    else if (existingCount && !skipped.length) blockers.push(`Every visit already exists in the new weeks (${existingCount}). Rolling forward again never creates duplicates.`);
    else if (skipped.length) blockers.push(`All ${skipped.length} visits would be skipped (${[...new Set(skipped.map((s) => s.reason))].slice(0, 3).join("; ")}).`);
  }
  return {
    sourceWeek: input.sourceWeek,
    targetWeeks,
    areaIds,
    sourceVisits: source.length,
    visits,
    skipped,
    existing: existingCount,
    counts: { create: visits.length, kept, review, uncovered, doubleUpsShort },
    forecastMinutes: visits.reduce((m, v) => m + v.durationMin * v.carersRequired, 0),
    estimatedPayPence: visits.reduce((p, v) => p + (v.payPence ?? 0), 0),
    slotsWithoutRate: visits.reduce((n, v) => n + (v.payPence === null ? v.slots.filter((s) => s.staffId && s.slot !== "SHADOW").length : 0), 0),
    blockers,
  };
}

export async function previewRollForward(ctx: Ctx, input: { sourceWeek: string; targetWeek: string; weeks: number; areaIds?: string[] }) {
  const scope = await rotaScope(ctx, "rota.build");
  const p = parseRollInput(input);
  return plan(db, scope, { ...p, areaIds: input.areaIds ?? [] });
}

/**
 * Saves a roll forward as one unpublished build per destination week, in a single transaction. The plan is worked out
 * again inside the transaction under per-week locks, so what is saved is what the rules allow at that moment.
 */
export async function confirmRollForward(ctx: Ctx, input: { sourceWeek: string; targetWeek: string; weeks: number; areaIds?: string[] }) {
  const scope = await rotaScope(ctx, "rota.build");
  const p = parseRollInput(input);
  return db.$transaction(
    async (tx) => {
      const weeks = Array.from({ length: p.weeks }, (_, i) => addDays(p.targetWeek, i * 7));
      // The same lock as Build Rota, so a build and a roll forward of the same week never run at once.
      for (const w of weeks) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rota-build:${scope.organisationId}:${w}`}))`;
      const pl = await plan(tx, scope, { ...p, areaIds: input.areaIds ?? [] });
      if (!pl.visits.length) throw new ValidationError(pl.blockers[0] ?? "There is nothing to roll forward.");
      const staffIds = [...new Set(pl.visits.flatMap((v) => v.slots.map((s) => s.staffId)).filter((x): x is string => !!x))].sort();
      if (staffIds.length) await tx.$queryRaw`SELECT id FROM "StaffMember" WHERE id = ANY(${staffIds}) ORDER BY id FOR UPDATE`;
      const settings = await rotaSettings(tx, scope.organisationId);
      const sources = await tx.visit.findMany({ where: { id: { in: [...new Set(pl.visits.map((v) => v.sourceVisitId))] } }, include: { tasks: { orderBy: { position: "asc" } }, runRoute: true } });
      const srcById = new Map(sources.map((s) => [s.id, s]));
      const taken = new Set((await tx.visit.findMany({ where: { organisationId: scope.organisationId, date: { gte: dbDate(weeks[0]!), lte: dbDate(addDays(weeks[weeks.length - 1]!, 6)) } }, select: { reference: true } })).map((r) => r.reference));
      const freshReference = (date: string) => {
        let r = visitReference(date);
        while (taken.has(r)) r = visitReference(date);
        taken.add(r);
        return r;
      };
      const builds: { id: string; weekStart: string; visits: number; uncovered: number }[] = [];
      for (const week of weeks) {
        const mine = pl.visits.filter((v) => v.weekStart === week);
        if (!mine.length) continue;
        const uncovered = mine.reduce((n, v) => n + v.slots.filter((s) => s.slot !== "SHADOW" && s.state === "UNCOVERED").length, 0);
        const build = await tx.rotaBuild.create({
          data: {
            organisationId: scope.organisationId,
            weekStart: dbDate(week),
            cycleWeek: cycleWeekOf(week, fromDbDate(settings.anchorMonday), settings.cycleLength),
            areaIds: pl.areaIds,
            builtById: ctx.userId,
            visitCount: mine.length,
            skippedCount: pl.skipped.filter((s) => mondayOf(s.date) === week).length,
            unassignedSlots: uncovered,
            forecastMinutes: mine.reduce((m, v) => m + v.durationMin * v.carersRequired, 0),
            summary: { source: "roll-forward", fromWeek: p.sourceWeek, skipped: pl.skipped.filter((s) => mondayOf(s.date) === week), review: mine.reduce((n, v) => n + v.slots.filter((s) => s.state === "REVIEW").length, 0) } as unknown as Prisma.InputJsonValue,
          },
        });
        const routes = new Map<string, string>();
        const visitRows: Prisma.VisitCreateManyInput[] = [];
        const assignmentRows: Prisma.VisitAssignmentCreateManyInput[] = [];
        const taskRows: Prisma.VisitTaskCreateManyInput[] = [];
        const eventRows: Prisma.VisitEventCreateManyInput[] = [];
        for (const v of mine) {
          const src = srcById.get(v.sourceVisitId)!;
          let runRouteId: string | null = null;
          if (src.runRoute) {
            const key = src.runRoute.name;
            if (!routes.has(key)) {
              const r = src.runRoute;
              const route = await tx.runRoute.upsert({
                where: { organisationId_weekStart_name: { organisationId: scope.organisationId, weekStart: dbDate(week), name: r.name } },
                create: { organisationId: scope.organisationId, name: r.name, kind: r.kind, staffId: r.staffId, areaId: r.areaId, colour: r.colour, textColour: r.textColour, weekStart: dbDate(week), templateId: r.templateId, createdById: ctx.userId },
                update: {},
              });
              routes.set(key, route.id);
            }
            runRouteId = routes.get(key)!;
          }
          const id = randomUUID();
          visitRows.push({
            id,
            organisationId: scope.organisationId,
            reference: freshReference(v.date),
            serviceUserId: v.serviceUserId,
            callTypeId: src.callTypeId,
            areaId: v.areaId,
            templateId: v.templateId,
            rotaBuildId: build.id,
            runRouteId,
            routeOrder: runRouteId ? src.routeOrder : null,
            date: dbDate(v.date),
            scheduledStart: v.start,
            scheduledEnd: v.end,
            carersRequired: v.carersRequired,
            rotaType: src.rotaType,
            timeLocked: src.timeLocked,
            medicationRequired: src.medicationRequired,
            alertOnLate: src.alertOnLate,
            chargeable: src.chargeable,
            payable: src.payable,
            notes: src.notes,
            createdById: ctx.userId,
          });
          for (const s of v.slots.filter((s) => s.staffId)) {
            assignmentRows.push({
              organisationId: scope.organisationId,
              visitId: id,
              slot: s.slot,
              staffId: s.staffId!,
              startsAt: v.start,
              endsAt: v.end,
              eligibility: s.state === "KEPT" ? "ELIGIBLE" : "REQUIRES_REVIEW",
              assignedById: ctx.userId,
              reviewReason: s.state === "REVIEW" ? s.reason : null,
              reviewFlaggedAt: s.state === "REVIEW" ? new Date() : null,
            });
          }
          src.tasks.forEach((t, i) => taskRows.push({ visitId: id, careTaskId: t.careTaskId, name: t.name, position: i }));
          eventRows.push({ organisationId: scope.organisationId, visitId: id, type: "CREATED", toStatus: "SCHEDULED", actorId: ctx.userId, data: { source: "roll-forward", buildId: build.id, fromVisit: v.sourceReference, slots: v.slots.map((s) => ({ slot: s.slot, state: s.state, from: s.fromName, reason: s.reason ?? null })) } as unknown as Prisma.InputJsonValue });
        }
        await tx.visit.createMany({ data: visitRows });
        if (assignmentRows.length) await tx.visitAssignment.createMany({ data: assignmentRows });
        if (taskRows.length) await tx.visitTask.createMany({ data: taskRows });
        await tx.visitEvent.createMany({ data: eventRows });
        if (uncovered) {
          await raiseAlert(tx, { organisationId: scope.organisationId, kind: "UNASSIGNED", message: `Week of ${week}: ${uncovered} visit slot${uncovered === 1 ? " is" : "s are"} uncovered after rolling the rota forward`, dedupeKey: `build-unassigned:${build.id}`, actionUrl: `/rota/visits?date=${week}&unassigned=1` });
        }
        builds.push({ id: build.id, weekStart: week, visits: mine.length, uncovered });
      }
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.rolled_forward", entityType: "RotaBuild", entityId: builds[0]!.id, data: { fromWeek: p.sourceWeek, weeks: weeks, builds: builds.map((b) => b.id), visits: pl.visits.length, kept: pl.counts.kept, review: pl.counts.review, uncovered: pl.counts.uncovered, existing: pl.existing, skipped: pl.skipped.length } }, tx);
      return { builds, plan: pl };
    },
    { timeout: 300_000 },
  );
}

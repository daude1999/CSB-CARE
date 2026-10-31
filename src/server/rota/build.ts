import { randomUUID } from "node:crypto";
import type { AssignmentSlot, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, cycleWeekOf, dbDate, fmtLondonDate, fromDbDate, isIsoDate, isoWeekday, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { evaluate, loadFacts, type Facts, type PreferenceFacts } from "@/server/workforce/eligibility";
import { raiseAlert, reviewStaffImpact } from "@/server/workforce/impact";
import { rotaSettings } from "./settings";
import { buildWhere, rotaScope, staffDirectoryWhere, templateScopeWhere, visitWhere, type Scope } from "./scope";
import { visitReference } from "./visits";

/**
 * Build Rota: turns the recurring templates for one week into dated visits.
 * 1 read the cycle → 2 work out the week → 3 load active templates → 4 calculate dates and London times →
 * 5 skip service-user absences → 6–8 check every proposed carer (holidays, HR checks, clashes) with the shared
 * eligibility rules → 9 create visit slots → 10 leave refused slots unassigned → 11 forecast hours →
 * 12 preview → 13 confirm (rota.build) → 14 save in one transaction → 15 never duplicate (one visit per template and date).
 */

type Tx = Prisma.TransactionClient;

export interface PlannedSlot {
  slot: AssignmentSlot;
  staffId: string | null;
  staffName: string | null;
  state: "ASSIGNED" | "FLAGGED" | "UNASSIGNED";
  reason?: string;
}
export interface PlannedVisit {
  templateId: string;
  serviceUserId: string;
  serviceUserName: string;
  callTypeId: string;
  callType: string;
  areaId: string | null;
  date: string;
  start: Date;
  end: Date;
  durationMin: number;
  carersRequired: number;
  slots: PlannedSlot[];
}
export interface Skipped {
  templateId: string;
  serviceUserName: string;
  date: string;
  reason: string;
}
/** Why nothing can be built, in words the office can act on, with the screen that fixes it. */
export interface BuildBlocker {
  code: "NO_AREAS" | "NO_TEMPLATES" | "NO_TEMPLATES_THIS_WEEK" | "ALREADY_BUILT" | "ALL_SKIPPED" | "ALL_PASSED";
  message: string;
  action?: { label: string; href: string };
}
export interface BuildPlan {
  weekStart: string;
  cycleWeek: number;
  areaIds: string[];
  visits: PlannedVisit[];
  skipped: Skipped[];
  alreadyBuilt: number;
  unassignedSlots: number;
  flaggedSlots: number;
  forecastMinutes: number;
  checklist: { label: string; ok: boolean; detail: string }[];
  /** Set when there is nothing to create; the first entry is the main reason. */
  blockers: BuildBlocker[];
}

const nameOf = (su: { firstName: string; lastName: string; preferredName: string | null }) => `${su.preferredName || su.firstName} ${su.lastName}`;

export function parseWeek(weekStart: string) {
  if (!isIsoDate(weekStart)) throw new ValidationError("Choose a week");
  if (isoWeekday(weekStart) !== 1) throw new ValidationError("A rota week starts on a Monday");
  return weekStart;
}

/** A Week Setting chosen by hand must be a whole number; the cycle length is checked against the settings in plan(). */
export function parseCycleWeek(v: number | undefined) {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v)) throw new ValidationError("Choose a week of the cycle, such as Week 1");
  return v;
}

async function plan(tx: Tx, scope: Scope, weekStart: string, areaIdsIn: string[], cycleWeekOverride?: number, opts: { allowPast?: boolean } = {}): Promise<BuildPlan> {
  const org = scope.organisationId;
  const settings = await rotaSettings(tx, org);
  const cycleWeek = cycleWeekOverride ?? cycleWeekOf(weekStart, fromDbDate(settings.anchorMonday), settings.cycleLength);
  if (cycleWeek < 1 || cycleWeek > settings.cycleLength) throw new ValidationError(`Week ${cycleWeek} is outside the ${settings.cycleLength}-week cycle`);
  const allAreas = await tx.area.findMany({ where: { organisationId: org, active: true }, select: { id: true } });
  const permitted = allAreas.map((a) => a.id).filter((id) => !scope.areaIds || scope.areaIds.includes(id));
  const areaIds = areaIdsIn.length ? areaIdsIn.filter((id) => permitted.includes(id)) : permitted;
  if (areaIdsIn.length && areaIds.length !== areaIdsIn.length) throw new ValidationError("One of the chosen areas is not available to you");
  // Templates without an area are built when no area is ticked, and only for service users the member may see.
  const includeNoArea = !areaIdsIn.length;
  const weekEnd = addDays(weekStart, 6);
  const now = new Date();

  const templates = await tx.visitTemplate.findMany({
    where: {
      organisationId: org,
      enabled: true,
      cycleWeeks: { has: cycleWeek },
      effectiveFrom: { lte: dbDate(weekEnd) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dbDate(weekStart) } }],
      AND: [{ OR: [{ areaId: { in: areaIds } }, ...(includeNoArea ? [{ areaId: null }] : [])] }, templateScopeWhere(scope)],
    },
    include: { serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, status: true, carerGenderPreference: true, carerPreferences: true } }, callType: { select: { name: true } }, tasks: { select: { careTaskId: true } } },
    orderBy: [{ startMinute: "asc" }],
  });
  const weekFrom = londonToUtc(weekStart, 0);
  const weekTo = londonToUtc(addDays(weekStart, 8), 0);
  const [existing, suAbsences, staffAbsencesAll, unapproved] = await Promise.all([
    tx.visit.findMany({ where: { organisationId: org, templateId: { in: templates.map((t) => t.id) }, date: { gte: dbDate(weekStart), lte: dbDate(weekEnd) } }, select: { templateId: true, date: true } }),
    tx.serviceUserAbsence.findMany({ where: { organisationId: org, cancelledAt: null, serviceUserId: { in: templates.map((t) => t.serviceUserId) }, startsAt: { lt: weekTo }, OR: [{ endsAt: null }, { endsAt: { gt: weekFrom } }] } }),
    tx.staffAbsence.count({ where: { organisationId: org, staff: staffDirectoryWhere(scope, { status: "all" }), status: "APPROVED", startsAt: { lt: weekTo }, endsAt: { gt: weekFrom } } }),
    tx.staffAbsence.count({ where: { organisationId: org, staff: staffDirectoryWhere(scope, { status: "all" }), status: "REQUESTED", startsAt: { lt: weekTo }, endsAt: { gt: weekFrom } } }),
  ]);
  const built = new Set(existing.map((e) => `${e.templateId}|${fromDbDate(e.date)}`));
  const staffIds = [...new Set(templates.flatMap((t) => [t.preferredStaff1Id, t.preferredStaff2Id, t.shadowStaffId]).filter((x): x is string => !!x))];
  const facts: Facts = await loadFacts(tx, org, staffIds, weekFrom, weekTo);

  const visits: PlannedVisit[] = [];
  const skipped: Skipped[] = [];
  let alreadyBuilt = 0;
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    const weekday = d + 1;
    for (const t of templates) {
      if (!t.weekdays.includes(weekday)) continue;
      if (fromDbDate(t.effectiveFrom) > date || (t.effectiveTo && fromDbDate(t.effectiveTo) < date)) continue;
      const suName = nameOf(t.serviceUser);
      if (built.has(`${t.id}|${date}`)) {
        alreadyBuilt++;
        continue;
      }
      if (t.serviceUser.status !== "ACTIVE") {
        skipped.push({ templateId: t.id, serviceUserName: suName, date, reason: `Care is ${t.serviceUser.status.toLowerCase()}` });
        continue;
      }
      const start = londonToUtc(date, t.startMinute);
      const end = new Date(start.getTime() + t.durationMin * 60000);
      // Building the current week part-way through adds only what is still to come; a past call would show as missed.
      if (start <= now && !opts.allowPast) {
        skipped.push({ templateId: t.id, serviceUserName: suName, date, reason: "Start time has already passed" });
        continue;
      }
      const away = suAbsences.find((a) => a.serviceUserId === t.serviceUserId && a.startsAt < end && (!a.endsAt || a.endsAt > start));
      if (away) {
        skipped.push({ templateId: t.id, serviceUserName: suName, date, reason: `Service user away (${away.reason.toLowerCase()})` });
        continue;
      }
      const prefs: PreferenceFacts = { carerGenderPreference: t.serviceUser.carerGenderPreference, preferences: t.serviceUser.carerPreferences };
      const wanted: [AssignmentSlot, string | null][] = [["PRIMARY", t.preferredStaff1Id]];
      if (t.carersRequired === 2) wanted.push(["SECOND", t.preferredStaff2Id]);
      if (t.shadowStaffId) wanted.push(["SHADOW", t.shadowStaffId]);
      const slots: PlannedSlot[] = [];
      for (const [slot, staffId] of wanted) {
        if (!staffId) {
          slots.push({ slot, staffId: null, staffName: null, state: "UNASSIGNED", reason: "No carer on the template" });
          continue;
        }
        const name = facts.staff.find((s) => s.id === staffId)?.displayName ?? "Unknown";
        const r = evaluate(settings, facts, { staffId, start, end, slot, serviceUserId: t.serviceUserId, areaId: t.areaId, careTaskIds: t.tasks.map((x) => x.careTaskId) }, prefs, { otherSlotStaffIds: slots.map((s) => s.staffId).filter((x): x is string => !!x) });
        if (r.state === "NOT_ELIGIBLE") {
          slots.push({ slot, staffId: null, staffName: name, state: "UNASSIGNED", reason: `${name}: ${r.blocking.map((b) => b.message).join("; ")}` });
          if (slot === "SHADOW") slots.pop();
          continue;
        }
        slots.push({ slot, staffId, staffName: name, state: r.state === "ELIGIBLE" ? "ASSIGNED" : "FLAGGED", reason: r.state === "ELIGIBLE" ? undefined : r.warnings.map((w) => w.message).join("; ") });
        // Book the carer in the in-memory facts so the rest of this build sees the booking.
        facts.assignments.push({ id: `plan-${visits.length}-${slot}`, staffId, visitId: `plan-${visits.length}`, slot, startsAt: start, endsAt: end, visit: { reference: "this build" } });
      }
      visits.push({ templateId: t.id, serviceUserId: t.serviceUserId, serviceUserName: suName, callTypeId: t.callTypeId, callType: t.callType.name, areaId: t.areaId, date, start, end, durationMin: t.durationMin, carersRequired: t.carersRequired, slots });
    }
  }
  const unassignedSlots = visits.reduce((n, v) => n + v.slots.filter((s) => s.slot !== "SHADOW" && s.state === "UNASSIGNED").length, 0);
  const flaggedSlots = visits.reduce((n, v) => n + v.slots.filter((s) => s.state === "FLAGGED").length, 0);
  const noCarer = templates.filter((t) => !t.preferredStaff1Id || (t.carersRequired === 2 && !t.preferredStaff2Id)).length;
  const blockers = visits.length ? [] : await whyNothing(tx, scope, { weekStart, cycleWeek, cycleLength: settings.cycleLength, areaIds, includeNoArea, templates: templates.length, alreadyBuilt, skipped });
  return {
    weekStart,
    cycleWeek,
    areaIds,
    visits,
    skipped,
    alreadyBuilt,
    unassignedSlots,
    flaggedSlots,
    forecastMinutes: visits.reduce((m, v) => m + v.durationMin * v.carersRequired, 0),
    checklist: [
      { label: "Templates for this cycle week", ok: templates.length > 0, detail: `${templates.length} active template${templates.length === 1 ? "" : "s"} in Week ${cycleWeek}` },
      { label: "Templates with a carer in every slot", ok: noCarer === 0, detail: noCarer ? `${noCarer} template${noCarer === 1 ? " has" : "s have"} an empty slot` : "All slots have a preferred carer" },
      { label: "Service-user absences entered", ok: true, detail: `${suAbsences.length} absence${suAbsences.length === 1 ? "" : "s"} this week will be skipped` },
      { label: "Staff holidays and sickness decided", ok: unapproved === 0, detail: `${staffAbsencesAll} approved; ${unapproved} request${unapproved === 1 ? "" : "s"} still waiting for a decision` },
      { label: "Correct cycle week", ok: true, detail: `${weekStart} is Week ${cycleWeek} of ${settings.cycleLength}` },
    ],
    blockers,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Works out the precise reason a week has nothing to build, most fundamental first. */
async function whyNothing(
  tx: Tx,
  scope: Scope,
  p: { weekStart: string; cycleWeek: number; cycleLength: number; areaIds: string[]; includeNoArea: boolean; templates: number; alreadyBuilt: number; skipped: Skipped[] },
): Promise<BuildBlocker[]> {
  const out: BuildBlocker[] = [];
  if (scope.areaIds && !scope.areaIds.length) {
    out.push({ code: "NO_AREAS", message: "Your account is not linked to any area, so there is nothing you can build. An administrator can give you your branch's areas in Rota Settings.", action: { label: "Open Rota Settings", href: "/rota/settings" } });
    return out;
  }
  if (p.alreadyBuilt) {
    const built = await tx.rotaBuild.findFirst({ where: { ...buildWhere(scope), weekStart: dbDate(p.weekStart), status: "BUILT" }, orderBy: { builtAt: "desc" }, select: { id: true, builtAt: true } });
    const pending = built ? await tx.visit.count({ where: { ...visitWhere(scope), rotaBuildId: built.id, publishedAt: null, status: { not: "CANCELLED" } } }) : 0;
    out.push({
      code: "ALREADY_BUILT",
      message: `This week is already built: all ${plural(p.alreadyBuilt, "visit")} from your templates exist${built ? ` (built ${fmtLondonDate(londonDate(built.builtAt), { day: "numeric", month: "long", year: "numeric" })})` : ""}. Building again never creates duplicates.${pending ? ` ${plural(pending, "visit is", "visits are")} not published yet, so carers cannot see them.` : ""}`,
      action: pending ? { label: "Publish it from the list", href: "/rota/build" } : { label: "Open this week's rota", href: `/rota/visits?date=${p.weekStart}` },
    });
    return out;
  }
  if (!p.templates) {
    const templateArea = { OR: [{ areaId: { in: p.areaIds } }, ...(p.includeNoArea ? [{ areaId: null }] : [])] };
    const anyActive = await tx.visitTemplate.findMany({ where: { organisationId: scope.organisationId, enabled: true, AND: [templateArea, templateScopeWhere(scope)] }, select: { cycleWeeks: true }, take: 2000 });
    if (!anyActive.length) {
      out.push({ code: "NO_TEMPLATES", message: "There are no active recurring templates in the chosen areas, so there is nothing to build from. Add templates (or switch existing ones back on) first.", action: { label: "Open Recurring Templates", href: "/rota/templates?state=all" } });
    } else {
      const weeks = [...new Set(anyActive.flatMap((t) => t.cycleWeeks))].filter((w) => w >= 1 && w <= p.cycleLength).sort();
      out.push({
        code: "NO_TEMPLATES_THIS_WEEK",
        message: `No active template runs in Week ${p.cycleWeek} of the cycle${weeks.length ? `. Your templates run in ${weeks.map((w) => `Week ${w}`).join(", ")}` : ""}. Check the Week Setting, or the cycle start in Rota Settings, or add Week ${p.cycleWeek} to the templates.`,
        action: { label: `Open Week ${p.cycleWeek} templates`, href: `/rota/templates?week=${p.cycleWeek}` },
      });
    }
    return out;
  }
  if (p.skipped.length) {
    const passed = p.skipped.filter((s) => s.reason === "Start time has already passed").length;
    if (passed === p.skipped.length) {
      out.push({ code: "ALL_PASSED", message: "Every visit in this week has already started or passed, so there is nothing left to build. Choose a later week." });
    } else {
      const reasons = [...new Set(p.skipped.map((s) => s.reason))].slice(0, 3).join("; ");
      out.push({ code: "ALL_SKIPPED", message: `All ${plural(p.skipped.length, "visit")} in this week were skipped (${reasons}). Check service-user absences and care status.`, action: { label: "Open Service Users", href: "/rota/service-users" } });
    }
  }
  return out;
}

export async function previewBuild(ctx: Ctx, input: { weekStart: string; areaIds?: string[]; cycleWeek?: number }) {
  const scope = await rotaScope(ctx, "rota.build");
  return plan(db, scope, parseWeek(input.weekStart), input.areaIds ?? [], parseCycleWeek(input.cycleWeek));
}

/**
 * The week the Build Rota form should open on: the current week if it has not been built for the member's areas
 * (only what is still to come gets built), otherwise the first later week that has not been built for all of them.
 */
export async function suggestBuildWeek(ctx: Ctx, horizonWeeks = 26) {
  const scope = await rotaScope(ctx, "rota.build");
  const thisMonday = mondayOf(londonDate());
  const areas = (await db.area.findMany({ where: { organisationId: scope.organisationId, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, select: { id: true } })).map((a) => a.id);
  const builds = await db.rotaBuild.findMany({ where: { ...buildWhere(scope), status: "BUILT", weekStart: { gte: dbDate(thisMonday) } }, select: { weekStart: true, areaIds: true } });
  const covered = new Map<string, Set<string>>();
  for (const b of builds) {
    const w = fromDbDate(b.weekStart);
    const set = covered.get(w) ?? new Set<string>();
    b.areaIds.forEach((a) => set.add(a));
    covered.set(w, set);
  }
  const isBuilt = (w: string) => {
    const set = covered.get(w);
    if (!set) return false;
    return areas.length ? areas.every((a) => set.has(a)) : true;
  };
  for (let i = 0; i <= horizonWeeks; i++) {
    const w = addDays(thisMonday, i * 7);
    if (!isBuilt(w)) return { weekStart: w, builtThrough: i ? addDays(w, -1) : null };
  }
  return { weekStart: addDays(thisMonday, (horizonWeeks + 1) * 7), builtThrough: addDays(thisMonday, (horizonWeeks + 1) * 7 - 1) };
}

/** Saves a previewed build. Re-plans inside the transaction (with locks), so the saved week is exactly what the rules allow now. */
/** `demoHistory` is used only by the demo seeds, to create past weeks and the whole of the current week; no action or route passes it. */
export async function confirmBuild(ctx: Ctx, input: { weekStart: string; areaIds?: string[]; cycleWeek?: number }, opts: { demoHistory?: boolean } = {}) {
  const scope = await rotaScope(ctx, "rota.build");
  const weekStart = parseWeek(input.weekStart);
  const cycleWeek = parseCycleWeek(input.cycleWeek);
  if (weekStart < mondayOf(londonDate()) && !opts.demoHistory) throw new ValidationError("Past weeks cannot be built");
  return db.$transaction(
    async (tx) => {
      // One build of an organisation's week at a time; a second click waits, then finds the visits already built.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rota-build:${scope.organisationId}:${weekStart}`}))`;
      const p = await plan(tx, scope, weekStart, input.areaIds ?? [], cycleWeek, { allowPast: opts.demoHistory });
      if (!p.visits.length) throw new ValidationError(p.blockers[0]?.message ?? "There is nothing to build for this week.");
      const staffIds = [...new Set(p.visits.flatMap((v) => v.slots.map((s) => s.staffId)).filter((x): x is string => !!x))].sort();
      if (staffIds.length) await tx.$queryRaw`SELECT id FROM "StaffMember" WHERE id = ANY(${staffIds}) ORDER BY id FOR UPDATE`;
      const build = await tx.rotaBuild.create({
        data: { organisationId: scope.organisationId, weekStart: dbDate(weekStart), cycleWeek: p.cycleWeek, areaIds: p.areaIds, builtById: ctx.userId, visitCount: p.visits.length, skippedCount: p.skipped.length, unassignedSlots: p.unassignedSlots, forecastMinutes: p.forecastMinutes, summary: { skipped: p.skipped, flaggedSlots: p.flaggedSlots, alreadyBuilt: p.alreadyBuilt } as unknown as Prisma.InputJsonValue },
      });
      const templates = await tx.visitTemplate.findMany({ where: { id: { in: [...new Set(p.visits.map((v) => v.templateId))] } }, include: { tasks: { include: { careTask: true } } } });
      const routes = new Map<string, string>();
      for (const t of templates.filter((t) => t.runRouteTemplateId)) {
        const rt = await tx.runRouteTemplate.findUnique({ where: { id: t.runRouteTemplateId! } });
        if (!rt || routes.has(rt.id)) continue;
        const route = await tx.runRoute.upsert({
          where: { organisationId_weekStart_name: { organisationId: scope.organisationId, weekStart: dbDate(weekStart), name: rt.name } },
          create: { organisationId: scope.organisationId, name: rt.name, kind: rt.kind, staffId: rt.staffId, areaId: rt.areaId, colour: rt.colour, textColour: rt.textColour, weekStart: dbDate(weekStart), templateId: rt.id, createdById: ctx.userId },
          update: {},
        });
        routes.set(rt.id, route.id);
      }
      const tById = new Map(templates.map((t) => [t.id, t]));
      const visitRows: Prisma.VisitCreateManyInput[] = [];
      const assignmentRows: Prisma.VisitAssignmentCreateManyInput[] = [];
      const taskRows: Prisma.VisitTaskCreateManyInput[] = [];
      const eventRows: Prisma.VisitEventCreateManyInput[] = [];
      // References are random per day; a week of over a thousand visits occasionally draws the same one twice, which
      // the unique index would reject for the whole week. Existing references on these days are avoided as well.
      const taken = new Set((await tx.visit.findMany({ where: { organisationId: scope.organisationId, date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) } }, select: { reference: true } })).map((r) => r.reference));
      const freshReference = (date: string) => {
        let r = visitReference(date);
        while (taken.has(r)) r = visitReference(date);
        taken.add(r);
        return r;
      };
      for (const v of p.visits) {
        const t = tById.get(v.templateId)!;
        const id = randomUUID();
        visitRows.push({
          id,
          organisationId: scope.organisationId,
          reference: freshReference(v.date),
          serviceUserId: v.serviceUserId,
          callTypeId: v.callTypeId,
          areaId: v.areaId,
          templateId: v.templateId,
          rotaBuildId: build.id,
          runRouteId: t.runRouteTemplateId ? (routes.get(t.runRouteTemplateId) ?? null) : null,
          routeOrder: t.runRouteTemplateId ? t.routeOrder : null,
          date: dbDate(v.date),
          scheduledStart: v.start,
          scheduledEnd: v.end,
          carersRequired: v.carersRequired,
          rotaType: t.rotaType,
          timeLocked: t.timeLocked,
          medicationRequired: t.medicationRequired,
          alertOnLate: t.alertOnLate,
          notes: t.notes,
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
            eligibility: s.state === "ASSIGNED" ? "ELIGIBLE" : "REQUIRES_REVIEW",
            assignedById: ctx.userId,
            reviewReason: s.state === "FLAGGED" ? s.reason : null,
            reviewFlaggedAt: s.state === "FLAGGED" ? new Date() : null,
          });
        }
        t.tasks.forEach((x, i) => taskRows.push({ visitId: id, careTaskId: x.careTaskId, name: x.careTask.name, position: i }));
        eventRows.push({ organisationId: scope.organisationId, visitId: id, type: "CREATED", toStatus: "SCHEDULED", actorId: ctx.userId, data: { source: "build", buildId: build.id, slots: v.slots.map((s) => ({ slot: s.slot, state: s.state, reason: s.reason ?? null })) } as unknown as Prisma.InputJsonValue });
      }
      await tx.visit.createMany({ data: visitRows });
      if (assignmentRows.length) await tx.visitAssignment.createMany({ data: assignmentRows });
      if (taskRows.length) await tx.visitTask.createMany({ data: taskRows });
      await tx.visitEvent.createMany({ data: eventRows });
      if (p.unassignedSlots) {
        await raiseAlert(tx, { organisationId: scope.organisationId, kind: "UNASSIGNED", message: `Week of ${weekStart}: ${p.unassignedSlots} visit slot${p.unassignedSlots === 1 ? " is" : "s are"} unassigned after the build`, dedupeKey: `build-unassigned:${build.id}`, actionUrl: `/rota/visits?date=${weekStart}&unassigned=1` });
      }
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.built", entityType: "RotaBuild", entityId: build.id, data: { weekStart, cycleWeek: p.cycleWeek, visits: p.visits.length, unassignedSlots: p.unassignedSlots, skipped: p.skipped.length } }, tx);
      return { build, plan: p };
    },
    { timeout: 120_000 },
  );
}

/** Makes a built week visible to its carers, and tells each carer in-app. */
export async function publishBuild(ctx: Ctx, buildId: string) {
  const scope = await rotaScope(ctx, "rota.build");
  return db.$transaction(async (tx) => {
    const b = await tx.rotaBuild.findFirst({ where: { ...buildWhere(scope), id: buildId, status: "BUILT" } });
    if (!b) throw new NotFoundError("Rota build");
    const now = new Date();
    // A branch-limited member publishes only the visits in their own areas; another branch's part of a shared build
    // stays unpublished for that branch to check and publish.
    const visits = await tx.visit.findMany({ where: { ...visitWhere(scope), rotaBuildId: b.id, publishedAt: null, status: { not: "CANCELLED" } }, select: { id: true } });
    if (!visits.length) throw new ValidationError("Everything in this build that you look after is already published.");
    // Re-validate every carer on the week before it goes out: anything that changed since the build (an expired
    // certificate, a new restriction, an absence) flags the visit for review. Nobody is reassigned automatically.
    const staffOnBuild = [...new Set((await tx.visitAssignment.findMany({ where: { visitId: { in: visits.map((v) => v.id) }, removedAt: null }, select: { staffId: true } })).map((a) => a.staffId))];
    const recheck = staffOnBuild.length ? await reviewStaffImpact(tx, scope.organisationId, staffOnBuild, { source: "publish", now, visitIds: visits.map((v) => v.id) }) : { flagged: 0, cleared: 0 };
    await tx.visit.updateMany({ where: { id: { in: visits.map((v) => v.id) } }, data: { publishedAt: now } });
    if (visits.length) await tx.visitEvent.createMany({ data: visits.map((v) => ({ organisationId: scope.organisationId, visitId: v.id, type: "PUBLISHED", actorId: ctx.userId })) });
    const carers = await tx.visitAssignment.findMany({ where: { visitId: { in: visits.map((v) => v.id) }, removedAt: null }, select: { staff: { select: { userId: true } } } });
    const users = [...new Set(carers.map((c) => c.staff.userId).filter((x): x is string => !!x))];
    const week = fromDbDate(b.weekStart);
    if (users.length) {
      await tx.notification.createMany({
        data: users.map((userId) => ({ organisationId: scope.organisationId, userId, type: "rota.published", title: `Your visits for the week of ${week} are ready`, body: "Open My visits to see and acknowledge them.", reason: "You are booked on visits in this week.", actionUrl: "/carer", dedupeKey: `rota-published:${b.id}:${userId}` })),
        skipDuplicates: true,
      });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.published", entityType: "RotaBuild", entityId: b.id, data: { visits: visits.length, carersNotified: users.length, flaggedOnRecheck: recheck.flagged, limitedToAreas: scope.areaIds } }, tx);
    return { published: visits.length, carersNotified: users.length, flagged: recheck.flagged };
  }, { timeout: 120_000 });
}

/** Removes a future build whose visits have not been touched. Anything started, clocked or changed by hand stops it. */
export async function deleteBuild(ctx: Ctx, buildId: string, reason: string) {
  const scope = await rotaScope(ctx, "rota.build");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for deleting the build");
  return db.$transaction(async (tx) => {
    const b = await tx.rotaBuild.findFirst({ where: { ...buildWhere(scope), id: buildId, status: "BUILT" } });
    if (!b) throw new NotFoundError("Rota build");
    // Deleting removes the whole week, so a member limited to some areas may delete only a build made for those areas.
    if (scope.areaIds && b.areaIds.some((a) => !scope.areaIds!.includes(a))) throw new ForbiddenError("This build covers areas outside yours, so only a manager with access to all of them can delete it. Cancel your own visits instead.");
    const outside = scope.areaIds ? await tx.visit.count({ where: { rotaBuildId: b.id, NOT: visitWhere(scope) } }) : 0;
    if (outside) throw new ForbiddenError(`This build includes ${outside} visit${outside === 1 ? "" : "s"} outside your areas, so you cannot delete it.`);
    const visits = await tx.visit.findMany({ where: { rotaBuildId: b.id }, select: { id: true, reference: true, status: true, manuallyChanged: true, scheduledStart: true, _count: { select: { clocks: true, visitNotes: true, taskOutcomes: true, correctionRequests: true, marRecords: true } } } });
    const blockers = visits.filter((v) => v.status !== "SCHEDULED" || v.manuallyChanged || v.scheduledStart <= new Date() || v._count.clocks || v._count.visitNotes || v._count.taskOutcomes || v._count.correctionRequests || v._count.marRecords);
    if (blockers.length) throw new ValidationError(`Cannot delete: ${blockers.length} visit${blockers.length === 1 ? " has" : "s have"} started, been changed by hand or been recorded (e.g. ${blockers.slice(0, 3).map((v) => v.reference).join(", ")}). Cancel individual visits instead.`);
    // Their CREATED events go with them (the event trigger allows deletion only by cascade from a removed visit).
    await tx.visit.deleteMany({ where: { id: { in: visits.map((v) => v.id) } } });
    await tx.rotaBuild.update({ where: { id: b.id }, data: { status: "DELETED", deletedById: ctx.userId, deletedAt: new Date() } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.build.deleted", entityType: "RotaBuild", entityId: b.id, data: { visitsRemoved: visits.length, reason: reason.trim() } }, tx);
    return { removed: visits.length };
  });
}

/** Every rota build for the organisation, newest week first, for the All Rotas list. */
export async function listBuilds(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.build");
  const builds = await db.rotaBuild.findMany({ where: buildWhere(scope), orderBy: [{ weekStart: "desc" }, { builtAt: "desc" }], take: 300 });
  const ids = builds.map((b) => b.id);
  const [pending, mine] = builds.length
    ? await Promise.all([
        db.visit.groupBy({ by: ["rotaBuildId"], where: { ...visitWhere(scope), rotaBuildId: { in: ids }, publishedAt: null, status: { not: "CANCELLED" } }, _count: { _all: true } }),
        scope.areaIds ? db.visit.groupBy({ by: ["rotaBuildId"], where: { ...visitWhere(scope), rotaBuildId: { in: ids } }, _count: { _all: true } }) : Promise.resolve(null),
      ])
    : [[], null];
  const thisMonday = mondayOf(londonDate());
  return builds.map((b) => {
    const weekStart = fromDbDate(b.weekStart);
    return {
      id: b.id,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      current: weekStart === thisMonday,
      future: weekStart > thisMonday,
      cycleWeek: b.cycleWeek,
      /** Only the member's own areas are named; others are counted, never shown. */
      areaIds: scope.areaIds ? b.areaIds.filter((a) => scope.areaIds!.includes(a)) : b.areaIds,
      otherAreas: scope.areaIds ? b.areaIds.filter((a) => !scope.areaIds!.includes(a)).length : 0,
      status: b.status,
      builtById: b.builtById,
      builtAt: b.builtAt,
      deletedById: b.deletedById,
      deletedAt: b.deletedAt,
      visitCount: mine ? (mine.find((m) => m.rotaBuildId === b.id)?._count._all ?? 0) : b.visitCount,
      unassignedSlots: b.unassignedSlots,
      unpublished: pending.find((p) => p.rotaBuildId === b.id)?._count._all ?? 0,
    };
  });
}

/** True when a rota has been built for the week containing `date`, so an empty screen can say why it is empty. */
export async function weekIsBuilt(ctx: Ctx, date: string) {
  const scope = await rotaScope(ctx, "rota.view");
  return (await db.rotaBuild.count({ where: { ...buildWhere(scope), weekStart: dbDate(mondayOf(date)), status: "BUILT" } })) > 0;
}

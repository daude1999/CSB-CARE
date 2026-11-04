import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { addDays, cycleWeekOf, dbDate, fmtLondonDate, fromDbDate, hhmm, isoWeekday, londonDate, londonMinute, londonToUtc, mondayOf } from "@/lib/london";
import { carerPlaces, placeKey, placeLabel, placeNumber, preferredOf, type PlaceKey } from "@/lib/carer-places";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { eligibilityFor } from "@/server/workforce/eligibility";
import { assignInTx, isOverlapViolation } from "./assign";
import { rotaScope, type Scope } from "./scope";
import { rotaSettings } from "./settings";
import { checkRefs, loadTemplate, parseTemplateInput, templateData, type TemplateInput } from "./templates";
import { cancelVisitInTx, updateVisitInTx, type VisitPatch } from "./visits";
import { notifyVisitsChanged } from "./visit-change-notify";

/**
 * Confirm Template Changes (brief of 3 Nov 2026, sections 7-9). Saving an edited template never writes straight away:
 *
 *   1. previewTemplateEdit works out, from the coordinator's UNSAVED form values, which fields would change, and signs
 *      that exact proposal with a token (template id + version + proposed values). Nothing is written.
 *   2. Template Only: saveTemplateEdit saves the template with that token. Built visits are untouched.
 *   3. Template + Future Rota: previewTemplateImpact sorts every future visit of the template into what can be updated,
 *      what is protected and what needs the coordinator, and fingerprints that plan. saveTemplateEdit with the plan's
 *      fingerprint then saves the template AND applies the eligible visits in ONE transaction, after re-planning from
 *      live data: if anything changed since the preview, or any visit is refused on the final checks, nothing is saved.
 */

type Tx = Prisma.TransactionClient;
type Values = ReturnType<typeof templateData>;
type Stored = Awaited<ReturnType<typeof loadTemplate>> & { tasks: { careTaskId: string }[] };

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

export type ImpactResult = "update" | "manual" | "started" | "locked" | "review" | "removed" | "unchanged";
export const IMPACT_LABEL: Record<ImpactResult, string> = {
  update: "Can update",
  manual: "Manual change – protected",
  started: "Started or finished – history kept",
  locked: "Time locked – protected",
  review: "Needs review",
  removed: "No longer in the template",
  unchanged: "Already matches",
};

export interface CarerSwap {
  place: PlaceKey;
  fromStaffId: string | null;
  toStaffId: string;
}

export interface ImpactRow {
  visitId: string;
  reference: string;
  lockVersion: number;
  date: string;
  status: string;
  published: boolean;
  result: ImpactResult;
  reason?: string;
  previous: string;
  proposed: string;
  changes: string[];
  /** Applied to the visit when the result is "update". */
  patch?: VisitPatch;
  swaps?: CarerSwap[];
  replaceTasks?: boolean;
}

export interface TemplateImpact {
  rows: ImpactRow[];
  /** Dates in weeks already built that the changed template would now cover, but which have no visit. Never created here. */
  newDates: string[];
  /** Changes that are never applied to built visits automatically. */
  manualActions: string[];
  summary: { update: number; review: number; protected: number; removed: number; past: number; unchanged: number };
  fingerprint: string;
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const yesNo = (b: boolean) => (b ? "Yes" : "No");
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const daysText = (d: number[]) => (d.length === 7 ? "Every day" : d.map((x) => DAY[x - 1]).join(", "));
const timeText = (start: number, dur: number) => `${hhmm(start)}–${hhmm((start + dur) % 1440)}`;

/** Parses, checks every reference against the caller's organisation, and returns the values a save would store. */
async function propose(tx: Tx, scope: Scope, input: TemplateInput) {
  const t = parseTemplateInput(input);
  const { areaId } = await checkRefs(tx, scope, t);
  const values = templateData(t, areaId);
  return { values, taskIds: [...new Set(t.taskIds)].sort() };
}

/** The signature of one proposal for one template version: a save or apply must carry it unchanged. */
export function proposalToken(templateId: string, version: number, p: { values: Values; taskIds: string[] }) {
  return hash({ templateId, version, values: { ...p.values, effectiveFrom: p.values.effectiveFrom.toISOString(), effectiveTo: p.values.effectiveTo?.toISOString() ?? null }, taskIds: p.taskIds });
}

/** Only the fields that actually change, in words. */
async function diff(tx: Tx, organisationId: string, before: Stored, after: { values: Values; taskIds: string[] }): Promise<FieldChange[]> {
  const a = after.values;
  const out: FieldChange[] = [];
  const staffIds = [...preferredOf(before), ...preferredOf(a), before.shadowStaffId, a.shadowStaffId].filter((x): x is string => !!x);
  const [staff, calls, areas, routes, tasks, sus] = await Promise.all([
    tx.staffMember.findMany({ where: { organisationId, id: { in: staffIds } }, select: { id: true, displayName: true } }),
    tx.callType.findMany({ where: { organisationId, id: { in: [before.callTypeId, a.callTypeId] } }, select: { id: true, name: true } }),
    tx.area.findMany({ where: { organisationId, id: { in: [before.areaId, a.areaId].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    tx.runRouteTemplate.findMany({ where: { organisationId, id: { in: [before.runRouteTemplateId, a.runRouteTemplateId].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    tx.careTask.findMany({ where: { organisationId, id: { in: [...before.tasks.map((t) => t.careTaskId), ...after.taskIds] } }, select: { id: true, name: true } }),
    tx.serviceUser.findMany({ where: { organisationId, id: { in: [before.serviceUserId, a.serviceUserId] } }, select: { id: true, firstName: true, lastName: true, preferredName: true } }),
  ]);
  const name = (list: { id: string; name?: string; displayName?: string }[], id: string | null, none = "None") => (id ? (list.find((x) => x.id === id)?.name ?? list.find((x) => x.id === id)?.displayName ?? "Former record") : none);
  const push = (key: string, label: string, b: string, af: string) => {
    if (b !== af) out.push({ key, label, before: b, after: af });
  };
  const su = (id: string) => { const s = sus.find((x) => x.id === id); return s ? `${s.preferredName || s.firstName} ${s.lastName}` : "Former record"; };
  push("serviceUser", "Service user", su(before.serviceUserId), su(a.serviceUserId));
  push("callType", "Call", name(calls, before.callTypeId), name(calls, a.callTypeId));
  push("start", "Start", hhmm(before.startMinute), hhmm(a.startMinute));
  push("finish", "Finish", hhmm((before.startMinute + before.durationMin) % 1440), hhmm((a.startMinute + a.durationMin) % 1440));
  push("duration", "Duration", `${before.durationMin} min`, `${a.durationMin} min`);
  push("days", "Days", daysText(before.weekdays), daysText(a.weekdays));
  push("weeks", "Weeks", before.cycleWeeks.map((w) => `Week ${w}`).join(", "), a.cycleWeeks.map((w) => `Week ${w}`).join(", "));
  push("carersRequired", "Carers required", String(before.carersRequired), String(a.carersRequired));
  const pb = preferredOf(before);
  const pa = preferredOf(a);
  for (let i = 0; i < Math.max(pb.length, pa.length); i++) {
    const label = Math.max(pb.length, pa.length) === 1 ? "Carer" : `Carer ${i + 1}`;
    push(`carer${i + 1}`, label, i < pb.length ? name(staff, pb[i] ?? null, "No carer") : "Not needed", i < pa.length ? name(staff, pa[i] ?? null, "No carer") : "Not needed");
  }
  push("shadow", "Shadow carer", name(staff, before.shadowStaffId), name(staff, a.shadowStaffId));
  push("area", "Area", name(areas, before.areaId), name(areas, a.areaId));
  push("timeLocked", "Time locked", yesNo(before.timeLocked), yesNo(a.timeLocked));
  push("medicationRequired", "Medication prompt", yesNo(before.medicationRequired), yesNo(a.medicationRequired));
  push("alertOnLate", "Alert if late", yesNo(before.alertOnLate), yesNo(a.alertOnLate));
  push("runRoute", "Run route", name(routes, before.runRouteTemplateId), name(routes, a.runRouteTemplateId));
  push("effectiveFrom", "From", fromDbDate(before.effectiveFrom), fromDbDate(a.effectiveFrom));
  push("effectiveTo", "Until", before.effectiveTo ? fromDbDate(before.effectiveTo) : "No end date", a.effectiveTo ? fromDbDate(a.effectiveTo) : "No end date");
  const taskNames = (ids: string[]) => ids.map((id) => name(tasks, id)).sort().join(", ") || "None";
  push("tasks", "Care tasks", taskNames(before.tasks.map((t) => t.careTaskId)), taskNames(after.taskIds));
  push("notes", "Notes", before.notes ?? "None", a.notes ?? "None");
  push("rotaType", "Rota type", before.rotaType, a.rotaType);
  return out;
}

async function loadStored(tx: Tx, scope: Scope, templateId: string, lock = false): Promise<Stored> {
  if (lock) await tx.$queryRaw`SELECT id FROM "VisitTemplate" WHERE id = ${templateId} FOR UPDATE`;
  const t = await loadTemplate(tx, scope, templateId);
  const tasks = await tx.templateTask.findMany({ where: { templateId }, select: { careTaskId: true } });
  return { ...t, tasks };
}

export interface EditPreview {
  templateId: string;
  version: number;
  serviceUser: string;
  callType: string;
  changes: FieldChange[];
  token: string;
  futureVisits: number;
}

/** Step 1: what Save would change. Read only. */
export async function previewTemplateEdit(ctx: Ctx, templateId: string, version: number, input: TemplateInput): Promise<EditPreview> {
  const scope = await rotaScope(ctx, "rota.edit");
  const stored = await loadStored(db, scope, templateId);
  if (stored.version !== version) throw new ConflictError("This template changed since you opened it. Reload and try again.");
  const p = await propose(db, scope, input);
  const changes = await diff(db, scope.organisationId, stored, p);
  if (!changes.length) throw new ValidationError("No changes to save.");
  const su = await db.serviceUser.findUniqueOrThrow({ where: { id: stored.serviceUserId }, select: { firstName: true, lastName: true, preferredName: true } });
  const ct = await db.callType.findUniqueOrThrow({ where: { id: stored.callTypeId }, select: { name: true } });
  const futureVisits = await db.visit.count({ where: { organisationId: scope.organisationId, templateId, date: { gte: dbDate(londonDate()) }, status: "SCHEDULED" } });
  return { templateId, version, serviceUser: `${su.preferredName || su.firstName} ${su.lastName}`, callType: ct.name, changes, token: proposalToken(templateId, version, p), futureVisits };
}

/** Does the proposed pattern cover this date? */
function covers(v: Pick<Values, "weekdays" | "cycleWeeks" | "effectiveFrom" | "effectiveTo">, date: string, cycleWeek: number) {
  return v.weekdays.includes(isoWeekday(date)) && v.cycleWeeks.includes(cycleWeek) && fromDbDate(v.effectiveFrom) <= date && (!v.effectiveTo || fromDbDate(v.effectiveTo) >= date);
}

/** Sorts every future visit of the template under the proposed values. Shared by the preview and the final apply. */
async function planImpact(tx: Tx, scope: Scope, stored: Stored, p: { values: Values; taskIds: string[] }, token: string): Promise<TemplateImpact> {
  const org = scope.organisationId;
  const a = p.values;
  const today = londonDate();
  const now = new Date();
  const settings = await rotaSettings(tx, org);
  const anchor = fromDbDate(settings.anchorMonday);
  const cw = (date: string) => cycleWeekOf(mondayOf(date), anchor, settings.cycleLength);
  const visits = await tx.visit.findMany({
    where: { organisationId: org, templateId: stored.id, date: { gte: dbDate(today) } },
    orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
    include: {
      clocks: { select: { id: true }, take: 1 },
      _count: { select: { taskOutcomes: true } },
      assignments: { where: { removedAt: null }, select: { staffId: true, slot: true, position: true, staff: { select: { displayName: true } } } },
      tasks: { select: { careTaskId: true } },
    },
  });
  const manualActions: string[] = [];
  if (a.serviceUserId !== stored.serviceUserId) manualActions.push("The service user changed. Visits already built stay with the original person; cancel them and build again if needed.");
  if (a.areaId !== stored.areaId) manualActions.push("The area changed. Visits already built keep their area.");
  if (a.runRouteTemplateId !== stored.runRouteTemplateId) manualActions.push("The run route changed. Visits already built keep their route; move them on the Run Routes screen.");
  const pa = preferredOf(a);
  const pb = preferredOf(stored);
  const taskChange = p.taskIds.join() !== stored.tasks.map((t) => t.careTaskId).sort().join();

  const rows: ImpactRow[] = [];
  for (const v of visits) {
    const date = fromDbDate(v.date);
    const start = londonToUtc(date, a.startMinute);
    const end = new Date(start.getTime() + a.durationMin * 60000);
    const prevTime = `${hhmm(londonMinute(v.scheduledStart))}–${hhmm(londonMinute(v.scheduledEnd))}`;
    const base = { visitId: v.id, reference: v.reference, lockVersion: v.lockVersion, date, status: v.status, published: !!v.publishedAt, previous: prevTime, proposed: timeText(a.startMinute, a.durationMin) };
    const started = v.status !== "SCHEDULED" || v.clocks.length > 0 || v.scheduledStart <= now;
    if (!covers(a, date, cw(date))) {
      rows.push({ ...base, proposed: "Not in the template", result: started ? "started" : "removed", changes: ["no longer in the pattern"], reason: started ? "Started or finished: history is kept" : "Kept unless you tick it to cancel" });
      continue;
    }
    const changes: string[] = [];
    const patch: VisitPatch = {};
    if (start.getTime() !== v.scheduledStart.getTime() || end.getTime() !== v.scheduledEnd.getTime()) {
      changes.push("time");
      patch.scheduledStart = start;
      patch.scheduledEnd = end;
    }
    if (v.callTypeId !== a.callTypeId) { changes.push("call type"); patch.callTypeId = a.callTypeId; }
    if (v.medicationRequired !== a.medicationRequired) { changes.push("medication prompt"); patch.medicationRequired = a.medicationRequired; }
    if (v.alertOnLate !== a.alertOnLate) { changes.push("late alert"); patch.alertOnLate = a.alertOnLate; }
    if (v.timeLocked !== a.timeLocked) { changes.push("time lock"); patch.timeLocked = a.timeLocked; }
    if (v.carersRequired !== a.carersRequired) { changes.push("number of carers"); patch.carersRequired = a.carersRequired; }
    if ((v.notes ?? null) !== (a.notes ?? null) && (v.notes ?? null) === (stored.notes ?? null)) { changes.push("notes"); patch.notes = a.notes; }
    const replaceTasks = taskChange && v._count.taskOutcomes === 0 && v.tasks.map((t) => t.careTaskId ?? "").sort().join() !== p.taskIds.join();
    if (replaceTasks) changes.push("care tasks");

    // Carer places: a place moves to the template's new carer only when it is still held by the old preferred carer
    // (or is empty). Anyone else there was put on by hand or as cover, and is never replaced from the template.
    const swaps: CarerSwap[] = [];
    let carerReview: string | null = null;
    for (const [i, place] of carerPlaces(a.carersRequired).entries()) {
      const want = pa[i] ?? null;
      const was = pb[i] ?? null;
      if (want === was || !want) continue;
      const holder = v.assignments.find((x) => placeKey(x) === place);
      if (holder?.staffId === want) continue;
      if (holder && holder.staffId !== was) {
        carerReview = `${holder.staff.displayName} covers ${placeLabel(place).toLowerCase()} on this visit, so the template's new carer is not swapped in`;
        continue;
      }
      swaps.push({ place, fromStaffId: holder?.staffId ?? null, toStaffId: want });
    }
    if (swaps.length) changes.push("carers");
    const row = { ...base, changes, proposed: changes.includes("time") ? base.proposed : base.previous };
    if (!changes.length && !carerReview) { rows.push({ ...row, result: "unchanged" }); continue; }
    if (started) { rows.push({ ...row, result: "started", reason: "Started or finished: history is kept" }); continue; }
    if (v.manuallyChanged) { rows.push({ ...row, result: "manual", reason: "Changed by hand: left as it is" }); continue; }
    if (v.timeLocked && changes.includes("time")) { rows.push({ ...row, result: "locked", reason: "This visit's time is locked" }); continue; }
    // Lowering the number of carers never removes anyone: the coordinator chooses who stays.
    const beyond = v.assignments.filter((x) => x.slot !== "SHADOW" && (placeNumber(placeKey(x)) ?? 0) > a.carersRequired);
    if (beyond.length) { rows.push({ ...row, result: "review", reason: `Fewer carers needed: choose who stays (${beyond.map((b) => b.staff.displayName).join(", ")} would have no place)` }); continue; }
    if (carerReview) { rows.push({ ...row, result: "review", reason: carerReview }); continue; }

    // Every carer who would be on the visit is checked at the proposed time with the shared eligibility service.
    const finalStaff = carerPlaces(a.carersRequired).map((place) => swaps.find((s) => s.place === place)?.toStaffId ?? v.assignments.find((x) => placeKey(x) === place)?.staffId ?? null).filter((x): x is string => !!x);
    let blocked: string | null = null;
    for (const staffId of finalStaff) {
      const isNew = swaps.some((s) => s.toStaffId === staffId);
      if (!isNew && !changes.includes("time")) continue;
      const r = await eligibilityFor(tx, org, { staffId, start: patch.scheduledStart ?? v.scheduledStart, end: patch.scheduledEnd ?? v.scheduledEnd, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, careTaskIds: replaceTasks ? p.taskIds : v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x) }, { otherSlotStaffIds: finalStaff.filter((x) => x !== staffId) });
      const nm = v.assignments.find((x) => x.staffId === staffId)?.staff.displayName ?? (await tx.staffMember.findUnique({ where: { id: staffId }, select: { displayName: true } }))?.displayName ?? "A carer";
      if (r.state === "NOT_ELIGIBLE") { blocked = `${nm} cannot do it: ${r.blocking.map((b) => b.message).join("; ")}`; break; }
      if (r.state === "REQUIRES_REVIEW" && isNew) { blocked = `${nm} needs checking first: ${r.warnings.map((w) => w.message).join("; ")}`; break; }
    }
    if (blocked) { rows.push({ ...row, result: "review", reason: blocked }); continue; }
    rows.push({ ...row, result: "update", patch, swaps, replaceTasks });
  }

  // Dates in weeks already built that the new pattern adds. Listed only: Create Future Rota adds them.
  const built = new Set((await tx.rotaBuild.findMany({ where: { organisationId: org, status: "BUILT", weekStart: { gte: dbDate(mondayOf(today)) } }, select: { weekStart: true } })).map((b) => fromDbDate(b.weekStart)));
  for (const v of visits) built.add(mondayOf(fromDbDate(v.date)));
  const have = new Set(visits.map((v) => fromDbDate(v.date)));
  const newDates: string[] = [];
  for (const monday of [...built].sort()) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(monday, d);
      if (date < today || have.has(date)) continue;
      if (covers(a, date, cw(date)) && !covers(stored, date, cw(date))) newDates.push(date);
    }
  }

  const count = (r: ImpactResult) => rows.filter((x) => x.result === r).length;
  const summary = { update: count("update"), review: count("review"), protected: count("manual") + count("locked") + count("started"), removed: count("removed"), past: 0, unchanged: count("unchanged") };
  const fingerprint = hash({ token, rows: rows.map((r) => [r.visitId, r.lockVersion, r.status, r.result, r.swaps?.map((s) => `${s.place}:${s.toStaffId}`).join() ?? ""]), newDates });
  return { rows, newDates, manualActions, summary, fingerprint };
}

/** Step 2b: the affected-visits review for Template + Future Rota. Read only; the template is not saved. */
export async function previewTemplateImpact(ctx: Ctx, templateId: string, version: number, input: TemplateInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  const stored = await loadStored(db, scope, templateId);
  if (stored.version !== version) throw new ConflictError("This template changed since you opened it. Reload and try again.");
  const p = await propose(db, scope, input);
  const token = proposalToken(templateId, version, p);
  const impact = await planImpact(db, scope, stored, p, token);
  return { ...impact, rows: impact.rows.map(({ patch: _p, swaps: _s, replaceTasks: _r, ...r }) => r), token };
}

export interface SaveTemplateOptions {
  /** The token from previewTemplateEdit. Required: it proves the confirmation was shown for exactly these values. */
  token: string;
  /** "template" = Template Only; "future" = Template + Future Rota (needs the plan fingerprint). */
  scope: "template" | "future";
  fingerprint?: string;
  /** Visits listed as "No longer in the template" that the coordinator ticked to cancel, and why. */
  cancelVisitIds?: string[];
  cancelReason?: string;
}

/**
 * Saves a confirmed template edit. Template Only changes just the template. Template + Future Rota re-plans inside the
 * transaction and applies every eligible visit through the shared visit and assignment services; any refusal, or any
 * change since the preview, rolls the whole save back.
 */
export async function saveTemplateEdit(ctx: Ctx, templateId: string, version: number, input: TemplateInput, opts: SaveTemplateOptions) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (!opts.token) throw new ValidationError("Confirm the changes before saving.");
  if (opts.scope === "future" && !opts.fingerprint) throw new ValidationError("Review the future visits before applying.");
  const cancelIds = [...new Set(opts.cancelVisitIds ?? [])];
  if (cancelIds.length && (opts.cancelReason ?? "").trim().length < 3) throw new ValidationError("Give a reason for cancelling the visits you ticked");
  try {
    return await db.$transaction(async (tx) => {
      const stored = await loadStored(tx, scope, templateId, true);
      if (stored.version !== version) throw new ConflictError("This template changed since you opened it. Reload and try again.");
      const p = await propose(tx, scope, input);
      const token = proposalToken(templateId, version, p);
      if (token !== opts.token) throw new ConflictError("The changes are not the ones you confirmed. Save again to review them.");
      const changes = await diff(tx, scope.organisationId, stored, p);
      if (!changes.length) throw new ValidationError("No changes to save.");
      let impact: TemplateImpact | null = null;
      if (opts.scope === "future") {
        impact = await planImpact(tx, scope, stored, p, token);
        if (impact.fingerprint !== opts.fingerprint) throw new ConflictError("The rota changed since your preview. Review the future visits again.");
        const removable = new Set(impact.rows.filter((r) => r.result === "removed").map((r) => r.visitId));
        if (cancelIds.some((id) => !removable.has(id))) throw new ValidationError("Only visits that are no longer in the template can be cancelled here");
      }

      await tx.templateTask.deleteMany({ where: { templateId } });
      await tx.visitTemplate.update({ where: { id: templateId }, data: { ...p.values, version: { increment: 1 }, tasks: { create: p.taskIds.map((careTaskId) => ({ careTaskId })) } } });

      let applied = 0;
      const changed: string[] = [];
      const removedStaff = new Map<string, string[]>();
      if (impact) {
        const careTasks = p.taskIds.length ? await tx.careTask.findMany({ where: { organisationId: scope.organisationId, id: { in: p.taskIds } }, select: { id: true, name: true } }) : [];
        for (const r of impact.rows.filter((x) => x.result === "update")) {
          try {
            if (r.patch && Object.keys(r.patch).length) await updateVisitInTx(tx, scope, ctx.userId, r.visitId, r.patch, { source: "template", keepAutomatic: true, lockVersion: r.lockVersion });
            for (const s of r.swaps ?? []) {
              await assignInTx(tx, scope, ctx.userId, { visitId: r.visitId, slot: s.place, staffId: s.toStaffId }, { source: "template", markManual: false, reason: "Template carer changed" });
              if (s.fromStaffId) removedStaff.set(r.visitId, [...(removedStaff.get(r.visitId) ?? []), s.fromStaffId]);
            }
            if (r.replaceTasks) {
              await tx.visitTask.deleteMany({ where: { visitId: r.visitId } });
              if (careTasks.length) await tx.visitTask.createMany({ data: p.taskIds.map((id, i) => ({ visitId: r.visitId, careTaskId: id, name: careTasks.find((c) => c.id === id)?.name ?? "Task", position: i })) });
            }
          } catch (e) {
            if (isOverlapViolation(e)) throw new ConflictError(`Nothing was saved. ${r.reference} on ${fmtLondonDate(r.date, { day: "numeric", month: "short" })}: a carer is already booked at the new time. Review the future visits again.`);
            if (e instanceof AppError) throw new ConflictError(`Nothing was saved. ${r.reference} on ${fmtLondonDate(r.date, { day: "numeric", month: "short" })}: ${e.message} Review the future visits again.`);
            throw e;
          }
          applied++;
          changed.push(r.visitId);
        }
        for (const id of cancelIds) {
          const r = impact.rows.find((x) => x.visitId === id)!;
          await cancelVisitInTx(tx, scope, ctx.userId, id, `${opts.cancelReason!.trim()} (no longer in the template)`, r.lockVersion);
          changed.push(id);
        }
      }
      const carersTold = await notifyVisitsChanged(tx, scope.organisationId, changed, { key: `tpl:${templateId}:${version}`, extraStaffIds: removedStaff });
      await audit({
        organisationId: scope.organisationId,
        actorId: ctx.userId,
        action: "template.updated",
        entityType: "VisitTemplate",
        entityId: templateId,
        data: {
          fromVersion: version,
          choice: opts.scope === "future" ? "template and future rota" : "template only",
          changes: changes.map((c) => ({ field: c.label, from: c.before, to: c.after })),
          ...(impact ? { visitsUpdated: applied, visitsCancelled: cancelIds.length, needsReview: impact.summary.review, protected: impact.summary.protected, keptNotInTemplate: impact.summary.removed - cancelIds.length, newDatesNotCreated: impact.newDates.length, carersTold } : {}),
        },
      }, tx);
      return { applied, cancelled: cancelIds.length, review: impact?.summary.review ?? 0, protected: impact?.summary.protected ?? 0, carersTold, newDates: impact?.newDates.length ?? 0 };
    }, { timeout: 60_000 });
  } catch (e) {
    if (isOverlapViolation(e)) throw new ConflictError("Nothing was saved: a carer is already booked at the new time. Review the future visits again.");
    throw e;
  }
}

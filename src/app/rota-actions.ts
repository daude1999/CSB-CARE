"use server";

import type { AssignmentSlot } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { londonToUtc, parseHhmm } from "@/lib/london";
import { handle, str } from "./action-kit";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { confirmBuild, deleteBuild, publishBuild } from "@/server/rota/build";
import { updateRotaSettings } from "@/server/rota/settings";
import { resolveAlert } from "@/server/rota/alerts";
import { applyTemplateChanges, createTemplate, duplicateTemplate, nudgeTemplates, setTemplatesEnabled, updateTemplate, type TemplateInput } from "@/server/rota/templates";
import { bulkVisits, cancelVisit, createVisit, reinstateVisit, setDoubleUp, updateVisit, type BulkAction, type BulkResult } from "@/server/rota/visits";
import { linkLogin, unlinkLogin } from "@/server/workforce/link";
import { reconcileWorkforce } from "@/server/workforce/projection";
import { requireOrgPermission } from "@/server/auth/rbac";

/** Server actions for Rostering & Care Management. Each reads FormData, calls one domain function and redirects back. */

const SLOTS: AssignmentSlot[] = ["PRIMARY", "SECOND", "SHADOW"];
function slot(fd: FormData): AssignmentSlot {
  const s = str(fd, "slot") as AssignmentSlot;
  if (!SLOTS.includes(s)) throw new ValidationError("Choose a slot");
  return s;
}
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1";
function int(fd: FormData, k: string, label: string) {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number`);
  return n;
}
function optInt(fd: FormData, k: string) {
  const v = str(fd, k);
  return v === "" ? undefined : Number(v);
}
function minuteOf(fd: FormData, k: string, label: string) {
  const m = parseHhmm(str(fd, k));
  if (m === null) throw new ValidationError(`${label} must be a time such as 07:30`);
  return m;
}
const ids = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && x.length > 0);

/** Lists what a bulk action did, so the coordinator sees each refusal and its reason. */
function summarise(results: { ok: boolean; message?: string; reference?: string }[]) {
  const done = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok);
  if (!refused.length) return `${done} updated`;
  const detail = refused.slice(0, 4).map((r) => `${r.reference ?? "one"}: ${r.message}`).join("; ");
  if (!done) throw new ValidationError(`None updated. ${detail}${refused.length > 4 ? ` and ${refused.length - 4} more` : ""}`);
  return `${done} updated, ${refused.length} refused (${detail}${refused.length > 4 ? ` and ${refused.length - 4} more` : ""})`;
}

// ── Visits ────────────────────────────────────────────────────────────────

export async function assignCarerAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await assignCarer(ctx, { visitId: str(fd, "visitId"), slot: slot(fd), staffId: str(fd, "staffId"), acceptWarnings: bool(fd, "acceptWarnings"), lockVersion: optInt(fd, "lockVersion") });
  }, "Carer assigned");
}

export async function unassignCarerAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await unassignCarer(ctx, { visitId: str(fd, "visitId"), slot: slot(fd), reason: str(fd, "reason") || "Removed by the office", lockVersion: optInt(fd, "lockVersion") });
  }, "Carer removed");
}

export async function updateVisitAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const date = str(fd, "date");
    const start = londonToUtc(date, minuteOf(fd, "start", "Start"));
    const duration = int(fd, "durationMin", "Length");
    if (duration < 5 || duration > 1440) throw new ValidationError("A visit lasts between 5 minutes and 24 hours");
    await updateVisit(ctx, str(fd, "visitId"), int(fd, "lockVersion", "Version"), {
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + duration * 60000),
      callTypeId: str(fd, "callTypeId") || undefined,
      medicationRequired: bool(fd, "medicationRequired"),
      timeLocked: bool(fd, "timeLocked"),
      alertOnLate: bool(fd, "alertOnLate"),
      notes: str(fd, "notes") || null,
    });
  }, "Visit saved");
}

export async function cancelVisitAction(fd: FormData) {
  return handle(fd, (ctx) => cancelVisit(ctx, str(fd, "visitId"), str(fd, "reason"), optInt(fd, "lockVersion")).then(() => undefined), "Visit cancelled");
}

export async function reinstateVisitAction(fd: FormData) {
  return handle(fd, (ctx) => reinstateVisit(ctx, str(fd, "visitId"), str(fd, "reason") || "Reinstated by the office", optInt(fd, "lockVersion")).then(() => undefined), "Visit reinstated");
}

export async function doubleUpAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const n = int(fd, "carersRequired", "Carers");
    if (n !== 1 && n !== 2) throw new ValidationError("A visit needs one or two carers");
    await setDoubleUp(ctx, str(fd, "visitId"), n, optInt(fd, "lockVersion"));
  }, "Visit updated");
}

export async function createVisitAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const v = await createVisit(ctx, {
      serviceUserId: str(fd, "serviceUserId"),
      callTypeId: str(fd, "callTypeId"),
      date: str(fd, "date"),
      startMinute: minuteOf(fd, "start", "Start"),
      durationMin: Number(str(fd, "durationMin")),
      carersRequired: Number(str(fd, "carersRequired") || 1),
      medicationRequired: bool(fd, "medicationRequired"),
      timeLocked: bool(fd, "timeLocked"),
      notes: str(fd, "notes") || undefined,
      publish: bool(fd, "publish"),
    });
    return `/rota/visits/${v.id}`;
  }, "Visit added");
}

export async function bulkVisitsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const kind = str(fd, "kind");
    let action: BulkAction;
    switch (kind) {
      case "assign":
        if (!str(fd, "staffId")) throw new ValidationError("Choose a carer");
        action = { kind, staffId: str(fd, "staffId"), slot: slot(fd), acceptWarnings: bool(fd, "acceptWarnings") };
        break;
      case "unassign":
        action = { kind, slot: slot(fd), reason: str(fd, "reason") || "Removed in bulk by the office" };
        break;
      case "cancel":
        action = { kind, reason: str(fd, "reason") };
        break;
      case "nudge":
        action = { kind, minutes: int(fd, "minutes", "Minutes") };
        break;
      case "lock":
      case "unlock":
        action = { kind: "lock", locked: kind === "lock" };
        break;
      case "publish":
        action = { kind };
        break;
      default:
        throw new ValidationError("Choose what to do with the selected visits");
    }
    const results: BulkResult[] = await bulkVisits(ctx, ids(fd, "visitIds"), action);
    return { ok: summarise(results) };
  }, "Done");
}

// ── Templates ─────────────────────────────────────────────────────────────

function templateInput(fd: FormData): TemplateInput {
  const nums = (k: string) => fd.getAll(k).map((x) => Number(x));
  const opt = (k: string) => str(fd, k) || null;
  return {
    serviceUserId: str(fd, "serviceUserId"),
    callTypeId: str(fd, "callTypeId"),
    areaId: opt("areaId"),
    cycleWeeks: nums("cycleWeeks"),
    weekdays: nums("weekdays"),
    startMinute: minuteOf(fd, "start", "Start"),
    durationMin: Number(str(fd, "durationMin")),
    carersRequired: Number(str(fd, "carersRequired") || 1),
    preferredStaff1Id: opt("preferredStaff1Id"),
    preferredStaff2Id: opt("preferredStaff2Id"),
    shadowStaffId: opt("shadowStaffId"),
    timeLocked: bool(fd, "timeLocked"),
    medicationRequired: bool(fd, "medicationRequired"),
    alertOnLate: bool(fd, "alertOnLate"),
    rotaType: str(fd, "rotaType") === "ALTERNATE" ? "ALTERNATE" : "NORMAL",
    runRouteTemplateId: opt("runRouteTemplateId"),
    effectiveFrom: str(fd, "effectiveFrom"),
    effectiveTo: opt("effectiveTo"),
    notes: opt("notes"),
    taskIds: ids(fd, "taskIds"),
  };
}

export async function createTemplateAction(fd: FormData) {
  return handle(fd, async (ctx) => `/rota/templates/${(await createTemplate(ctx, templateInput(fd))).id}`, "Template created");
}

export async function updateTemplateAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await updateTemplate(ctx, str(fd, "templateId"), int(fd, "version", "Version"), templateInput(fd));
  }, "Template saved. Built visits are unchanged until you apply the change below.");
}

export async function templateBulkAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const list = ids(fd, "templateIds");
    if (!list.length) throw new ValidationError("Select at least one template");
    const kind = str(fd, "kind");
    const results = kind === "enable" || kind === "disable" ? await setTemplatesEnabled(ctx, list, kind === "enable") : kind === "nudge" ? await nudgeTemplates(ctx, list, int(fd, "minutes", "Minutes")) : null;
    if (!results) throw new ValidationError("Choose what to do with the selected templates");
    const refused = results.filter((r) => !r.ok);
    if (refused.length === results.length) throw new ValidationError(`None updated: ${refused[0]?.message}`);
    return { ok: refused.length ? `${results.length - refused.length} updated, ${refused.length} refused (${refused[0]?.message})` : `${results.length} updated` };
  }, "Templates updated");
}

export async function duplicateTemplateAction(fd: FormData) {
  return handle(fd, async (ctx) => `/rota/templates/${(await duplicateTemplate(ctx, str(fd, "templateId"))).id}`, "Copy created. It is switched off until you check and enable it.");
}

export async function applyTemplateChangesAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const results = await applyTemplateChanges(ctx, str(fd, "templateId"), int(fd, "version", "Version"));
    if (!results.length) throw new ValidationError("No built visits needed changing");
    return { ok: `Applied to built visits: ${summarise(results)}` };
  }, "Template change applied to built visits");
}

// ── Build Rota ────────────────────────────────────────────────────────────

export async function confirmBuildAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const cycle = optInt(fd, "cycleWeek");
    await confirmBuild(ctx, { weekStart: str(fd, "weekStart"), areaIds: ids(fd, "areaIds"), cycleWeek: cycle });
    return `/rota/build?week=${str(fd, "weekStart")}`;
  }, "Rota built. Check it, then publish it to carers.");
}

export async function publishBuildAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await publishBuild(ctx, str(fd, "buildId"));
    return { ok: `${r.published} visits published. ${r.carersNotified} linked carer${r.carersNotified === 1 ? " has" : "s have"} been told in the app.` };
  }, "Rota published. Linked carers have been told in the app.");
}

export async function deleteBuildAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await deleteBuild(ctx, str(fd, "buildId"), str(fd, "reason"));
    return { ok: `Build deleted: ${r.removed} visits removed` };
  }, "Build deleted");
}

// ── Settings and workforce links ───────────────────────────────────────────

export async function rotaSettingsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const rating = str(fd, "minPreferenceRating");
    await updateRotaSettings(ctx, {
      cycleLength: str(fd, "cycleLength"),
      anchorMonday: str(fd, "anchorMonday"),
      buildAheadWeeks: str(fd, "buildAheadWeeks"),
      lateAfterMin: str(fd, "lateAfterMin"),
      missedAfterMin: str(fd, "missedAfterMin"),
      earlyBeforeMin: str(fd, "earlyBeforeMin"),
      blockEarlyClockIn: bool(fd, "blockEarlyClockIn"),
      shortVisitPercent: str(fd, "shortVisitPercent"),
      requireNoteOnShortVisit: bool(fd, "requireNoteOnShortVisit"),
      dbsRule: str(fd, "dbsRule"),
      rightToWorkRule: str(fd, "rightToWorkRule"),
      trainingRule: str(fd, "trainingRule"),
      careRoleTitles: str(fd, "careRoleTitles").split("\n").map((s) => s.trim()).filter(Boolean),
      minPreferenceRating: rating === "" ? null : rating,
      geofenceMetres: str(fd, "geofenceMetres"),
      carerDaysForward: str(fd, "carerDaysForward"),
      carerDaysBack: str(fd, "carerDaysBack"),
      mandatoryClockOutNote: bool(fd, "mandatoryClockOutNote"),
      doorstepCancel: bool(fd, "doorstepCancel"),
      alertLatencyTargetSec: str(fd, "alertLatencyTargetSec"),
    });
  }, "Rostering settings saved");
}

export async function reconcileWorkforceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const org = requireOrgPermission(ctx, "workforce.link");
    await reconcileWorkforce(org, ctx.userId);
  }, "Staff records re-checked against HR");
}

export async function linkLoginAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await linkLogin(ctx, { staffId: str(fd, "staffId"), userId: str(fd, "userId"), grantCarerRole: bool(fd, "grantCarerRole"), confirm: bool(fd, "confirm") });
  }, "Sign-in linked");
}

export async function unlinkLoginAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await unlinkLogin(ctx, str(fd, "staffId"), str(fd, "reason"));
  }, "Sign-in unlinked");
}

export async function resolveAlertAction(fd: FormData) {
  return handle(fd, (ctx) => resolveAlert(ctx, str(fd, "alertId"), str(fd, "resolution")), "Alert closed");
}

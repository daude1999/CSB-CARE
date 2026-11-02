"use server";

import type { AssignmentSlot } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { isIsoDate, londonToUtc, parseHhmm } from "@/lib/london";
import { handle, safeBack, str, withParam } from "./action-kit";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { swapCarers } from "@/server/rota/swap";
import { confirmBuild, deleteBuild, publishBuild } from "@/server/rota/build";
import { confirmRollForward } from "@/server/rota/roll-forward";
import { applyPlan, decideChanges, discardPlan, generatePlan, publishPlanVisits } from "@/server/rota/optimise";
import { updateRotaSettings } from "@/server/rota/settings";
import { resolveAlert } from "@/server/rota/alerts";
import { assignExceptionOwner, escalateException, resolveException } from "@/server/rota/exceptions";
import { acknowledgeMyVisits } from "@/server/rota/carer";
import { addVisitNote, recordTaskOutcomes } from "@/server/care/visit-record";
import { createPackage, endPackage, updatePackage, type PackageInput } from "@/server/care/packages";
import { clockMine, notDeliveredMine, officeClock } from "@/server/rota/attendance";
import { decideClockCorrection, requestClockCorrection } from "@/server/rota/corrections";
import { addToRoute, createLiveRoute, createTemplateRoute, moveStop, moveToRoute, orderRouteDayByTime, removeFromRoute, removeRoute, type RouteInput } from "@/server/rota/routes";
import { decideMileage, submitMyMileage } from "@/server/finance/mileage";
import { sweepNow } from "@/server/rota/monitor";
import { acknowledgePlan, approvePlan, discardDraft, returnPlan, saveDraft, startDraft, submitPlan } from "@/server/care/care-plans";
import { archiveRisk, createRisk, reviewRisk } from "@/server/care/risks";
import { addBand, addBankHoliday, createRateCard, removeBand, removeBankHoliday, saveFunder, setPackageFunder, setStaffPayCard, updateFinanceSettings } from "@/server/finance/rates";
import { adjustLine, bulkTimesheets, decideTimesheet, generateTimesheets, submitTimesheet, verifyLines } from "@/server/finance/timesheets";
import { approveRun, prepareInvoiceRun, preparePayRun, voidRun } from "@/server/finance/runs";
import { addIncidentNote, closeIncident, reopenIncident, reportIncident, triageIncident } from "@/server/care/incidents";
import { createCallType, createCareTask, saveArea, setAreaActive, setCallTypeActive, setCareTaskActive, setMemberAreas } from "@/server/rota/reference";
import { addAbsence, addContact, updateContact, cancelAbsence, createServiceUser, removeCarerPreference, removeContact, setCarerPreference, setKeySafe, setServiceUserStatus, updateServiceUser } from "@/server/care/service-users";
import { applyTemplateChanges, bulkTemplates, createTemplate, duplicateTemplate, duplicateTemplates, nudgeTemplates, setTemplateCarer, setTemplatesEnabled, updateTemplate, type TemplateBulkAction, type TemplateInput } from "@/server/rota/templates";
import { bulkVisits, cancelVisit, createVisit, moveVisit, reinstateVisit, setDoubleUp, updateVisit, type BulkAction, type BulkResult } from "@/server/rota/visits";
import { linkLogin, unlinkLogin } from "@/server/workforce/link";
import { updateRotaProfile } from "@/server/workforce/profile";
import { addAvailability, cancelStaffAbsence, decideAbsence, endAvailability, recordAbsence } from "@/server/workforce/absences";
import { reconcileWorkforce } from "@/server/workforce/projection";
import { requireOrgPermission } from "@/server/auth/rbac";
import { confirmCover, recordServiceUserInformed } from "@/server/rota/missed-cover";
import { bookCover, bookedText } from "@/server/rota/replacement-cover";
import { closeContactFollowUp, correctContactAttempt, recordContactAttempt } from "@/server/rota/cover-communication";
import { addCaseComment, addCaseEvidence, addFollowUp, assignCoordinator, bulkMissed, completeFollowUp, escalateMissedCase, recordReason, recordReplacement, reopenMissedCase, signOffMissedCase, submitForSignOff } from "@/server/rota/missed-calls";

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

/** The planner's drag to another day, optionally onto another carer. */
export async function moveVisitAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await moveVisit(ctx, { visitId: str(fd, "visitId"), slot: str(fd, "slot"), lockVersion: optInt(fd, "lockVersion"), toDate: str(fd, "toDate"), staffId: str(fd, "staffId") || null, acceptWarnings: bool(fd, "acceptWarnings") });
  }, "Visit moved");
}

/** Two-way swap from the visit page: "with" holds the other visit as visitId|slot|lockVersion. */
export async function swapCarersAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const [visitId, otherSlot, version] = str(fd, "with").split("|");
    if (!visitId || !otherSlot) throw new ValidationError("Choose the visit to swap with");
    const other = { visitId, slot: otherSlot, lockVersion: version ? Number(version) : undefined };
    await swapCarers(ctx, { first: { visitId: str(fd, "visitId"), slot: slot(fd), lockVersion: optInt(fd, "lockVersion") }, second: other, reason: str(fd, "reason"), acceptWarnings: bool(fd, "acceptWarnings") });
  }, "Carers swapped");
}

export async function updateVisitAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const date = str(fd, "date");
    if (!isIsoDate(date)) throw new ValidationError("Choose the date of the visit");
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

/** The office must say whether a cancellation is charged: "yes" or "no". */
function cancelCharge(fd: FormData) {
  const c = str(fd, "charge");
  if (c !== "yes" && c !== "no") throw new ValidationError("Choose whether to charge for the cancellation");
  return c === "yes";
}

export async function cancelVisitAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const charge = cancelCharge(fd);
    await cancelVisit(ctx, str(fd, "visitId"), str(fd, "reason"), optInt(fd, "lockVersion"), charge);
  }, "Visit cancelled");
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
      case "shadow":
        if (!str(fd, "staffId")) throw new ValidationError("Choose a carer");
        action = { kind: "assign", staffId: str(fd, "staffId"), slot: kind === "shadow" ? "SHADOW" : slot(fd), acceptWarnings: bool(fd, "acceptWarnings") };
        break;
      case "unassign":
        action = { kind, slot: slot(fd), reason: str(fd, "reason") || "Removed in bulk by the office" };
        break;
      case "cancel":
        action = { kind, reason: str(fd, "reason"), charge: cancelCharge(fd) };
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
      case "activate":
        action = { kind, reason: str(fd, "reason") };
        break;
      case "editTime":
        action = { kind, startMinute: minuteOf(fd, "time", "New start time") };
        break;
      case "editDuration":
        action = { kind, minutes: int(fd, "duration", "Duration") };
        break;
      case "editService":
        if (!str(fd, "callTypeId")) throw new ValidationError("Choose a service call");
        action = { kind, callTypeId: str(fd, "callTypeId") };
        break;
      case "addAlert":
      case "removeAlert":
        action = { kind: "alert", on: kind === "addAlert" };
        break;
      case "doubleUp":
      case "single":
        action = { kind: "doubleUp", carers: kind === "doubleUp" ? 2 : 1 };
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
    const tslot = (): "PRIMARY" | "SECOND" | "SHADOW" => (str(fd, "slot") === "SECOND" ? "SECOND" : str(fd, "slot") === "SHADOW" ? "SHADOW" : "PRIMARY");
    let action: TemplateBulkAction | null = null;
    if (kind === "assign") {
      if (!str(fd, "staffId")) throw new ValidationError("Choose a team member");
      action = { kind, staffId: str(fd, "staffId"), slot: tslot() };
    } else if (kind === "unassign") action = { kind, slot: tslot() };
    else if (kind === "editTime") action = { kind, startMinute: minuteOf(fd, "time", "New start time") };
    else if (kind === "editDuration") action = { kind, minutes: int(fd, "duration", "Duration") };
    else if (kind === "editService") {
      if (!str(fd, "callTypeId")) throw new ValidationError("Choose a service call");
      action = { kind, callTypeId: str(fd, "callTypeId") };
    } else if (kind === "lock" || kind === "unlock") action = { kind: "lock", on: kind === "lock" };
    else if (kind === "addAlert" || kind === "removeAlert") action = { kind: "alert", on: kind === "addAlert" };
    else if (kind === "doubleUp" || kind === "single") action = { kind: "doubleUp", carers: kind === "doubleUp" ? 2 : 1 };
    const results = kind === "enable" || kind === "disable" ? await setTemplatesEnabled(ctx, list, kind === "enable") : kind === "nudge" ? await nudgeTemplates(ctx, list, int(fd, "minutes", "Minutes")) : kind === "duplicate" ? await duplicateTemplates(ctx, list) : action ? await bulkTemplates(ctx, list, action) : null;
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
    return "/rota/build";
  }, "Rota built. Check it, then publish it to carers.");
}

export async function rollForwardAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await confirmRollForward(ctx, { sourceWeek: str(fd, "sourceWeek"), targetWeek: str(fd, "targetWeek"), weeks: int(fd, "weeks", "Weeks"), areaIds: ids(fd, "areaIds") });
    const uncovered = r.builds.reduce((n, b) => n + b.uncovered, 0);
    return { to: "/rota/build", ok: `Rolled forward into ${r.builds.length} week${r.builds.length === 1 ? "" : "s"}: ${r.plan.visits.length} visits saved as drafts${uncovered ? `, ${uncovered} carer slots need covering` : ""}. Check them, then publish each week.` };
  }, "Rota rolled forward as drafts. Check it, then publish.");
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
      repeatOffenderCount: str(fd, "repeatOffenderCount") || undefined,
      repeatClientCount: str(fd, "repeatClientCount") || undefined,
      repeatWindowDays: str(fd, "repeatWindowDays") || undefined,
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

export async function rotaProfileAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const rota = str(fd, "rotaEnabled");
    const gender = str(fd, "gender");
    const hours = str(fd, "maxWeeklyHours");
    await updateRotaProfile(ctx, str(fd, "staffId"), {
      rotaEnabled: rota === "" ? null : rota === "yes",
      gender: gender === "" ? null : gender,
      drives: bool(fd, "drives"),
      maxWeeklyHours: hours === "" ? null : hours,
      areaIds: ids(fd, "areaIds"),
      notes: str(fd, "notes") || null,
    });
  }, "Rota details saved. Future visits were re-checked.");
}

// ── Service users ──────────────────────────────────────────────────────────

function serviceUserInput(fd: FormData) {
  const risk = str(fd, "riskLevel");
  return {
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    preferredName: str(fd, "preferredName"),
    dateOfBirth: str(fd, "dateOfBirth"),
    nhsNumber: str(fd, "nhsNumber"),
    gender: str(fd, "gender"),
    areaId: str(fd, "areaId"),
    addressLine1: str(fd, "addressLine1"),
    addressLine2: str(fd, "addressLine2"),
    town: str(fd, "town"),
    postcode: str(fd, "postcode"),
    phone: str(fd, "phone"),
    altPhone: fd.has("altPhone") ? str(fd, "altPhone") : undefined,
    preferredContactMethod: fd.has("preferredContactMethod") ? str(fd, "preferredContactMethod") : undefined,
    accessNotes: str(fd, "accessNotes"),
    carerGenderPreference: (["FEMALE", "MALE"] as const).find((g) => g === str(fd, "carerGenderPreference")) ?? "ANY",
    firstLanguage: str(fd, "firstLanguage"),
    communicationNeeds: str(fd, "communicationNeeds"),
    carePreferences: str(fd, "carePreferences"),
    riskLevel: (["LOW", "MEDIUM", "HIGH"] as const).find((r) => r === risk) ?? null,
    riskSummary: str(fd, "riskSummary"),
  };
}

export async function createServiceUserAction(fd: FormData) {
  return handle(fd, async (ctx) => `/rota/service-users/${(await createServiceUser(ctx, serviceUserInput(fd))).id}`, "Service user added. Their status is Assessment until care starts.");
}

export async function updateServiceUserAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await updateServiceUser(ctx, str(fd, "serviceUserId"), int(fd, "version", "Version"), serviceUserInput(fd));
  }, "Details saved");
}

export async function serviceUserStatusAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const to = (["ENQUIRY", "ASSESSMENT", "ACTIVE", "PAUSED", "ENDED"] as const).find((s) => s === str(fd, "to"));
    if (!to) throw new ValidationError("Choose a status");
    const r = await setServiceUserStatus(ctx, str(fd, "serviceUserId"), to, str(fd, "reason"), str(fd, "endDate") || undefined);
    return { ok: to === "ENDED" ? `Care ended. Templates switched off and ${r.cancelled} future visit${r.cancelled === 1 ? "" : "s"} cancelled.` : "Status changed" };
  }, "Status changed");
}

function contactInput(fd: FormData) {
  return {
    kind: str(fd, "kind"), name: str(fd, "name"), relationship: str(fd, "relationship"), phone: str(fd, "phone"), email: str(fd, "email"), isEmergency: bool(fd, "isEmergency"), canReceiveUpdates: bool(fd, "canReceiveUpdates"),
    altPhone: str(fd, "altPhone"), preferredContactMethod: str(fd, "preferredContactMethod"), isPrimary: bool(fd, "isPrimary"), authorityType: str(fd, "authorityType"), authorityScope: str(fd, "authorityScope"),
  };
}

export async function addContactAction(fd: FormData) {
  return handle(fd, (ctx) => addContact(ctx, str(fd, "serviceUserId"), contactInput(fd)), "Contact added");
}

export async function updateContactAction(fd: FormData) {
  return handle(fd, (ctx) => updateContact(ctx, str(fd, "serviceUserId"), str(fd, "contactId"), contactInput(fd)), "Contact saved");
}

export async function removeContactAction(fd: FormData) {
  return handle(fd, (ctx) => removeContact(ctx, str(fd, "serviceUserId"), str(fd, "contactId")), "Contact removed");
}

export async function addAbsenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await addAbsence(ctx, str(fd, "serviceUserId"), { reason: str(fd, "reason"), from: str(fd, "from"), to: str(fd, "to") || undefined, note: str(fd, "note") });
    return { ok: `Absence recorded. ${r.cancelled} built visit${r.cancelled === 1 ? "" : "s"} in the period cancelled.` };
  }, "Absence recorded");
}

export async function cancelAbsenceAction(fd: FormData) {
  return handle(fd, (ctx) => cancelAbsence(ctx, str(fd, "serviceUserId"), str(fd, "absenceId")), "Absence ended. Reinstate any cancelled visits that are still needed.");
}

export async function carerPreferenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const rating = str(fd, "rating");
    await setCarerPreference(ctx, str(fd, "serviceUserId"), { staffId: str(fd, "staffId"), rating: rating ? Number(rating) : null, blocked: bool(fd, "blocked"), reason: str(fd, "reason") });
  }, "Preference saved. Future visits with this carer were re-checked.");
}

export async function removeCarerPreferenceAction(fd: FormData) {
  return handle(fd, (ctx) => removeCarerPreference(ctx, str(fd, "serviceUserId"), str(fd, "staffId")), "Preference removed");
}

export async function keySafeAction(fd: FormData) {
  return handle(fd, (ctx) => setKeySafe(ctx, str(fd, "serviceUserId"), str(fd, "code")), "Key safe code saved (encrypted)");
}

// ── Reference lists ────────────────────────────────────────────────────────

export async function saveAreaAction(fd: FormData) {
  return handle(fd, (ctx) => saveArea(ctx, { id: str(fd, "areaId") || undefined, name: str(fd, "name"), colour: str(fd, "colour"), branchId: str(fd, "branchId") || null }), "Area saved");
}
export async function areaActiveAction(fd: FormData) {
  return handle(fd, (ctx) => setAreaActive(ctx, str(fd, "areaId"), str(fd, "active") === "1"), "Area updated");
}
export async function memberAreasAction(fd: FormData) {
  return handle(fd, (ctx) => setMemberAreas(ctx, str(fd, "membershipId"), ids(fd, "areaIds")), "Coordinator areas saved");
}
export async function createCallTypeAction(fd: FormData) {
  return handle(fd, (ctx) => createCallType(ctx, { name: str(fd, "name"), defaultDurationMin: str(fd, "defaultDurationMin"), monitored: bool(fd, "monitored"), chargeable: bool(fd, "chargeable") }), "Call type added");
}
export async function callTypeActiveAction(fd: FormData) {
  return handle(fd, (ctx) => setCallTypeActive(ctx, str(fd, "id"), str(fd, "active") === "1"), "Call type updated");
}
export async function createCareTaskAction(fd: FormData) {
  return handle(fd, (ctx) => createCareTask(ctx, { name: str(fd, "name"), description: str(fd, "description") }), "Task added");
}
export async function careTaskActiveAction(fd: FormData) {
  return handle(fd, (ctx) => setCareTaskActive(ctx, str(fd, "id"), str(fd, "active") === "1"), "Task updated");
}

export async function templateCarerAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const s = slot(fd);
    await setTemplateCarer(ctx, str(fd, "templateId"), int(fd, "version", "Version"), s, str(fd, "staffId") || null);
  }, "Template carer changed. Weeks built from now on use the new carer.");
}

// ── Workforce: absences and availability (HR-controlled) ────────────────────

const impactNote = (r: { flagged: number }) => (r.flagged ? ` ${r.flagged} booked visit${r.flagged === 1 ? " is" : "s are"} now flagged for the rota team to review.` : "");

export async function recordAbsenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await recordAbsence(ctx, { staffId: str(fd, "staffId"), kind: str(fd, "kind"), from: str(fd, "from"), to: str(fd, "to") || str(fd, "from"), startTime: str(fd, "startTime") || undefined, endTime: str(fd, "endTime") || undefined, reason: str(fd, "reason") });
    return { ok: `${r.status === "APPROVED" ? "Sickness recorded." : "Request recorded. Someone else must approve it."}${impactNote(r.impact)}` };
  }, "Recorded");
}

export async function decideAbsenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const d = str(fd, "decision") === "APPROVED" ? "APPROVED" : "DECLINED";
    const r = await decideAbsence(ctx, str(fd, "absenceId"), int(fd, "version", "Version"), d, str(fd, "note"));
    return { ok: `${d === "APPROVED" ? "Approved." : "Declined."}${impactNote(r)}` };
  }, "Decided");
}

export async function cancelStaffAbsenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await cancelStaffAbsence(ctx, str(fd, "absenceId"), str(fd, "reason"));
  }, "Absence cancelled. Visits flagged for it have been re-checked.");
}

export async function addAvailabilityAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await addAvailability(ctx, { staffId: str(fd, "staffId"), weekdays: fd.getAll("weekdays").map(Number), start: str(fd, "start"), end: str(fd, "end"), kind: str(fd, "kind"), from: str(fd, "from"), to: str(fd, "to") || undefined, note: str(fd, "note") });
    return { ok: `Working pattern saved.${impactNote(r)}` };
  }, "Saved");
}

export async function endAvailabilityAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await endAvailability(ctx, str(fd, "id"));
  }, "Pattern line ended");
}

export async function acknowledgeMyVisitsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const n = await acknowledgeMyVisits(ctx);
    return { ok: n ? `Thanks. ${n} visit${n === 1 ? "" : "s"} marked as seen.` : "You had already seen all your visits." };
  }, "Done");
}

export async function clockMineAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const kind = str(fd, "kind") === "OUT" ? "OUT" : "IN";
    const r = await clockMine(ctx, str(fd, "visitId"), kind, { nonce: str(fd, "nonce"), note: str(fd, "note") });
    return { ok: kind === "IN" ? "Clocked in" : r.status === "COMPLETED" ? "Clocked out. Visit complete." : "Clocked out" };
  }, "Recorded");
}

export async function notDeliveredMineAction(fd: FormData) {
  return handle(fd, (ctx) => notDeliveredMine(ctx, str(fd, "visitId"), str(fd, "reason")), "The office has been told");
}

export async function officeClockAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await officeClock(ctx, str(fd, "visitId"), Object.fromEntries(fd));
    return { ok: r.short ? "Clock time recorded. The visit was shorter than planned and has been flagged." : "Clock time recorded" };
  }, "Clock time recorded");
}

export async function sweepNowAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await sweepNow(ctx);
    return { ok: `Checked ${r.processed} visit${r.processed === 1 ? "" : "s"}. ${r.alertsRaised} new alert${r.alertsRaised === 1 ? "" : "s"}.` };
  }, "Checked");
}

// ── Care plans, risk assessments and incidents ──

export async function startDraftAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await startDraft(ctx, str(fd, "serviceUserId"));
    return { to: `/rota/care-plans/${str(fd, "serviceUserId")}?edit=1`, ok: "Draft started from the current plan" };
  }, "Draft started");
}

export async function saveDraftAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const sections: Record<string, { body: string; outcomes?: string }> = {};
    for (const [k, v] of fd.entries()) {
      const m = /^section\.(\w+)\.(body|outcomes)$/.exec(k);
      if (m && typeof v === "string") sections[m[1]!] = { ...sections[m[1]!], body: sections[m[1]!]?.body ?? "", [m[2]!]: v };
    }
    await saveDraft(ctx, str(fd, "planId"), { fingerprint: str(fd, "fingerprint"), summary: str(fd, "summary"), reviewDue: str(fd, "reviewDue"), sections });
    if (str(fd, "then") === "submit") {
      await submitPlan(ctx, str(fd, "planId"));
      return { to: str(fd, "done"), ok: "Saved and sent for approval" };
    }
  }, "Draft saved");
}

export async function returnPlanAction(fd: FormData) {
  return handle(fd, (ctx) => returnPlan(ctx, str(fd, "planId"), str(fd, "reason")), "Returned to draft");
}

export async function approvePlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await approvePlan(ctx, str(fd, "planId"));
    return { ok: `Approved and now in use. ${r.notified} carer${r.notified === 1 ? "" : "s"} asked to read it.` };
  }, "Approved");
}

export async function discardDraftAction(fd: FormData) {
  return handle(fd, (ctx) => discardDraft(ctx, str(fd, "planId")), "Draft discarded");
}

export async function acknowledgePlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const created = await acknowledgePlan(ctx, str(fd, "serviceUserId"), str(fd, "planId"));
    return { ok: created ? "Thanks. The office can see you have read it." : "You had already confirmed this version." };
  }, "Recorded");
}

export async function createRiskAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await createRisk(ctx, str(fd, "serviceUserId"), Object.fromEntries(fd));
    return { to: `/rota/risks/${r.id}`, ok: "Risk assessment saved" };
  }, "Saved");
}

export async function reviewRiskAction(fd: FormData) {
  return handle(fd, (ctx) => reviewRisk(ctx, str(fd, "riskId"), int(fd, "version", "Version"), Object.fromEntries(fd)), "Review saved");
}

export async function archiveRiskAction(fd: FormData) {
  return handle(fd, (ctx) => archiveRisk(ctx, str(fd, "riskId"), str(fd, "reason")), "Archived");
}

export async function reportIncidentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const inc = await reportIncident(ctx, Object.fromEntries(fd));
    return { to: `/rota/incidents/${inc.id}`, ok: `Reported as ${inc.reference}` };
  }, "Reported");
}

export async function triageIncidentAction(fd: FormData) {
  return handle(fd, (ctx) => triageIncident(ctx, str(fd, "incidentId"), int(fd, "version", "Version"), { severity: str(fd, "severity"), safeguarding: bool(fd, "safeguarding"), notifiable: bool(fd, "notifiable"), note: str(fd, "note") }), "Incident updated");
}

export async function incidentNoteAction(fd: FormData) {
  return handle(fd, (ctx) => addIncidentNote(ctx, str(fd, "incidentId"), str(fd, "note")), "Note added");
}

export async function closeIncidentAction(fd: FormData) {
  return handle(fd, (ctx) => closeIncident(ctx, str(fd, "incidentId"), int(fd, "version", "Version"), str(fd, "outcome"), bool(fd, "notificationHandled")), "Incident closed");
}

export async function reopenIncidentAction(fd: FormData) {
  return handle(fd, (ctx) => reopenIncident(ctx, str(fd, "incidentId"), int(fd, "version", "Version"), str(fd, "reason")), "Incident reopened");
}

// ── Finance preparation (nothing is paid, submitted or sent) ──

export async function saveFunderAction(fd: FormData) {
  return handle(fd, async (ctx) => { await saveFunder(ctx, str(fd, "funderId") || null, Object.fromEntries(fd)); }, "Funder saved");
}

export async function createRateCardAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const c = await createRateCard(ctx, { kind: str(fd, "kind"), name: str(fd, "name"), effectiveFrom: str(fd, "effectiveFrom") });
    return { to: `/rota/finance/rates?tab=cards&card=${c.id}#card-${c.id}`, ok: "Rate card created. Add its bands." };
  }, "Created");
}

export async function addBandAction(fd: FormData) {
  return handle(fd, (ctx) => addBand(ctx, str(fd, "rateCardId"), { label: str(fd, "label"), weekdays: fd.getAll("weekdays").map(Number), from: str(fd, "from"), to: str(fd, "to"), bankHoliday: bool(fd, "bankHoliday"), rate: str(fd, "rate"), unit: str(fd, "unit"), minimumMinutes: str(fd, "minimumMinutes") }), "Band added");
}

export async function removeBandAction(fd: FormData) {
  return handle(fd, (ctx) => removeBand(ctx, str(fd, "bandId")), "Band removed");
}

export async function addBankHolidayAction(fd: FormData) {
  return handle(fd, (ctx) => addBankHoliday(ctx, str(fd, "date"), str(fd, "name")), "Bank holiday added");
}

export async function removeBankHolidayAction(fd: FormData) {
  return handle(fd, (ctx) => removeBankHoliday(ctx, str(fd, "holidayId")), "Bank holiday removed");
}

export async function financeSettingsAction(fd: FormData) {
  return handle(fd, (ctx) => updateFinanceSettings(ctx, Object.fromEntries(fd)), "Settings saved");
}

export async function packageFunderAction(fd: FormData) {
  return handle(fd, (ctx) => setPackageFunder(ctx, str(fd, "packageId"), str(fd, "funderId") || null), "Funder set");
}

export async function staffPayCardAction(fd: FormData) {
  return handle(fd, (ctx) => setStaffPayCard(ctx, str(fd, "staffId"), str(fd, "rateCardId"), str(fd, "from")), "Pay rate set");
}

export async function generateTimesheetsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await generateTimesheets(ctx, str(fd, "week"));
    return { ok: `${r.created} timesheets prepared, ${r.refreshed} drafts refreshed${r.skipped ? `, ${r.skipped} left alone (already submitted or approved)` : ""}.` };
  }, "Prepared");
}

export async function bulkTimesheetsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const kind = str(fd, "kind") === "approve" ? "approve" : "submit";
    const r = await bulkTimesheets(ctx, str(fd, "week"), kind);
    const why = [...new Set(r.refused)].join(" ");
    return { ok: `${r.done} timesheet${r.done === 1 ? "" : "s"} ${kind === "approve" ? "approved" : "submitted"}.${r.refused.length ? ` ${r.refused.length} not changed: ${why}` : ""}` };
  }, "Done");
}

export async function adjustLineAction(fd: FormData) {
  return handle(fd, (ctx) => adjustLine(ctx, str(fd, "timesheetId"), int(fd, "version", "Version"), str(fd, "lineId"), int(fd, "minutes", "Payable minutes"), str(fd, "reason")), "Line adjusted");
}

export async function submitTimesheetAction(fd: FormData) {
  return handle(fd, (ctx) => submitTimesheet(ctx, str(fd, "timesheetId"), int(fd, "version", "Version")), "Submitted for approval");
}

export async function decideTimesheetAction(fd: FormData) {
  return handle(fd, (ctx) => decideTimesheet(ctx, str(fd, "timesheetId"), int(fd, "version", "Version"), str(fd, "decision") === "REJECTED" ? "REJECTED" : "APPROVED", str(fd, "note")), "Decision recorded");
}

export async function prepareRunAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const kind = str(fd, "kind") === "invoice" ? "invoice" : "pay";
    const run = kind === "pay" ? await preparePayRun(ctx, str(fd, "week")) : await prepareInvoiceRun(ctx, str(fd, "week"));
    return { to: `/rota/finance/${kind === "pay" ? "payroll" : "invoices"}/${run.id}`, ok: "Draft prepared. Check the exceptions before asking for approval." };
  }, "Prepared");
}

export async function approveRunAction(fd: FormData) {
  return handle(fd, (ctx) => approveRun(ctx, str(fd, "kind") === "invoice" ? "invoice" : "pay", str(fd, "runId")), "Approved. Nothing has been paid or sent; export the file when ready.");
}

export async function voidRunAction(fd: FormData) {
  return handle(fd, (ctx) => voidRun(ctx, str(fd, "kind") === "invoice" ? "invoice" : "pay", str(fd, "runId"), str(fd, "reason")), "Run voided");
}

// ── Exceptions register ───────────────────────────────────────────────────

export async function assignExceptionOwnerAction(fd: FormData) {
  return handle(fd, (ctx) => assignExceptionOwner(ctx, str(fd, "alertId"), str(fd, "ownerId")), "Owner assigned");
}

export async function escalateExceptionAction(fd: FormData) {
  return handle(fd, (ctx) => escalateException(ctx, str(fd, "alertId"), str(fd, "note")), "Escalated to the care managers");
}

export async function resolveExceptionAction(fd: FormData) {
  return handle(fd, (ctx) => resolveException(ctx, str(fd, "alertId"), { resolution: str(fd, "resolution"), evidenceNote: str(fd, "evidenceNote") || undefined }), "Exception resolved");
}

// ── Visit tasks and notes ─────────────────────────────────────────────────

/** Task outcomes arrive as outcome_<taskId> and note_<taskId>; tasks left blank are not recorded. */
export async function recordTasksMineAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const rows: { visitTaskId: string; outcome: "DONE" | "NOT_DONE" | "REFUSED"; note?: string }[] = [];
    for (const [k, val] of fd.entries()) {
      if (!k.startsWith("outcome_") || typeof val !== "string" || !val) continue;
      if (val !== "DONE" && val !== "NOT_DONE" && val !== "REFUSED") throw new ValidationError("Choose done, not done or refused");
      const id = k.slice("outcome_".length);
      rows.push({ visitTaskId: id, outcome: val, note: str(fd, `note_${id}`) || undefined });
    }
    const r = await recordTaskOutcomes(ctx, str(fd, "visitId"), rows);
    return { ok: `${r.recorded} task${r.recorded === 1 ? "" : "s"} recorded` };
  }, "Tasks recorded");
}

export async function addVisitNoteAction(fd: FormData) {
  const category = str(fd, "category");
  return handle(fd, async (ctx) => {
    await addVisitNote(ctx, str(fd, "visitId"), { text: str(fd, "text"), category: category === "HANDOVER" || category === "CONCERN" ? category : "GENERAL" });
  }, "Note added");
}

// ── Care packages ─────────────────────────────────────────────────────────

function packageInput(fd: FormData): PackageInput {
  return { reference: str(fd, "reference"), commissionedMinutesPerWeek: str(fd, "hoursPerWeek") ? Math.round(Number(str(fd, "hoursPerWeek")) * 60) : null, startDate: str(fd, "startDate"), endDate: str(fd, "endDate") || undefined, requirements: str(fd, "requirements"), funderId: fd.has("funderId") ? str(fd, "funderId") || undefined : undefined };
}

export async function createPackageAction(fd: FormData) {
  return handle(fd, async (ctx) => { await createPackage(ctx, str(fd, "serviceUserId"), packageInput(fd)); }, "Care package recorded");
}

export async function updatePackageAction(fd: FormData) {
  return handle(fd, async (ctx) => { await updatePackage(ctx, str(fd, "packageId"), packageInput(fd)); }, "Care package updated");
}

export async function endPackageAction(fd: FormData) {
  return handle(fd, (ctx) => endPackage(ctx, str(fd, "packageId"), { endDate: str(fd, "endDate"), reason: str(fd, "reason") }), "Care package ended");
}

// ── Attendance verification ───────────────────────────────────────────────

export async function requestClockCorrectionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await requestClockCorrection(ctx, str(fd, "visitId"), { kind: str(fd, "kind") === "OUT" ? "OUT" : "IN", date: str(fd, "date"), time: str(fd, "time"), reason: str(fd, "reason") });
  }, "Request sent to the office");
}

export async function decideClockCorrectionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await decideClockCorrection(ctx, str(fd, "requestId"), str(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED", str(fd, "note"));
  }, "Decision recorded");
}

export async function verifyLinesAction(fd: FormData) {
  const ids = fd.getAll("lineId").filter((x): x is string => typeof x === "string" && !!x);
  return handle(fd, async (ctx) => {
    const n = await verifyLines(ctx, str(fd, "timesheetId"), Number(str(fd, "version")), ids.length ? ids : "exceptions", str(fd, "note"));
    return { ok: `${n} line${n === 1 ? "" : "s"} checked` };
  }, "Lines checked");
}

// ── Run routes ────────────────────────────────────────────────────────────

const routeInput = (fd: FormData): RouteInput => ({ name: str(fd, "name"), kind: str(fd, "kind") === "AREA" ? "AREA" : "CARER", staffId: str(fd, "staffId") || undefined, areaId: str(fd, "areaId") || undefined, weekStart: str(fd, "weekStart") || undefined, colour: str(fd, "colour"), textColour: str(fd, "textColour") });
const routeKind = (fd: FormData) => (str(fd, "kind") === "TEMPLATE" ? "TEMPLATE" : "LIVE");

export async function createLiveRouteAction(fd: FormData) {
  return handle(fd, async (ctx) => `/rota/routes/${(await createLiveRoute(ctx, routeInput(fd))).id}`, "Run route added");
}

export async function createTemplateRouteAction(fd: FormData) {
  return handle(fd, async (ctx) => `/rota/routes/templates/${(await createTemplateRoute(ctx, routeInput(fd))).id}`, "Template run route added");
}

export async function addToRouteAction(fd: FormData) {
  const ids = fd.getAll("ids").filter((x): x is string => typeof x === "string" && !!x);
  return handle(fd, async (ctx) => {
    const n = await addToRoute(ctx, routeKind(fd), str(fd, "routeId"), ids);
    return { ok: `${n} added to the route` };
  }, "Added to the route");
}

export async function removeFromRouteAction(fd: FormData) {
  return handle(fd, (ctx) => removeFromRoute(ctx, routeKind(fd), str(fd, "routeId"), str(fd, "id")), "Taken off the route");
}

export async function moveToRouteAction(fd: FormData) {
  return handle(fd, (ctx) => moveToRoute(ctx, routeKind(fd), str(fd, "routeId"), str(fd, "toRouteId"), str(fd, "id")), "Moved to the other route");
}

export async function moveStopAction(fd: FormData) {
  return handle(fd, (ctx) => moveStop(ctx, routeKind(fd), str(fd, "routeId"), str(fd, "id"), str(fd, "dir") === "up" ? "up" : "down"), "Order changed");
}

export async function orderRouteByTimeAction(fd: FormData) {
  return handle(fd, (ctx) => orderRouteDayByTime(ctx, str(fd, "routeId"), str(fd, "date")), "Stops put in time order");
}

export async function removeRouteAction(fd: FormData) {
  return handle(fd, (ctx) => removeRoute(ctx, routeKind(fd), str(fd, "routeId")), routeKind(fd) === "LIVE" ? "Run route removed" : "Template run route switched off");
}

// ── Mileage ───────────────────────────────────────────────────────────────

export async function submitMileageAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await submitMyMileage(ctx, { date: str(fd, "date"), miles: Number(str(fd, "miles")), visitId: str(fd, "visitId") || undefined, reason: str(fd, "reason") });
  }, "Mileage claim sent");
}

export async function decideMileageAction(fd: FormData) {
  return handle(fd, (ctx) => decideMileage(ctx, str(fd, "claimId"), str(fd, "decision") === "APPROVED" ? "APPROVED" : "REJECTED", str(fd, "note")), "Decision recorded");
}

// ── Missed Calls ──────────────────────────────────────────────────────────

const lock = (fd: FormData) => {
  const n = Number(str(fd, "lockVersion"));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export async function missedAssignAction(fd: FormData) {
  return handle(fd, (ctx) => assignCoordinator(ctx, str(fd, "caseId"), str(fd, "coordinatorId"), lock(fd)), "Coordinator assigned");
}

export async function missedReasonAction(fd: FormData) {
  return handle(fd, (ctx) => recordReason(ctx, str(fd, "caseId"), { reasonCode: str(fd, "reasonCode"), reasonDetail: str(fd, "reasonDetail") || undefined, findings: str(fd, "findings"), lockVersion: lock(fd) }), "Reason recorded");
}

export async function missedReplacementAction(fd: FormData) {
  return handle(fd, (ctx) => recordReplacement(ctx, str(fd, "caseId"), { replacementType: str(fd, "replacementType"), replacementStaffId: str(fd, "replacementStaffId") || undefined, arrivedAt: str(fd, "arrivedAt") || undefined, clientInformed: str(fd, "clientInformed"), note: str(fd, "note") || undefined, acceptWarnings: bool(fd, "acceptWarnings"), lockVersion: lock(fd) }), "Replacement care recorded");
}

export async function missedAddActionAction(fd: FormData) {
  return handle(fd, (ctx) => addFollowUp(ctx, str(fd, "caseId"), { text: str(fd, "text"), ownerId: str(fd, "ownerId"), due: str(fd, "due") }), "Follow-up action added");
}

export async function missedCompleteActionAction(fd: FormData) {
  return handle(fd, (ctx) => completeFollowUp(ctx, str(fd, "actionId")), "Action marked done");
}

export async function missedCommentAction(fd: FormData) {
  return handle(fd, (ctx) => addCaseComment(ctx, str(fd, "caseId"), str(fd, "body")), "Comment added");
}

export async function missedEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to attach");
    await addCaseEvidence(ctx, str(fd, "caseId"), { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, str(fd, "description") || undefined);
  }, "Evidence attached");
}

export async function missedEscalateAction(fd: FormData) {
  return handle(fd, (ctx) => escalateMissedCase(ctx, str(fd, "caseId"), str(fd, "note")), "Escalated to the care managers");
}

export async function missedSubmitAction(fd: FormData) {
  const preventable = str(fd, "preventable");
  return handle(fd, (ctx) => submitForSignOff(ctx, str(fd, "caseId"), { outcome: str(fd, "outcome"), preventable: preventable === "yes" || preventable === "no" ? preventable : ("" as "yes"), outcomeNote: str(fd, "outcomeNote"), lockVersion: lock(fd) }), "Sent to the care managers for sign-off");
}

export async function missedSignOffAction(fd: FormData) {
  const decision = str(fd, "decision") === "return" ? "return" : "approve";
  return handle(fd, (ctx) => signOffMissedCase(ctx, str(fd, "caseId"), { decision, note: str(fd, "note"), lockVersion: lock(fd) }), decision === "approve" ? "Signed off and closed" : "Sent back for more investigation");
}

export async function missedReopenAction(fd: FormData) {
  return handle(fd, (ctx) => reopenMissedCase(ctx, str(fd, "caseId"), str(fd, "reason")), "Case reopened");
}

export async function missedBulkAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const action = str(fd, "bulk");
    if (action !== "assign" && action !== "escalate") throw new ValidationError("Choose a bulk action");
    const r = await bulkMissed(ctx, ids(fd, "ids"), action, { coordinatorId: str(fd, "coordinatorId") || undefined, note: str(fd, "note") || undefined });
    return { ok: `${r.done} ${action === "assign" ? "assigned" : "escalated"}${r.skipped.length ? `, ${r.skipped.length} skipped (${[...new Set(r.skipped)].slice(0, 2).join("; ")})` : ""}` };
  }, "Done");
}

/** Find Cover: books the chosen carer on a linked recovery visit, then opens the panel's result step. */
export async function coverConfirmAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const rank = Number(str(fd, "rank"));
    const source = str(fd, "source") === "MANUAL" ? "MANUAL" : "RECOMMENDED";
    const r = await confirmCover(ctx, str(fd, "caseId"), {
      staffId: str(fd, "staffId"), date: str(fd, "date"), time: str(fd, "time"), source,
      rank: str(fd, "rank") && Number.isInteger(rank) ? rank : undefined,
      suggested: fd.getAll("suggested").filter((v): v is string => typeof v === "string").slice(0, 3),
      acknowledged: fd.getAll("ack").filter((v): v is string => typeof v === "string"),
      warningReason: str(fd, "warningReason") || undefined,
      seenRecoveryId: str(fd, "seenRecoveryId"),
    });
    const to = safeBack(fd.get("done"), "/rota/missed");
    return { to, ok: `Cover booked: ${r.staffName} on ${r.reference}.${r.stillNeeded ? ` ${r.stillNeeded} more carer needed.` : ""}` };
  }, "Cover booked");
}

/** Find Replacement Cover for an existing visit: fills an empty place or replaces the booked carer in one place. */
export async function coverBookAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const mode = str(fd, "mode") === "replace" ? "replace" : "fill";
    const r = await bookCover(ctx, {
      mode, visitId: str(fd, "visitId"), slot: str(fd, "slot"), staffId: str(fd, "staffId"), lockVersion: Number(str(fd, "lockVersion")), expectStaffId: str(fd, "expectStaffId"),
      source: str(fd, "source") === "RECOMMENDED" ? "RECOMMENDED" : "MANUAL", rank: str(fd, "rank") ? Number(str(fd, "rank")) : undefined,
      acknowledged: fd.getAll("ack").filter((v): v is string => typeof v === "string"),
      warningReason: str(fd, "warningReason") || undefined, replaceReason: str(fd, "replaceReason") || undefined,
    });
    const to = safeBack(fd.get("done"), "/rota/visits");
    return { to, ok: r.duplicate ? "This carer is already booked in this place. Nothing was changed." : await bookedText(ctx, r.assignmentId) };
  }, "Cover booked");
}

/** The fields of the communication form, shared by a new entry and a correction. */
function attemptFields(fd: FormData) {
  return {
    visitId: str(fd, "visitId"), caseId: str(fd, "caseId") || undefined, recipient: str(fd, "recipient"), via: str(fd, "via"),
    otherName: str(fd, "otherName"), otherRelationship: str(fd, "otherRelationship"), otherAddress: str(fd, "otherAddress"),
    method: str(fd, "method"), outcome: str(fd, "outcome"), notApplicableReason: str(fd, "notApplicableReason"), notes: str(fd, "notes"),
    contactedDate: bool(fd, "earlier") ? str(fd, "contactedDate") : "", contactedTime: bool(fd, "earlier") ? str(fd, "contactedTime") : "",
    followUp: bool(fd, "followUp"), followUpOwnerId: str(fd, "followUpOwnerId"), followUpDate: str(fd, "followUpDate"), followUpTime: str(fd, "followUpTime"),
    clientToken: str(fd, "clientToken"),
  };
}

/** Records one attempt to contact the service user or their representative. Nothing is sent from the platform. */
export async function coverContactAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await recordContactAttempt(ctx, attemptFields(fd));
    return { to: withParam(safeBack(fd.get("back")), "fcSaved", str(fd, "clientToken")), ok: r.duplicate ? "Already saved: this entry was recorded once." : "Communication saved. Nothing was sent from the platform." };
  }, "Communication saved");
}

export async function coverContactCorrectAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await correctContactAttempt(ctx, str(fd, "attemptId"), { ...attemptFields(fd), reason: str(fd, "reason") });
    return { to: withParam(safeBack(fd.get("back")), "fcSaved", str(fd, "clientToken")), ok: r.duplicate ? "Already saved: this correction was recorded once." : "Correction saved. The original entry is kept." };
  }, "Correction saved");
}

export async function coverFollowUpCloseAction(fd: FormData) {
  return handle(fd, (ctx) => closeContactFollowUp(ctx, str(fd, "attemptId"), str(fd, "note")), "Follow-up closed");
}

export async function coverInformedAction(fd: FormData) {
  return handle(fd, (ctx) => recordServiceUserInformed(ctx, str(fd, "caseId"), { status: str(fd, "status"), note: str(fd, "note") || undefined }), "Saved");
}

// Generate & Optimise. A plan is a draft: nothing on the rota changes until accepted changes are applied.
export async function generatePlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    // "Find Suitable Carers" for the visits ticked on Unassigned Visits: the dates come from those visits.
    const chosen = fd.get("planChosen") === "1" ? fd.getAll("visitIds").filter((x): x is string => typeof x === "string") : [];
    if (fd.get("planChosen") === "1" && !chosen.length) throw new ValidationError("Tick the visits you want carers for");
    const plan = chosen.length
      ? await generatePlan(ctx, { visitIds: chosen, gapMinutes: "10", maxShiftMinutes: "0", respectWeeklyLimits: true })
      : await generatePlan(ctx, { from: str(fd, "from"), days: str(fd, "days"), areaId: str(fd, "areaId"), gapMinutes: str(fd, "gapMinutes"), maxShiftMinutes: str(fd, "maxShiftMinutes"), respectWeeklyLimits: bool(fd, "respectWeeklyLimits") });
    return `/rota/optimise/${plan.id}`;
  }, "Plan generated. Nothing has changed on the rota yet: accept or reject each change, then apply.");
}

export async function decidePlanChangesAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    // A row's own button sends "ACCEPTED|<id>"; the bulk buttons send a decision for the ticked changes.
    const [rowDecision, rowId] = str(fd, "row").split("|");
    const decision = rowId ? rowDecision : str(fd, "decision");
    if (decision !== "ACCEPTED" && decision !== "REJECTED" && decision !== "PENDING") throw new ValidationError("Choose accept or reject");
    const which = str(fd, "which");
    const n = await decideChanges(ctx, str(fd, "planId"), rowId ? [rowId] : which === "ALL" || which === "ALL_CLEAN" ? which : ids(fd, "changeIds"), decision);
    return { ok: `${n} change${n === 1 ? "" : "s"} ${decision === "ACCEPTED" ? "accepted" : decision === "REJECTED" ? "rejected" : "reset"}.` };
  }, "Saved.");
}

export async function applyPlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await applyPlan(ctx, str(fd, "planId"));
    return { ok: `${r.applied} change${r.applied === 1 ? "" : "s"} applied to ${r.visitIds.length} visit${r.visitIds.length === 1 ? "" : "s"}${r.failed ? `; ${r.failed} could not be applied (see each change for why)` : ""}.` };
  }, "Plan applied.");
}

export async function discardPlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await discardPlan(ctx, str(fd, "planId"));
    return "/rota/optimise";
  }, "Plan discarded. The rota was not changed.");
}

export async function publishPlanAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await publishPlanVisits(ctx, str(fd, "planId"));
    return { ok: r.published ? `${r.published} visit${r.published === 1 ? "" : "s"} published to carers.${r.failed ? ` ${r.failed} could not be published.` : ""}` : "Every changed visit was already published." };
  }, "Published.");
}

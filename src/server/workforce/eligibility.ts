import type { AssignmentSlot, ComplianceRule, Prisma, RotaSettings } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, isoWeekday, londonDate, londonMinute, londonTime, mondayOf, londonToUtc } from "@/lib/london";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { isCareRole, rotaSettings } from "@/server/rota/settings";

/**
 * The one eligibility service. Every scheduling path (manual assignment, planner moves, bulk reassignment,
 * rota build, template preferred carers, visit edits) calls it inside its write transaction.
 * A green badge on screen is never a substitute for this check.
 */

export type EligibilityState = "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE";
export interface Reason {
  code: string;
  message: string;
}
export interface ComplianceSummary {
  dbs: string;
  rightToWork: string;
  training: string;
}
export interface EligibilityResult {
  staffId: string;
  state: EligibilityState;
  blocking: Reason[];
  warnings: Reason[];
  compliance: ComplianceSummary;
  restrictions: string[];
}

export interface EligibilityInput {
  staffId: string;
  start: Date;
  end: Date;
  slot?: AssignmentSlot;
  visitId?: string | null;
  serviceUserId?: string | null;
  areaId?: string | null;
  timeLocked?: boolean;
}

type Db = Tx | Prisma.TransactionClient;

const staffInclude = {
  profile: true,
  compliance: true,
  areas: { select: { areaId: true } },
} as const;

/** Loads everything the rules need for a set of staff over a time window, in a handful of indexed queries. */
export async function loadFacts(tx: Db, organisationId: string, staffIds: string[], from: Date, to: Date) {
  const weekFrom = londonToUtc(mondayOf(londonDate(from)), 0);
  const weekTo = londonToUtc(addDays(mondayOf(londonDate(to)), 7), 0);
  const [staff, absences, availability, assignments] = await Promise.all([
    tx.staffMember.findMany({ where: { organisationId, id: { in: staffIds } }, include: staffInclude }),
    tx.staffAbsence.findMany({ where: { organisationId, staffId: { in: staffIds }, status: { in: ["APPROVED", "REQUESTED"] }, startsAt: { lt: to }, endsAt: { gt: from } } }),
    tx.staffAvailability.findMany({ where: { organisationId, staffId: { in: staffIds } } }),
    tx.visitAssignment.findMany({
      where: { organisationId, staffId: { in: staffIds }, blocking: true, startsAt: { lt: weekTo }, endsAt: { gt: weekFrom } },
      select: { id: true, staffId: true, visitId: true, slot: true, startsAt: true, endsAt: true, visit: { select: { reference: true } } },
    }),
  ]);
  return { staff, absences, availability, assignments };
}
export type Facts = Awaited<ReturnType<typeof loadFacts>>;

export interface PreferenceFacts {
  carerGenderPreference: "ANY" | "FEMALE" | "MALE";
  preferences: { staffId: string; rating: number | null; blocked: boolean; reason: string | null }[];
}

export async function loadPreferenceFacts(tx: Db, organisationId: string, serviceUserId: string | null | undefined): Promise<PreferenceFacts | null> {
  if (!serviceUserId) return null;
  const su = await tx.serviceUser.findFirst({ where: { id: serviceUserId, organisationId }, select: { carerGenderPreference: true, carerPreferences: { select: { staffId: true, rating: true, blocked: true, reason: true } } } });
  return su ? { carerGenderPreference: su.carerGenderPreference, preferences: su.carerPreferences } : null;
}

const KIND_LABEL: Record<string, string> = { HOLIDAY: "holiday", SICKNESS: "sickness absence", COMPASSIONATE: "compassionate leave", TRAINING: "training", UNPAID: "unpaid leave", OTHER: "absence" };

function checkGroup(rows: Facts["staff"][number]["compliance"], category: string, onDate: string) {
  const required = rows.filter((c) => c.required && c.category === category);
  const problems: string[] = [];
  for (const c of required) {
    const due = c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null;
    if (!c.hasEvidence) problems.push(`${c.name}: evidence missing`);
    else if (!c.verified) problems.push(`${c.name}: awaiting verification`);
    else if (c.recurring && !due) problems.push(`${c.name}: next review date not recorded`);
    else if (due && due < onDate) problems.push(`${c.name}: review was due ${due}`);
  }
  return { required: required.length, problems };
}

function applyRule(rule: ComplianceRule, msg: Reason, out: { blocking: Reason[]; warnings: Reason[] }) {
  if (rule === "BLOCK") out.blocking.push(msg);
  else if (rule === "REVIEW") out.warnings.push(msg);
}

/** Pure rules. Kept separate from loading so they are unit-tested directly. */
export function evaluate(settings: RotaSettings, facts: Facts, input: EligibilityInput, prefs: PreferenceFacts | null, opts: { otherSlotStaffIds?: string[] } = {}): EligibilityResult {
  const out = { blocking: [] as Reason[], warnings: [] as Reason[] };
  const restrictions: string[] = [];
  const s = facts.staff.find((x) => x.id === input.staffId);
  const none: ComplianceSummary = { dbs: "Unknown", rightToWork: "Unknown", training: "Unknown" };
  if (!s) return { staffId: input.staffId, state: "NOT_ELIGIBLE", blocking: [{ code: "NOT_FOUND", message: "This person is not on your organisation's staff list" }], warnings: [], compliance: none, restrictions };
  const date = londonDate(input.start);

  // 1–4. Employment, role, rota participation.
  if (s.hrMissing) out.blocking.push({ code: "HR_MISSING", message: "The HR record for this person no longer exists" });
  if (s.employmentStatus === "ARCHIVED") out.blocking.push({ code: "ARCHIVED", message: "Archived in HR & Workforce" });
  if (s.employmentStatus === "ONBOARDING" && input.slot !== "SHADOW") out.blocking.push({ code: "ONBOARDING", message: "Still onboarding: can only shadow another carer" });
  if (s.startDate && s.startDate.toISOString().slice(0, 10) > date) out.blocking.push({ code: "NOT_STARTED", message: `Starts on ${s.startDate.toISOString().slice(0, 10)}` });
  if (s.leavingDate && s.leavingDate.toISOString().slice(0, 10) < date) out.blocking.push({ code: "LEFT", message: `Left on ${s.leavingDate.toISOString().slice(0, 10)}` });
  const careRole = isCareRole(settings, s.jobTitle);
  if (!careRole) out.blocking.push({ code: "NOT_CARE_ROLE", message: `${s.jobTitle} is not a care role` });
  const rotaEnabled = s.profile?.rotaEnabled ?? careRole;
  if (careRole && !rotaEnabled) out.blocking.push({ code: "ROTA_OFF", message: "Rota participation is switched off" });

  // 5–7. HR compliance, judged for the date of the visit. Missing evidence is never treated as valid.
  const dbs = checkGroup(s.compliance, "DBS", date);
  const rtw = checkGroup(s.compliance, "Right to work", date);
  const training = checkGroup(s.compliance, "Training", date);
  if (!dbs.required) applyRule(settings.dbsRule, { code: "DBS_NONE", message: "No DBS check is recorded in HR" }, out);
  for (const p of dbs.problems) applyRule(settings.dbsRule, { code: "DBS", message: p }, out);
  if (!rtw.required) applyRule(settings.rightToWorkRule, { code: "RTW_NONE", message: "No right to work check is recorded in HR" }, out);
  for (const p of rtw.problems) applyRule(settings.rightToWorkRule, { code: "RTW", message: p }, out);
  for (const p of training.problems) applyRule(settings.trainingRule, { code: "TRAINING", message: p }, out);
  const compliance: ComplianceSummary = {
    dbs: !dbs.required ? "Not recorded" : dbs.problems.length ? "Needs attention" : "Up to date",
    rightToWork: !rtw.required ? "Not recorded" : rtw.problems.length ? "Needs attention" : "Up to date",
    training: !training.required ? "None required" : `${training.required - training.problems.length} of ${training.required} up to date`,
  };

  // 8. Absences.
  for (const a of facts.absences.filter((a) => a.staffId === s.id && a.startsAt < input.end && a.endsAt > input.start)) {
    if (a.status === "APPROVED") out.blocking.push({ code: "ABSENCE", message: `On approved ${KIND_LABEL[a.kind]}` });
    else out.warnings.push({ code: "ABSENCE_REQUESTED", message: `Has requested ${KIND_LABEL[a.kind]} for this time` });
  }

  // 9. Working availability (weekly pattern).
  const weekday = isoWeekday(date);
  const startMin = londonMinute(input.start);
  const endMin = startMin + Math.round((input.end.getTime() - input.start.getTime()) / 60000);
  const pattern = facts.availability.filter((a) => a.staffId === s.id && a.effectiveFrom.toISOString().slice(0, 10) <= date && (!a.effectiveTo || a.effectiveTo.toISOString().slice(0, 10) >= date));
  if (pattern.some((a) => a.kind === "UNAVAILABLE" && a.weekday === weekday && a.startMinute < endMin && a.endMinute > startMin)) out.blocking.push({ code: "UNAVAILABLE", message: "Not available at this time (working pattern)" });
  const available = pattern.filter((a) => a.kind === "AVAILABLE");
  if (available.length && !available.some((a) => a.weekday === weekday && a.startMinute <= startMin && a.endMinute >= Math.min(endMin, 1440))) out.warnings.push({ code: "OUTSIDE_AVAILABILITY", message: "Outside their usual working pattern" });

  // 10. Overlapping bookings.
  for (const b of facts.assignments.filter((b) => b.staffId === s.id && b.visitId !== input.visitId && b.startsAt < input.end && b.endsAt > input.start)) {
    out.blocking.push({ code: "OVERLAP", message: `Already booked ${londonTime(b.startsAt)}–${londonTime(b.endsAt)} (${b.visit.reference})` });
  }
  if (s.profile?.maxWeeklyMinutes) {
    const wk = mondayOf(date);
    const booked = facts.assignments
      .filter((b) => b.staffId === s.id && b.visitId !== input.visitId && londonDate(b.startsAt) >= wk && londonDate(b.startsAt) < addDays(wk, 7))
      .reduce((m, b) => m + (b.endsAt.getTime() - b.startsAt.getTime()) / 60000, 0);
    if (booked + (endMin - startMin) > s.profile.maxWeeklyMinutes) out.warnings.push({ code: "MAX_HOURS", message: `Would exceed their ${Math.round(s.profile.maxWeeklyMinutes / 60)} hour weekly limit` });
  }

  // 11. The service user's requirements.
  if (prefs) {
    const p = prefs.preferences.find((x) => x.staffId === s.id);
    if (p?.blocked) out.blocking.push({ code: "BLOCKED_BY_CLIENT", message: `Not to visit this person${p.reason ? `: ${p.reason}` : ""}` });
    if (settings.minPreferenceRating && p?.rating && p.rating < settings.minPreferenceRating) out.blocking.push({ code: "LOW_PREFERENCE", message: `Preference rating ${p.rating} is below the minimum of ${settings.minPreferenceRating}` });
    if (prefs.carerGenderPreference !== "ANY") {
      const g = s.profile?.gender;
      if (!g || g === "UNDISCLOSED" || g === "OTHER") out.warnings.push({ code: "GENDER_UNKNOWN", message: `Prefers a ${prefs.carerGenderPreference.toLowerCase()} carer; this carer's gender is not recorded for rota matching` });
      else if (g !== prefs.carerGenderPreference) out.warnings.push({ code: "GENDER", message: `Prefers a ${prefs.carerGenderPreference.toLowerCase()} carer` });
    }
  }

  // 12. Double-up: one person cannot fill two slots.
  if (opts.otherSlotStaffIds?.includes(s.id)) out.blocking.push({ code: "DOUBLE_UP_SAME", message: "Already in the other slot of this double-up" });

  // 13. Areas.
  if (input.areaId && s.areas.length && !s.areas.some((a) => a.areaId === input.areaId)) out.warnings.push({ code: "AREA", message: "Does not usually work in this area" });

  // 14. Time lock.
  if (input.timeLocked) restrictions.push("The visit time is locked: the carer may change, the time may not");

  const state: EligibilityState = out.blocking.length ? "NOT_ELIGIBLE" : out.warnings.length ? "REQUIRES_REVIEW" : "ELIGIBLE";
  return { staffId: s.id, state, blocking: out.blocking, warnings: out.warnings, compliance, restrictions };
}

/** Eligibility for one person and one time window, for coordinators. */
export async function checkStaffEligibility(ctx: Ctx, input: EligibilityInput, tx: Db = db): Promise<EligibilityResult> {
  const organisationId = requireOrgPermission(ctx, "rota.view");
  const exists = await tx.staffMember.findFirst({ where: { id: input.staffId, organisationId }, select: { id: true } });
  if (!exists) throw new NotFoundError("Staff member");
  return eligibilityFor(tx, organisationId, input);
}

/** Server-internal form used inside write transactions (the caller has already authorised). */
export async function eligibilityFor(tx: Db, organisationId: string, input: EligibilityInput, opts: { otherSlotStaffIds?: string[] } = {}): Promise<EligibilityResult> {
  const [settings, facts, prefs] = await Promise.all([rotaSettings(tx, organisationId), loadFacts(tx, organisationId, [input.staffId], input.start, input.end), loadPreferenceFacts(tx, organisationId, input.serviceUserId)]);
  return evaluate(settings, facts, input, prefs, opts);
}

/** Eligibility of many people for one visit: used to rank carers in pickers. */
export async function rankCarers(tx: Db, organisationId: string, input: Omit<EligibilityInput, "staffId">, staffIds?: string[]) {
  const ids = staffIds ?? (await tx.staffMember.findMany({ where: { organisationId, employmentStatus: { not: "ARCHIVED" }, hrMissing: false }, select: { id: true } })).map((s) => s.id);
  const [settings, facts, prefs] = await Promise.all([rotaSettings(tx, organisationId), loadFacts(tx, organisationId, ids, input.start, input.end), loadPreferenceFacts(tx, organisationId, input.serviceUserId)]);
  const order = { ELIGIBLE: 0, REQUIRES_REVIEW: 1, NOT_ELIGIBLE: 2 };
  return ids
    .map((id) => ({ staff: facts.staff.find((s) => s.id === id), result: evaluate(settings, facts, { ...input, staffId: id }, prefs) }))
    .filter((r) => r.staff)
    .sort((a, b) => order[a.result.state] - order[b.result.state] || a.staff!.displayName.localeCompare(b.staff!.displayName));
}

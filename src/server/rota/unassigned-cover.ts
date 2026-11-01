import type { AssignmentSlot } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";
import { READINESS_LABEL } from "@/server/readiness";
import { eligibilityFor, type EligibilityResult } from "@/server/workforce/eligibility";
import { visitCandidates, type Candidate } from "./queries";
import { rotaScope } from "./scope";
import { getVisit } from "./visits";

/**
 * Find Cover for an upcoming visit with an empty carer place. Both tabs come from one ranked list (visitCandidates →
 * the shared eligibility service): Recommended shows the top three people the rules allow; Manual searches the same
 * list by name, so a hand-picked carer is judged by exactly the same checks. Nobody is booked here: Review Assignment
 * runs the eligibility check again and the booking itself goes through assignCarer, which checks a third time inside
 * its locked transaction.
 */

export const RECOMMEND = 3;
const MANUAL_MAX = 40;

export type CheckState = "ok" | "warn" | "fail" | "info";
export interface Check {
  label: string;
  state: CheckState;
  text: string;
}

const GROUPS: { label: string; codes: string[]; ok: (r: EligibilityResult) => string }[] = [
  { label: "Employment and role", codes: ["HR_MISSING", "ARCHIVED", "ONBOARDING", "NOT_STARTED", "LEFT", "NOT_CARE_ROLE", "ROTA_OFF", "NOT_FOUND"], ok: () => "Employed in a care role and on the rota" },
  { label: "DBS", codes: ["DBS", "DBS_NONE"], ok: (r) => `Recorded in HR: ${r.compliance.dbs.toLowerCase()}` },
  { label: "Right to work", codes: ["RTW", "RTW_NONE"], ok: (r) => `Recorded in HR: ${r.compliance.rightToWork.toLowerCase()}` },
  { label: "Mandatory training", codes: ["TRAINING"], ok: (r) => `Training: ${r.compliance.training.toLowerCase()}` },
  { label: "Staff readiness and competencies", codes: ["READINESS", "READINESS_PENDING", "READINESS_RESTRICTED", "READINESS_REVIEW", "RESTRICTION"], ok: (r) => (r.readiness ? READINESS_LABEL[r.readiness.status] : "No readiness record to check") },
  { label: "Absence and availability", codes: ["ABSENCE", "ABSENCE_REQUESTED", "UNAVAILABLE", "OUTSIDE_AVAILABILITY"], ok: () => "No absence recorded; within their working pattern" },
  { label: "Existing bookings", codes: ["OVERLAP", "DOUBLE_UP_SAME"], ok: () => "No overlapping booking" },
  { label: "Weekly hours", codes: ["MAX_HOURS"], ok: () => "Within their weekly limit (or no limit set)" },
  { label: "Service user preferences", codes: ["BLOCKED_BY_CLIENT", "LOW_PREFERENCE", "GENDER", "GENDER_UNKNOWN"], ok: () => "No recorded preference against this carer" },
  { label: "Area", codes: ["AREA"], ok: () => "Works in this area (or has no area set)" },
];

/** The eligibility result as labelled checks. A check is only shown as passed when the service judged it. */
export function assignmentChecks(r: EligibilityResult): Check[] {
  const out: Check[] = GROUPS.map((g) => {
    const block = r.blocking.filter((b) => g.codes.includes(b.code));
    const warn = r.warnings.filter((w) => g.codes.includes(w.code));
    if (block.length) return { label: g.label, state: "fail" as const, text: block.map((b) => b.message).join("; ") };
    if (warn.length) return { label: g.label, state: "warn" as const, text: warn.map((w) => w.message).join("; ") };
    return { label: g.label, state: "ok" as const, text: g.ok(r) };
  });
  // Anything the groups above do not name is still shown, never dropped.
  const known = new Set(GROUPS.flatMap((g) => g.codes));
  for (const x of r.blocking.filter((b) => !known.has(b.code))) out.push({ label: "Other check", state: "fail", text: x.message });
  for (const x of r.warnings.filter((w) => !known.has(w.code))) out.push({ label: "Other check", state: "warn", text: x.message });
  for (const a of r.advice) out.push({ label: "Time between bookings", state: "info", text: `${a.message} (a time gap, not a journey time)` });
  for (const x of r.restrictions) out.push({ label: "Visit", state: "info", text: x });
  return out;
}

/** The plain one-line reason shown under a recommended carer, from the score's own explanation. */
export function headline(c: Candidate) {
  if (c.continuity) return `Previously supported this service user (${c.continuity} time${c.continuity === 1 ? "" : "s"} in 8 weeks)`;
  if (c.explain.some((e) => e.text === "works in this area")) return "Available and works in this area";
  if (c.state === "REQUIRES_REVIEW") return `Allowed with warnings: ${c.reasons[0] ?? "check first"}`;
  return "Available and passes every check";
}

export async function coverOptions(ctx: Ctx, visitId: string, opts: { slot?: string; q?: string; pick?: string } = {}) {
  const scope = await rotaScope(ctx, "rota.edit");
  let v: Awaited<ReturnType<typeof getVisit>>;
  try {
    v = await getVisit(ctx, visitId);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
  const live = v.assignments.filter((a) => !a.removedAt && a.slot !== "SHADOW");
  const required = Math.min(2, v.carersRequired);
  const openSlots = (["PRIMARY", "SECOND"] as AssignmentSlot[]).slice(0, required).filter((s) => !live.some((a) => a.slot === s));
  const assignable = ["SCHEDULED", "MISSED"].includes(v.status) && v.scheduledEnd > new Date();
  const slot = openSlots.find((s) => s === opts.slot) ?? openSlots[0] ?? null;
  const base = { visit: v, live, openSlots, slot, assignable, careTasks: v.tasks.map((t) => t.name) };
  if (!assignable || !slot) return { ...base, list: [] as Candidate[], recommended: [] as Candidate[], manual: [] as Candidate[], areas: new Map<string, string[]>(), pick: null };

  const list = await visitCandidates(ctx, v, slot);
  const recommended = list.filter((c) => c.score !== null).slice(0, RECOMMEND);
  const q = opts.q?.trim().toLowerCase().slice(0, 60);
  const manual = (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list).slice(0, MANUAL_MAX);
  const shownIds = [...new Set([...recommended, ...manual].map((c) => c.id))];
  const areaRows = await db.staffArea.findMany({ where: { organisationId: scope.organisationId, staffId: { in: shownIds } }, select: { staffId: true, area: { select: { name: true } } } });
  const areas = new Map<string, string[]>();
  for (const a of areaRows) areas.set(a.staffId, [...(areas.get(a.staffId) ?? []), a.area.name]);

  let pick: { candidate: Candidate; result: EligibilityResult; checks: Check[] } | null = null;
  const chosen = opts.pick ? list.find((c) => c.id === opts.pick) : undefined;
  if (chosen) {
    // A fresh check for the review step, the same call the booking makes inside its transaction.
    const careTaskIds = v.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x);
    const result = await eligibilityFor(db, scope.organisationId, { staffId: chosen.id, start: v.scheduledStart, end: v.scheduledEnd, slot, visitId: v.id, serviceUserId: v.serviceUserId, areaId: v.areaId, timeLocked: v.timeLocked, careTaskIds }, { otherSlotStaffIds: live.filter((a) => a.slot !== slot).map((a) => a.staffId) });
    pick = { candidate: chosen, result, checks: assignmentChecks(result) };
  }
  return { ...base, list, recommended, manual, areas, pick };
}

export type CoverOptions = NonNullable<Awaited<ReturnType<typeof coverOptions>>>;

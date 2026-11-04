import { londonTime } from "@/lib/london";
import { MISSED_REASONS } from "../missed-calls";
import { ANSWER_LABEL, type CarerFacts, type CaseFacts } from "./evidence";

/**
 * The rules-based investigation summary. Deterministic: the same facts always give the same result, and every line
 * comes from a record or a carer's attributed statement. It suggests one of the existing missed-call reason codes only
 * when the evidence supports it, and never states that care was delivered, who was at fault or what a safeguarding
 * outcome is. It is a suggestion: only a coordinator recording the reason makes it the case's reason.
 */

export type Classification =
  | "POSSIBLE_UNASSIGNED"
  | "CONFLICTING"
  | "POSSIBLE_LATE"
  | "POSSIBLE_NOT_CLOCKED"
  | "POSSIBLE_NON_ATTENDANCE"
  | "POSSIBLE_ACCESS"
  | "POSSIBLE_CANCELLED"
  | "POSSIBLE_SYSTEM"
  | "POSSIBLE_ROTA_ERROR"
  | "CARER_OTHER"
  | "AWAITING_CARER"
  | "UNRESOLVED";

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  POSSIBLE_UNASSIGNED: "Possible unassigned visit",
  CONFLICTING: "Conflicting evidence: manual investigation required",
  POSSIBLE_LATE: "Possible late attendance",
  POSSIBLE_NOT_CLOCKED: "Possible visit delivered without clock-in",
  POSSIBLE_NON_ATTENDANCE: "Possible non-attendance",
  POSSIBLE_ACCESS: "Possible access problem",
  POSSIBLE_CANCELLED: "Possible cancellation or refusal, not recorded",
  POSSIBLE_SYSTEM: "Possible phone or system failure",
  POSSIBLE_ROTA_ERROR: "Possible rota error",
  CARER_OTHER: "Carer gave another explanation: manual investigation required",
  AWAITING_CARER: "Waiting for the carer's explanation",
  UNRESOLVED: "Unresolved: attendance not confirmed",
};

export type Support = "SUPPORTED" | "WEAK" | "INSUFFICIENT";
export const SUPPORT_LABEL: Record<Support, string> = { SUPPORTED: "Supported by system records", WEAK: "Requires verification", INSUFFICIENT: "Not enough evidence" };

export interface Suggestion {
  classification: Classification;
  suggestedReason: string | null;
  support: Support;
  urgent: boolean;
  found: string[];
  reported: string[];
  unverified: string[];
  conflicts: string[];
  missing: string[];
  nextActions: string[];
}

const ATTENDED = new Set(["ATTENDED_NO_CLOCK", "ARRIVED_LATE"]);
const DID_NOT = new Set(["UNABLE_TO_ATTEND", "SU_CANCELLED", "ACCESS_PROBLEM"]);
/** A reported arrival more than this far from a recorded clock-in is a conflict. */
const CLOCK_TOLERANCE_MIN = 30;

const t = (s: string | null) => (s ? londonTime(new Date(s)) : "");

function conflictsOf(f: CaseFacts): string[] {
  const out: string[] = [];
  const answered = f.carers.filter((c) => c.response);
  for (const c of answered) {
    const r = c.response!;
    if (DID_NOT.has(r.answer) && c.clockInAt) out.push(`${c.name} reported “${ANSWER_LABEL[r.answer]}”, but a clock-in at ${t(c.clockInAt)} is recorded for them.`);
    if (ATTENDED.has(r.answer) && r.reportedArrival && c.clockInAt && Math.abs(new Date(r.reportedArrival).getTime() - new Date(c.clockInAt).getTime()) > CLOCK_TOLERANCE_MIN * 60000) out.push(`${c.name} reported arriving at ${t(r.reportedArrival)}, but their recorded clock-in is ${t(c.clockInAt)}.`);
    if (ATTENDED.has(r.answer) && r.careDelivered === "NO" && r.answer === "ATTENDED_NO_CLOCK") out.push(`${c.name} reported attending but also that no care was delivered.`);
    if (c.absenceOverlap && ATTENDED.has(r.answer)) out.push(`${c.name} reported attending, but an approved absence covers the visit time.`);
  }
  const kinds = new Set(answered.map((c) => (ATTENDED.has(c.response!.answer) ? "attended" : c.response!.answer)));
  if (answered.length > 1 && kinds.size > 1) out.push(`The carers' explanations differ: ${answered.map((c) => `${c.name}: “${ANSWER_LABEL[c.response!.answer]}”`).join("; ")}.`);
  return out;
}

function foundOf(f: CaseFacts): string[] {
  const out: string[] = [];
  out.push(`The visit was due ${t(f.scheduledStart)}–${t(f.scheduledEnd)} and was marked missed at ${t(f.detectedAt)} with no clock-in.`);
  if (!f.carers.length) out.push("Nobody was booked on the visit when it was missed.");
  else out.push(`Booked when it was missed: ${f.carers.map((c) => c.name).join(", ")}${f.carers.length < f.carersRequired ? ` (${f.carers.length} of ${f.carersRequired} places filled)` : ""}.`);
  for (const c of f.carers) {
    if (c.clockInAt) out.push(`${c.name} has a clock-in at ${t(c.clockInAt)}${c.clockInAfterDetection ? ", recorded after the call was marked missed" : ""}${c.clockOutAt ? ` and a clock-out at ${t(c.clockOutAt)}` : ""}.`);
    if (c.pendingCorrection) out.push(`${c.name} has a clock correction waiting for an office decision.`);
    if (c.approvedCorrection) out.push(`A clock correction for ${c.name} has been approved.`);
    if (c.absenceOverlap) out.push(`${c.name} has an approved absence covering the visit time.`);
    if (!c.stillBooked) out.push(`${c.name} has since been taken off the visit.`);
  }
  if (f.highRisk) out.push("The service user is recorded as high risk.");
  if (f.suAbsenceRecorded) out.push("A service-user absence covering the visit time is on record.");
  if (f.recoveryBooked) out.push("A recovery visit has been booked.");
  return out;
}

function reportedOf(f: CaseFacts): string[] {
  return f.carers.filter((c) => c.response).map((c) => {
    const r = c.response!;
    const bits = [r.reportedArrival ? `arrived ${t(r.reportedArrival)}` : null, r.reportedDeparture ? `left ${t(r.reportedDeparture)}` : null, r.careDelivered ? `care delivered: ${r.careDelivered.toLowerCase()}` : null].filter(Boolean);
    return `${c.name} said: “${ANSWER_LABEL[r.answer] ?? r.answer}”${bits.length ? ` (${bits.join(", ")})` : ""}, at ${t(r.submittedAt)}${c.responseCount > 1 ? `, in the latest of ${c.responseCount} statements` : ""}.`;
  });
}

function missingOf(f: CaseFacts): string[] {
  const out: string[] = [];
  for (const c of f.carers) {
    if (c.confirmation === "NO_LOGIN") out.push(`${c.name} has no linked sign-in, so could not be asked in the app. Contact them by phone.`);
    else if (c.confirmation === "REQUESTED") out.push(`Waiting for ${c.name}'s explanation.`);
    else if (c.confirmation === "NO_RESPONSE") out.push(`${c.name} has not answered by the deadline.`);
    else if (c.confirmation === "NOT_REQUESTED" || c.confirmation === "WITHDRAWN") out.push(`${c.name} has not been asked in the app.`);
    const r = c.response;
    if (r && ATTENDED.has(r.answer) && !c.clockInAt && !c.pendingCorrection && !c.approvedCorrection) out.push(c.stillBooked ? `${c.name} has not asked for a clock correction.` : `${c.name} is no longer on the visit, so a clock correction must be entered by the office.`);
  }
  if (!f.recoveryBooked && !f.replacementRecorded) out.push("No replacement care has been recorded.");
  out.push("Nothing in the system confirms the care was delivered: this needs checking with the carer, the service user or their representative.");
  return out;
}

/** The reason code a carer's answer points to, where the existing list has one. */
function codeFor(c: CarerFacts): { classification: Classification; code: string | null } {
  const r = c.response!;
  switch (r.answer) {
    case "ATTENDED_NO_CLOCK": return { classification: "POSSIBLE_NOT_CLOCKED", code: "NOT_CLOCKED" };
    case "ARRIVED_LATE": return { classification: "POSSIBLE_LATE", code: "CARER_LATE" };
    case "UNABLE_TO_ATTEND": return { classification: "POSSIBLE_NON_ATTENDANCE", code: r.unableReason === "SICKNESS" ? "CARER_SICKNESS" : r.unableReason === "TRAVEL" ? "CARER_TRAVEL" : "CARER_NO_SHOW" };
    case "ACCESS_PROBLEM": return { classification: "POSSIBLE_ACCESS", code: "ACCESS" };
    case "SU_CANCELLED": return { classification: "POSSIBLE_CANCELLED", code: "CLIENT_CANCELLED" };
    case "PHONE_SYSTEM": return { classification: "POSSIBLE_SYSTEM", code: "SYSTEM" };
    case "ROTA_WRONG": return { classification: "POSSIBLE_ROTA_ERROR", code: "ROTA_ERROR" };
    default: return { classification: "CARER_OTHER", code: null };
  }
}

const NEXT: Record<Classification, string[]> = {
  POSSIBLE_UNASSIGNED: ["Review the rota assignment: no carer was booked.", "Check the service user is safe and arrange cover."],
  CONFLICTING: ["Investigate manually: speak to each carer and compare with the records.", "Refer to the care manager if the accounts cannot be reconciled."],
  POSSIBLE_LATE: ["Compare the reported and recorded times.", "Verify whether the full care was delivered."],
  POSSIBLE_NOT_CLOCKED: ["Verify whether care was delivered, using existing procedures.", "Review the carer's clock-correction request if they make one."],
  POSSIBLE_NON_ATTENDANCE: ["Check cover was arranged for the service user.", "Refer to the care manager."],
  POSSIBLE_ACCESS: ["Contact the service user or their representative using existing procedures.", "Check the access notes and key-safe details."],
  POSSIBLE_CANCELLED: ["Verify the cancellation with the service user or their representative.", "Record the cancellation if it is confirmed."],
  POSSIBLE_SYSTEM: ["Verify whether care was delivered, using existing procedures."],
  POSSIBLE_ROTA_ERROR: ["Review the rota assignment and the carer's published rota."],
  CARER_OTHER: ["Read the carer's explanation and investigate manually."],
  AWAITING_CARER: ["Wait for the carer's explanation, or phone them now if the service user may be at risk."],
  UNRESOLVED: ["Contact the carer by phone.", "Verify whether care was delivered, using existing procedures."],
};

export function suggestReason(f: CaseFacts): Suggestion {
  const found = foundOf(f);
  const reported = reportedOf(f);
  const conflicts = conflictsOf(f);
  const missing = missingOf(f);
  const unverified = f.carers.filter((c) => c.response).map((c) => `${c.name}'s statement has not been checked yet.`);
  const awaiting = f.carers.some((c) => c.confirmation === "REQUESTED");
  let classification: Classification;
  let code: string | null = null;
  let support: Support;

  const answered = f.carers.filter((c) => c.response);
  const lateClock = f.carers.find((c) => c.clockInAt && c.clockInAfterDetection);
  if (!f.carers.length) {
    classification = "POSSIBLE_UNASSIGNED"; code = "UNASSIGNED"; support = "SUPPORTED";
  } else if (conflicts.length) {
    classification = "CONFLICTING"; support = "INSUFFICIENT";
  } else if (lateClock) {
    classification = "POSSIBLE_LATE"; code = "CARER_LATE"; support = "SUPPORTED";
  } else if (answered.length) {
    const first = codeFor(answered[0]!);
    classification = first.classification; code = first.code;
    support = first.code === "CLIENT_CANCELLED" && f.suAbsenceRecorded ? "SUPPORTED" : first.code ? "WEAK" : "INSUFFICIENT";
  } else if (awaiting) {
    classification = "AWAITING_CARER"; support = "INSUFFICIENT";
  } else {
    classification = "UNRESOLVED"; support = "INSUFFICIENT";
  }
  // While another booked carer's answer is outstanding, nothing is better than "requires verification".
  if (awaiting && support === "SUPPORTED" && classification !== "POSSIBLE_UNASSIGNED") support = "WEAK";
  if (code && !(code in MISSED_REASONS)) code = null;

  const urgent = f.highRisk || (classification === "POSSIBLE_NON_ATTENDANCE" && !f.recoveryBooked && !f.replacementRecorded) || (classification === "POSSIBLE_UNASSIGNED" && !f.recoveryBooked);
  const nextActions = [...(urgent ? ["Consider urgent contingency action: follow the escalation procedure now."] : []), ...NEXT[classification]];
  if (!f.reasonRecorded) nextActions.push("Record the reason and findings yourself in step 1; this suggestion is not recorded until you do.");
  return { classification, suggestedReason: code, support, urgent, found, reported, unverified, conflicts, missing, nextActions };
}

import { db } from "@/lib/db";
import { addDays, londonDate, londonToUtc } from "@/lib/london";
import { evaluate, loadFacts, type EligibilityState, type Reason } from "./eligibility";
import { rotaSettings } from "@/server/rota/settings";

/**
 * "Check Staff Readiness": the rota's own eligibility rules applied to one person for an ordinary hour tomorrow, keeping
 * only the reasons that are about the person (employment, HR checks, training, competency, policy sign-off and
 * restrictions). Anything that depends on a particular visit (bookings, availability, the service user's wishes) is left
 * out, because there is no visit. The rota still makes its own decision at the moment of every assignment.
 */
const PERSON_CODES = new Set(["NOT_FOUND", "HR_MISSING", "ARCHIVED", "ONBOARDING", "NOT_STARTED", "LEFT", "NOT_CARE_ROLE", "ROTA_OFF", "DBS_NONE", "DBS", "RTW_NONE", "RTW", "TRAINING", "READINESS", "READINESS_PENDING", "RESTRICTION", "READINESS_REVIEW"]);

export const ELIGIBILITY_WORD: Record<EligibilityState, string> = { ELIGIBLE: "Eligible", REQUIRES_REVIEW: "Needs Review", NOT_ELIGIBLE: "Not Eligible" };

export interface StaffCheck {
  state: EligibilityState;
  label: string;
  blocking: Reason[];
  warnings: Reason[];
  date: string;
}

export async function staffReadinessCheck(organisationId: string, staffId: string, date = addDays(londonDate(), 1)): Promise<StaffCheck> {
  const start = londonToUtc(date, 10 * 60);
  const end = londonToUtc(date, 11 * 60);
  const [settings, facts] = await Promise.all([rotaSettings(db, organisationId), loadFacts(db, organisationId, [staffId], start, end)]);
  const r = evaluate(settings, facts, { staffId, start, end, slot: "PRIMARY" }, null);
  const blocking = r.blocking.filter((x) => PERSON_CODES.has(x.code));
  const warnings = r.warnings.filter((x) => PERSON_CODES.has(x.code));
  const state: EligibilityState = blocking.length ? "NOT_ELIGIBLE" : warnings.length ? "REQUIRES_REVIEW" : "ELIGIBLE";
  return { state, label: ELIGIBILITY_WORD[state], blocking, warnings, date };
}

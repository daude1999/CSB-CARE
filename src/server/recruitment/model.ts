import type { InterviewStatus, RecruitmentStage, RightToWorkStatus } from "@prisma/client";
import { addDays } from "@/lib/london";

/**
 * Recruitment vocabulary and the pure rules behind it (stage moves, next actions, reminders, retention). No database
 * access here, so every rule is unit-tested directly.
 */

export const OPEN_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING", "READY"] as const satisfies readonly RecruitmentStage[];
export const PIPELINE: RecruitmentStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING", "READY"];
export const CLOSED_STAGES: RecruitmentStage[] = ["WITHDRAWN", "UNSUCCESSFUL"];

export const STAGE_LABEL: Record<RecruitmentStage, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  ONBOARDING: "Onboarding",
  READY: "Ready for Work",
  WITHDRAWN: "Withdrawn",
  UNSUCCESSFUL: "Unsuccessful",
};

export const RTW_LABEL: Record<RightToWorkStatus, string> = {
  NOT_CHECKED: "Not checked yet",
  IN_PROGRESS: "Check in progress",
  VERIFIED: "Seen and verified",
  NOT_ELIGIBLE: "No right to work",
};

export const DRIVING_LABEL: Record<string, string> = {
  DRIVER_WITH_CAR: "Drives, has a car",
  DRIVER_NO_CAR: "Drives, no car",
  NON_DRIVER: "Does not drive",
  NOT_ASKED: "Not asked",
};

export const INTERVIEW_LABEL: Record<InterviewStatus, string> = {
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  DECLINED: "Candidate declined",
  COMPLETED: "Held",
  CANCELLED: "Cancelled",
  NO_SHOW: "Did not attend",
};

export const CHANNEL_LABEL: Record<string, string> = { PHONE: "By phone", IN_PERSON: "In person", PAPER: "On a paper form" };

/** The standard screening questions. Job-related only: nothing about health, age, family or other protected characteristics. */
export const SCREENING_QUESTIONS = [
  { key: "experience", question: "What paid or unpaid care experience do you have?" },
  { key: "availability", question: "Which days and times can you work, including weekends?" },
  { key: "travel", question: "How would you travel between visits in the area?" },
  { key: "start", question: "When could you start, and do you need to give notice?" },
  { key: "why", question: "Why do you want to work in home care?" },
] as const;

/** Documents commonly outstanding during recruitment. Free text is allowed too. */
export const COMMON_DOCUMENTS = ["Proof of identity", "Right to work document", "Two references", "DBS application", "Proof of address", "Driving licence and insurance", "Signed contract"];

/** Stages a recruiter may move a candidate to by hand. Onboarding and Ready for Work have their own authorised steps. */
export function manualMoves(stage: RecruitmentStage): RecruitmentStage[] {
  switch (stage) {
    case "APPLIED":
      return ["SCREENING", "INTERVIEW"];
    case "SCREENING":
      return ["APPLIED", "INTERVIEW"];
    case "INTERVIEW":
      return ["SCREENING"];
    default:
      return [];
  }
}

export function isOpen(stage: RecruitmentStage) {
  return !CLOSED_STAGES.includes(stage);
}

/** A candidate can be closed (withdrawn or unsuccessful) before onboarding starts. After that, HR manages the employee. */
export function canClose(stage: RecruitmentStage) {
  return ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"].includes(stage);
}

export function retainUntil(closedOn: string, months: number) {
  const [y, m, d] = closedOn.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}

export interface CandidateFacts {
  stage: RecruitmentStage;
  applicationComplete: boolean;
  rightToWork: RightToWorkStatus;
  outstandingDocuments: string[];
  offerResponse: string | null;
  createdOn: string;
  stageChangedOn: string;
  nextAction: string | null;
  screenings: { sentOn: string; answered: boolean; reviewOutcome: string | null }[];
  interviews: { startsAt: Date; status: InterviewStatus; outcome: string | null }[];
  hrEmployeeId: string | null;
}

/**
 * The one obvious next step for a candidate, worked out from their records. A recruiter's own "next action" wins when
 * it is set; this is what the list shows when it is not.
 */
export function suggestedNextAction(c: CandidateFacts, now: Date): string {
  if (c.nextAction) return c.nextAction;
  const upcoming = c.interviews.filter((i) => i.startsAt > now && ["AWAITING_CONFIRMATION", "CONFIRMED"].includes(i.status));
  switch (c.stage) {
    case "APPLIED":
      return c.applicationComplete ? "Review the application" : "Ask for the missing application details";
    case "SCREENING": {
      const s = c.screenings[0];
      if (!s) return "Ask the screening questions";
      if (!s.answered) return "Record the screening answers";
      if (!s.reviewOutcome) return "Review the screening answers";
      return s.reviewOutcome === "PROCEED" ? "Book an interview" : "Decide whether to continue";
    }
    case "INTERVIEW": {
      if (upcoming.some((i) => i.status === "AWAITING_CONFIRMATION")) return "Confirm the interview with the candidate";
      if (upcoming.length) return "Hold the interview";
      const held = c.interviews.find((i) => i.status === "COMPLETED");
      if (held && !held.outcome) return "Record the interview outcome";
      if (held?.outcome === "PASSED") return "Make an offer";
      if (held?.outcome === "NOT_PASSED") return "Close the application";
      return "Book an interview";
    }
    case "OFFER":
      if (c.offerResponse === "ACCEPTED") return "Start onboarding";
      if (c.offerResponse === "DECLINED") return "Close the application";
      return "Wait for the candidate's answer";
    case "ONBOARDING":
      return c.outstandingDocuments.length ? "Collect outstanding documents" : "Finish onboarding checks in HR";
    case "READY":
      return "Nothing to do: the rota checks readiness itself";
    default:
      return "Closed";
  }
}

export interface ReminderSettings {
  remindersOn: boolean;
  incompleteAfterDays: number;
  screeningAfterDays: number;
  interviewConfirmHours: number;
  referencesAfterDays: number;
  onboardingDocsAfterDays: number;
  trainingAfterDays: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = { remindersOn: true, incompleteAfterDays: 3, screeningAfterDays: 3, interviewConfirmHours: 48, referencesAfterDays: 7, onboardingDocsAfterDays: 5, trainingAfterDays: 7 };

export type ReminderKind = "INCOMPLETE" | "SCREENING" | "INTERVIEW_CONFIRM" | "REFERENCES" | "ONBOARDING_DOCS" | "TRAINING";
export const REMINDER_LABEL: Record<ReminderKind, string> = {
  INCOMPLETE: "Application incomplete",
  SCREENING: "Screening answers outstanding",
  INTERVIEW_CONFIRM: "Interview not confirmed",
  REFERENCES: "References outstanding",
  ONBOARDING_DOCS: "Onboarding documents missing",
  TRAINING: "Training not complete",
};

export interface Reminder {
  kind: ReminderKind;
  text: string;
  /** Stable for one occurrence, so the same reminder is never raised twice. */
  key: string;
}

/**
 * Reminders due for one candidate today, from the organisation's settings. These are prompts for the recruiter inside
 * the platform; nothing is ever sent to a candidate. `training` is the number of required training items the linked
 * employee still has missing, when onboarding has started.
 */
export function remindersFor(c: CandidateFacts & { id: string; trainingMissing: number; onboardingDocsMissing: number }, s: ReminderSettings, today: string, now: Date): Reminder[] {
  if (!s.remindersOn || !isOpen(c.stage)) return [];
  const out: Reminder[] = [];
  const olderThan = (on: string, days: number) => on <= addDays(today, -days);
  if (c.stage === "APPLIED" && !c.applicationComplete && olderThan(c.createdOn, s.incompleteAfterDays)) out.push({ kind: "INCOMPLETE", text: `Application still incomplete after ${s.incompleteAfterDays} days`, key: `inc:${c.id}` });
  const sc = c.screenings[0];
  if (c.stage === "SCREENING" && sc && !sc.answered && olderThan(sc.sentOn, s.screeningAfterDays)) out.push({ kind: "SCREENING", text: `Screening answers not recorded ${s.screeningAfterDays}+ days after the questions were given`, key: `scr:${c.id}:${sc.sentOn}` });
  for (const i of c.interviews) {
    const hours = (i.startsAt.getTime() - now.getTime()) / 3_600_000;
    if (i.status === "AWAITING_CONFIRMATION" && hours > 0 && hours <= s.interviewConfirmHours) out.push({ kind: "INTERVIEW_CONFIRM", text: `Interview in ${Math.max(1, Math.round(hours))} hours is not confirmed`, key: `int:${c.id}:${i.startsAt.toISOString()}` });
  }
  const refs = c.outstandingDocuments.find((d) => /reference/i.test(d));
  if (refs && ["OFFER", "ONBOARDING"].includes(c.stage) && olderThan(c.stageChangedOn, s.referencesAfterDays)) out.push({ kind: "REFERENCES", text: `${refs} still outstanding`, key: `ref:${c.id}:${c.stageChangedOn}` });
  if (c.stage === "ONBOARDING" && c.onboardingDocsMissing > 0 && olderThan(c.stageChangedOn, s.onboardingDocsAfterDays)) out.push({ kind: "ONBOARDING_DOCS", text: `${c.onboardingDocsMissing} HR check${c.onboardingDocsMissing === 1 ? "" : "s"} still without evidence`, key: `docs:${c.id}:${c.stageChangedOn}` });
  if (c.stage === "ONBOARDING" && c.trainingMissing > 0 && olderThan(c.stageChangedOn, s.trainingAfterDays)) out.push({ kind: "TRAINING", text: `${c.trainingMissing} required training item${c.trainingMissing === 1 ? "" : "s"} not complete`, key: `trn:${c.id}:${c.stageChangedOn}` });
  return out;
}

/** "Ready for Work" in recruitment is a record of HR's decision; it never makes anyone eligible for visits. */
export function readyBlockers(e: { employeeStatus: string | null; outstandingDocuments: string[]; rightToWork: RightToWorkStatus }): string[] {
  const out: string[] = [];
  if (!e.employeeStatus) out.push("The HR employee record is missing");
  else if (e.employeeStatus !== "Active") out.push(`The employee is "${e.employeeStatus === "Onboarding" ? "New starter" : e.employeeStatus}" in HR; HR must set them to Active first`);
  if (e.rightToWork !== "VERIFIED") out.push("Right to work has not been seen and verified");
  if (e.outstandingDocuments.length) out.push(`Outstanding: ${e.outstandingDocuments.join(", ")}`);
  return out;
}

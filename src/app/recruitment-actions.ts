"use server";

import type { RecruitmentStage } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { handle, str } from "./action-kit";
import { addNote, closeCandidate, createCandidate, eraseCandidate, giveScreening, makeOffer, moveStage, recordOfferResponse, recordScreeningAnswers, reopenCandidate, reviewScreening, saveRecruitmentSettings, scheduleInterview, updateCandidate, updateInterview } from "@/server/recruitment/candidates";
import { markReady, startOnboarding } from "@/server/recruitment/onboarding";
import { SCREENING_QUESTIONS } from "@/server/recruitment/model";

/** Server actions for HR & Workforce → Recruitment. Each reads FormData, calls one domain function and redirects back. */

const on = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
function lock(fd: FormData) {
  const n = Number(str(fd, "lockVersion"));
  if (!Number.isInteger(n)) throw new ValidationError("Reload the page and try again");
  return n;
}

function candidateFields(fd: FormData) {
  const docs = str(fd, "outstandingDocuments")
    .split(/\n|,/)
    .map((d) => d.trim())
    .filter(Boolean);
  return {
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    roleApplied: str(fd, "roleApplied"),
    branchId: str(fd, "branchId"),
    availability: str(fd, "availability"),
    experience: str(fd, "experience"),
    driving: str(fd, "driving") || "NOT_ASKED",
    rightToWork: str(fd, "rightToWork") || "NOT_CHECKED",
    source: str(fd, "source"),
    applicationComplete: !on(fd, "incomplete"),
    outstandingDocuments: [...new Set([...fd.getAll("docs").filter((x): x is string => typeof x === "string"), ...docs])],
    recruiterId: str(fd, "recruiterId"),
    nextAction: str(fd, "nextAction"),
    nextActionDue: str(fd, "nextActionDue"),
    contactConsent: on(fd, "contactConsent"),
  };
}

export async function createCandidateAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const c = await createCandidate(ctx, candidateFields(fd));
    return `/hr/recruitment/${c.id}`;
  }, "Candidate added.");
}

export async function updateCandidateAction(fd: FormData) {
  return handle(fd, (ctx) => updateCandidate(ctx, str(fd, "candidateId"), lock(fd), candidateFields(fd)), "Candidate details saved.");
}

export async function candidateNoteAction(fd: FormData) {
  return handle(fd, (ctx) => addNote(ctx, str(fd, "candidateId"), str(fd, "note")), "Note added.");
}

export async function moveStageAction(fd: FormData) {
  return handle(fd, (ctx) => moveStage(ctx, str(fd, "candidateId"), lock(fd), str(fd, "to") as RecruitmentStage), "Stage changed.");
}

export async function closeCandidateAction(fd: FormData) {
  return handle(fd, (ctx) => closeCandidate(ctx, str(fd, "candidateId"), lock(fd), { outcome: str(fd, "outcome") as "WITHDRAWN", reason: str(fd, "reason") }), "Application closed. It is kept until its retention date.");
}

export async function reopenCandidateAction(fd: FormData) {
  return handle(fd, (ctx) => reopenCandidate(ctx, str(fd, "candidateId"), lock(fd)), "Application reopened.");
}

export async function eraseCandidateAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    if (str(fd, "confirm") !== "REMOVE") throw new ValidationError('Type REMOVE to confirm');
    await eraseCandidate(ctx, str(fd, "candidateId"));
  }, "Personal details removed. The reference and dates are kept for reporting.");
}

export async function giveScreeningAction(fd: FormData) {
  return handle(fd, (ctx) => giveScreening(ctx, str(fd, "candidateId"), str(fd, "channel")), "Screening questions recorded as given. Record the answers when you have them.");
}

export async function screeningAnswersAction(fd: FormData) {
  return handle(fd, (ctx) => recordScreeningAnswers(ctx, str(fd, "screeningId"), Object.fromEntries(SCREENING_QUESTIONS.map((q) => [q.key, str(fd, `answer.${q.key}`)]))), "Answers recorded.");
}

export async function screeningReviewAction(fd: FormData) {
  return handle(fd, (ctx) => reviewScreening(ctx, str(fd, "screeningId"), str(fd, "outcome"), str(fd, "note")), "Screening decision recorded.");
}

export async function scheduleInterviewAction(fd: FormData) {
  return handle(fd, (ctx) => scheduleInterview(ctx, str(fd, "candidateId"), { date: str(fd, "date"), time: str(fd, "time"), durationMin: Number(str(fd, "durationMin") || 45), location: str(fd, "location"), interviewerId: str(fd, "interviewerId") }), "Interview booked. No invitation is sent: tell the candidate and record their confirmation.");
}

export async function interviewAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const action = str(fd, "action");
    if (action === "outcome") return updateInterview(ctx, str(fd, "interviewId"), { action, outcome: str(fd, "outcome") as "PASSED", notes: str(fd, "notes") });
    if (action === "confirm" || action === "decline" || action === "cancel" || action === "no_show") return updateInterview(ctx, str(fd, "interviewId"), { action });
    throw new ValidationError("Choose what happened");
  }, "Interview updated.");
}

export async function makeOfferAction(fd: FormData) {
  return handle(fd, (ctx) => makeOffer(ctx, str(fd, "candidateId"), lock(fd)), "Offer recorded. Record the candidate's answer when you have it.");
}

export async function offerResponseAction(fd: FormData) {
  return handle(fd, (ctx) => recordOfferResponse(ctx, str(fd, "candidateId"), lock(fd), str(fd, "response")), "Answer recorded.");
}

export async function startOnboardingAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await startOnboarding(ctx, str(fd, "candidateId"), { mode: str(fd, "mode") === "link" ? "link" : "create", staffId: str(fd, "staffId"), start: str(fd, "start"), linkEmployeeId: str(fd, "linkEmployeeId"), lockVersion: lock(fd) });
    return { ok: r.created ? "Onboarding started. The employee is in HR as a New starter with their checks and tasks." : "Onboarding started and linked to the existing HR record." };
  }, "Onboarding started.");
}

export async function markReadyAction(fd: FormData) {
  return handle(fd, (ctx) => markReady(ctx, str(fd, "candidateId"), lock(fd)), "Recorded as Ready for Work. The rota still checks readiness at every booking.");
}

export async function recruitmentSettingsAction(fd: FormData) {
  return handle(fd, (ctx) =>
    saveRecruitmentSettings(ctx, {
      remindersOn: on(fd, "remindersOn"),
      incompleteAfterDays: str(fd, "incompleteAfterDays"),
      screeningAfterDays: str(fd, "screeningAfterDays"),
      interviewConfirmHours: str(fd, "interviewConfirmHours"),
      referencesAfterDays: str(fd, "referencesAfterDays"),
      onboardingDocsAfterDays: str(fd, "onboardingDocsAfterDays"),
      trainingAfterDays: str(fd, "trainingAfterDays"),
      retentionMonths: str(fd, "retentionMonths"),
    }), "Recruitment settings saved.");
}

"use server";

import { handle, str } from "./action-kit";
import { setMissedAutomation } from "@/server/rota/missed-auto/settings";
import { refreshEvidence } from "@/server/rota/missed-auto/runs";
import { acceptSuggestion, dismissSuggestion } from "@/server/rota/missed-auto/review";
import { submitCarerResponse, type ResponseInput } from "@/server/rota/missed-auto/confirmations";

/** Server actions for the automated missed-call investigation. Each reads FormData, calls one domain function and redirects back. */

const on = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1";
const lock = (fd: FormData) => {
  const n = Number(str(fd, "lockVersion"));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export async function missedAutomationSettingsAction(fd: FormData) {
  return handle(fd, (ctx) => setMissedAutomation(ctx, { evidence: on(fd, "evidence"), confirm: on(fd, "confirm"), summary: on(fd, "summary"), confirmMinutes: Number(str(fd, "confirmMinutes")), reminders: Number(str(fd, "reminders")), reminderMinutes: Number(str(fd, "reminderMinutes")) }), "Missed call automation settings saved");
}

export async function missedRefreshEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await refreshEvidence(ctx, str(fd, "caseId"));
    return { ok: r === "unchanged" ? "Evidence checked: nothing has changed since the last check" : r === "skipped" ? "Evidence was not checked" : "Evidence refreshed" };
  }, "Evidence refreshed");
}

export async function missedAcceptSuggestionAction(fd: FormData) {
  return handle(fd, (ctx) => acceptSuggestion(ctx, str(fd, "caseId"), str(fd, "draftId"), { findings: str(fd, "findings"), lockVersion: lock(fd) }), "Suggested reason accepted and recorded with your findings");
}

export async function missedDismissSuggestionAction(fd: FormData) {
  return handle(fd, (ctx) => dismissSuggestion(ctx, str(fd, "caseId"), str(fd, "draftId"), str(fd, "note")), "Suggestion dismissed");
}

export async function carerMissedResponseAction(fd: FormData) {
  const opt = (k: string) => str(fd, k) || undefined;
  const input: ResponseInput = {
    answer: str(fd, "answer"),
    arrival: opt("arrival"),
    departure: opt("departure"),
    careDelivered: opt("careDelivered"),
    unableReason: opt("unableReason"),
    notifiedSomeone: opt("notifiedSomeone"),
    notifiedWho: opt("notifiedWho"),
    notifiedAt: opt("notifiedAt"),
    attemptedAt: opt("attemptedAt"),
    contacted: opt("contacted"),
    explanation: str(fd, "explanation"),
    submissionKey: str(fd, "submissionKey"),
  };
  return handle(fd, async (ctx) => {
    const r = await submitCarerResponse(ctx, str(fd, "confirmationId"), input);
    return { ok: r.duplicate ? "Your statement was already recorded" : "Thank you. Your statement has been recorded and the office can see it" };
  }, "Statement recorded");
}

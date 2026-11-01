"use server";

import { generateCareSummary, reviewCareSummary, setCareSummaryEnabled, startReviewFromSummary } from "@/server/care/care-summary";
import { handle, str } from "./action-kit";

export async function careSummarySwitchAction(fd: FormData) {
  const on = str(fd, "on") === "1";
  return handle(fd, (ctx) => setCareSummaryEnabled(ctx, on, str(fd, "authorisedBy")), on ? "Care Summary switched on" : "Care Summary switched off");
}

export async function generateCareSummaryAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const row = await generateCareSummary(ctx, str(fd, "serviceUserId"), { from: str(fd, "from"), to: str(fd, "to") });
    const period = ["7", "14", "30"].includes(str(fd, "period")) ? `period=${str(fd, "period")}` : `period=custom&from=${encodeURIComponent(str(fd, "from"))}&to=${encodeURIComponent(str(fd, "to"))}`;
    return { to: `/rota/care-plans/${row.serviceUserId}?view=summary&${period}&summary=${row.id}`, ok: "Care Summary created. It is unapproved until a manager reviews it." };
  }, "Care Summary created");
}

export async function reviewCareSummaryAction(fd: FormData) {
  const outcome = str(fd, "outcome") === "DISMISSED" ? "DISMISSED" : "REVIEWED";
  return handle(fd, (ctx) => reviewCareSummary(ctx, str(fd, "summaryId"), outcome, str(fd, "note")), outcome === "DISMISSED" ? "Care Summary dismissed" : "Care Summary marked as reviewed");
}

export async function startReviewFromSummaryAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const plan = await startReviewFromSummary(ctx, str(fd, "summaryId"));
    return { to: `/rota/care-plans/${plan.serviceUserId}?edit=1`, ok: `Version ${plan.version} started as a draft. Nothing changes for carers until it is approved.` };
  }, "Draft started");
}

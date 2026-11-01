"use server";

import { AppError } from "@/lib/errors";
import { handle, str } from "./action-kit";
import { closeRisk, createRisk, reopenRisk, reviewRisk, updateRisk, type RiskInput } from "@/server/compliance/risks";
import { attachActionEvidence, transitionAction } from "@/server/compliance/audits";
import { uploadEvidence } from "@/server/compliance/evidence";

/**
 * Server actions for the Audits & Improvements workspace: the risk register, evidence linked to records, and an action's
 * own page. Each reads FormData, calls one function in src/server/compliance and redirects back with ?ok= or ?error=.
 */

function riskInput(fd: FormData): RiskInput {
  return {
    title: str(fd, "title"),
    description: str(fd, "description"),
    category: str(fd, "category") as RiskInput["category"],
    branchId: str(fd, "branchId") || undefined,
    likelihood: Number(str(fd, "likelihood")),
    impact: Number(str(fd, "impact")),
    existingControls: str(fd, "existingControls"),
    controlEffectiveness: (str(fd, "controlEffectiveness") || "NOT_ASSESSED") as RiskInput["controlEffectiveness"],
    residualLikelihood: Number(str(fd, "residualLikelihood")),
    residualImpact: Number(str(fd, "residualImpact")),
    ownerId: str(fd, "ownerId"),
    reviewDate: new Date(str(fd, "reviewDate")),
    findingId: str(fd, "findingId") || undefined,
  };
}

/** A file from the form, or null when none was chosen. */
async function fileFrom(fd: FormData, key = "file") {
  const f = fd.get(key);
  if (!(f instanceof File) || f.size === 0) return null;
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

export async function createRiskAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await createRisk(ctx, riskInput(fd));
    return { to: `/compliance/risks/${r.id}`, ok: `Risk ${r.ref} added to the register` };
  }, "Risk added");
}

export async function updateRiskAction(fd: FormData) {
  return handle(fd, async (ctx) => void (await updateRisk(ctx, str(fd, "riskId"), { ...riskInput(fd), reason: str(fd, "reason"), expectedUpdatedAt: str(fd, "updatedAt") || undefined })), "Risk updated; the change is kept in its history");
}

export async function reviewRiskAction(fd: FormData) {
  return handle(fd, (ctx) => reviewRisk(ctx, str(fd, "riskId"), { note: str(fd, "note"), nextReviewDate: new Date(str(fd, "nextReviewDate")), status: (str(fd, "status") || undefined) as "OPEN" | "MONITORING" | undefined }), "Review recorded");
}

export async function closeRiskAction(fd: FormData) {
  return handle(fd, (ctx) => closeRisk(ctx, str(fd, "riskId"), str(fd, "reason")), "Risk closed");
}

export async function reopenRiskAction(fd: FormData) {
  return handle(fd, (ctx) => reopenRisk(ctx, str(fd, "riskId"), str(fd, "reason")), "Risk reopened");
}

/** Uploads evidence linked to one record (policy, audit, question, finding, action or risk), checked on the server. */
export async function uploadLinkedEvidenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const file = await fileFrom(fd);
    if (!file) throw new AppError("Choose a file to upload", "VALIDATION", 422);
    // Either separate linkedType and linkedId fields, or one "TYPE:id" choice from the Evidence Library's list.
    const [type, id] = str(fd, "link") ? str(fd, "link").split(":", 2) : [str(fd, "linkedType"), str(fd, "linkedId")];
    await uploadEvidence(ctx, file, { description: str(fd, "description") || undefined, linkedType: type || undefined, linkedId: id || undefined });
  }, "Evidence uploaded and linked");
}

/**
 * Moves an action on, attaching a newly chosen file first when there is one, so completing an action and providing its
 * evidence is one step. If the file is rejected nothing moves.
 */
export async function progressActionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const actionId = str(fd, "actionId");
    const file = await fileFrom(fd);
    // The file is checked and stored first; if it is rejected, the action does not move.
    const doc = file ? await attachActionEvidence(ctx, actionId, file, str(fd, "description") || undefined) : null;
    const to = str(fd, "to");
    if (!to) {
      if (!doc) throw new AppError("Choose a file to attach, or a step to move the action to", "VALIDATION", 422);
      return { ok: "Evidence attached to the action" };
    }
    await transitionAction(ctx, actionId, to, { note: str(fd, "note") || undefined, evidenceId: doc?.id ?? (str(fd, "evidenceId") || undefined) });
  }, "Action updated");
}

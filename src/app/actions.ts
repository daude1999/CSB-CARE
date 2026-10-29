"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { BUSINESS_FIELDS } from "@/lib/business";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { requireCtx, sessionToken } from "@/server/auth/current";
import { login, logout, SESSION_COOKIE, switchOrganisation } from "@/server/auth/session";
import type { Ctx } from "@/server/auth/rbac";
import { hasOrgPermission, requireOrgPermission, requirePlatformPermission } from "@/server/auth/rbac";
import { triageChange, reviewAssessment } from "@/server/changes/workflow";
import { createManualAssessment } from "@/server/impact/assess";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { acknowledge, addComment, logReadAndSign, confirmImplementation, createManualRevision, createRollbackRevision, decide, editDraftSection, publishRevision, submitForReview } from "@/server/policies/workflow";
import { adoptTemplate, assignPolicyReviewer, createPolicy, setPolicyArchived } from "@/server/policies/library";
import { z } from "zod";
import { requestManualCheck } from "@/server/sources/engine";
import { cancelJob, retryJob } from "@/server/jobs/queue";
import { addFinding, answerQuestion, completeAudit, createAction, startAudit, transitionAction } from "@/server/compliance/audits";
import { uploadEvidence } from "@/server/compliance/evidence";
import { audit } from "@/server/audit-log";
import { AiUnavailableError } from "@/server/ai/provider";
import type { ChangeStatus, Urgency } from "@prisma/client";
import { askAssistant, type AssistantResult } from "@/server/search/assistant";

export type AskState = { question: string; result?: AssistantResult; error?: string };

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

function safeBack(v: FormDataEntryValue | null, fallback = "/") {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}

function withParam(url: string, key: string, value: string) {
  const [path, query = ""] = url.split("?");
  const q = new URLSearchParams(query);
  q.delete("ok");
  q.delete("error");
  q.set(key, value);
  return `${path}?${q}`;
}

async function handle(fd: FormData, fn: (ctx: Ctx) => Promise<string | void>, ok: string) {
  const back = safeBack(fd.get("back"));
  let target: string;
  try {
    const ctx = await requireCtx();
    const next = await fn(ctx);
    target = withParam(next ?? back, "ok", ok);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = e instanceof AppError || e instanceof AiUnavailableError ? e.message : "Something went wrong. The error has been logged.";
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message, stack: (e as Error).stack }, "action failed");
    target = withParam(back, "error", msg);
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// ───────── auth
export async function loginAction(fd: FormData) {
  const h = await headers();
  let target = "/overview";
  try {
    const { token, expiresAt } = await login(str(fd, "email"), str(fd, "password"), { ip: h.get("x-forwarded-for") ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
  } catch (e) {
    target = `/login?error=${encodeURIComponent(e instanceof AppError ? e.message : "Sign-in failed")}`;
  }
  redirect(target);
}

export async function logoutAction() {
  const t = await sessionToken();
  if (t) await logout(t);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function switchOrgAction(fd: FormData) {
  const t = await sessionToken();
  if (t) await switchOrganisation(t, str(fd, "organisationId"));
  revalidatePath("/", "layout");
  redirect("/");
}

// ───────── regulatory changes
export async function triageAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      await triageChange(ctx, str(fd, "changeId"), { to: str(fd, "to") as ChangeStatus, reason: str(fd, "reason"), urgency: (str(fd, "urgency") || undefined) as Urgency | undefined });
    },
    "Change updated",
  );
}

export async function reviewAssessmentAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const keys = str(fd, "affectedSectionKeys");
      await reviewAssessment(ctx, str(fd, "assessmentId"), {
        decision: str(fd, "decision") as "REVISION_REQUIRED" | "NO_REVISION" | "DISMISS",
        reason: str(fd, "reason"),
        affectedSectionKeys: keys ? keys.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
    },
    "Assessment decision recorded",
  );
}

export async function manualAssessmentAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const policy = await db.policy.findUnique({ where: { id: str(fd, "policyId") } });
      const allowed = policy && (policy.organisationId ? policy.organisationId === ctx.organisationId && hasOrgPermission(ctx, "impact.review") : policy.kind === "MASTER" && ctx.platformRoles.some((r) => r === "REGULATORY_REVIEWER" || r === "CONTENT_EDITOR"));
      if (!allowed) throw new AppError("You cannot assess this policy", "FORBIDDEN", 403);
      await createManualAssessment({
        changeId: str(fd, "changeId"),
        policyId: str(fd, "policyId"),
        actorId: ctx.userId,
        applicability: str(fd, "applicability") as "APPLIES",
        outcome: str(fd, "outcome") as "REVISION_RECOMMENDED",
        rationale: str(fd, "rationale"),
        affectedSectionKeys: str(fd, "affectedSectionKeys").split(",").map((s) => s.trim()).filter(Boolean),
      });
    },
    "Manual assessment saved",
  );
}

export async function generateDraftAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const a = await db.impactAssessment.findUniqueOrThrow({ where: { id: str(fd, "assessmentId") } });
      const allowed = a.organisationId ? a.organisationId === ctx.organisationId && hasOrgPermission(ctx, "policy.author") : ctx.platformRoles.includes("CONTENT_EDITOR") || ctx.platformRoles.includes("REGULATORY_REVIEWER");
      if (!allowed) throw new AppError("You cannot draft revisions for this policy", "FORBIDDEN", 403);
      const r = await draftRevisionFromAssessment(a.id, ctx.userId);
      if (!r.revision) throw new AppError(r.reason ?? "No draft created", "NO_DRAFT", 422);
      return `/revisions/${r.revision.id}`;
    },
    "Draft prepared for review. Nothing has been published.",
  );
}

// ───────── revisions
export async function editSectionAction(fd: FormData) {
  await handle(fd, (ctx) => editDraftSection(ctx, str(fd, "revisionId"), str(fd, "key"), { body: str(fd, "body"), heading: str(fd, "heading") || undefined }), "Section saved");
}
export async function submitAction(fd: FormData) {
  await handle(fd, (ctx) => submitForReview(ctx, str(fd, "revisionId"), { note: str(fd, "note") || undefined }), "Submitted for review");
}
export async function decideAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      await decide(ctx, str(fd, "revisionId"), { decision: str(fd, "decision") as "APPROVE", comment: str(fd, "comment") });
    },
    "Decision recorded",
  );
}
export async function publishAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const when = str(fd, "scheduleFor");
      const eff = str(fd, "effectiveDate");
      await publishRevision(ctx, str(fd, "revisionId"), {
        scheduleFor: when ? new Date(when) : null,
        effectiveDate: eff ? new Date(eff) : undefined,
        requireAcknowledgement: fd.get("requireAcknowledgement") === "on",
        acknowledgementDueDays: Number(str(fd, "ackDays") || 14),
      });
    },
    "Publication recorded",
  );
}
export async function commentAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await addComment(ctx, str(fd, "revisionId"), str(fd, "body"), str(fd, "sectionKey") || undefined)), "Comment added");
}
export async function newRevisionAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await createManualRevision(ctx, str(fd, "policyId"), str(fd, "reason"))).id}`, "Draft created");
}
export async function rollbackAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await createRollbackRevision(ctx, str(fd, "policyId"), str(fd, "versionId"), str(fd, "reason"))).id}`, "Rollback draft created; it requires approval");
}
export async function adoptTemplateAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await adoptTemplate(ctx, str(fd, "templateId"))).revision.id}`, "Template adopted as a draft. Complete the local sections, then submit for approval.");
}
export async function createPolicyAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const raw = str(fd, "content");
      const sections = raw
        .split(/^##\s+/m)
        .map((b) => b.trim())
        .filter(Boolean)
        .map((block, i) => {
          const [heading, ...rest] = block.split("\n");
          const key = (heading ?? `section-${i}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `section-${i}`;
          return { key, heading: heading!.trim(), body: rest.join("\n").trim() || "(to be written)", isLocal: /local|contact/i.test(heading ?? "") };
        });
      const r = await createPolicy(ctx, { ref: str(fd, "ref"), title: str(fd, "title"), description: str(fd, "description"), categoryCode: str(fd, "category"), serviceTypes: fd.getAll("serviceTypes").map(String), sections, master: fd.get("master") === "on" });
      return `/revisions/${r.revision.id}`;
    },
    "Policy created as a draft",
  );
}
export async function acknowledgeAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await acknowledge(ctx, str(fd, "acknowledgementId"))), "Thank you, your acknowledgement has been recorded");
}
export async function logReadAndSignAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await logReadAndSign(ctx, str(fd, "policyId"))), "Read and signed. Your signature has been logged");
}
// ───────── policy library workspace
const RecordId = z.string().regex(/^[a-z0-9]{8,40}$/i, "That record could not be found");
const AssignReviewer = z.object({ policyId: RecordId, reviewerId: z.string().regex(/^[a-z0-9]{8,40}$/i, "Choose a reviewer") });
const ArchivePolicy = z.object({ policyId: RecordId, reason: z.string().trim().min(5, "Give a reason of at least a few words").max(500) });

/** Reads an action's fields with a zod schema; a failure is shown to the user like any other validation error. */
function parse<T extends z.ZodTypeAny>(schema: T, fd: FormData): z.infer<T> {
  const r = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Some details are missing");
  return r.data;
}

export async function assignReviewerAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const input = parse(AssignReviewer, fd);
    await assignPolicyReviewer(ctx, input.policyId, input.reviewerId);
  }, "Reviewer assigned and notified");
}
export async function archivePolicyAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const input = parse(ArchivePolicy, fd);
    await setPolicyArchived(ctx, input.policyId, true, input.reason);
    return `/policies?tab=archived&selected=${input.policyId}`;
  }, "Policy archived");
}
export async function restorePolicyAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const input = parse(ArchivePolicy, fd);
    await setPolicyArchived(ctx, input.policyId, false, input.reason);
    return `/policies?selected=${input.policyId}`;
  }, "Policy restored");
}
export async function confirmImplementationAction(fd: FormData) {
  await handle(fd, (ctx) => confirmImplementation(ctx, str(fd, "publicationId"), str(fd, "notes")), "Implementation confirmed");
}

// ───────── sources and jobs (platform administrators)
export async function manualCheckAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      requirePlatformPermission(ctx, "sources.manage");
      await requestManualCheck(str(fd, "sourceId"), ctx.userId);
      await audit({ actorId: ctx.userId, action: "source.manual_check", entityType: "RegulatorySource", entityId: str(fd, "sourceId") });
    },
    "Check queued. The background worker will run it shortly.",
  );
}
export async function updateSourceAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      requirePlatformPermission(ctx, "sources.manage");
      const id = str(fd, "sourceId");
      const freq = Math.max(60, Number(str(fd, "frequencyMinutes")) || 1440);
      const fresh = Math.max(1, Number(str(fd, "freshnessWindowHours")) || 48);
      const s = await db.regulatorySource.update({ where: { id }, data: { active: fd.get("active") === "on", frequencyMinutes: freq, freshnessWindowHours: fresh, nextCheckAt: null } });
      await audit({ actorId: ctx.userId, action: "source.updated", entityType: "RegulatorySource", entityId: id, data: { active: s.active, frequencyMinutes: freq, freshnessWindowHours: fresh } });
    },
    "Source updated",
  );
}
export async function retryJobAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      requirePlatformPermission(ctx, "jobs.manage");
      await retryJob(str(fd, "jobId"));
      await audit({ actorId: ctx.userId, action: "job.retried", entityType: "BackgroundJob", entityId: str(fd, "jobId") });
    },
    "Job re-queued",
  );
}
export async function cancelJobAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      requirePlatformPermission(ctx, "jobs.manage");
      await cancelJob(str(fd, "jobId"));
    },
    "Job cancelled",
  );
}

// ───────── audits, actions, evidence
export async function startAuditAction(fd: FormData) {
  await handle(fd, async (ctx) => `/audits/${(await startAudit(ctx, str(fd, "templateId"), { title: str(fd, "title"), branchId: str(fd, "branchId") || null })).id}`, "Audit started");
}
export async function answerAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await answerQuestion(ctx, str(fd, "auditId"), str(fd, "questionId"), str(fd, "response"), str(fd, "notes") || undefined)), "Answer saved");
}
export async function findingAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await addFinding(ctx, str(fd, "auditId"), { description: str(fd, "description"), riskRating: str(fd, "riskRating") })), "Finding added");
}
export async function completeAuditAction(fd: FormData) {
  await handle(fd, (ctx) => completeAudit(ctx, str(fd, "auditId")), "Audit completed");
}
export async function createActionAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await createAction(ctx, { title: str(fd, "title"), description: str(fd, "description") || undefined, ownerId: str(fd, "ownerId"), dueDate: new Date(str(fd, "dueDate")), findingId: str(fd, "findingId") || undefined })), "Action created");
}
export async function transitionActionAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await transitionAction(ctx, str(fd, "actionId"), str(fd, "to"), { note: str(fd, "note") || undefined, evidenceId: str(fd, "evidenceId") || undefined })), "Action updated");
}
export async function uploadEvidenceAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const file = fd.get("file");
      if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a file to upload", "VALIDATION", 422);
      await uploadEvidence(ctx, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, { description: str(fd, "description") || undefined });
    },
    "Evidence uploaded",
  );
}

export async function markNotificationsReadAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await db.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } })), "Notifications marked as read");
}

export async function updateOrgSettingsAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const orgId = requireOrgPermission(ctx, "org.manage");
      const n = Math.min(3, Math.max(1, Number(str(fd, "requiredApprovals")) || 1));
      const org = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
      await db.organisation.update({ where: { id: orgId }, data: { settings: { ...(org.settings as object), requiredApprovals: n } } });
      await audit({ organisationId: orgId, actorId: ctx.userId, action: "org.settings_updated", entityType: "Organisation", entityId: orgId, data: { requiredApprovals: n } });
    },
    "Settings saved",
  );
}

export async function updateBusinessDetailsAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const orgId = requireOrgPermission(ctx, "org.manage");
      const business = Object.fromEntries(BUSINESS_FIELDS.map((f) => [f.tag, str(fd, f.tag).slice(0, 300)]));
      const org = await db.organisation.findUniqueOrThrow({ where: { id: orgId } });
      await db.organisation.update({ where: { id: orgId }, data: { settings: { ...(org.settings as object), business } } });
      await audit({ organisationId: orgId, actorId: ctx.userId, action: "org.business_details_updated", entityType: "Organisation", entityId: orgId, data: { fields: Object.keys(business).filter((k) => business[k]) } });
    },
    "Business details saved. Every policy now shows them",
  );
}

/** Ticks or unticks one item on the CQC registration pack checklist. */
export async function toggleRegistrationItemAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      if (!ctx.organisationId) throw new ForbiddenError();
      const item = str(fd, "item").slice(0, 60);
      const org = await db.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId } });
      const settings = (org.settings ?? {}) as { registrationPack?: string[] };
      const done = new Set(settings.registrationPack ?? []);
      if (done.has(item)) done.delete(item);
      else done.add(item);
      await db.organisation.update({ where: { id: org.id }, data: { settings: { ...settings, registrationPack: [...done] } } });
    },
    "Checklist updated",
  );
}

/** Records interest in a locked add-on module so the CSB team can follow up. */
export async function requestModuleAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "module.access_requested", entityType: "Module", entityId: str(fd, "module").slice(0, 60) });
    },
    "Thanks. Your CSB account manager will be in touch about this module",
  );
}

// ───────── assistant (returns state rather than redirecting)
export async function askAction(_prev: AskState, fd: FormData): Promise<AskState> {
  const question = str(fd, "question");
  if (!question) return { question, error: "Type a question" };
  try {
    const ctx = await requireCtx();
    return { question, result: await askAssistant(ctx, question) };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    logger.error({ err: (e as Error).message }, "assistant failed");
    return { question, error: e instanceof AppError ? e.message : "The assistant could not answer just now. Search results are still available from the policy library." };
  }
}

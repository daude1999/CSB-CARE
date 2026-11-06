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
import { hasOrgPermission, requireOrgPermission, requirePlatformPermission } from "@/server/auth/rbac";
import { triageChange, reviewAssessment } from "@/server/changes/workflow";
import { createManualAssessment } from "@/server/impact/assess";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { acknowledge, addComment, cancelScheduledPublication, discardDraft, logReadAndSign, confirmImplementation, createManualRevision, createRollbackRevision, editDraftSection, publishRevision, returnToDraft } from "@/server/policies/workflow";
import { GOVERNANCE_CHECKS } from "@/server/policy-geo/generator";
import { adoptTemplate, assignPolicyReviewer, createPolicy, setPolicyArchived } from "@/server/policies/library";
import { z } from "zod";
import { requestManualCheck } from "@/server/sources/engine";
import { cancelJob, retryJob } from "@/server/jobs/queue";
import { addFinding, answerQuestion, completeAudit, createAction, startAudit, transitionAction } from "@/server/compliance/audits";
import { uploadEvidence } from "@/server/compliance/evidence";
import { importPolicies } from "@/server/policies/import";
import { audit } from "@/server/audit-log";
import type { ChangeStatus, Urgency } from "@prisma/client";
import { askAssistant, type AssistantResult } from "@/server/search/assistant";

export type AskState = { question: string; result?: AssistantResult; error?: string };

import { handle, handleData, str } from "./action-kit";
import { BookmarkKindSchema, toggleBookmark } from "@/server/policies/bookmarks";
import { addResourceLink, withdrawResourceLink } from "@/server/forms/links";
import { approveRecord, returnRecord, saveDraft, startForm, submitRecord, voidRecord } from "@/server/forms/records";
import { linkRecord, parseLinkChoice, startFormAbout, unlinkRecord } from "@/server/forms/record-links";
import { saveOverviewOrder } from "@/server/overview/layout";

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
    "Draft prepared. Check every change against the source, then publish it. Nothing has been published yet.",
  );
}

// ───────── revisions
export async function editSectionAction(fd: FormData) {
  await handle(fd, (ctx) => editDraftSection(ctx, str(fd, "revisionId"), str(fd, "key"), { body: str(fd, "body"), heading: str(fd, "heading") || undefined }), "Section saved");
}
const PublishSchema = z.object({
  revisionId: z.string().min(1).max(40),
  scheduleFor: z.string().max(40).optional().transform((v, c) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid publication date and time" });
      return z.NEVER;
    }
    return d;
  }),
  effectiveDate: z.string().max(40).optional().transform((v, c) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid effective date" });
      return z.NEVER;
    }
    return d;
  }),
  ackDays: z.coerce.number().int().min(1, "Allow at least one day to read it").max(90, "Allow at most 90 days to read it").catch(14),
  changeSummary: z.string().max(2000, "Keep the summary of changes under 2,000 characters").optional(),
});

/** Publishes a draft directly (or schedules it). No review or approval step: the server checks the publisher's permission. */
export async function publishAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const parsed = PublishSchema.safeParse({ revisionId: str(fd, "revisionId"), scheduleFor: str(fd, "scheduleFor") || undefined, effectiveDate: str(fd, "effectiveDate") || undefined, ackDays: str(fd, "ackDays") || 14, changeSummary: str(fd, "changeSummary") || undefined });
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the publication details");
      const p = parsed.data;
      const r = await publishRevision(ctx, p.revisionId, {
        scheduleFor: p.scheduleFor,
        effectiveDate: p.effectiveDate,
        requireAcknowledgement: fd.get("requireAcknowledgement") === "on",
        materialRevision: fd.get("materialRevision") === "on",
        acknowledgementDueDays: p.ackDays,
        changeSummary: p.changeSummary,
        governance: Object.fromEntries(GOVERNANCE_CHECKS.map(([k]) => [k, fd.get(`gov_${k}`) === "on"])),
        assignBranchStaff: fd.get("assignBranchStaff") !== "off",
      });
      return { ok: r.scheduled ? "Scheduled. It will be published automatically at the time you chose." : "Published. Staff can read the new version now." };
    },
    "Published",
  );
}
export async function cancelScheduleAction(fd: FormData) {
  await handle(fd, (ctx) => cancelScheduledPublication(ctx, str(fd, "revisionId")), "Schedule cancelled. The version is a draft again.");
}
export async function returnToDraftAction(fd: FormData) {
  await handle(fd, (ctx) => returnToDraft(ctx, str(fd, "revisionId")), "Returned to draft. You can edit and publish it.");
}
export async function discardDraftAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    await discardDraft(ctx, str(fd, "revisionId"), str(fd, "reason"));
    return "/queue";
  }, "Draft discarded. It is kept in the record but will not be published.");
}
export async function commentAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await addComment(ctx, str(fd, "revisionId"), str(fd, "body"), str(fd, "sectionKey") || undefined)), "Comment added");
}
export async function newRevisionAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await createManualRevision(ctx, str(fd, "policyId"), str(fd, "reason"))).id}`, "Draft created");
}
export async function rollbackAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await createRollbackRevision(ctx, str(fd, "policyId"), str(fd, "versionId"), str(fd, "reason"))).id}`, "Restore draft created. Publish it to make it the current version.");
}
export async function adoptTemplateAction(fd: FormData) {
  await handle(fd, async (ctx) => `/revisions/${(await adoptTemplate(ctx, str(fd, "templateId"))).revision.id}`, "Your own copy has been created as a draft. Complete the local sections, then publish it. CSB updates will still reach it.");
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
// ───────── policy reader
const ToggleBookmark = z.object({ policyId: z.string().regex(/^[a-z0-9]{8,40}$/i, "That policy could not be found"), kind: BookmarkKindSchema });

/** Policy Reader "Mark as Important" / "Add to Reading List": toggles the signed-in person's own marker, no page reload. */
export async function togglePolicyBookmarkAction(input: { policyId: string; kind: string }) {
  return handleData(async (ctx) => {
    const r = ToggleBookmark.safeParse(input);
    if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "That action could not be completed");
    return toggleBookmark(ctx, r.data.policyId, r.data.kind);
  });
}
// ───────── policy-to-form links (Forms PR 1)
/** Links a form or resource to a policy, optionally at one procedure step. Validated in the forms domain service. */
export async function addResourceLinkAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    await addResourceLink(ctx, { policyId: str(fd, "policyId"), resourceId: str(fd, "resourceId"), sectionKey: str(fd, "sectionKey"), useWhen: str(fd, "useWhen"), required: fd.get("required") === "on" });
  }, "Form linked to this policy");
}
export async function withdrawResourceLinkAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await withdrawResourceLink(ctx, { linkId: str(fd, "linkId"), reason: str(fd, "reason") })), "Link removed. It stays in this policy's link history.");
}
// ───────── on-screen forms (Forms PR 2/3)
const LockVersion = z.coerce.number().int().min(0);
/** The answers posted by a form: fields are named f_<key>; multi-select fields post several values. */
function postedAnswers(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const name of new Set([...fd.keys()].filter((k) => k.startsWith("f_")))) {
    const values = fd.getAll(name).filter((v): v is string => typeof v === "string");
    out[name.slice(2)] = values.length > 1 ? values : (values[0] ?? "");
  }
  return out;
}
export async function startFormAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    // Started from a person's record: the new form is linked to them in the same step.
    const about = parseLinkChoice(str(fd, "about"));
    const rec = about ? await startFormAbout(ctx, str(fd, "definitionId"), about) : await startForm(ctx, str(fd, "definitionId"));
    return `/policies/forms/records/${rec.id}`;
  }, "Form started. Save it as a draft at any time.");
}
export async function linkFormAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const about = parseLinkChoice(str(fd, "about"));
    if (!about) throw new ValidationError("Choose who this form is about");
    await linkRecord(ctx, str(fd, "recordId"), about);
    return { ok: "Linked. The form now shows on that person's record." };
  }, "Linked");
}
export async function unlinkFormAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await unlinkRecord(ctx, str(fd, "recordId"), str(fd, "linkId"), str(fd, "reason"))), "Link removed. It stays in the form's history.");
}
export async function saveFormAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const id = str(fd, "recordId");
    const lock = LockVersion.parse(str(fd, "lockVersion") || "0");
    const answers = postedAnswers(fd);
    // Save first, so a submission that is not complete yet keeps what was typed.
    await saveDraft(ctx, id, answers, lock);
    if (str(fd, "intent") !== "submit") return { ok: "Draft saved" };
    await submitRecord(ctx, id, answers, lock + 1);
    return { ok: "Submitted for review. Your answers are now locked." };
  }, "Saved");
}
export async function reviewFormAction(fd: FormData) {
  await handle(fd, async (ctx) => {
    const id = str(fd, "recordId");
    const lock = LockVersion.parse(str(fd, "lockVersion") || "0");
    if (str(fd, "decision") === "approve") {
      await approveRecord(ctx, id, lock);
      return { ok: "Approved" };
    }
    await returnRecord(ctx, id, lock, str(fd, "reason"));
    return { ok: "Returned for correction with your reason" };
  }, "Saved");
}
export async function voidFormAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await voidRecord(ctx, str(fd, "recordId"), str(fd, "reason"))), "Form voided. It stays on record, marked void.");
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
  await handle(fd, async (ctx) => void (await addFinding(ctx, str(fd, "auditId"), { description: str(fd, "description"), riskRating: str(fd, "riskRating"), questionId: str(fd, "questionId") || undefined })), "Finding added");
}
export async function completeAuditAction(fd: FormData) {
  await handle(fd, (ctx) => completeAudit(ctx, str(fd, "auditId")), "Audit completed");
}
export async function createActionAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await createAction(ctx, { title: str(fd, "title"), description: str(fd, "description") || undefined, ownerId: str(fd, "ownerId"), dueDate: new Date(str(fd, "dueDate")), findingId: str(fd, "findingId") || undefined, riskId: str(fd, "riskId") || undefined })), "Action created");
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

/**
 * Upload policy: each .docx or .pdf becomes a Draft v1 policy with its original kept as private evidence. One upload
 * opens its draft so the extracted text can be checked; several return to the library with what came in.
 */
export async function uploadPoliciesAction(fd: FormData) {
  await handle(
    fd,
    async (ctx) => {
      const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      const r = await importPolicies(
        ctx,
        await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) }))),
        { categoryCode: str(fd, "category"), ownerId: str(fd, "ownerId"), duplicateCheck: fd.get("duplicateCheck") === "on", extractText: fd.get("extractText") === "on" },
      );
      const skipped = r.skipped.length ? ` Not uploaded: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.` : "";
      if (!r.created.length) throw new ValidationError(`No policy was uploaded.${skipped}`);
      const made = r.created.length === 1 ? `${r.created[0]!.ref} ${r.created[0]!.title} uploaded as Draft v1` : `${r.created.length} policies uploaded as Draft v1 (${r.created.map((c) => c.ref).join(", ")})`;
      const check = r.created.some((c) => c.extracted) ? " Check the extracted text before sending it for review." : " Add or paste the policy text before sending it for review.";
      return { to: r.created.length === 1 ? `/revisions/${r.created[0]!.revisionId}` : "/policies?sort=updated", ok: `${made}. Nothing has been published yet.${check}${skipped}` };
    },
    "Uploaded",
  );
}

export async function markNotificationsReadAction(fd: FormData) {
  await handle(fd, async (ctx) => void (await db.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } })), "Notifications marked as read");
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
      const slug = str(fd, "module").slice(0, 60);
      const team = await db.user.findMany({ where: { platformRoles: { has: "PLATFORM_ADMIN" }, deactivatedAt: null }, select: { id: true } });
      await db.notification.createMany({ data: team.map((u) => ({ userId: u.id, type: "module.access_requested", title: `Module request: ${slug}`, body: `${ctx.userName} asked about the ${slug} module.`, reason: "You look after customer module requests.", actionUrl: "/modules", dedupeKey: `module-request:${ctx.organisationId}:${slug}:${u.id}` })), skipDuplicates: true });
      await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "module.access_requested", entityType: "Module", entityId: slug });
    },
    "Request sent to the CSB team inside the platform. They will contact you about this module.",
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

// ───────── overview layout (a personal preference, scoped to the session's own membership)
export async function saveOverviewOrderAction(fd: FormData) {
  const reset = str(fd, "reset") === "1";
  await handle(
    fd,
    async (ctx) => {
      const order = reset ? [] : str(fd, "order").split(",").map((s) => s.trim()).filter(Boolean);
      await saveOverviewOrder(ctx, order);
      // Saving leaves arrange mode; restoring the standard order stays in it so the person can carry on arranging.
      return reset ? undefined : "/overview";
    },
    reset ? "The module boxes are back in the standard order." : "Your module order is saved.",
  );
}

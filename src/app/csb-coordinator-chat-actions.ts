"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import { answerFromCrm, type CrmLink, type CrmPage } from "@/server/care/coordinator/crm-assistant";
import { audit } from "@/server/audit-log";
import { db } from "@/lib/db";
import { getAiProvider } from "@/server/ai";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { getIntake, readIntakeDocument } from "@/server/care/coordinator/intake";
import { coordinatorIntent } from "@/lib/coordinator-chat-intent";
import { createHash } from "node:crypto";
import { addDocuments, coordinatorAccess, createIntake } from "@/server/care/coordinator/intake";
import { MAX_DOCUMENT_BYTES, type UploadedFile } from "@/server/care/su-documents";
import { ConflictError, ValidationError } from "@/lib/errors";

/**
 * Permission-scoped CRM assistant: the existing deterministic CRM answer is retrieved first,
 * then optionally explained by Claude if the organisation has explicitly enabled AI document
 * processing after its data-protection review.
 * Never directly writes to patient records or sends raw document bytes in chat.
 */
const requestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  intakeId: z.string().trim().max(80).nullable(),
  path: z.string().trim().max(300).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(8),
});
export type CoordinatorChatRequest = z.input<typeof requestSchema>;
export type CoordinatorChatResponse = { answer: string; links: CrmLink[]; topic: string };


/** The chat paperclip uses the same private intake storage, scanning, source-page extraction,
 * tenancy and human-approval rules as the full Care Coordinator workflow. The user explicitly
 * confirms the attachment; this action only creates DRAFT intake records and facts.
 */
export type CoordinatorUploadResponse = {
  intakeId: string;
  reference: string;
  filename: string;
  documents: number;
  facts: number;
  remainingToCheck: number;
  duplicate: boolean;
  extractionFailures: number;
  reviewHref: string;
};

export async function uploadCsbCoordinatorDocument(form: FormData): Promise<CoordinatorUploadResponse> {
  const ctx = await requirePortal("rota");
  coordinatorAccess(ctx);
  const organisationId = requireOrgPermission(ctx, "serviceUser.documents");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ValidationError("Select a PDF or image to attach");
  if (file.size > MAX_DOCUMENT_BYTES) throw new ValidationError("A document must be no larger than 4 MB");
  if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new ValidationError("Attach a PDF, PNG or JPEG document");
  const chosenIntakeId = form.get("intakeId");
  const selected = typeof chosenIntakeId === "string" ? chosenIntakeId.trim() : "";
  if (selected && !ID.test(selected)) throw new ValidationError("Choose a valid care intake");
  const rawServiceUserId = form.get("serviceUserId");
  const serviceUserId = typeof rawServiceUserId === "string" ? rawServiceUserId.trim() : "";
  if (serviceUserId && !ID.test(serviceUserId)) throw new ValidationError("Choose a valid service user");

  // Check existing intake and file fingerprint before a potentially chargeable document read.
  // A duplicate does not create another file or trigger the AI provider.
  const bytes = Buffer.from(await file.arrayBuffer());
  let id = selected;
  if (id) {
    const existing = await getIntake(ctx, id);
    if (existing.intake.status !== "DRAFT") throw new ConflictError("Only draft intakes can receive documents");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await db.careIntakeDocument.findFirst({
      where: { organisationId, intakeId: id, sha256 },
      select: { id: true },
    });
    if (duplicate) {
      return {
        intakeId: id, reference: existing.intake.reference, filename: file.name,
        documents: existing.documents.length, facts: existing.facts.length,
        remainingToCheck: existing.sections.reduce((n, s) => n + s.open, 0),
        duplicate: true, extractionFailures: 0,
        reviewHref: `/rota/coordinator/${encodeURIComponent(id)}`,
      };
    }
  } else {
    // A new intake is deliberately a draft; uploaded information cannot change a
    // service-user profile until independent coordinator and manager decisions.
    const title = `Referral — ${file.name.replace(/\.[^.]+$/, "").slice(0, 95)}`;
    const intake = await createIntake(ctx, {
      title, mode: serviceUserId ? "EXISTING" : "NEW",
      ...(serviceUserId ? { serviceUserId } : {}),
    });
    id = intake.id;
  }

  const upload: UploadedFile = { name: file.name, type: file.type, bytes };
  const response = await addDocuments(ctx, id, [upload]);
  const current = await getIntake(ctx, id);
  return {
    intakeId: id, reference: current.intake.reference, filename: file.name,
    documents: current.documents.length, facts: current.facts.length,
    remainingToCheck: current.sections.reduce((n, s) => n + s.open, 0),
    duplicate: false, extractionFailures: response.results.filter(r => "error" in r).length,
    reviewHref: `/rota/coordinator/${encodeURIComponent(id)}`,
  };
}

const ID = /^[a-zA-Z0-9]{10,40}$/;
/** Visits use UUIDs rather than cuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which CRM page the panel was opened on. Only the shape of the path is used here; ids are checked later. */
function pageOf(path: string | undefined, intakeId: string | null): CrmPage {
  if (intakeId && ID.test(intakeId)) return { kind: "intake", id: intakeId };
  if (!path) return { kind: "other", id: null };
  const intake = path.match(/^\/rota\/coordinator\/([^/?#]+)/);
  if (intake && ID.test(intake[1]!)) return { kind: "intake", id: intake[1]! };
  const su = path.match(/^\/rota\/(?:service-users|care-plans)\/([^/?#]+)/);
  if (su && ID.test(su[1]!)) return { kind: "service-user", id: su[1]! };
  const visit = path.match(/^\/rota\/visits\/([^/?#]+)/);
  if (visit && (UUID.test(visit[1]!) || ID.test(visit[1]!))) return { kind: "visit", id: visit[1]! };
  if (path === "/rota" || path.startsWith("/rota/")) return { kind: "rota", id: null };
  if (path === "/overview") return { kind: "overview", id: null };
  return { kind: "other", id: null };
}

export async function askCsbCoordinator(raw: CoordinatorChatRequest): Promise<CoordinatorChatResponse> {
  const ctx = await requirePortal("rota");
  const organisationId = requireOrgPermission(ctx, "serviceUser.documents");
  const d = requestSchema.parse(raw);
  const page = pageOf(d.path, d.intakeId);
  let result: CoordinatorChatResponse;
  try {
    result = await answerFromCrm(ctx, d.question, page);
  } catch (e) {
    // A record on the page that this employee may not open is answered as not available, never described.
    if (e instanceof NotFoundError) result = { topic: "not-found", answer: "That record isn't available to you, so I can't answer about it.", links: [] };
    else throw e;
  }
  // An explicit request to process an existing intake uses the CRM's real
  // upload/reading pipeline, never model-generated database instructions.
  // Document extraction proposes facts only; review, approval, save and rota
  // publication remain in the established CRM workflow.
  if (coordinatorIntent(d.question) === "process-plan") {
    if (page.kind !== "intake" || !page.id) {
      result = {
        topic: "process-plan", links: [{ label: "Open Care Coordinator", href: "/rota/coordinator" }],
        answer: "I can prepare a complete care-intake draft for review. Start a new intake or open an existing one, upload the council support plan, then ask me to process it there. I will not create or approve clinical records without the CRM's review process.",
      };
    } else {
      const before = await getIntake(ctx, page.id);
      const canRead = before.intake.status === "DRAFT";
      const pending = before.documents.filter(doc => doc.contentType === "application/pdf" && doc.readStatus === "PENDING");
      // Bound the number of additional chargeable API reads per chat action.
      let attempted = 0;
      let failed = 0;
      if (canRead) {
        for (const doc of pending.slice(0, 2)) {
          attempted++;
          try { await readIntakeDocument(ctx, doc.id); }
          catch (e) {
            failed++;
            logger.warn({ reason: (e as Error).name }, "Coordinator chat document read failed");
          }
        }
      }
      const current = attempted ? await getIntake(ctx, page.id) : before;
      const count = (destination: string) => current.facts.filter(f => f.destination === destination).length;
      const plans = new Set(current.facts.filter(f => f.destination.startsWith("careplan.")).map(f => f.destination)).size;
      const risks = count("risk");
      const visits = count("visit");
      const missing = current.sections.reduce((total, section) => total + section.open, 0);
      const remaining = current.documents.filter(doc => doc.readStatus === "PENDING").length;
      const notes = [
        "I've checked the actual intake and its saved extraction results.",
        `Documents: ${current.documents.length}. New extraction attempts: ${attempted}${failed ? ` (${failed} failed)` : ""}.`,
        `Draft facts available for review: ${current.facts.length}; care-plan section entries: ${plans}; risk proposals: ${risks}; visit proposals: ${visits}.`,
        `Facts still requiring coordinator decisions: ${missing}.`,
        remaining ? `${remaining} document(s) are still awaiting extraction. Open the intake to continue.` : "",
        "Nothing has been automatically approved, saved to a service-user record, or published to the rota.",
        "Review each source, resolve missing/conflicting fields, then submit the intake for manager approval. Approved sections can be applied through the existing CRM workflow.",
      ].filter(Boolean);
      result = {
        topic: "process-plan", answer: notes.join("\n\n"),
        links: [{ label: "Review extracted care intake", href: `/rota/coordinator/${encodeURIComponent(page.id)}` }],
      };
    }
    await audit({ organisationId, actorId: ctx.userId, action: "coordinator.chat.asked", entityType: "Organisation", entityId: organisationId,
      data: { page: page.kind, topic: result.topic, historyCount: d.history.length, aiUsed: false } });
    return result;
  }
  // Provider secrets are server-side. Enabling the environment variable alone must
  // never send a care organisation's records off-platform without its opt-in.
  const settings = await db.rotaSettings.findUnique({
    where: { organisationId }, select: { careCoordinatorAiEnabledAt: true },
  });
  const provider = settings?.careCoordinatorAiEnabledAt ? getAiProvider() : null;
  let usedModel = false;
  if (provider?.coordinateChat && !provider.isSimulated && result.topic !== "not-found") {
    try {
      // The deterministic engine has already applied organisation/branch/area/role
      // permissions. Send only this scoped summary and its verified navigation links.
      const caseContext = JSON.stringify({
        page: page.kind,
        crmAnswer: result.answer.slice(0, 10000),
        links: result.links.slice(0, 12),
        note: "CRM summary only. Do not claim the person or document was fully reviewed.",
      });
      const answer = await provider.coordinateChat({
        question: d.question, history: d.history, caseContext,
      });
      if (answer.trim()) {
        result = { ...result, answer, topic: "ai-coordinator" };
        usedModel = true;
      }
    } catch (e) {
      // Retain a useful, correctly-scoped answer during API outages or rate limits.
      // Never log patient details or message content.
      logger.warn({ reason: (e as Error).name }, "AI coordinator provider failed; used CRM fallback");
    }
  }
  await audit({ organisationId, actorId: ctx.userId, action: "coordinator.chat.asked", entityType: "Organisation", entityId: organisationId,
    data: { page: page.kind, topic: result.topic, historyCount: d.history.length, aiUsed: usedModel } });
  return result;
}

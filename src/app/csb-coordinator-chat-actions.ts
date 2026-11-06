"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import type { CrmLink, CrmPage } from "@/server/care/coordinator/crm-assistant";
import { coordinatorChat, type ChatMode } from "@/server/care/coordinator/agent";
import { chatDraftIntakes, uploadFromChat } from "@/server/care/coordinator/chat-upload";
import { ValidationError } from "@/lib/errors";
import { MAX_DOCUMENT_BYTES } from "@/server/care/su-documents";

/**
 * AI CSB Coordinator chat. Claude with permission-checked CRM tools when the organisation has switched AI on and the
 * server has a provider; otherwise (or over a limit, or during an outage) the built-in CRM answers. See
 * src/server/care/coordinator/agent.ts. The page the panel was opened on is sent as its path; any record id in it is
 * re-checked on the server before use. Nothing here takes an organisation id from the browser.
 */
const requestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  intakeId: z.string().trim().max(80).nullable(),
  path: z.string().trim().max(300).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(8),
  /** Names of documents the employee has just attached to this intake with the paperclip. */
  attached: z.array(z.string().max(160)).max(3).optional(),
});
export type CoordinatorChatRequest = z.input<typeof requestSchema>;
export type CoordinatorChatResponse = { answer: string; links: CrmLink[]; topic: string; mode: ChatMode; notice: string | null };

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
  requireOrgPermission(ctx, "serviceUser.documents");
  const d = requestSchema.parse(raw);
  const attachedNote = d.attached?.length ? `The employee has just attached ${d.attached.length} document(s) to this intake with the paperclip; they were stored and read by the CRM's intake upload.` : null;
  return coordinatorChat(ctx, { question: d.question, history: d.history, page: pageOf(d.path, d.intakeId), attachedNote });
}

/** Current, accessible draft intake options for the in-chat attachment picker. */
export async function listCsbCoordinatorDraftIntakes(): Promise<{ id: string; label: string }[]> {
  const ctx = await requirePortal("rota");
  return chatDraftIntakes(ctx);
}

export type CoordinatorUploadResponse = {
  intakeId: string;
  reference: string;
  filename: string;
  documents: number;
  facts: number;
  remainingToCheck: number;
  duplicate: boolean;
  /** The same file is already on another open intake, so no new intake was started and nothing was read again. */
  alreadyOnIntake: boolean;
  extractionFailures: number;
  /** The upload worked but the AI could not read all of it; the basic reader covered it. */
  aiFallback: { reason: string; partly: boolean } | null;
  reviewHref: string;
  /** What was extracted, as plain sentences from the saved intake (no AI). */
  summary: string;
};

/**
 * The chat paperclip uses the same private intake storage, scanning, source-page extraction, tenancy and
 * human-approval rules as the full Care Coordinator workflow (src/server/care/coordinator/chat-upload.ts). The employee
 * explicitly confirms the attachment; this only creates DRAFT intake records and facts. A duplicate file is neither
 * stored nor read again, so it is never charged twice.
 */
export async function uploadCsbCoordinatorDocument(form: FormData): Promise<CoordinatorUploadResponse> {
  const ctx = await requirePortal("rota");
  requireOrgPermission(ctx, "serviceUser.documents");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ValidationError("Select a PDF or image to attach");
  if (file.size > MAX_DOCUMENT_BYTES) throw new ValidationError("A document must be no larger than 4 MB");
  if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new ValidationError("Attach a PDF, PNG or JPEG document");
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
  const selected = field("intakeId");
  if (selected && !ID.test(selected)) throw new ValidationError("Choose a valid care intake");
  const serviceUserId = field("serviceUserId");
  if (serviceUserId && !ID.test(serviceUserId)) throw new ValidationError("Choose a valid service user");
  const bytes = Buffer.from(await file.arrayBuffer());
  const r = await uploadFromChat(ctx, {
    target: selected ? "intake" : "new", intakeId: selected, serviceUserId,
    title: `Referral — ${file.name.replace(/\.[^.]+$/, "").slice(0, 95)}`,
    files: [{ name: file.name, type: file.type, bytes }],
  });
  return {
    intakeId: r.intakeId, reference: r.reference, filename: file.name, documents: r.documents, facts: r.facts, remainingToCheck: r.remainingToCheck,
    duplicate: r.duplicates.length > 0, alreadyOnIntake: r.alreadyOnIntake, extractionFailures: r.failed.length, aiFallback: r.fallback[0] ? { reason: r.fallback[0].reason, partly: r.fallback[0].partly } : null, reviewHref: `/rota/coordinator/${encodeURIComponent(r.intakeId)}`, summary: r.summary,
  };
}

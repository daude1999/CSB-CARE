"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import type { CrmLink, CrmPage } from "@/server/care/coordinator/crm-assistant";
import { coordinatorChat, type ChatMode } from "@/server/care/coordinator/agent";
import { chatUploadTargets, uploadFromChat } from "@/server/care/coordinator/chat-upload";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
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

export type UploadTargetsResponse = { ok: true; data: Awaited<ReturnType<typeof chatUploadTargets>> } | { ok: false; error: string };
export type ChatUploadResponse = { ok: true; data: Awaited<ReturnType<typeof uploadFromChat>> } | { ok: false; error: string };

/** Where an attached document can go: the intake open on the page, or recent open intakes, or a new intake. */
export async function coordinatorUploadTargets(path: string | null): Promise<UploadTargetsResponse> {
  try {
    const ctx = await requirePortal("rota");
    const page = pageOf(path ?? undefined, null);
    return { ok: true, data: await chatUploadTargets(ctx, page) };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "The intakes could not be loaded just now." };
  }
}

const uploadSchema = z.object({
  target: z.enum(["intake", "new"]),
  intakeId: z.string().regex(ID).nullable(),
  serviceUserId: z.string().regex(ID).nullable(),
  title: z.string().trim().max(120).nullable(),
});

/** The paperclip: stores the file through the intake's own upload (size, type, virus scan, private storage, audit),
 *  reads it with the organisation's reading pipeline, and returns what was found. Never approves anything. */
export async function uploadToCoordinator(fd: FormData): Promise<ChatUploadResponse> {
  try {
    const ctx = await requirePortal("rota");
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new ValidationError("Choose a document to attach");
    if (files.length > 3) throw new ValidationError("Attach up to 3 documents at a time");
    for (const f of files) if (f.size > MAX_DOCUMENT_BYTES) throw new ValidationError(`${f.name.slice(0, 80)} is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`);
    const field = (k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
    const p = uploadSchema.safeParse({ target: field("target"), intakeId: field("intakeId"), serviceUserId: field("serviceUserId"), title: field("title") });
    if (!p.success) throw new ValidationError("Choose where the document should go");
    const uploaded = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
    return { ok: true, data: await uploadFromChat(ctx, { ...p.data, files: uploaded }) };
  } catch (e) {
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).name }, "coordinator chat upload failed");
    return { ok: false, error: e instanceof AppError ? e.message : "The document could not be attached just now. Nothing was saved. Try again, or upload it on the Care Coordinator page." };
  }
}

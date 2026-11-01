import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { sha256 } from "@/lib/text";
import { audit } from "../audit-log";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { sniffContentType } from "../sources/extract";
import { storage } from "../storage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  png: ["image/png"],
  jpeg: ["image/jpeg"],
  text: ["text/plain", "text/csv"],
};

function sniffImage(buf: Buffer): "png" | "jpeg" | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}

/**
 * Malware scanning policy (see docs/SECURITY.md, "Evidence files"):
 *   - With MALWARE_SCAN_URL set, every upload is scanned before it is stored. The scanner must answer within
 *     SCAN_TIMEOUT_MS with JSON `{ "infected": boolean }`; anything else counts as a failed scan, never as clean,
 *     and the upload is refused with nothing stored.
 *   - Without a scanner the file is stored as NOT_SCANNED after its type, content and size checks. Such files can
 *     be downloaded (as an attachment, never inline) unless EVIDENCE_REQUIRE_SCAN=true, which holds them until a
 *     scanner is configured. Once a scanner is configured, a NOT_SCANNED file is scanned the first time it is
 *     downloaded and its status recorded.
 *   - INFECTED files are never served. PENDING and SCAN_FAILED files are held. Nothing is deleted automatically.
 */
export type ScanStatus = "CLEAN" | "INFECTED" | "NOT_SCANNED" | "PENDING" | "SCAN_FAILED";
const SCAN_TIMEOUT_MS = 20_000;

/** The scanner could not give a clear answer. The caller decides what that means; it is never treated as clean. */
export class ScanUnavailableError extends Error {}

export const scannerConfigured = () => Boolean(process.env.MALWARE_SCAN_URL);
const requireScan = () => process.env.EVIDENCE_REQUIRE_SCAN === "true";

/** Calls the configured scanning service (e.g. Defender for Storage or a ClamAV REST wrapper). */
export async function scanBytes(buf: Buffer): Promise<"CLEAN" | "INFECTED" | "NOT_SCANNED"> {
  const url = process.env.MALWARE_SCAN_URL;
  if (!url) return "NOT_SCANNED";
  let body: unknown;
  try {
    const res = await fetch(url, { method: "POST", body: new Uint8Array(buf), headers: { "Content-Type": "application/octet-stream" }, signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
    if (!res.ok) throw new ScanUnavailableError(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw e instanceof ScanUnavailableError ? e : new ScanUnavailableError(e instanceof Error ? e.name : "scan error");
  }
  const infected = typeof body === "object" && body !== null && "infected" in body ? (body as { infected: unknown }).infected : undefined;
  if (typeof infected !== "boolean") throw new ScanUnavailableError("unexpected scanner response");
  return infected ? "INFECTED" : "CLEAN";
}

/** Why a file cannot be downloaded right now, in words the person can act on. Thrown as a 403. */
export class EvidenceHeldError extends ForbiddenError {}

/**
 * Applies the scanning policy to one stored file before it is served. Ownership and permission are checked by the
 * caller first. May record a new scan result (and audits it); never deletes the file.
 */
export async function assertDownloadable(doc: { id: string; organisationId: string; scanStatus: string; storageKey: string }, actorId: string): Promise<Buffer> {
  if (doc.scanStatus === "INFECTED") throw new EvidenceHeldError("This file failed the malware scan and cannot be downloaded. Ask an administrator to review it.");
  if (doc.scanStatus === "PENDING" || doc.scanStatus === "SCAN_FAILED") throw new EvidenceHeldError("This file is waiting for its virus check and cannot be downloaded yet. Try again later, or ask an administrator.");
  const bytes = await storage().get(doc.storageKey);
  if (doc.scanStatus === "NOT_SCANNED") {
    if (scannerConfigured()) {
      let result: "CLEAN" | "INFECTED" | "NOT_SCANNED";
      try {
        result = await scanBytes(bytes);
      } catch {
        throw new EvidenceHeldError("The virus check could not run just now, so the file is held. Try again in a few minutes.");
      }
      if (result !== "NOT_SCANNED") {
        await db.evidenceDocument.update({ where: { id: doc.id }, data: { scanStatus: result } });
        await audit({ organisationId: doc.organisationId, actorId, action: "evidence.scanned", entityType: "EvidenceDocument", entityId: doc.id, data: { scanStatus: result, when: "on download" } });
      }
      if (result === "INFECTED") throw new EvidenceHeldError("This file failed the malware scan and cannot be downloaded. Ask an administrator to review it.");
    } else if (requireScan()) {
      throw new EvidenceHeldError("This file has not been virus-checked. Your organisation only allows checked files to be downloaded, so it is held until a scanner is set up.");
    }
  }
  return bytes;
}

export async function uploadEvidence(ctx: Ctx, file: { name: string; type: string; bytes: Buffer }, meta: { description?: string; linkedType?: string; linkedId?: string }) {
  const orgId = requireOrgPermission(ctx, "evidence.upload");
  if (meta.linkedType || meta.linkedId) {
    // The record must exist in the caller's own organisation: evidence can never be attached to another tenant's record.
    if (!meta.linkedType || !meta.linkedId || !isLinkType(meta.linkedType)) throw new ValidationError("Choose the record this evidence supports");
    await resolveLinks(orgId, [{ linkedType: meta.linkedType, linkedId: meta.linkedId }]).then((m) => {
      if (!m.has(linkKey(meta.linkedType!, meta.linkedId!))) throw new NotFoundError("Linked record");
    });
  }
  return storeEvidenceFile(orgId, ctx.userId, file, meta);
}

/** The compliance records evidence can support. Missed-call evidence is attached from its own case page. */
export const LINK_TYPES = { POLICY: "Policy", AUDIT: "Audit", AUDIT_ANSWER: "Audit question", FINDING: "Audit finding", ACTION: "Corrective action", RISK: "Risk" } as const;
export type LinkType = keyof typeof LINK_TYPES;
export const isLinkType = (t: string): t is LinkType => t in LINK_TYPES;
const linkKey = (type: string, id: string) => `${type}:${id}`;

export interface EvidenceLink { type: string; typeLabel: string; label: string; href: string | null }

/**
 * Names and addresses of the records evidence is linked to, looked up only inside the organisation. A link to a record
 * that no longer exists (or never belonged to the organisation) is simply not returned.
 */
export async function resolveLinks(orgId: string, docs: { linkedType: string | null; linkedId: string | null }[]): Promise<Map<string, EvidenceLink>> {
  const ids = (t: string) => [...new Set(docs.filter((d) => d.linkedType === t && d.linkedId).map((d) => d.linkedId!))];
  const [policies, audits, answers, findings, actions, risks, missed] = await Promise.all([
    ids("POLICY").length ? db.policy.findMany({ where: { id: { in: ids("POLICY") }, organisationId: orgId }, select: { id: true, ref: true, title: true } }) : [],
    ids("AUDIT").length ? db.audit.findMany({ where: { id: { in: ids("AUDIT") }, organisationId: orgId }, select: { id: true, title: true } }) : [],
    ids("AUDIT_ANSWER").length ? db.auditAnswer.findMany({ where: { id: { in: ids("AUDIT_ANSWER") }, audit: { organisationId: orgId } }, select: { id: true, auditId: true, question: { select: { text: true, position: true } }, audit: { select: { title: true } } } }) : [],
    ids("FINDING").length ? db.auditFinding.findMany({ where: { id: { in: ids("FINDING") }, organisationId: orgId }, select: { id: true, auditId: true, description: true } }) : [],
    ids("ACTION").length ? db.complianceAction.findMany({ where: { id: { in: ids("ACTION") }, organisationId: orgId }, select: { id: true, title: true } }) : [],
    ids("RISK").length ? db.complianceRisk.findMany({ where: { id: { in: ids("RISK") }, organisationId: orgId }, select: { id: true, ref: true, title: true } }) : [],
    ids("MISSED_CALL").length ? db.missedCallCase.findMany({ where: { id: { in: ids("MISSED_CALL") }, organisationId: orgId }, select: { id: true } }) : [],
  ]);
  const out = new Map<string, EvidenceLink>();
  const put = (type: string, id: string, label: string, href: string | null) => out.set(linkKey(type, id), { type, typeLabel: type === "MISSED_CALL" ? "Missed call" : LINK_TYPES[type as LinkType], label, href });
  for (const p of policies) put("POLICY", p.id, `${p.ref} ${p.title}`, `/policies/${p.id}`);
  for (const a of audits) put("AUDIT", a.id, a.title, `/audits/${a.id}`);
  for (const a of answers) put("AUDIT_ANSWER", a.id, `${a.audit.title}: question ${a.question.position + 1}`, `/audits/${a.auditId}#q-${a.id}`);
  for (const f of findings) put("FINDING", f.id, f.description.slice(0, 90), `/audits/${f.auditId}#findings`);
  for (const a of actions) put("ACTION", a.id, a.title, `/actions/${a.id}`);
  for (const r of risks) put("RISK", r.id, `${r.ref} ${r.title}`, `/compliance/risks/${r.id}`);
  for (const m of missed) put("MISSED_CALL", m.id, "Missed call case", `/rota/missed/${m.id}`);
  return out;
}

export function linkFor(map: Map<string, EvidenceLink>, d: { linkedType: string | null; linkedId: string | null }) {
  return d.linkedType && d.linkedId ? (map.get(linkKey(d.linkedType, d.linkedId)) ?? null) : null;
}

/** Evidence attached to some records of one type, for showing beside those records. Needs evidence.read. */
export async function evidenceFor(ctx: Ctx, type: LinkType, ids: string[]) {
  const orgId = requireOrgPermission(ctx, "evidence.read");
  if (!ids.length) return [];
  return db.evidenceDocument.findMany({ where: { organisationId: orgId, linkedType: type, linkedId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, linkedId: true, scanStatus: true, createdAt: true, sizeBytes: true } });
}

/**
 * Checks, scans and stores one evidence file. Callers authorise first: compliance evidence via `evidence.upload`,
 * missed-call evidence via the rota permissions on the case it belongs to.
 */
export async function storeEvidenceFile(orgId: string, actorId: string, file: { name: string; type: string; bytes: Buffer }, meta: { description?: string; linkedType?: string; linkedId?: string }) {
  if (file.bytes.length === 0) throw new ValidationError("File is empty");
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError("File exceeds the 10 MB limit");
  const sniffed = sniffImage(file.bytes) ?? sniffContentType(file.bytes, file.type);
  const kind = sniffed === "unknown" && file.type === "text/csv" ? "text" : sniffed;
  if (!(kind in ALLOWED) || !ALLOWED[kind as keyof typeof ALLOWED]!.includes(file.type)) {
    throw new ValidationError("File type not allowed (PDF, DOCX, PNG, JPEG, TXT, CSV) or content does not match its declared type");
  }
  let scanStatus: ScanStatus;
  try {
    scanStatus = await scanBytes(file.bytes);
  } catch (e) {
    if (!(e instanceof ScanUnavailableError)) throw e;
    // Fail closed: a file the scanner could not check is not stored, so it can never be served as if clean.
    throw new ValidationError("The virus check could not run just now, so the file was not saved. Please try again in a few minutes.");
  }
  if (scanStatus === "INFECTED") throw new ValidationError("This file was rejected by the virus check and was not saved.");
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const key = `evidence/${orgId}/${randomUUID()}`;
  await storage().put(key, file.bytes, file.type);
  const doc = await db.evidenceDocument.create({
    data: { organisationId: orgId, filename: safeName, contentType: file.type, sizeBytes: file.bytes.length, sha256: sha256(file.bytes), storageKey: key, scanStatus, description: meta.description, linkedType: meta.linkedType, linkedId: meta.linkedId, uploadedById: actorId },
  });
  await audit({ organisationId: orgId, actorId, action: "evidence.uploaded", entityType: "EvidenceDocument", entityId: doc.id, data: { filename: safeName, sizeBytes: file.bytes.length, scanStatus } });
  return doc;
}

/** Streams evidence only after verifying the caller belongs to the owning organisation. */
export async function readEvidence(ctx: Ctx, id: string) {
  const orgId = requireOrgPermission(ctx, "evidence.read");
  const doc = await db.evidenceDocument.findUnique({ where: { id } });
  if (!doc || doc.organisationId !== orgId) throw new NotFoundError("Evidence");
  const bytes = await assertDownloadable(doc, ctx.userId);
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "evidence.downloaded", entityType: "EvidenceDocument", entityId: id });
  return { doc, bytes };
}

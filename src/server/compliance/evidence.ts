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

/** Malware scanning integration point. Configure MALWARE_SCAN_URL to call a scanning service (e.g. Defender for Storage / ClamAV REST). */
async function scan(buf: Buffer): Promise<"CLEAN" | "INFECTED" | "NOT_SCANNED"> {
  const url = process.env.MALWARE_SCAN_URL;
  if (!url) return "NOT_SCANNED";
  const res = await fetch(url, { method: "POST", body: new Uint8Array(buf), headers: { "Content-Type": "application/octet-stream" } });
  if (!res.ok) throw new Error(`Malware scan failed: HTTP ${res.status}`);
  const body = (await res.json()) as { infected?: boolean };
  return body.infected ? "INFECTED" : "CLEAN";
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
  const scanStatus = await scan(file.bytes);
  if (scanStatus === "INFECTED") throw new ValidationError("File rejected by malware scan");
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
  if (doc.scanStatus === "INFECTED") throw new ForbiddenError("This file failed the malware scan and cannot be downloaded");
  const bytes = await storage().get(doc.storageKey);
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "evidence.downloaded", entityType: "EvidenceDocument", entityId: id });
  return { doc, bytes };
}

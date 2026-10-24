import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
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
    data: { organisationId: orgId, filename: safeName, contentType: file.type, sizeBytes: file.bytes.length, sha256: sha256(file.bytes), storageKey: key, scanStatus, description: meta.description, linkedType: meta.linkedType, linkedId: meta.linkedId, uploadedById: ctx.userId },
  });
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "evidence.uploaded", entityType: "EvidenceDocument", entityId: doc.id, data: { filename: safeName, sizeBytes: file.bytes.length, scanStatus } });
  return doc;
}

/** Streams evidence only after verifying the caller belongs to the owning organisation. */
export async function readEvidence(ctx: Ctx, id: string) {
  const orgId = requireOrgPermission(ctx, "evidence.read");
  const doc = await db.evidenceDocument.findUnique({ where: { id } });
  if (!doc || doc.organisationId !== orgId) throw new NotFoundError("Evidence");
  const bytes = await storage().get(doc.storageKey);
  await audit({ organisationId: orgId, actorId: ctx.userId, action: "evidence.downloaded", entityType: "EvidenceDocument", entityId: id });
  return { doc, bytes };
}

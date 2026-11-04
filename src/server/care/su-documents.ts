import { randomUUID } from "node:crypto";
import type { Prisma, ServiceUserDocumentSection } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate } from "@/lib/london";
import { sha256 } from "@/lib/text";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { ScanUnavailableError, scanBytes } from "@/server/compliance/evidence";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { storage } from "@/server/storage";

/**
 * Council Documents and Other Documents on a service user's record. Two separate profile sections sharing one table
 * and one set of rules:
 *   - every file is kept: replacing a document adds a version, archiving moves it to "Historical documents";
 *   - files sit in private storage and are only streamed after a server-side check, never through a public link;
 *   - sensitive documents (identity, medical, financial, or marked sensitive) open only with serviceUser.sensitive;
 *   - uploads, replacements, detail changes, archiving, previews and downloads are written to the audit log.
 */

export const DOCUMENT_SECTIONS = { COUNCIL: "Council Documents", OTHER: "Other Documents" } as const satisfies Record<ServiceUserDocumentSection, string>;

interface Category { key: string; label: string; sensitive?: boolean }

export const COUNCIL_CATEGORIES: readonly Category[] = [
  { key: "COUNCIL_SUPPORT_PLAN", label: "Council Support Plan" },
  { key: "PURCHASE_ORDER", label: "Purchase Order (PO)" },
  { key: "CARE_PACKAGE_AUTHORISATION", label: "Care Package Authorisation" },
  { key: "CARE_SUPPORT_ASSESSMENT", label: "Care and Support Assessment" },
  { key: "COUNCIL_REVIEW", label: "Council Review Documents" },
  { key: "COUNCIL_CARE_PLAN", label: "Council Care Plan", sensitive: true },
  { key: "COUNCIL_RISK_ASSESSMENT", label: "Council Risk Assessment", sensitive: true },
  { key: "COUNCIL_NEEDS_ASSESSMENT", label: "Council Needs Assessment", sensitive: true },
  { key: "REFERRAL_FORM", label: "Council Referral Form", sensitive: true },
  { key: "COUNCIL_MEDICATION_LIST", label: "Council-issued Medication List", sensitive: true },
  { key: "COUNCIL_PROFESSIONAL_REPORT", label: "Council-issued Professional Report", sensitive: true },
  { key: "HOSPITAL_DISCHARGE", label: "Hospital Discharge Documents", sensitive: true },
  { key: "INDIVIDUAL_SERVICE_AGREEMENT", label: "Individual Service Agreement" },
  { key: "COUNCIL_CORRESPONDENCE", label: "Council Correspondence" },
  { key: "OTHER_COUNCIL", label: "Other Council Documents" },
];

export const OTHER_CATEGORIES: readonly Category[] = [
  { key: "SIGNED_CONSENT", label: "Signed Consent Forms" },
  { key: "IDENTIFICATION", label: "Passports and Identification Documents", sensitive: true },
  { key: "MEDICAL_LETTER", label: "Hospital and Medical Letters", sensitive: true },
  { key: "MEDICATION_LIST", label: "Medication List", sensitive: true },
  { key: "PROFESSIONAL_REPORT", label: "Healthcare Professional Report", sensitive: true },
  { key: "PROOF_OF_ADDRESS", label: "Proof of Address", sensitive: true },
  { key: "FAMILY_CORRESPONDENCE", label: "Family Correspondence", sensitive: true },
  { key: "GP_CORRESPONDENCE", label: "GP Correspondence", sensitive: true },
  { key: "DISCHARGE_INFORMATION", label: "Discharge Information", sensitive: true },
  { key: "SIGNED_AGREEMENT", label: "Signed Agreements" },
  { key: "FINANCIAL", label: "Financial and Supporting Documents", sensitive: true },
  { key: "NEXT_OF_KIN", label: "Next of Kin Documentation" },
  { key: "REPRESENTATIVE", label: "Representative Documentation" },
  { key: "OTHER_SUPPORTING", label: "Other Supporting Documents" },
];

/** The council documents every person must hold (owner's decision, 2 Nov 2026). Nothing in Other Documents is required. */
export const REQUIRED_COUNCIL_CATEGORIES = ["COUNCIL_SUPPORT_PLAN", "PURCHASE_ORDER"] as const;

export const categoriesFor = (section: ServiceUserDocumentSection) => (section === "COUNCIL" ? COUNCIL_CATEGORIES : OTHER_CATEGORIES);
export function categoryLabel(section: ServiceUserDocumentSection, key: string) {
  return categoriesFor(section).find((c) => c.key === key)?.label ?? key;
}
const categoryIsSensitive = (section: ServiceUserDocumentSection, key: string) => categoriesFor(section).some((c) => c.key === key && c.sensitive);

/**
 * Vercel refuses request bodies over 4.5 MB before they reach the app, so the limit is set just under it everywhere and
 * the person gets a clear message instead of a failed page.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const ACCEPT_DOCUMENTS = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff";

/** What a file really is, from its first bytes. A file whose content does not match an allowed type is refused. */
function sniffDocument(buf: Buffer, declared: string, name: string): { contentType: string; previewable: boolean } | null {
  const b = (i: number) => buf[i];
  const lower = name.toLowerCase();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { contentType: "application/pdf", previewable: true };
  if (b(0) === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return { contentType: "image/png", previewable: true };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { contentType: "image/jpeg", previewable: true };
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return { contentType: "image/gif", previewable: true };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { contentType: "image/webp", previewable: true };
  if ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00) || (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a)) return { contentType: "image/tiff", previewable: false };
  // Word: .docx is a zip, .doc an OLE compound file. Both are judged by content and name together.
  if (b(0) === 0x50 && b(1) === 0x4b && (declared.includes("wordprocessingml") || lower.endsWith(".docx"))) return { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", previewable: false };
  if (b(0) === 0xd0 && b(1) === 0xcf && b(2) === 0x11 && b(3) === 0xe0 && (declared === "application/msword" || lower.endsWith(".doc"))) return { contentType: "application/msword", previewable: false };
  return null;
}

/** Whether the browser can show this type itself (PDF and common images). Word and TIFF files download instead. */
export const previewable = (contentType: string) => ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType);

export interface UploadedFile { name: string; type: string; bytes: Buffer }

/** Checks, virus-scans (when a scanner is configured) and stores one file; returns what to save on the version row. */
export async function storePrivateFile(organisationId: string, folder: string, file: UploadedFile, opts: { imagesOnly?: boolean } = {}) {
  if (!file.bytes.length) throw new ValidationError("Choose a file to upload");
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new ValidationError("Files must be 4 MB or smaller. Scan at a lower resolution or split the document.");
  const sniffed = sniffDocument(file.bytes, file.type, file.name);
  if (!sniffed) throw new ValidationError("This file type is not allowed. Upload a PDF, Word document or image (JPG, PNG, GIF, WebP, TIFF).");
  if (opts.imagesOnly && !sniffed.contentType.startsWith("image/")) throw new ValidationError("Photos must be JPG, PNG, GIF, WebP or TIFF images.");
  let scanStatus: "CLEAN" | "NOT_SCANNED";
  try {
    const r = await scanBytes(file.bytes);
    if (r === "INFECTED") throw new ValidationError("This file was rejected by the virus check and was not saved.");
    scanStatus = r;
  } catch (e) {
    if (e instanceof ScanUnavailableError) throw new ValidationError("The virus check could not run just now, so the file was not saved. Please try again in a few minutes.");
    throw e;
  }
  const filename = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 140) || "document";
  const storageKey = `${folder}/${organisationId}/${randomUUID()}`;
  await storage().put(storageKey, file.bytes, sniffed.contentType);
  return { filename, contentType: sniffed.contentType, sizeBytes: file.bytes.length, sha256: sha256(file.bytes), storageKey, scanStatus };
}

/** The service user, only if the caller may see them (organisation, branch and area scope). */
export async function serviceUserForRecords(ctx: Ctx, serviceUserId: string, perm: OrgPermission = "serviceUser.view") {
  requireOrgPermission(ctx, perm);
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, organisationId: true, firstName: true, lastName: true, preferredName: true } });
  if (!su) throw new NotFoundError("Service user");
  return su;
}

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)
  .refine((v) => v === undefined || isIsoDate(v), "Dates must be real dates");

const detailsSchema = z
  .object({
    name: z.string().trim().min(2, "Give the document a name").max(160, "Keep the name under 160 characters"),
    category: z.string().trim().min(1, "Choose a category"),
    issuingAuthority: z.string().trim().max(160).optional().transform((v) => v || undefined),
    receivedOn: optionalDate,
    effectiveFrom: optionalDate,
    expiresOn: optionalDate,
    notes: z.string().trim().max(4000).optional().transform((v) => v || undefined),
    markSensitive: z.boolean().default(false),
  })
  .refine((d) => !d.effectiveFrom || !d.expiresOn || d.expiresOn >= d.effectiveFrom, { message: "The expiry date cannot be before the effective date" })
  .refine((d) => !d.receivedOn || d.receivedOn <= londonDate(), { message: "The date received cannot be in the future" });
export type DocumentDetails = z.input<typeof detailsSchema>;

function parseDetails(section: ServiceUserDocumentSection, input: DocumentDetails) {
  const p = detailsSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the document details");
  if (!categoriesFor(section).some((c) => c.key === p.data.category)) throw new ValidationError(`Choose a ${DOCUMENT_SECTIONS[section].toLowerCase().replace(/s$/, "")} category`);
  const d = p.data;
  return {
    name: d.name,
    category: d.category,
    issuingAuthority: d.issuingAuthority ?? null,
    receivedOn: d.receivedOn ? dbDate(d.receivedOn) : null,
    effectiveFrom: d.effectiveFrom ? dbDate(d.effectiveFrom) : null,
    expiresOn: d.expiresOn ? dbDate(d.expiresOn) : null,
    notes: d.notes ?? null,
    sensitive: categoryIsSensitive(section, d.category) || d.markSensitive,
  };
}

const canSeeSensitive = (ctx: Ctx) => hasOrgPermission(ctx, "serviceUser.sensitive");

/** A care-plan review prompt when a new Council Support Plan arrives (Part 9). Bell only; nothing is sent outside. */
async function promptCarePlanReview(tx: Prisma.TransactionClient, organisationId: string, actorId: string, su: { id: string; firstName: string; lastName: string }, documentId: string, version: number) {
  const ms = await tx.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER"] } }, select: { userId: true } });
  const users = [...new Set(ms.map((m) => m.userId))].filter((u) => u !== actorId);
  if (!users.length) return;
  await tx.notification.createMany({
    data: users.map((userId) => ({
      organisationId,
      userId,
      type: "care.plan.review-prompt",
      title: `New Council Support Plan for ${su.firstName} ${su.lastName}`,
      body: "A new or updated Council Support Plan was uploaded. Check whether the care plan needs reviewing. The care plan has not been changed.",
      reason: "You approve care plans for this organisation.",
      actionUrl: `/rota/service-users/${su.id}?tab=documents&section=council&doc=${documentId}`,
      dedupeKey: `su-doc:${documentId}:v${version}:${userId}`,
    })),
    skipDuplicates: true,
  });
}

export async function uploadDocument(ctx: Ctx, serviceUserId: string, section: ServiceUserDocumentSection, details: DocumentDetails, file: UploadedFile) {
  const su = await serviceUserForRecords(ctx, serviceUserId, "serviceUser.documents");
  const d = parseDetails(section, details);
  if (d.sensitive && !canSeeSensitive(ctx) && !categoryIsSensitive(section, d.category)) {
    // Marking a document sensitive would hide it from the uploader; only people who can open sensitive files may do that.
    throw new ForbiddenError("Only a registered manager or administrator can mark a document as sensitive");
  }
  const stored = await storePrivateFile(su.organisationId, "su-documents", file);
  return db.$transaction(async (tx) => {
    const doc = await tx.serviceUserDocument.create({ data: { organisationId: su.organisationId, serviceUserId: su.id, section, ...d, createdById: ctx.userId } });
    await tx.serviceUserDocumentVersion.create({ data: { organisationId: su.organisationId, documentId: doc.id, version: 1, ...stored, uploadedById: ctx.userId } });
    await audit({ organisationId: su.organisationId, actorId: ctx.userId, action: "suDocument.uploaded", entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: su.id, section, category: d.category, filename: stored.filename, sizeBytes: stored.sizeBytes, sensitive: d.sensitive } }, tx);
    if (section === "COUNCIL" && d.category === "COUNCIL_SUPPORT_PLAN") await promptCarePlanReview(tx, su.organisationId, ctx.userId, su, doc.id, 1);
    return doc;
  });
}

/** Loads a document the caller may act on: in their scope, and openable if sensitive. */
async function documentFor(ctx: Ctx, documentId: string, perm: OrgPermission) {
  const organisationId = requireOrgPermission(ctx, perm);
  const doc = await db.serviceUserDocument.findFirst({ where: { id: documentId, organisationId } });
  if (!doc) throw new NotFoundError("Document");
  await serviceUserForRecords(ctx, doc.serviceUserId);
  if (doc.sensitive && !canSeeSensitive(ctx)) throw new ForbiddenError("This document is restricted. Only a registered manager or administrator can open it.");
  return doc;
}

/** Replacing adds a new version; the earlier file stays available in the version history. */
export async function replaceDocument(ctx: Ctx, documentId: string, lockVersion: number, file: UploadedFile, changeNote?: string) {
  const doc = await documentFor(ctx, documentId, "serviceUser.documents");
  if (doc.archivedAt) throw new ConflictError("This document is archived. Restore it before replacing the file.");
  if (doc.lockVersion !== lockVersion) throw new ConflictError("Someone else changed this document. Reload the page and try again.");
  const note = changeNote?.trim().slice(0, 1000) || null;
  const stored = await storePrivateFile(doc.organisationId, "su-documents", file);
  return db.$transaction(async (tx) => {
    const next = doc.currentVersion + 1;
    const moved = await tx.serviceUserDocument.updateMany({ where: { id: doc.id, lockVersion }, data: { currentVersion: next, lockVersion: { increment: 1 } } });
    if (moved.count !== 1) throw new ConflictError("Someone else changed this document. Reload the page and try again.");
    await tx.serviceUserDocumentVersion.create({ data: { organisationId: doc.organisationId, documentId: doc.id, version: next, ...stored, changeNote: note, uploadedById: ctx.userId } });
    await audit({ organisationId: doc.organisationId, actorId: ctx.userId, action: "suDocument.replaced", entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: doc.serviceUserId, version: next, filename: stored.filename, changeNote: note } }, tx);
    if (doc.section === "COUNCIL" && doc.category === "COUNCIL_SUPPORT_PLAN") {
      const su = await tx.serviceUser.findUniqueOrThrow({ where: { id: doc.serviceUserId }, select: { id: true, firstName: true, lastName: true } });
      await promptCarePlanReview(tx, doc.organisationId, ctx.userId, su, doc.id, next);
    }
    return next;
  });
}

const fmtField = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);

/** Changes the details (not the file). Every change is recorded with its old and new value. */
export async function updateDocumentDetails(ctx: Ctx, documentId: string, lockVersion: number, details: DocumentDetails) {
  const doc = await documentFor(ctx, documentId, "serviceUser.documents");
  const d = parseDetails(doc.section, details);
  if (doc.sensitive && !d.sensitive && !canSeeSensitive(ctx)) throw new ForbiddenError("Only a registered manager or administrator can remove the sensitive marking");
  if (!doc.sensitive && d.sensitive && !canSeeSensitive(ctx) && !categoryIsSensitive(doc.section, d.category)) throw new ForbiddenError("Only a registered manager or administrator can mark a document as sensitive");
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(d) as (keyof typeof d)[]) {
    const from = fmtField(doc[k]);
    const to = fmtField(d[k]);
    if (from !== to) changes[k] = { from, to };
  }
  if (!Object.keys(changes).length) return;
  await db.$transaction(async (tx) => {
    const r = await tx.serviceUserDocument.updateMany({ where: { id: doc.id, lockVersion }, data: { ...d, lockVersion: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("Someone else changed this document. Reload the page and try again.");
    await audit({ organisationId: doc.organisationId, actorId: ctx.userId, action: "suDocument.updated", entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: doc.serviceUserId, changes } as Prisma.InputJsonValue }, tx);
  });
}

/** Moves a document to Historical documents (never deletes it), or brings it back. */
export async function setDocumentArchived(ctx: Ctx, documentId: string, lockVersion: number, archived: boolean, reason?: string) {
  const doc = await documentFor(ctx, documentId, "serviceUser.documents");
  const why = reason?.trim().slice(0, 500) || "";
  if (archived && why.length < 3) throw new ValidationError("Say why the document is being archived");
  if (archived === Boolean(doc.archivedAt)) return;
  await db.$transaction(async (tx) => {
    const r = await tx.serviceUserDocument.updateMany({ where: { id: doc.id, lockVersion }, data: archived ? { archivedAt: new Date(), archivedById: ctx.userId, archiveReason: why, lockVersion: { increment: 1 } } : { archivedAt: null, archivedById: null, archiveReason: null, lockVersion: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("Someone else changed this document. Reload the page and try again.");
    await audit({ organisationId: doc.organisationId, actorId: ctx.userId, action: archived ? "suDocument.archived" : "suDocument.restored", entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: doc.serviceUserId, reason: why || null } }, tx);
  });
}

export interface DocumentRow {
  id: string;
  section: ServiceUserDocumentSection;
  category: string;
  categoryLabel: string;
  /** Restricted rows show only their category: the viewer cannot open sensitive documents. */
  restricted: boolean;
  name: string;
  issuingAuthority: string | null;
  receivedOn: Date | null;
  effectiveFrom: Date | null;
  expiresOn: Date | null;
  expired: boolean;
  notes: string | null;
  sensitive: boolean;
  currentVersion: number;
  lockVersion: number;
  archivedAt: Date | null;
  archiveReason: string | null;
  createdAt: Date;
  latest: { version: number; filename: string; contentType: string; sizeBytes: number; uploadedById: string; uploadedAt: Date } | null;
}

/** One section's documents for one person: current first by category, then archived ones. */
export async function listDocuments(ctx: Ctx, serviceUserId: string, section: ServiceUserDocumentSection): Promise<DocumentRow[]> {
  const su = await serviceUserForRecords(ctx, serviceUserId);
  const docs = await db.serviceUserDocument.findMany({
    where: { organisationId: su.organisationId, serviceUserId: su.id, section },
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, filename: true, contentType: true, sizeBytes: true, uploadedById: true, uploadedAt: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
  const sensitiveOk = canSeeSensitive(ctx);
  const today = dbDate(londonDate());
  const order = categoriesFor(section).map((c) => c.key);
  return docs
    .map((d) => {
      const restricted = d.sensitive && !sensitiveOk;
      return {
        id: d.id,
        section: d.section,
        category: d.category,
        categoryLabel: categoryLabel(section, d.category),
        restricted,
        name: restricted ? "Restricted document" : d.name,
        issuingAuthority: restricted ? null : d.issuingAuthority,
        receivedOn: d.receivedOn,
        effectiveFrom: restricted ? null : d.effectiveFrom,
        expiresOn: d.expiresOn,
        expired: !!d.expiresOn && d.expiresOn < today,
        notes: restricted ? null : d.notes,
        sensitive: d.sensitive,
        currentVersion: d.currentVersion,
        lockVersion: d.lockVersion,
        archivedAt: d.archivedAt,
        archiveReason: restricted ? null : d.archiveReason,
        createdAt: d.createdAt,
        latest: restricted ? null : (d.versions[0] ?? null),
      };
    })
    .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || order.indexOf(a.category) - order.indexOf(b.category) || b.createdAt.getTime() - a.createdAt.getTime());
}

/** A document with every version and its history (uploads, replacements, changes, archiving, previews, downloads). */
export async function getDocument(ctx: Ctx, documentId: string) {
  const doc = await documentFor(ctx, documentId, "serviceUser.view");
  const [versions, history] = await Promise.all([
    db.serviceUserDocumentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "desc" }, select: { id: true, version: true, filename: true, contentType: true, sizeBytes: true, changeNote: true, uploadedById: true, uploadedAt: true, scanStatus: true } }),
    db.auditLog.findMany({ where: { organisationId: doc.organisationId, entityType: "ServiceUserDocument", entityId: doc.id }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return { doc: { ...doc, categoryLabel: categoryLabel(doc.section, doc.category) }, versions, history };
}

/** Streams one version (the current one by default) after every check, and records the preview or download. */
export async function readDocumentFile(ctx: Ctx, documentId: string, opts: { version?: number; mode: "preview" | "download" }) {
  const doc = await documentFor(ctx, documentId, "serviceUser.view");
  const v = await db.serviceUserDocumentVersion.findFirst({ where: { documentId: doc.id, version: opts.version ?? doc.currentVersion } });
  if (!v) throw new NotFoundError("Document version");
  const inline = opts.mode === "preview" && previewable(v.contentType);
  const bytes = await storage().get(v.storageKey);
  await audit({ organisationId: doc.organisationId, actorId: ctx.userId, action: inline ? "suDocument.previewed" : "suDocument.downloaded", entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: doc.serviceUserId, version: v.version } });
  return { filename: v.filename, contentType: v.contentType, bytes, inline };
}

export interface DocumentCounts {
  council: { uploaded: number; missing: { key: string; label: string }[]; expired: number };
  other: { uploaded: number; missing: { key: string; label: string }[]; expired: number };
}

/**
 * Figures for the profile's compliance overview, from real records only. Missing = a required council document with no
 * current (not archived) copy; Other Documents has no required documents, so nothing there is ever "missing". Expired
 * counts current documents past their expiry date. Null when the viewer may not see the person's records.
 */
export async function documentCounts(ctx: Ctx, serviceUserId: string): Promise<DocumentCounts | null> {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "serviceUser.view")) return null;
  let su;
  try {
    su = await serviceUserForRecords(ctx, serviceUserId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
  const docs = await db.serviceUserDocument.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id, archivedAt: null }, select: { section: true, category: true, expiresOn: true } });
  const today = dbDate(londonDate());
  const forSection = (section: ServiceUserDocumentSection) => {
    const own = docs.filter((d) => d.section === section);
    const required: readonly string[] = section === "COUNCIL" ? REQUIRED_COUNCIL_CATEGORIES : [];
    return {
      uploaded: own.length,
      missing: required.filter((k) => !own.some((d) => d.category === k)).map((k) => ({ key: k, label: categoryLabel(section, k) })),
      expired: own.filter((d) => d.expiresOn && d.expiresOn < today).length,
    };
  };
  return { council: forSection("COUNCIL"), other: forSection("OTHER") };
}

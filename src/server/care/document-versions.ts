import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, fromDbDate, isIsoDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { promptCarePlanReview, serviceUserForRecords } from "./su-documents";

/**
 * Version control for a person's documents, above all the council support plan (AI CSB Coordinator brief, 6 Nov
 * 2026, phase 8). Every file is a version (V1, V2, V3...) with its own dates: on the document, received, uploaded,
 * effective and approved. Its status is an append-only log: Pending review, Current, Superseded, Withdrawn or
 * Rejected. A revised plan filed by the Care Coordinator waits as Pending review; the earlier plan stays Current
 * until a person approves the new one. "In force on a date" answers which version applied that day, so completed
 * visits are always read against the instructions of their own day and are never rewritten.
 */

export const VERSION_STATUS = { PENDING_REVIEW: "Pending review", CURRENT: "Current", SUPERSEDED: "Superseded", WITHDRAWN: "Withdrawn", REJECTED: "Rejected" } as const;
export type VersionStatus = keyof typeof VERSION_STATUS;

type Tx = Prisma.TransactionClient;
type VersionRow = { id: string; version: number; statuses: { status: string; at: Date; actorId: string; note: string | null }[] };

/** The status of each version: its latest log row, or, for versions from before version control, Current for the
 *  document's current version and Superseded for the rest. */
export function statusOf(v: VersionRow, currentVersion: number): VersionStatus {
  const last = [...v.statuses].sort((a, b) => a.at.getTime() - b.at.getTime()).at(-1);
  if (last && last.status in VERSION_STATUS) return last.status as VersionStatus;
  return v.version === currentVersion ? "CURRENT" : "SUPERSEDED";
}

/** Records a status for a version (inside the caller's transaction). */
export async function recordVersionStatus(tx: Tx, input: { organisationId: string; documentId: string; versionId: string; status: VersionStatus; actorId: string; note?: string | null }) {
  await tx.serviceUserDocumentVersionStatus.create({ data: { organisationId: input.organisationId, documentId: input.documentId, versionId: input.versionId, status: input.status, note: input.note ?? null, actorId: input.actorId } });
}

/**
 * Adds a file as a new version waiting for review: the current version stays in force until it is approved. Used when
 * the Care Coordinator files a revised support plan for someone who already has one.
 */
export async function addPendingVersion(tx: Tx, input: { organisationId: string; documentId: string; actorId: string; file: { filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string; scanStatus: string }; documentDate: Date | null; receivedOn: Date | null; effectiveFrom: Date | null; intakeId: string | null; note: string }) {
  const last = await tx.serviceUserDocumentVersion.findFirst({ where: { documentId: input.documentId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const row = await tx.serviceUserDocumentVersion.create({ data: { organisationId: input.organisationId, documentId: input.documentId, version, ...input.file, changeNote: input.note.slice(0, 1000), uploadedById: input.actorId, documentDate: input.documentDate, receivedOn: input.receivedOn, effectiveFrom: input.effectiveFrom, intakeId: input.intakeId } });
  await recordVersionStatus(tx, { organisationId: input.organisationId, documentId: input.documentId, versionId: row.id, status: "PENDING_REVIEW", actorId: input.actorId, note: input.note.slice(0, 1000) });
  await tx.serviceUserDocument.update({ where: { id: input.documentId }, data: { lockVersion: { increment: 1 } } });
  return row;
}

async function documentInScope(ctx: Ctx, documentId: string) {
  const organisationId = requireOrgPermission(ctx, "serviceUser.view");
  const doc = await db.serviceUserDocument.findFirst({ where: { id: documentId, organisationId } });
  if (!doc) throw new NotFoundError("Document");
  await serviceUserForRecords(ctx, doc.serviceUserId);
  if (doc.sensitive && !hasOrgPermission(ctx, "serviceUser.sensitive")) throw new ForbiddenError("This document is restricted. Only a registered manager or administrator can open it.");
  return doc;
}

/** Every version with its dates, status, who approved it and when, and the status history. */
export async function documentHistory(ctx: Ctx, documentId: string) {
  const doc = await documentInScope(ctx, documentId);
  const versions = await db.serviceUserDocumentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: "desc" }, include: { statuses: { orderBy: { at: "asc" }, select: { status: true, at: true, actorId: true, note: true } } } });
  return {
    document: { id: doc.id, name: doc.name, currentVersion: doc.currentVersion, lockVersion: doc.lockVersion },
    versions: versions.map((v) => {
      const approved = v.statuses.find((s) => s.status === "CURRENT");
      return {
        id: v.id, version: v.version, label: `V${v.version}`, status: statusOf(v, doc.currentVersion), filename: v.filename, changeNote: v.changeNote, intakeId: v.intakeId,
        documentDate: v.documentDate ? fromDbDate(v.documentDate) : null, receivedOn: v.receivedOn ? fromDbDate(v.receivedOn) : null, uploadedAt: v.uploadedAt, uploadedById: v.uploadedById,
        effectiveFrom: v.effectiveFrom ? fromDbDate(v.effectiveFrom) : null, approvedAt: approved?.at ?? null, approvedById: approved?.actorId ?? null,
        history: v.statuses.map((s) => ({ status: s.status as VersionStatus, at: s.at, actorId: s.actorId, note: s.note })),
      };
    }),
  };
}

/** The version in force on a date: the latest approved version (never rejected or withdrawn) effective by that day. */
export async function versionInForce(ctx: Ctx, documentId: string, date: string) {
  if (!isIsoDate(date)) throw new ValidationError("Choose a date");
  const h = await documentHistory(ctx, documentId);
  const day = dbDate(date).getTime();
  const candidates = h.versions.filter((v) => {
    if (v.status === "REJECTED" || v.status === "PENDING_REVIEW") return false;
    const withdrawn = v.history.find((s) => s.status === "WITHDRAWN");
    if (withdrawn && withdrawn.at.getTime() <= day + 86_399_999) return false;
    const from = v.effectiveFrom ? dbDate(v.effectiveFrom).getTime() : (v.approvedAt ?? v.uploadedAt).getTime();
    return from <= day + 86_399_999;
  });
  return candidates.sort((a, b) => b.version - a.version)[0] ?? null;
}

/** A version next to the one before it: what changed in its dates and file, and the intake that compared the content. */
export async function compareWithPrevious(ctx: Ctx, documentId: string, version: number) {
  const h = await documentHistory(ctx, documentId);
  const v = h.versions.find((x) => x.version === version);
  if (!v) throw new NotFoundError("Document version");
  const prev = h.versions.filter((x) => x.version < version).sort((a, b) => b.version - a.version)[0] ?? null;
  const field = (label: string, a: string | null, b: string | null) => ({ label, previous: a, this: b, changed: (a ?? "") !== (b ?? "") });
  return {
    version: v, previous: prev,
    fields: prev ? [
      field("Date on the document", prev.documentDate, v.documentDate), field("Date received", prev.receivedOn, v.receivedOn), field("Effective from", prev.effectiveFrom, v.effectiveFrom),
      field("File", prev.filename, v.filename), field("Status", VERSION_STATUS[prev.status], VERSION_STATUS[v.status]),
    ] : [],
  };
}

const DECIDED = { APPROVE: "approved", REJECT: "rejected", WITHDRAW: "withdrawn" } as const;
const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT", "WITHDRAW"]), note: z.string().trim().max(1000).optional() });

/**
 * A person decides a version: approve a pending one (it becomes Current, the one before Superseded), reject a pending
 * one, or withdraw one (a withdrawn current version hands back to the most recent earlier approved version).
 */
export async function decideVersion(ctx: Ctx, documentId: string, version: number, input: z.input<typeof decisionSchema>) {
  const p = decisionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the decision");
  requireOrgPermission(ctx, "serviceUser.documents");
  const doc = await documentInScope(ctx, documentId);
  const { decision, note } = p.data;
  if ((decision === "REJECT" || decision === "WITHDRAW") && !note) throw new ValidationError(decision === "REJECT" ? "Say why the version is rejected" : "Say why the version is withdrawn");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ServiceUserDocument" WHERE id = ${doc.id} FOR UPDATE`;
    const fresh = await tx.serviceUserDocument.findUniqueOrThrow({ where: { id: doc.id } });
    if (fresh.archivedAt) throw new ConflictError("This document is archived. Restore it first.");
    const versions = await tx.serviceUserDocumentVersion.findMany({ where: { documentId: doc.id }, include: { statuses: true }, orderBy: { version: "asc" } });
    const v = versions.find((x) => x.version === version);
    if (!v) throw new NotFoundError("Document version");
    const status = statusOf(v, fresh.currentVersion);
    const base = { organisationId: doc.organisationId, documentId: doc.id, actorId: ctx.userId };
    let currentVersion = fresh.currentVersion;
    if (decision === "APPROVE" || decision === "REJECT") {
      if (status !== "PENDING_REVIEW") throw new ConflictError(`V${version} is ${VERSION_STATUS[status].toLowerCase()}, not waiting for review`);
      if (decision === "REJECT") {
        await recordVersionStatus(tx, { ...base, versionId: v.id, status: "REJECTED", note });
      } else {
        for (const o of versions) if (o.id !== v.id && statusOf(o, fresh.currentVersion) === "CURRENT") await recordVersionStatus(tx, { ...base, versionId: o.id, status: "SUPERSEDED", note: `Superseded by V${version}` });
        await recordVersionStatus(tx, { ...base, versionId: v.id, status: "CURRENT", note: note ?? null });
        currentVersion = version;
        if (fresh.section === "COUNCIL" && fresh.category === "COUNCIL_SUPPORT_PLAN") {
          const su = await tx.serviceUser.findUniqueOrThrow({ where: { id: fresh.serviceUserId }, select: { id: true, firstName: true, lastName: true } });
          await promptCarePlanReview(tx, doc.organisationId, ctx.userId, su, doc.id, version);
        }
      }
    } else {
      if (status !== "CURRENT" && status !== "PENDING_REVIEW") throw new ConflictError(`V${version} is ${VERSION_STATUS[status].toLowerCase()} and cannot be withdrawn`);
      await recordVersionStatus(tx, { ...base, versionId: v.id, status: "WITHDRAWN", note });
      if (status === "CURRENT") {
        const back = [...versions].reverse().find((o) => o.version < version && statusOf(o, fresh.currentVersion) === "SUPERSEDED");
        if (back) {
          await recordVersionStatus(tx, { ...base, versionId: back.id, status: "CURRENT", note: `In force again after V${version} was withdrawn` });
          currentVersion = back.version;
        }
      }
    }
    await tx.serviceUserDocument.update({ where: { id: doc.id }, data: { currentVersion, lockVersion: { increment: 1 } } });
    await audit({ organisationId: doc.organisationId, actorId: ctx.userId, action: `suDocument.version.${DECIDED[decision]}`, entityType: "ServiceUserDocument", entityId: doc.id, data: { serviceUserId: doc.serviceUserId, version, note: note ?? null, currentVersion } }, tx);
    return { currentVersion };
  });
}

/** The person's current support plan document, if any (the one a revised plan becomes a new version of). */
export async function currentSupportPlan(tx: Tx, serviceUserId: string) {
  return tx.serviceUserDocument.findFirst({ where: { serviceUserId, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", archivedAt: null }, orderBy: { createdAt: "desc" } });
}

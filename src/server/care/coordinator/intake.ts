import type { Prisma, ServiceUserDocumentSection } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fromDbDate, isIsoDate } from "@/lib/london";
import {
  ACCEPTED, APPLY_ORDER, DECISIONS, OPEN_DECISIONS, RESTRICTED_PERSON_FIELDS, RESTRICTED_SECTIONS, SECTION_KEYS,
  UNCLEAR_REFERENCE, destinationSchema, displayValue, filingFor, parseValue, reconcileHours, sectionLabel, type IntakeSection,
} from "@/lib/care-coordinator-rules";
import { registerCheckInTx } from "../external-references";
import type { FundedBy } from "@/lib/su-import-rules";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { storage } from "@/server/storage";
import { categoriesFor, categoryLabel, storePrivateFile, type UploadedFile } from "../su-documents";
import { findPossibleDuplicates } from "../su-import";
import { pdfPages, readDocument } from "./reader";
import { getAiProvider } from "@/server/ai";

type Tx = Prisma.TransactionClient;

/**
 * AI Care Coordinator intake (4 Nov 2026).
 *
 * READ → EXTRACT → CLASSIFY → MAP → COMPARE → FLAG → COORDINATOR REVIEW → MANAGER APPROVAL → APPLY (apply.ts).
 *
 *  - An intake is saved as it goes: documents, every fact with its source page, and every decision. Nothing reaches the
 *    service user's record until a manager has approved the section and someone presses Save to record.
 *  - Who may see what: office staff (serviceUser.edit, rota.edit, serviceUser.documents) run intakes. Facts from
 *    restricted documents, medication, incident and skin findings, and date of birth / NHS number are shown only to
 *    people with serviceUser.sensitive; everyone else sees that a restricted fact exists, never its content.
 *  - Managers (care.plan.approve) decide each profile section. The person who submitted the intake, or who decided or
 *    edited a fact in that section, cannot approve it (separation of duties). Every decision is audited with the
 *    signed-in person's id; a typed name is never accepted as an approval.
 */

export const MAX_INTAKE_DOCUMENTS = 12;

export function coordinatorAccess(ctx: Ctx) {
  requireOrgPermission(ctx, "serviceUser.edit");
  requireOrgPermission(ctx, "rota.edit");
  requireOrgPermission(ctx, "serviceUser.documents");
  return {
    sensitive: hasOrgPermission(ctx, "serviceUser.sensitive"),
    approve: hasOrgPermission(ctx, "care.plan.approve"),
    medication: hasOrgPermission(ctx, "medication.manage"),
    build: hasOrgPermission(ctx, "rota.build"),
  };
}
export type CoordinatorAccess = ReturnType<typeof coordinatorAccess>;

async function scopeFor(ctx: Ctx) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return { access, scope };
}

/** The intake, locked for update when asked, only inside the caller's organisation. */
export async function intakeInScope(tx: Tx | typeof db, scope: Scope, id: string, lock = false) {
  if (lock) await (tx as Tx).$queryRaw`SELECT id FROM "CareIntake" WHERE id = ${id} AND "organisationId" = ${scope.organisationId} FOR UPDATE`;
  const intake = await tx.careIntake.findFirst({ where: { id, organisationId: scope.organisationId } });
  if (!intake) throw new NotFoundError("Intake");
  if (intake.serviceUserId) {
    // An intake for a person outside the caller's areas or branches is invisible to them.
    const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId }, select: { id: true } });
    if (!su) throw new NotFoundError("Intake");
  }
  return intake;
}

const isRestrictedFact = (f: { section: string; destination: string }, docSensitive: boolean) =>
  docSensitive || RESTRICTED_SECTIONS.has(f.section) || (f.destination.startsWith("person.") && RESTRICTED_PERSON_FIELDS.has(f.destination.slice(7)));

// ── Creating an intake and adding documents ────────────────────────────────

const createSchema = z.object({
  title: z.string().trim().min(3, "Give the intake a name, e.g. 'New referral, Stepney'").max(120),
  mode: z.enum(["NEW", "EXISTING"]).default("NEW"),
  serviceUserId: z.string().trim().optional().transform((v) => v || undefined),
  areaId: z.string().trim().optional().transform((v) => v || undefined),
});

export async function createIntake(ctx: Ctx, input: z.input<typeof createSchema>) {
  const { scope } = await scopeFor(ctx);
  const p = createSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the details");
  const d = p.data;
  if (d.mode === "EXISTING" && !d.serviceUserId) throw new ValidationError("Choose the person this intake updates");
  return db.$transaction(async (tx) => {
    const org = scope.organisationId;
    if (d.serviceUserId) {
      const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: d.serviceUserId }, select: { id: true } });
      if (!su) throw new NotFoundError("Service user");
    }
    if (d.areaId) {
      const area = await tx.area.findFirst({ where: { id: d.areaId, organisationId: org, active: true } });
      if (!area || (scope.areaIds && !scope.areaIds.includes(area.id))) throw new ValidationError("Choose one of your areas");
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`care-intake-ref:${org}`}))`;
    const count = await tx.careIntake.count({ where: { organisationId: org } });
    const intake = await tx.careIntake.create({
      data: { organisationId: org, reference: `CI-${String(count + 1).padStart(4, "0")}`, title: d.title, mode: d.mode, serviceUserId: d.mode === "EXISTING" ? d.serviceUserId! : null, areaId: d.areaId ?? null, createdById: ctx.userId },
    });
    await tx.careIntakeSection.createMany({ data: SECTION_KEYS.map((section) => ({ organisationId: org, intakeId: intake.id, section })) });
    await audit({ organisationId: org, actorId: ctx.userId, action: "coordinator.intake.created", entityType: "CareIntake", entityId: intake.id, data: { reference: intake.reference, mode: d.mode, serviceUserId: intake.serviceUserId } }, tx);
    return intake;
  });
}

/** Stores the originals privately (checked and virus-scanned), keeps each page's text, then reads every document. */
export async function addDocuments(ctx: Ctx, intakeId: string, files: UploadedFile[]) {
  const { scope } = await scopeFor(ctx);
  if (!files.length) throw new ValidationError("Choose at least one document");
  const intake = await intakeInScope(db, scope, intakeId);
  if (intake.status !== "DRAFT") throw new ConflictError("Documents can only be added while the coordinator is reviewing");
  const existing = await db.careIntakeDocument.count({ where: { intakeId } });
  if (existing + files.length > MAX_INTAKE_DOCUMENTS) throw new ValidationError(`An intake can hold at most ${MAX_INTAKE_DOCUMENTS} documents`);
  const created: string[] = [];
  for (const [i, f] of files.entries()) {
    const stored = await storePrivateFile(scope.organisationId, "care-intake", f);
    let pages: string[] = [];
    let readNote: string | null = null;
    if (stored.contentType === "application/pdf") {
      try {
        pages = await pdfPages(f.bytes);
      } catch {
        readNote = "The PDF could not be opened for reading. Read it and add the facts by hand.";
      }
    } else readNote = "Only PDFs are read. This file is kept and filed; add its facts by hand.";
    const { classifyText } = await import("@/lib/care-coordinator-rules");
    const guess = classifyText(pages.join("\n"));
    const filing = filingFor(guess.kind, guess.issuerKind);
    const cat = categoriesFor(filing.section).find((c) => c.key === filing.category);
    const sensitive = !!cat?.sensitive || guess.issuerKind === "NHS" || guess.issuerKind === "GP";
    const doc = await db.careIntakeDocument.create({
      data: {
        organisationId: scope.organisationId, intakeId, position: existing + i, filename: stored.filename, contentType: stored.contentType, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.storageKey, scanStatus: stored.scanStatus,
        section: filing.section, category: filing.category, name: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 160) || `Document ${existing + i + 1}`,
        issuer: guess.issuer?.slice(0, 160) ?? null, issuerKind: guess.issuerKind, documentDate: guess.documentDate ? new Date(`${guess.documentDate}T00:00:00Z`) : null, sensitive,
        pageCount: pages.length || null, pageText: pages as Prisma.InputJsonValue, readStatus: readNote ? "UNREADABLE" : "PENDING", readNote, createdById: ctx.userId,
      },
    });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.document.uploaded", entityType: "CareIntake", entityId: intakeId, data: { documentId: doc.id, filename: stored.filename.slice(0, 140), sizeBytes: stored.sizeBytes, sha256: stored.sha256, pages: pages.length, category: filing.category, sensitive } });
    created.push(doc.id);
  }
  const results = [];
  for (const id of created) {
    const d = await db.careIntakeDocument.findUniqueOrThrow({ where: { id } });
    if (d.readStatus === "PENDING") results.push(await readIntakeDocument(ctx, id).catch((e: unknown) => ({ documentId: id, facts: 0, error: e instanceof Error ? e.message : "Could not read" })));
  }
  return { documents: created.length, results };
}

/**
 * (Re)reads one document. Facts the coordinator has not yet decided are replaced; decided facts are kept. Facts are
 * compared with each other and with the existing record after every read.
 */
export async function readIntakeDocument(ctx: Ctx, documentId: string) {
  const { scope } = await scopeFor(ctx);
  const doc = await db.careIntakeDocument.findFirst({ where: { id: documentId, organisationId: scope.organisationId } });
  if (!doc) throw new NotFoundError("Document");
  const intake = await intakeInScope(db, scope, doc.intakeId);
  if (intake.status !== "DRAFT") throw new ConflictError("Documents can only be read while the coordinator is reviewing");
  if (doc.contentType !== "application/pdf") throw new ValidationError("Only PDFs can be read. Add this document's facts by hand.");
  const settings = await rotaSettings(db, scope.organisationId);
  const bytes = await storage().get(doc.storageKey);
  const pages = (doc.pageText as string[]) ?? [];
  let outcome: Awaited<ReturnType<typeof readDocument>>;
  try {
    outcome = await readDocument({ bytes, filename: doc.filename, categoryLabel: categoryLabel(doc.section, doc.category), pages, aiAllowed: !!settings.careCoordinatorAiEnabledAt });
  } catch (e) {
    await db.careIntakeDocument.update({ where: { id: doc.id }, data: { readStatus: "FAILED", readNote: e instanceof Error ? e.message.slice(0, 500) : "Could not read" } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.document.read-failed", entityType: "CareIntake", entityId: intake.id, data: { documentId: doc.id } });
    throw e;
  }
  const findings = [
    ...outcome.reading.flags.map((f) => ({ kind: "FLAG", text: f.text.slice(0, 1000), page: f.page })),
    ...outcome.reading.missing.map((m) => ({ kind: "MISSING", text: m.slice(0, 500), page: null })),
    ...outcome.reading.unreadable.map((u) => ({ kind: "UNREADABLE", text: u.reason.slice(0, 500), page: u.page })),
  ];
  const fact = outcome.facts;
  await db.$transaction(async (tx) => {
    await intakeInScope(tx, scope, intake.id, true);
    await tx.careIntakeFact.deleteMany({ where: { intakeId: intake.id, sourceDocumentId: doc.id, decision: "PENDING", origin: { not: "MANUAL" } } });
    const start = await tx.careIntakeFact.count({ where: { intakeId: intake.id } });
    const reading = outcome.reading.document;
    const filing = filingFor(reading.kind, reading.issuerKind);
    const cat = categoriesFor(filing.section).find((c) => c.key === filing.category);
    await tx.careIntakeDocument.update({
      where: { id: doc.id },
      data: {
        readStatus: outcome.status, readNote: outcome.reader === "ai" ? `Read by ${outcome.providerName}` : "Read on CSB's own server (no AI). Only labelled lines and timetable rows are recognised.", findings: findings as Prisma.InputJsonValue,
        // A better classification from the reading, unless the coordinator already changed it by hand.
        ...(doc.readStatus === "PENDING" ? { section: filing.section, category: filing.category, sensitive: doc.sensitive || !!cat?.sensitive || reading.issuerKind === "NHS" || reading.issuerKind === "GP" } : {}),
        issuer: doc.issuer ?? reading.issuer?.slice(0, 160) ?? null,
        documentDate: doc.documentDate ?? (reading.documentDate && isIsoDate(reading.documentDate) ? new Date(`${reading.documentDate}T00:00:00Z`) : null),
      },
    });
    if (fact.length) {
      await tx.careIntakeFact.createMany({
        data: fact.map((f, i) => ({
          organisationId: scope.organisationId, intakeId: intake.id, section: f.section, destination: f.destination, label: f.label.slice(0, 200), position: start + i,
          proposed: f.value as Prisma.InputJsonValue, value: f.value as Prisma.InputJsonValue, sourceDocumentId: doc.id, sourcePage: f.page, quote: f.quote?.slice(0, 500) ?? null,
          verification: f.verification, temporal: f.temporal, origin: outcome.reader === "ai" ? "AI" : "BASIC", conflict: [f.check, f.note].filter(Boolean).join(" ") || null,
        })),
      });
    }
    await compareFacts(tx, scope, intake.id);
    await tx.careIntake.update({ where: { id: intake.id }, data: { reader: outcome.reader === "ai" ? outcome.providerName : "basic-reader", lockVersion: { increment: 1 } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.document.read", entityType: "CareIntake", entityId: intake.id, data: { documentId: doc.id, reader: outcome.reader, provider: outcome.providerName, facts: fact.length, unverified: fact.filter((f) => f.verification === "UNVERIFIED").length, findings: findings.length, status: outcome.status } }, tx);
  });
  return { documentId: doc.id, facts: fact.length, status: outcome.status, reader: outcome.reader };
}

const docUpdateSchema = z.object({
  name: z.string().trim().min(2, "Give the document a name").max(160),
  section: z.enum(["COUNCIL", "OTHER"]),
  category: z.string().trim().min(1, "Choose a category"),
  issuer: z.string().trim().max(160).optional().transform((v) => v || null),
  documentDate: z.string().trim().optional().transform((v) => v || null).refine((v) => v === null || isIsoDate(v), "Use a real date"),
  sensitive: z.boolean().default(false),
});

/** The coordinator confirms or corrects where a document is filed. A restricted category stays restricted. */
export async function updateIntakeDocument(ctx: Ctx, documentId: string, input: z.input<typeof docUpdateSchema>) {
  const { scope, access } = await scopeFor(ctx);
  const p = docUpdateSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the document");
  const d = p.data;
  const cat = categoriesFor(d.section as ServiceUserDocumentSection).find((c) => c.key === d.category);
  if (!cat) throw new ValidationError("Choose a category from the list");
  const doc = await db.careIntakeDocument.findFirst({ where: { id: documentId, organisationId: scope.organisationId } });
  if (!doc) throw new NotFoundError("Document");
  const intake = await intakeInScope(db, scope, doc.intakeId);
  if (doc.filedDocumentId) throw new ConflictError("This document has already been filed in the person's record");
  if (intake.status === "CANCELLED" || intake.status === "COMPLETED") throw new ConflictError("This intake is closed");
  if (doc.sensitive && !access.sensitive) throw new ForbiddenError("Only a registered manager or administrator can change a restricted document");
  const sensitive = doc.sensitive || !!cat.sensitive || d.sensitive;
  if (sensitive && !doc.sensitive && !cat.sensitive && !access.sensitive) throw new ForbiddenError("Only a registered manager or administrator can mark a document as restricted");
  await db.careIntakeDocument.update({ where: { id: doc.id }, data: { name: d.name, section: d.section, category: d.category, issuer: d.issuer, documentDate: d.documentDate ? new Date(`${d.documentDate}T00:00:00Z`) : null, sensitive } });
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.document.classified", entityType: "CareIntake", entityId: intake.id, data: { documentId: doc.id, section: d.section, category: d.category, sensitive } });
}

/** The original file, for the review screen, after the same restricted-document check as the person's documents. */
export async function openIntakeDocument(ctx: Ctx, documentId: string) {
  const { scope, access } = await scopeFor(ctx);
  const doc = await db.careIntakeDocument.findFirst({ where: { id: documentId, organisationId: scope.organisationId } });
  if (!doc) throw new NotFoundError("Document");
  await intakeInScope(db, scope, doc.intakeId);
  if (doc.sensitive && !access.sensitive) throw new NotFoundError("Document");
  const bytes = await storage().get(doc.storageKey);
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.document.opened", entityType: "CareIntake", entityId: doc.intakeId, data: { documentId: doc.id } });
  return { filename: doc.filename, contentType: doc.contentType, bytes };
}

// ── Comparing ──────────────────────────────────────────────────────────────

/** Destinations that hold one value: two different values are a conflict for the coordinator to settle. */
const SINGLE = (d: string) => d.startsWith("person.") || d.startsWith("package.") || d === "preference.gender" || d === "careplan.summary" || d === "medication.arrangement";

const existingOf = (su: Record<string, unknown> | null, pkg: Record<string, unknown> | null, d: string): unknown => {
  if (d.startsWith("person.") && su) {
    const v = su[d.slice(7)];
    return v instanceof Date ? fromDbDate(v) : (v ?? null);
  }
  if (d === "preference.gender" && su) return su.carerGenderPreference ?? null;
  if (d.startsWith("package.") && pkg) {
    const k = d.slice(8);
    const v = k === "minutesPerWeek" ? pkg.commissionedMinutesPerWeek : pkg[k];
    return v instanceof Date ? fromDbDate(v) : (v ?? null);
  }
  return null;
};

/** Marks conflicts between documents, with the existing record, possible duplicates in lists, and older documents. */
export async function compareFacts(tx: Tx, scope: Scope, intakeId: string) {
  const intake = await tx.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  const [facts, docs] = await Promise.all([
    tx.careIntakeFact.findMany({ where: { intakeId, appliedAt: null }, orderBy: { position: "asc" } }),
    tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, name: true, documentDate: true } }),
  ]);
  const su = intake.serviceUserId ? await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId } }) : null;
  const pkg = su ? await tx.carePackage.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" } }) : null;
  const contacts = su ? await tx.serviceUserContact.findMany({ where: { serviceUserId: su.id } }) : [];
  const templates = su ? await tx.visitTemplate.findMany({ where: { serviceUserId: su.id, enabled: true }, select: { weekdays: true, startMinute: true } }) : [];
  const docName = (id: string | null) => docs.find((d) => d.id === id)?.name ?? "added by hand";
  const newest = docs.reduce<Date | null>((m, d) => (d.documentDate && (!m || d.documentDate > m) ? d.documentDate : m), null);
  for (const f of facts) {
    if (f.decision === "REJECTED" || f.decision === "DUPLICATE") continue;
    const notes: string[] = [];
    const val = JSON.stringify(f.value);
    if (SINGLE(f.destination)) {
      const others = facts.filter((o) => o.id !== f.id && o.destination === f.destination && o.decision !== "REJECTED" && o.decision !== "DUPLICATE" && JSON.stringify(o.value) !== val);
      const same = facts.find((o) => o.id !== f.id && o.position < f.position && o.destination === f.destination && o.decision !== "REJECTED" && o.decision !== "DUPLICATE" && JSON.stringify(o.value) === val);
      if (same && f.decision === "PENDING") notes.push(`${docName(same.sourceDocumentId)} gives the same value. Mark this one as a duplicate.`);
      for (const o of others.slice(0, 3)) notes.push(`${docName(o.sourceDocumentId)}${o.sourcePage ? ` (page ${o.sourcePage})` : ""} says "${displayValue(o.destination, o.value).slice(0, 120)}".`);
    }
    if (f.destination === "contact") {
      const v = f.value as { name?: string; kind?: string };
      const name = v.name?.toLowerCase().trim();
      if (contacts.some((c) => c.name.toLowerCase().trim() === name && c.kind === v.kind)) notes.push("This contact is already on the person's record.");
      if (facts.some((o) => o.id !== f.id && o.position < f.position && o.destination === "contact" && (o.value as { name?: string }).name?.toLowerCase().trim() === name && o.decision !== "REJECTED" && o.decision !== "DUPLICATE")) notes.push("The same contact appears earlier. Mark one as a duplicate.");
    }
    if (f.destination === "visit") {
      const v = f.value as { weekdays: number[]; startTime: string };
      const [h, m] = v.startTime.split(":").map(Number);
      const st = (h ?? 0) * 60 + (m ?? 0);
      if (templates.some((t) => t.startMinute === st && t.weekdays.some((d) => v.weekdays.includes(d)))) notes.push("The person already has a repeating visit at this time on some of these days.");
      if (facts.some((o) => o.id !== f.id && o.position < f.position && o.destination === "visit" && (o.value as { startTime: string }).startTime === v.startTime && (o.value as { weekdays: number[] }).weekdays.some((d) => v.weekdays.includes(d)) && o.decision !== "REJECTED" && o.decision !== "DUPLICATE")) notes.push("Another visit row starts at the same time on the same day. Check whether it is a continuation of the same row.");
    }
    if (f.destination === "externalReference") {
      const v = f.value as { type: string; issuer: string; value: string; typeUnclear?: boolean };
      if (v.typeUnclear) notes.push(UNCLEAR_REFERENCE);
      const reg = await registerCheckInTx(tx, scope.organisationId, su?.id ?? null, v);
      if (reg.onThisProfile) notes.push("Already on this person's Reference Numbers tab. Mark this one as a duplicate.");
      if (reg.sameOnOtherProfiles && v.type !== "COUNCIL_FRAMEWORK") notes.push("This number is already on another person's profile. Investigate before approving: it will not be linked here.");
      if (reg.sameOnOtherProfiles && v.type === "COUNCIL_FRAMEWORK") notes.push(`Shared framework ID, also recorded for ${reg.sameOnOtherProfiles} other ${reg.sameOnOtherProfiles === 1 ? "person" : "people"}. Not proof of identity.`);
      if (reg.otherTypeElsewhere) notes.push("The same number is recorded elsewhere as a different type or issuer. Check the document before approving.");
      if (facts.some((o) => o.id !== f.id && o.position < f.position && o.destination === "externalReference" && (o.value as { value: string }).value === v.value && o.decision !== "REJECTED" && o.decision !== "DUPLICATE")) notes.push("The same reference appears earlier. Mark this one as a duplicate.");
    }
    if (f.destination === "medication.item") {
      const name = (f.value as { name: string }).name.toLowerCase().split(" ")[0];
      if (facts.some((o) => o.id !== f.id && o.destination === "medication.item" && (o.value as { name: string }).name.toLowerCase().startsWith(name ?? "") && JSON.stringify(o.value) !== val)) notes.push("This medicine appears differently in another document. It goes to reconciliation.");
    }
    const doc = docs.find((d) => d.id === f.sourceDocumentId);
    if (doc?.documentDate && newest && doc.documentDate < newest && SINGLE(f.destination)) notes.push(`From an older document (${fromDbDate(doc.documentDate)}).`);
    const existing = existingOf(su as Record<string, unknown> | null, pkg as Record<string, unknown> | null, f.destination);
    if (existing !== null && existing !== "" && JSON.stringify(existing) !== val && String(existing) !== String(f.value)) notes.push(`The record already says "${String(existing).slice(0, 120)}". Approving this will change it.`);
    const base = f.verification === "UNVERIFIED" ? (f.conflict?.split(/(?<=\.)\s/).find((s) => /quote|scanned/.test(s)) ?? null) : null;
    const conflict = [base, ...notes].filter(Boolean).join(" ") || null;
    if (conflict !== f.conflict || JSON.stringify(existing) !== JSON.stringify(f.existingValue ?? null)) {
      await tx.careIntakeFact.update({ where: { id: f.id }, data: { conflict, existingValue: existing === null ? undefined : (existing as Prisma.InputJsonValue) } });
    }
  }
}

// ── Coordinator decisions ──────────────────────────────────────────────────

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "EDITED", "REJECTED", "CLARIFY", "DUPLICATE", "PENDING"]),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
  question: z.string().trim().max(1000).optional().transform((v) => v || null),
  assignedToId: z.string().trim().optional().transform((v) => v || null),
  value: z.unknown().optional(),
});

async function factForWrite(tx: Tx, scope: Scope, access: CoordinatorAccess, factId: string, lockVersion: number | null) {
  const f = await tx.careIntakeFact.findFirst({ where: { id: factId, organisationId: scope.organisationId } });
  if (!f) throw new NotFoundError("Fact");
  const intake = await intakeInScope(tx, scope, f.intakeId, true);
  const doc = f.sourceDocumentId ? await tx.careIntakeDocument.findUnique({ where: { id: f.sourceDocumentId }, select: { sensitive: true } }) : null;
  if (isRestrictedFact(f, !!doc?.sensitive) && !access.sensitive) throw new ForbiddenError("A registered manager or administrator reviews restricted facts");
  if (f.appliedAt) throw new ConflictError("This fact has already been saved to the record");
  const section = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId: intake.id, section: f.section } } });
  const editable = intake.status === "DRAFT" || ((intake.status === "SUBMITTED" || intake.status === "APPROVED") && (section.status === "RETURNED" || section.status === "INFO_REQUESTED"));
  if (!editable) throw new ConflictError(intake.status === "DRAFT" ? "This intake is closed" : `${sectionLabel(f.section)} is with the manager. Ask them to return it for correction first.`);
  if (lockVersion !== null && f.lockVersion !== lockVersion) throw new ConflictError("Someone else changed this fact since you opened it. Reload to see the latest.");
  return { f, intake };
}

export async function decideFact(ctx: Ctx, factId: string, lockVersion: number | null, input: z.input<typeof decisionSchema>) {
  const { scope, access } = await scopeFor(ctx);
  const p = decisionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the decision");
  const d = p.data;
  return db.$transaction(async (tx) => {
    const { f, intake } = await factForWrite(tx, scope, access, factId, lockVersion);
    let value: unknown = f.value;
    if (d.decision === "EDITED") {
      const parsed = parseValue(f.destination, d.value);
      if (!parsed.ok) throw new ValidationError(parsed.error);
      value = parsed.value;
    }
    if (d.decision === "CLARIFY" && !d.question) throw new ValidationError("Write the question that needs answering");
    if ((d.decision === "REJECTED" || d.decision === "DUPLICATE") && !d.note) throw new ValidationError("Say why, so the manager can see your reasoning");
    if (d.decision === "APPROVED" || d.decision === "EDITED") checkAcceptable(f.destination, value, f.temporal);
    if (d.assignedToId) {
      const m = await tx.membership.findFirst({ where: { organisationId: scope.organisationId, userId: d.assignedToId, deactivatedAt: null } });
      if (!m) throw new ValidationError("Choose someone in your organisation");
    }
    const changedValue = JSON.stringify(value) !== JSON.stringify(f.value);
    await tx.careIntakeFact.update({
      where: { id: f.id },
      data: {
        decision: d.decision, decisionNote: d.note, question: d.decision === "CLARIFY" ? d.question : f.question, assignedToId: d.decision === "CLARIFY" ? d.assignedToId : f.assignedToId,
        decidedById: d.decision === "PENDING" ? null : ctx.userId, decidedAt: d.decision === "PENDING" ? null : new Date(),
        ...(changedValue ? { value: value as Prisma.InputJsonValue, editedById: ctx.userId, editedAt: new Date() } : {}),
        lockVersion: { increment: 1 },
      },
    });
    if (changedValue || d.decision === "REJECTED" || d.decision === "DUPLICATE") await compareFacts(tx, scope, intake.id);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.fact.decided", entityType: "CareIntake", entityId: intake.id, data: { factId: f.id, section: f.section, destination: f.destination, decision: d.decision, edited: changedValue, assignedToId: d.assignedToId } }, tx);
    if (d.decision === "CLARIFY" && d.assignedToId && d.assignedToId !== ctx.userId) {
      await tx.notification.createMany({ data: [{ organisationId: scope.organisationId, userId: d.assignedToId, type: "coordinator.question", title: `Question on intake ${intake.reference}`, body: `A question about ${sectionLabel(f.section).toLowerCase()} needs your answer before the intake can go to a manager.`, reason: "You were asked a question on a Care Coordinator intake.", actionUrl: `/rota/coordinator/${intake.id}?section=${f.section}#fact-${f.id}`, dedupeKey: `coordinator-q:${f.id}:${d.assignedToId}` }], skipDuplicates: true });
    }
  });
}

/** Rules a fact must meet before it can be approved, whatever the screen allowed. */
function checkAcceptable(destination: string, value: unknown, temporal: string) {
  const parsed = parseValue(destination, value);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  if (destination === "externalReference" && (value as { typeUnclear?: boolean }).typeUnclear) throw new ValidationError("Choose what this reference identifies (client, package or framework) with Edit before approving it");
  if (destination === "risk" && !(value as { level: string | null }).level) throw new ValidationError("Set a provisional risk level (it stays a draft until an assessor approves it), or reject this risk");
  if (temporal === "HISTORICAL" && (destination.startsWith("person.") || destination.startsWith("package.") || destination === "visit")) throw new ValidationError("This fact is marked as historical. Edit it to the current value, or reject it.");
}

/** Approves every verified, unconflicted fact the coordinator may see in a section. Restricted or doubtful facts stay. */
export async function approveVerified(ctx: Ctx, intakeId: string, section: string) {
  const { scope, access } = await scopeFor(ctx);
  if (!(SECTION_KEYS as readonly string[]).includes(section)) throw new ValidationError("Unknown section");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status !== "DRAFT") throw new ConflictError("Only an intake in coordinator review can be changed this way");
    const facts = await tx.careIntakeFact.findMany({ where: { intakeId, section, decision: "PENDING", verification: "VERIFIED", conflict: null } });
    const docs = await tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true } });
    let n = 0;
    for (const f of facts) {
      if (isRestrictedFact(f, !!docs.find((d) => d.id === f.sourceDocumentId)?.sensitive) && !access.sensitive) continue;
      try {
        checkAcceptable(f.destination, f.value, f.temporal);
      } catch {
        continue;
      }
      await tx.careIntakeFact.update({ where: { id: f.id }, data: { decision: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), lockVersion: { increment: 1 } } });
      n++;
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.fact.bulk-approved", entityType: "CareIntake", entityId: intakeId, data: { section, approved: n } }, tx);
    return n;
  });
}

const manualSchema = z.object({ destination: z.string().trim().min(1), label: z.string().trim().max(200).optional(), value: z.unknown(), sourceDocumentId: z.string().trim().optional().transform((v) => v || null), sourcePage: z.coerce.number().int().min(1).max(500).optional().nullable() });

/** A fact the coordinator adds by hand (for a scanned page, or something the reader missed). It records who added it. */
export async function addManualFact(ctx: Ctx, intakeId: string, input: z.input<typeof manualSchema>) {
  const { scope, access } = await scopeFor(ctx);
  const p = manualSchema.safeParse(input);
  if (!p.success) throw new ValidationError("Check the fact");
  const dest = destinationSchema(p.data.destination);
  if (!dest) throw new ValidationError("Choose where this goes in the profile");
  const parsed = parseValue(p.data.destination, p.data.value);
  if (!parsed.ok) throw new ValidationError(parsed.error);
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    const section = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: dest.section } } });
    if (!(intake.status === "DRAFT" || section.status === "RETURNED" || section.status === "INFO_REQUESTED")) throw new ConflictError("Facts can only be added while the coordinator is reviewing this section");
    let docSensitive = false;
    if (p.data.sourceDocumentId) {
      const doc = await tx.careIntakeDocument.findFirst({ where: { id: p.data.sourceDocumentId, intakeId } });
      if (!doc) throw new ValidationError("Choose one of this intake's documents");
      docSensitive = doc.sensitive;
    }
    if (isRestrictedFact({ section: dest.section, destination: p.data.destination }, docSensitive) && !access.sensitive) throw new ForbiddenError("A registered manager or administrator adds restricted facts");
    checkAcceptable(p.data.destination, parsed.value, "CURRENT");
    const position = await tx.careIntakeFact.count({ where: { intakeId } });
    const f = await tx.careIntakeFact.create({
      data: { organisationId: scope.organisationId, intakeId, section: dest.section, destination: p.data.destination, label: (p.data.label || dest.label).slice(0, 200), position, proposed: parsed.value as Prisma.InputJsonValue, value: parsed.value as Prisma.InputJsonValue, sourceDocumentId: p.data.sourceDocumentId, sourcePage: p.data.sourcePage ?? null, verification: "MANUAL", origin: "MANUAL", decision: "APPROVED", decidedById: ctx.userId, decidedAt: new Date() },
    });
    await compareFacts(tx, scope, intakeId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.fact.added", entityType: "CareIntake", entityId: intakeId, data: { factId: f.id, section: dest.section, destination: p.data.destination } }, tx);
    return f;
  });
}

// ── Submitting to a manager ────────────────────────────────────────────────

export async function submitIntake(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean; areaId?: string } = {}) {
  const { scope } = await scopeFor(ctx);
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    const facts = await tx.careIntakeFact.findMany({ where: { intakeId } });
    const sections = await tx.careIntakeSection.findMany({ where: { intakeId } });
    const resubmitting = intake.status === "SUBMITTED" || intake.status === "APPROVED";
    const reopen = sections.filter((s) => s.status === "RETURNED" || s.status === "INFO_REQUESTED").map((s) => s.section);
    if (intake.status !== "DRAFT" && !(resubmitting && reopen.length)) throw new ConflictError("This intake is not waiting for the coordinator");
    const scopeFacts = resubmitting ? facts.filter((f) => reopen.includes(f.section)) : facts;
    const open = scopeFacts.filter((f) => OPEN_DECISIONS.has(f.decision) && !f.appliedAt);
    if (open.length) throw new ValidationError(`${open.length} fact${open.length === 1 ? " still needs" : "s still need"} a decision (approve, edit, reject or mark duplicate) or an answer to a question`);
    if (!facts.some((f) => ACCEPTED.has(f.decision))) throw new ValidationError("Nothing has been approved, so there is nothing for a manager to check");
    let areaId = intake.areaId;
    if (intake.mode === "NEW" && !resubmitting) {
      for (const k of ["person.firstName", "person.lastName"]) if (!facts.some((f) => f.destination === k && ACCEPTED.has(f.decision))) throw new ValidationError(`Approve the person's ${k === "person.firstName" ? "first" : "last"} name before sending to a manager`);
      if (opts.areaId) {
        const area = await tx.area.findFirst({ where: { id: opts.areaId, organisationId: scope.organisationId, active: true } });
        if (!area || (scope.areaIds && !scope.areaIds.includes(area.id))) throw new ValidationError("Choose one of your areas");
        areaId = area.id;
      }
      if (scope.areaIds && !areaId) throw new ValidationError("Choose the area the person lives in");
      const name = (k: string) => String(facts.find((f) => f.destination === k && ACCEPTED.has(f.decision))?.value ?? "");
      const dupes = await findPossibleDuplicates(scope, { firstName: name("person.firstName"), lastName: name("person.lastName"), dateOfBirth: name("person.dateOfBirth") || undefined, postcode: name("person.postcode") || undefined });
      if (dupes.length && !opts.notADuplicate) throw new ConflictError(`${dupes[0]!.name} (${dupes[0]!.reference}) is already on record: ${dupes[0]!.reason.toLowerCase()}. Start an intake for that person instead, or tick "This is a different person".`);
      if (dupes.length) await tx.careIntake.update({ where: { id: intake.id }, data: { notDuplicateById: ctx.userId } });
    }
    for (const s of sections) {
      const accepted = facts.some((f) => f.section === s.section && ACCEPTED.has(f.decision) && !f.appliedAt);
      if (!resubmitting || reopen.includes(s.section)) await tx.careIntakeSection.update({ where: { id: s.id }, data: { status: accepted ? "OPEN" : "OPEN", reason: resubmitting ? s.reason : null, decidedById: null, decidedAt: null, lockVersion: { increment: 1 } } });
    }
    await tx.careIntake.update({ where: { id: intake.id }, data: { status: "SUBMITTED", submittedById: ctx.userId, submittedAt: new Date(), areaId, lockVersion: { increment: 1 } } });
    const managers = await tx.membership.findMany({ where: { organisationId: scope.organisationId, deactivatedAt: null, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER"] } }, select: { userId: true } });
    const to = [...new Set(managers.map((m) => m.userId))].filter((u) => u !== ctx.userId);
    if (to.length) await tx.notification.createMany({ data: to.map((userId) => ({ organisationId: scope.organisationId, userId, type: "coordinator.submitted", title: `Intake ${intake.reference} is ready for approval`, body: `${intake.title}: ${resubmitting ? "corrected sections are" : "the coordinator's review is"} ready for a manager to approve section by section.`, reason: "You approve care plans for this organisation.", actionUrl: `/rota/coordinator/${intake.id}`, dedupeKey: `coordinator-submitted:${intake.id}:${intake.lockVersion}:${userId}` })), skipDuplicates: true });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: resubmitting ? "coordinator.intake.resubmitted" : "coordinator.intake.submitted", entityType: "CareIntake", entityId: intake.id, data: { accepted: facts.filter((f) => ACCEPTED.has(f.decision)).length, rejected: facts.filter((f) => f.decision === "REJECTED").length, duplicates: facts.filter((f) => f.decision === "DUPLICATE").length, sections: resubmitting ? reopen : undefined, notADuplicate: !!opts.notADuplicate } }, tx);
  });
}

// ── Manager decisions ──────────────────────────────────────────────────────

const sectionDecisionSchema = z.object({ decision: z.enum(["APPROVED", "RETURNED", "REJECTED", "INFO_REQUESTED"]), reason: z.string().trim().max(2000).optional().transform((v) => v || null) });

export async function decideSection(ctx: Ctx, intakeId: string, section: string, input: z.input<typeof sectionDecisionSchema>) {
  const { scope, access } = await scopeFor(ctx);
  if (!access.approve) throw new ForbiddenError("Only a care manager or administrator can approve intake sections");
  if (!(SECTION_KEYS as readonly string[]).includes(section)) throw new ValidationError("Unknown section");
  if (RESTRICTED_SECTIONS.has(section) && !access.sensitive) throw new ForbiddenError("This section holds restricted information");
  const p = sectionDecisionSchema.safeParse(input);
  if (!p.success) throw new ValidationError("Choose a decision");
  const d = p.data;
  if (d.decision !== "APPROVED" && (!d.reason || d.reason.length < 5)) throw new ValidationError("Give a reason so the coordinator knows what to do");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status !== "SUBMITTED" && intake.status !== "APPROVED" && intake.status !== "APPLYING") throw new ConflictError("This intake is not waiting for a manager");
    const s = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
    if (s.applyStatus === "DONE") throw new ConflictError("This section has already been saved to the record");
    if (s.status === "RETURNED" || s.status === "INFO_REQUESTED") throw new ConflictError("This section is back with the coordinator");
    const facts = await tx.careIntakeFact.findMany({ where: { intakeId, section } });
    const accepted = facts.filter((f) => ACCEPTED.has(f.decision));
    if (!accepted.length && d.decision === "APPROVED") throw new ValidationError("There is nothing approved by the coordinator in this section");
    if (d.decision === "APPROVED") {
      if (intake.submittedById === ctx.userId) throw new ForbiddenError("You sent this intake for approval, so another manager must approve it");
      if (facts.some((f) => f.decidedById === ctx.userId || f.editedById === ctx.userId)) throw new ForbiddenError("You reviewed facts in this section, so another manager must approve it");
    }
    await tx.careIntakeSection.update({ where: { id: s.id }, data: { status: d.decision, reason: d.reason, decidedById: ctx.userId, decidedAt: new Date(), applyStatus: d.decision === "APPROVED" ? s.applyStatus : "NOT_STARTED", lockVersion: { increment: 1 } } });
    const all = await tx.careIntakeSection.findMany({ where: { intakeId } });
    const withFacts = new Set((await tx.careIntakeFact.findMany({ where: { intakeId, decision: { in: [...ACCEPTED] } }, select: { section: true } })).map((f) => f.section));
    const waiting = all.filter((x) => withFacts.has(x.section) && x.status === "OPEN");
    if (!waiting.length && intake.status === "SUBMITTED" && all.some((x) => x.status === "APPROVED")) await tx.careIntake.update({ where: { id: intake.id }, data: { status: "APPROVED", lockVersion: { increment: 1 } } });
    if ((d.decision === "RETURNED" || d.decision === "INFO_REQUESTED") && intake.submittedById && intake.submittedById !== ctx.userId) {
      await tx.notification.createMany({ data: [{ organisationId: scope.organisationId, userId: intake.submittedById, type: "coordinator.returned", title: `${sectionLabel(section)} returned on ${intake.reference}`, body: d.reason ?? "", reason: "You sent this intake for approval.", actionUrl: `/rota/coordinator/${intake.id}?section=${section}`, dedupeKey: `coordinator-returned:${s.id}:${s.lockVersion}` }], skipDuplicates: true });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.section.decided", entityType: "CareIntake", entityId: intake.id, data: { section, decision: d.decision, reason: d.reason, facts: accepted.length } }, tx);
  });
}

export async function cancelIntake(ctx: Ctx, intakeId: string, reason: string) {
  const { scope } = await scopeFor(ctx);
  if (reason.trim().length < 5) throw new ValidationError("Say why the intake is being cancelled");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status === "COMPLETED" || intake.status === "CANCELLED") throw new ConflictError("This intake is already closed");
    const applied = await tx.careIntakeSection.count({ where: { intakeId, applyStatus: "DONE" } });
    if (applied) throw new ConflictError("Some sections are already saved to the record. Finish the intake instead of cancelling it.");
    await tx.careIntake.update({ where: { id: intake.id }, data: { status: "CANCELLED", cancelledById: ctx.userId, cancelledAt: new Date(), cancelReason: reason.trim(), lockVersion: { increment: 1 } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.intake.cancelled", entityType: "CareIntake", entityId: intake.id, data: { reason: reason.trim() } }, tx);
  });
}

// ── Reading for the screens ────────────────────────────────────────────────

export async function listIntakes(ctx: Ctx, f: { status?: string } = {}) {
  const { scope } = await scopeFor(ctx);
  const rows = await db.careIntake.findMany({
    where: { organisationId: scope.organisationId, ...(f.status && f.status in { DRAFT: 1, SUBMITTED: 1, APPROVED: 1, APPLYING: 1, COMPLETED: 1, CANCELLED: 1 } ? { status: f.status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { _count: { select: { documents: true, facts: true } } },
  });
  const suIds = rows.map((r) => r.serviceUserId).filter((x): x is string => !!x);
  const sus = suIds.length ? await db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), id: { in: suIds } }, select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true } }) : [];
  const open = await db.careIntakeFact.groupBy({ by: ["intakeId"], where: { intakeId: { in: rows.map((r) => r.id) }, decision: { in: [...OPEN_DECISIONS] } }, _count: true });
  const users = await namesFor([...new Set(rows.flatMap((r) => [r.createdById, r.submittedById].filter((x): x is string => !!x)))]);
  return rows
    .filter((r) => !r.serviceUserId || sus.some((s) => s.id === r.serviceUserId))
    .map((r) => {
      const su = sus.find((s) => s.id === r.serviceUserId);
      return { ...r, person: su ? { id: su.id, reference: su.reference, name: `${su.preferredName ?? su.firstName} ${su.lastName}` } : null, openFacts: open.find((o) => o.intakeId === r.id)?._count ?? 0, createdBy: users.get(r.createdById) ?? "Unknown", submittedBy: r.submittedById ? (users.get(r.submittedById) ?? "Unknown") : null };
    });
}

export async function namesFor(ids: string[]) {
  const rows = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name]));
}

export async function getIntake(ctx: Ctx, intakeId: string) {
  const { scope, access } = await scopeFor(ctx);
  const intake = await intakeInScope(db, scope, intakeId);
  const [docs, facts, sections, history, members, areas, callTypes] = await Promise.all([
    db.careIntakeDocument.findMany({ where: { intakeId }, orderBy: { position: "asc" }, select: { id: true, position: true, filename: true, contentType: true, sizeBytes: true, sha256: true, section: true, category: true, name: true, issuer: true, issuerKind: true, documentDate: true, sensitive: true, pageCount: true, readStatus: true, readNote: true, findings: true, filedDocumentId: true, createdAt: true, createdById: true } }),
    db.careIntakeFact.findMany({ where: { intakeId }, orderBy: [{ position: "asc" }] }),
    db.careIntakeSection.findMany({ where: { intakeId } }),
    db.auditLog.findMany({ where: { organisationId: scope.organisationId, entityType: "CareIntake", entityId: intakeId }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.membership.findMany({ where: { organisationId: scope.organisationId, deactivatedAt: null, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] } }, select: { userId: true, roles: true, user: { select: { name: true } } } }),
    db.area.findMany({ where: { organisationId: scope.organisationId, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.callType.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const su = intake.serviceUserId ? await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId }, select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true, status: true } }) : null;
  const followUps = await db.careIntakeReviewItem.findMany({ where: { organisationId: scope.organisationId, intakeId, ...(access.sensitive ? {} : { restricted: false }) }, orderBy: { createdAt: "asc" } });
  const userIds = new Set<string>([intake.createdById, ...(intake.submittedById ? [intake.submittedById] : []), ...history.map((h) => h.actorId).filter((x): x is string => !!x), ...facts.flatMap((f) => [f.decidedById, f.editedById, f.assignedToId].filter((x): x is string => !!x)), ...sections.flatMap((s) => [s.decidedById, s.appliedById].filter((x): x is string => !!x))]);
  const names = await namesFor([...userIds]);
  const docSensitive = new Map(docs.map((d) => [d.id, d.sensitive]));
  const shownFacts = facts.map((f) => {
    const restricted = isRestrictedFact(f, !!(f.sourceDocumentId && docSensitive.get(f.sourceDocumentId)));
    const hidden = restricted && !access.sensitive;
    return {
      id: f.id, section: f.section as IntakeSection, destination: f.destination, label: hidden ? "Restricted fact" : f.label, position: f.position,
      value: hidden ? null : f.value, proposed: hidden ? null : f.proposed, display: hidden ? "Restricted: a registered manager reviews this" : displayValue(f.destination, f.value), proposedDisplay: hidden ? "" : displayValue(f.destination, f.proposed),
      sourceDocumentId: f.sourceDocumentId, sourcePage: f.sourcePage, quote: hidden ? null : f.quote, verification: f.verification, temporal: f.temporal, origin: f.origin,
      existing: hidden || f.existingValue === null ? null : displayValue(f.destination, f.existingValue), conflict: hidden ? null : f.conflict,
      decision: f.decision, decisionLabel: DECISIONS[f.decision as keyof typeof DECISIONS] ?? f.decision, decisionNote: hidden ? null : f.decisionNote, question: hidden ? null : f.question,
      assignedTo: f.assignedToId ? (names.get(f.assignedToId) ?? "Unknown") : null, decidedBy: f.decidedById ? (names.get(f.decidedById) ?? "Unknown") : null, decidedAt: f.decidedAt, editedBy: f.editedById ? (names.get(f.editedById) ?? "Unknown") : null,
      appliedAt: f.appliedAt, appliedRef: f.appliedRef, lockVersion: f.lockVersion, restricted, hidden,
    };
  });
  const visitFacts = facts.filter((f) => f.destination === "visit" && ACCEPTED.has(f.decision)).map((f) => f.value as { weekdays: number[]; durationMin: number; carers: number; fundedBy: FundedBy });
  const minutesFact = facts.find((f) => f.destination === "package.minutesPerWeek" && ACCEPTED.has(f.decision));
  const reconciliation = reconcileHours(visitFacts, minutesFact ? Number(minutesFact.value) : null);
  const sectionRows = APPLY_ORDER.map((key) => {
    const s = sections.find((x) => x.section === key)!;
    const fs = shownFacts.filter((f) => f.section === key);
    return {
      key, ...s, decidedBy: s.decidedById ? (names.get(s.decidedById) ?? "Unknown") : null, appliedBy: s.appliedById ? (names.get(s.appliedById) ?? "Unknown") : null,
      total: fs.length, accepted: fs.filter((f) => ACCEPTED.has(f.decision)).length, open: fs.filter((f) => OPEN_DECISIONS.has(f.decision)).length, rejected: fs.filter((f) => f.decision === "REJECTED" || f.decision === "DUPLICATE").length, hidden: fs.filter((f) => f.hidden).length,
      restrictedSection: RESTRICTED_SECTIONS.has(key),
    };
  });
  const shownDocs = docs.map((d) => ({ ...d, categoryLabel: categoryLabel(d.section, d.category), findings: (access.sensitive || !d.sensitive ? d.findings : []) as { kind: string; text: string; page: number | null }[], canOpen: access.sensitive || !d.sensitive }));
  return {
    intake, access, person: su ? { ...su, name: `${su.preferredName ?? su.firstName} ${su.lastName}` } : null,
    documents: shownDocs, facts: shownFacts, sections: sectionRows, reconciliation,
    history: history.map((h) => ({ id: h.id, at: h.createdAt, action: h.action, actor: h.actorId ? (names.get(h.actorId) ?? "Unknown") : "System", data: h.data as Record<string, unknown> })),
    members: members.map((m) => ({ id: m.userId, name: m.user.name, manager: m.roles.some((r) => r === "ORG_ADMIN" || r === "CARE_MANAGER") })),
    followUps: followUps.map((f) => ({ id: f.id, category: f.category, description: f.description, sourceRef: f.sourceRef, restricted: f.restricted, status: f.status, resolution: f.resolution, resolvedAt: f.resolvedAt })),
    hiddenFollowUps: access.sensitive ? 0 : await db.careIntakeReviewItem.count({ where: { organisationId: scope.organisationId, intakeId, restricted: true } }),
    areas, callTypes, createdBy: names.get(intake.createdById) ?? "Unknown", submittedBy: intake.submittedById ? (names.get(intake.submittedById) ?? "Unknown") : null,
  };
}
export type IntakeView = Awaited<ReturnType<typeof getIntake>>;

// ── Start screen and the organisation's AI switch ─────────────────────────

/** What the start form needs: areas, people an intake can update, and how documents will be read here. */
export async function intakeStartOptions(ctx: Ctx) {
  const { scope, access } = await scopeFor(ctx);
  const [areas, people, settings] = await Promise.all([
    db.area.findMany({ where: { organisationId: scope.organisationId, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), status: { not: "ENDED" } }, select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 1000 }),
    db.rotaSettings.findUnique({ where: { organisationId: scope.organisationId }, select: { careCoordinatorAiEnabledAt: true, careCoordinatorAiReviewNote: true } }),
  ]);
  return { access, areas, people: people.map((p) => ({ id: p.id, label: `${p.preferredName ?? p.firstName} ${p.lastName} (${p.reference})` })), reading: readingMode(!!settings?.careCoordinatorAiEnabledAt) };
}

/** How documents are read in this organisation right now, said plainly. */
export function readingMode(enabled: boolean) {
  const provider = getAiProvider();
  const capable = !!provider?.extractCareDocument && !provider.isSimulated;
  if (enabled && capable) return { ai: true, label: `AI reading is on (${provider!.name}). Every quote it returns is checked against the page before you see it.` };
  if (enabled) return { ai: false, label: "AI reading is switched on but no AI provider is set up on the server, so CSB's own reader is used: it recognises labelled lines and timetable rows only, and you add anything else by hand." };
  return { ai: false, label: "AI reading is off, so documents are read on CSB's own server and are not sent anywhere. It recognises labelled lines and timetable rows only; you add anything else by hand." };
}

/** An organisation admin switches AI reading on after recording who authorised sending documents to the provider. */
export async function setCoordinatorAi(ctx: Ctx, on: boolean, reviewNote: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  if (on && reviewNote.trim().length < 10) throw new ValidationError("Record who authorised sending care documents to the AI provider (data protection review), and when");
  await db.$transaction(async (tx) => {
    await tx.rotaSettings.update({ where: { organisationId }, data: on ? { careCoordinatorAiEnabledAt: new Date(), careCoordinatorAiEnabledById: ctx.userId, careCoordinatorAiReviewNote: reviewNote.trim() } : { careCoordinatorAiEnabledAt: null, careCoordinatorAiEnabledById: null } });
    await audit({ organisationId, actorId: ctx.userId, action: on ? "coordinator.ai.enabled" : "coordinator.ai.disabled", entityType: "Organisation", entityId: organisationId, data: { reviewNote: reviewNote.trim() || null } }, tx);
  });
}

/** Closes a follow-up the intake left (medication to reconcile, informal support not scheduled, history to check). */
export async function resolveFollowUp(ctx: Ctx, itemId: string, resolution: string) {
  const { scope, access } = await scopeFor(ctx);
  const text = resolution.trim();
  if (text.length < 5) throw new ValidationError("Say what was done, so the next person can see it");
  return db.$transaction(async (tx) => {
    const item = await tx.careIntakeReviewItem.findFirst({ where: { id: itemId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
    if (!item) throw new NotFoundError("Follow-up");
    if (item.restricted && !access.sensitive) throw new NotFoundError("Follow-up");
    if (item.category === "MEDICATION" && !access.medication) throw new ForbiddenError("A manager who can manage medication closes medication follow-ups");
    const done = await tx.careIntakeReviewItem.updateMany({ where: { id: item.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedById: ctx.userId, resolvedAt: new Date(), resolution: text.slice(0, 2000) } });
    if (!done.count) throw new ConflictError("This follow-up is already closed");
    if (item.intakeId) await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.followup.resolved", entityType: "CareIntake", entityId: item.intakeId, data: { itemId: item.id, category: item.category } }, tx);
  });
}

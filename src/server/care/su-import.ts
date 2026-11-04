import type { Prisma, ServiceUserDocumentSection } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, hhmm, isIsoDate, londonDate, parseHhmm } from "@/lib/london";
import { FUNDED_BY, guessCallType, hoursToMinutes, weeklyTotals, type FundedBy } from "@/lib/su-import-rules";
export { FUNDED_BY, guessCallType, hoursToMinutes, weeklyTotals, type FundedBy };
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError } from "@/server/ai/provider";
import type { SupportPlanExtraction } from "@/server/ai/schemas";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { createTemplateInTx, type TemplateInput } from "@/server/rota/templates";
import { checkArea, contactData, contactSchema, detailData, detailsSchema, nextServiceUserReference } from "./service-users";
import { packageSchema } from "./packages";
import { canSeeSensitive, categoriesFor, MAX_DOCUMENT_BYTES, parseDetails, promptCarePlanReview, storePrivateFile, type UploadedFile } from "./su-documents";

/**
 * Set up a service user from a council support plan (4 Nov 2026).
 *
 * Office staff upload the council support plan (and other letters), check what was read from it, correct it, and
 * confirm. One transaction then creates the person, their contacts, the care package, one visit template per timetable
 * row and the document records, so Build Rota can schedule the visits straight away.
 *
 *  - Reading the PDF is a proposal from the AI provider, page-referenced, and always checked by a person. When the
 *    provider cannot read documents (simulated, none), the form opens empty and staff type the values in.
 *  - Care plans, risk assessments, medication and resuscitation decisions are never created here. They need a manager's
 *    and a clinical lead's judgement, so the confirmation lists them as the next steps instead.
 *  - Nothing is written until Confirm. A likely duplicate (same name and date of birth, or same name and postcode)
 *    stops the import unless the person confirms it is someone else.
 */

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const optDate = z.string().trim().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Dates must be real dates");

export const importVisitSchema = z
  .object({
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Choose at least one day for every visit"),
    startTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Give each visit a start time (HH:MM)"),
    durationMin: z.coerce.number().int().min(5, "A visit lasts at least 5 minutes").max(1440),
    carers: z.coerce.number().int().min(1, "Each visit needs at least one carer").max(20),
    callTypeId: z.string().trim().min(1, "Choose a call type for every visit"),
    tasks: z.string().trim().max(2000, "Keep each visit's tasks under 2000 characters").optional().transform((v) => v || undefined),
    fundedBy: z.enum(["COUNCIL", "CARERS_SERVICE", "OTHER"]).default("COUNCIL"),
    medicationPrompt: z.boolean().default(false),
    effectiveFrom: z.string().trim().refine(isIsoDate, "Give each visit a start date"),
    effectiveTo: optDate,
    sourcePages: z.array(z.number().int()).default([]),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: "A visit's end date must be after its start date" });

export const importDocumentSchema = z.object({
  /** Which uploaded file this is, in upload order. */
  fileIndex: z.number().int().min(0),
  section: z.enum(["COUNCIL", "OTHER"]),
  category: z.string().trim().min(1, "Choose a category for every document"),
  name: z.string().trim().min(2, "Give every document a name").max(160),
  markSensitive: z.boolean().default(false),
});

export const importDraftSchema = z.object({
  person: detailsSchema.extend({ councilReference: text(80) }),
  contacts: z
    .array(
      contactSchema.extend({
        address: text(500),
        isKeyHolder: z.boolean().default(false),
        sourcePage: z.number().int().optional(),
      }),
    )
    .max(30),
  package: packageSchema.extend({ funderName: text(120) }),
  visits: z.array(importVisitSchema).max(40, "At most 40 visit rows"),
  documents: z.array(importDocumentSchema).max(4),
  /** When set, care is marked Active from this date so Build Rota schedules the visits. Otherwise the person stays at Assessment. */
  careActiveFrom: optDate,
  /** The person confirmed a flagged match is someone else. */
  notADuplicate: z.boolean().default(false),
  flags: z.array(z.string().max(1000)).max(40).default([]),
});
export type ImportDraft = z.input<typeof importDraftSchema>;
export type ImportDraftParsed = z.output<typeof importDraftSchema>;

export interface ImportPermissions {
  sensitive: boolean;
}

export function importPermissions(ctx: Ctx): ImportPermissions {
  requireOrgPermission(ctx, "serviceUser.edit");
  requireOrgPermission(ctx, "rota.edit");
  requireOrgPermission(ctx, "serviceUser.documents");
  return { sensitive: hasOrgPermission(ctx, "serviceUser.sensitive") };
}

/** Turns an AI reading into the editable draft. Everything stays a proposal until the office confirms. */
export function draftFromExtraction(x: SupportPlanExtraction, callTypes: { id: string; name: string }[], fileNames: string[]): ImportDraft {
  const v = (f: { value: string } | null | undefined) => f?.value?.trim() || undefined;
  const dob = v(x.person.dateOfBirth);
  const start = v(x.package.startDate);
  const hours = v(x.package.hoursPerWeek);
  const weekly = hours ? hoursToMinutes(hours) : null;
  const flags = [...x.flags.map((f) => `${f.text} (page ${f.pages.join(", ") || "?"})`), ...x.unreadable.map((u) => `Could not read: ${u}`)];
  return {
    person: {
      firstName: v(x.person.firstName) ?? "",
      lastName: v(x.person.lastName) ?? "",
      dateOfBirth: dob && isIsoDate(dob) ? dob : undefined,
      gender: v(x.person.gender),
      nhsNumber: v(x.person.nhsNumber),
      addressLine1: v(x.person.addressLine1),
      addressLine2: v(x.person.addressLine2),
      town: v(x.person.town),
      postcode: v(x.person.postcode),
      phone: v(x.person.phone),
      firstLanguage: v(x.person.firstLanguage),
      accessNotes: v(x.person.accessNotes),
      communicationNeeds: v(x.person.communicationNeeds),
      carerGenderPreference: "ANY",
      councilReference: v(x.person.councilReference),
    },
    contacts: x.contacts.map((c) => ({
      kind: c.kind,
      name: c.name.trim(),
      relationship: c.relationship?.trim() || undefined,
      phone: c.phone?.trim() || undefined,
      altPhone: c.altPhone?.trim() || undefined,
      address: c.address?.trim() || undefined,
      isEmergency: c.isEmergency,
      canReceiveUpdates: false,
      isKeyHolder: c.isKeyHolder,
      isPrimary: false,
      sourcePage: c.page,
    })),
    package: {
      funderName: v(x.package.funder),
      startDate: start && isIsoDate(start) ? start : londonDate(),
      endDate: (() => { const e = v(x.package.endDate); return e && isIsoDate(e) ? e : undefined; })(),
      commissionedMinutesPerWeek: weekly ?? undefined,
      requirements: [v(x.package.requirements), hours ? `Document states ${hours} hours a week` : undefined, v(x.package.costPerWeek) ? `Cost per week as written: ${v(x.package.costPerWeek)}` : undefined].filter(Boolean).join(". ") || undefined,
    },
    visits: x.visits.map((r) => ({
      weekdays: [...new Set(r.weekdays)].sort(),
      startTime: /^\d{2}:\d{2}$/.test(r.startTime) ? r.startTime : "",
      durationMin: r.durationMinutes,
      carers: r.carers,
      callTypeId: guessCallType(r.startTime, r.tasks, callTypes),
      tasks: r.tasks.trim().slice(0, 2000),
      fundedBy: r.fundedBy,
      medicationPrompt: r.medicationPrompt,
      effectiveFrom: start && isIsoDate(start) && r.isNew ? start : londonDate(),
      effectiveTo: undefined,
      sourcePages: r.pages,
    })),
    documents: fileNames.map((name, i) => ({ fileIndex: i, section: i === 0 ? "COUNCIL" : "OTHER", category: i === 0 ? "COUNCIL_SUPPORT_PLAN" : "OTHER_SUPPORTING", name: name.replace(/\.[a-z0-9]+$/i, "").slice(0, 160) || `Document ${i + 1}`, markSensitive: false })),
    careActiveFrom: start && isIsoDate(start) ? start : londonDate(),
    notADuplicate: false,
    flags,
  };
}

/** An empty draft for typing in by hand (no AI, or the provider cannot read documents). */
export function emptyDraft(fileNames: string[]): ImportDraft {
  return {
    person: { firstName: "", lastName: "", carerGenderPreference: "ANY" },
    contacts: [],
    package: { startDate: londonDate() },
    visits: [],
    documents: fileNames.map((name, i) => ({ fileIndex: i, section: i === 0 ? "COUNCIL" : "OTHER", category: i === 0 ? "COUNCIL_SUPPORT_PLAN" : "OTHER_SUPPORTING", name: name.replace(/\.[a-z0-9]+$/i, "").slice(0, 160) || `Document ${i + 1}`, markSensitive: false })),
    careActiveFrom: londonDate(),
    notADuplicate: false,
    flags: [],
  };
}

// ── Reading the document ───────────────────────────────────────────────────

export interface ReadResult {
  draft: ImportDraft;
  /** "ai" when the AI read the document, "manual" when the form opened empty. */
  source: "ai" | "manual";
  providerName: string | null;
  simulated: boolean;
  duplicates: DuplicateMatch[];
}

export interface DuplicateMatch { id: string; reference: string; name: string; status: string; reason: string }

/** Reads the first file (the support plan) with the AI provider, when it can read documents, and proposes a draft. */
export async function readSupportPlan(ctx: Ctx, files: UploadedFile[]): Promise<ReadResult> {
  importPermissions(ctx);
  const scope = await rotaScope(ctx, "rota.edit");
  if (!files.length) throw new ValidationError("Upload the council support plan first");
  for (const f of files) {
    if (f.bytes.length > MAX_DOCUMENT_BYTES) throw new ValidationError(`${f.name} is over 4 MB. Scan it at a lower resolution or split it.`);
    if (f.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ValidationError(`${f.name} is not a PDF. The import reads PDF files only.`);
  }
  const callTypes = await db.callType.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (!callTypes.length) throw new ValidationError("Add at least one call type in Rota Settings before importing");
  const names = files.map((f) => f.name);
  const provider = getAiProvider();
  if (!provider?.extractSupportPlan) {
    return { draft: emptyDraft(names), source: "manual", providerName: provider?.name ?? null, simulated: provider?.isSimulated ?? false, duplicates: [] };
  }
  const plan = files[0]!;
  let extracted: SupportPlanExtraction;
  try {
    extracted = await provider.extractSupportPlan({ pdfBase64: plan.bytes.toString("base64"), filename: plan.name });
  } catch (e) {
    if (e instanceof AiUnavailableError) throw e;
    throw new AiUnavailableError("The document could not be read just now. Type the details in, or try again in a few minutes.");
  }
  const draft = draftFromExtraction(extracted, callTypes, names);
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.import.read", entityType: "Organisation", entityId: scope.organisationId, data: { provider: provider.name, file: plan.name.slice(0, 140), visits: draft.visits.length, contacts: draft.contacts.length, flags: draft.flags?.length ?? 0 } });
  const duplicates = await findPossibleDuplicates(scope, draft.person);
  return { draft, source: "ai", providerName: provider.name, simulated: provider.isSimulated, duplicates };
}

/** People already on record who could be the same person: same name and date of birth, or same name and postcode. */
export async function findPossibleDuplicates(scope: Scope, person: { firstName?: string; lastName?: string; dateOfBirth?: string; postcode?: string }): Promise<DuplicateMatch[]> {
  const first = person.firstName?.trim();
  const last = person.lastName?.trim();
  if (!first || !last) return [];
  const rows = await db.serviceUser.findMany({
    where: { ...serviceUserWhere(scope), firstName: { equals: first, mode: "insensitive" }, lastName: { equals: last, mode: "insensitive" } },
    select: { id: true, reference: true, firstName: true, lastName: true, status: true, dateOfBirth: true, postcode: true },
    take: 10,
  });
  const dob = person.dateOfBirth && isIsoDate(person.dateOfBirth) ? dbDate(person.dateOfBirth).getTime() : null;
  const pc = person.postcode?.replace(/\s/g, "").toUpperCase() || null;
  return rows.flatMap((r) => {
    const sameDob = dob !== null && r.dateOfBirth?.getTime() === dob;
    const samePc = pc !== null && r.postcode?.replace(/\s/g, "").toUpperCase() === pc;
    const reason = sameDob ? "Same name and date of birth" : samePc ? "Same name and postcode" : "Same name";
    return [{ id: r.id, reference: r.reference, name: `${r.firstName} ${r.lastName}`, status: r.status, reason }];
  });
}

// ── Confirming ─────────────────────────────────────────────────────────────

export interface ImportResult {
  serviceUserId: string;
  reference: string;
  contacts: number;
  templates: number;
  documents: number;
  packageId: string | null;
  careActive: boolean;
}

export function parseDraft(input: unknown): ImportDraftParsed {
  const r = importDraftSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the details");
  return r.data;
}

/** Everything the import writes, in one transaction. Files are stored first; if the transaction fails nothing is recorded. */
export async function confirmImport(ctx: Ctx, input: unknown, files: UploadedFile[]): Promise<ImportResult> {
  const perms = importPermissions(ctx);
  const scope = await rotaScope(ctx, "rota.edit");
  const d = parseDraft(input);
  if (!d.visits.length) throw new ValidationError("Add at least one visit from the timetable, or set the person up without visits from Add service user");
  if (d.package.endDate && d.package.endDate < d.package.startDate) throw new ValidationError("The package end date is before its start");
  for (const v of d.visits) if (parseHhmm(v.startTime) === null) throw new ValidationError("Give each visit a start time (HH:MM)");
  for (const doc of d.documents) {
    if (!files[doc.fileIndex]) throw new ValidationError("A document is missing its file. Upload the files again.");
    if (!categoriesFor(doc.section).some((c) => c.key === doc.category)) throw new ValidationError(`Choose a valid category for ${doc.name}`);
    if (doc.markSensitive && !perms.sensitive) throw new ValidationError("Only a registered manager or administrator can mark a document as sensitive");
  }
  if (d.careActiveFrom && d.careActiveFrom > addDays(londonDate(), 366)) throw new ValidationError("The care start date is more than a year away");

  const duplicates = await findPossibleDuplicates(scope, d.person);
  if (duplicates.length && !d.notADuplicate) throw new ConflictError(`${duplicates[0]!.name} (${duplicates[0]!.reference}) is already on record: ${duplicates[0]!.reason.toLowerCase()}. Tick "This is a different person" to go ahead, or open their record instead.`);

  // Files are checked, scanned and stored before the transaction; the rows that point at them are written inside it.
  const stored: Awaited<ReturnType<typeof storePrivateFile>>[] = [];
  for (const doc of d.documents) stored.push(await storePrivateFile(scope.organisationId, "su-documents", files[doc.fileIndex]!));

  return db.$transaction(async (tx) => {
    const org = scope.organisationId;
    const area = await checkArea(tx, scope, d.person.areaId);
    const reference = await nextServiceUserReference(tx, org);
    const careActive = !!d.careActiveFrom;
    const su = await tx.serviceUser.create({
      data: {
        organisationId: org,
        reference,
        status: careActive ? "ACTIVE" : "ASSESSMENT",
        startDate: careActive ? dbDate(d.careActiveFrom!) : null,
        areaId: area?.id ?? null,
        branchId: area?.branchId ?? null,
        createdById: ctx.userId,
        ...detailData(ctx, d.person),
        ...(d.person.councilReference ? { carePreferences: [d.person.carePreferences, `Council reference: ${d.person.councilReference}`].filter(Boolean).join("\n") } : {}),
      },
    });
    await audit({ organisationId: org, actorId: ctx.userId, action: "serviceUser.created", entityType: "ServiceUser", entityId: su.id, data: { via: "support-plan-import" } }, tx);
    if (careActive) await audit({ organisationId: org, actorId: ctx.userId, action: "serviceUser.status", entityType: "ServiceUser", entityId: su.id, data: { from: "ASSESSMENT", to: "ACTIVE", reason: "Set up from the council support plan" } }, tx);

    let primarySet = false;
    for (const c of d.contacts) {
      const data = contactData({ ...c, isPrimary: c.isPrimary && !primarySet });
      if (data.isPrimary) primarySet = true;
      const notes = [c.isKeyHolder ? "Key holder" : null, c.sourcePage ? `Support plan page ${c.sourcePage}` : null].filter(Boolean).join(". ") || null;
      const row = await tx.serviceUserContact.create({ data: { organisationId: org, serviceUserId: su.id, ...data, address: c.address ?? null, notes } });
      await audit({ organisationId: org, actorId: ctx.userId, action: "serviceUser.contact.added", entityType: "ServiceUser", entityId: su.id, data: { kind: row.kind, contactId: row.id, via: "support-plan-import" } }, tx);
    }

    let packageId: string | null = null;
    if (d.package.startDate) {
      const requirements = [d.package.funderName ? `Funder: ${d.package.funderName}` : null, d.package.requirements || null].filter(Boolean).join("\n") || null;
      const pkg = await tx.carePackage.create({ data: { organisationId: org, serviceUserId: su.id, reference: d.package.reference || d.person.councilReference || null, commissionedMinutesPerWeek: d.package.commissionedMinutesPerWeek ?? null, startDate: dbDate(d.package.startDate), endDate: d.package.endDate ? dbDate(d.package.endDate) : null, requirements } });
      packageId = pkg.id;
      await audit({ organisationId: org, actorId: ctx.userId, action: "care.package.created", entityType: "ServiceUser", entityId: su.id, data: { packageId: pkg.id, minutes: pkg.commissionedMinutesPerWeek, via: "support-plan-import" } }, tx);
    }

    let templates = 0;
    for (const v of d.visits) {
      const notes = [v.fundedBy !== "COUNCIL" ? `[${FUNDED_BY[v.fundedBy]}]` : null, v.tasks || null, v.sourcePages.length ? `(Support plan page ${v.sourcePages.join(", ")})` : null].filter(Boolean).join(" ").slice(0, 2000) || null;
      const input: TemplateInput = {
        serviceUserId: su.id,
        callTypeId: v.callTypeId,
        areaId: area?.id ?? null,
        cycleWeeks: [1, 2, 3, 4],
        weekdays: v.weekdays,
        startMinute: parseHhmm(v.startTime)!,
        durationMin: v.durationMin,
        carersRequired: v.carers,
        medicationRequired: v.medicationPrompt,
        alertOnLate: true,
        timeLocked: false,
        rotaType: "NORMAL",
        effectiveFrom: v.effectiveFrom,
        effectiveTo: v.effectiveTo ?? null,
        notes,
        taskIds: [],
        extraPreferredStaffIds: [],
      };
      await createTemplateInTx(tx, scope, ctx.userId, input);
      templates++;
    }

    let documents = 0;
    for (const [i, doc] of d.documents.entries()) {
      const details = parseDetails(doc.section as ServiceUserDocumentSection, { name: doc.name, category: doc.category, markSensitive: doc.markSensitive, receivedOn: londonDate() });
      if (details.sensitive && !canSeeSensitive(ctx) && !categoriesFor(doc.section).some((c) => c.key === doc.category && c.sensitive)) throw new ValidationError("Only a registered manager or administrator can mark a document as sensitive");
      const row = await tx.serviceUserDocument.create({ data: { organisationId: org, serviceUserId: su.id, section: doc.section, ...details, createdById: ctx.userId } });
      await tx.serviceUserDocumentVersion.create({ data: { organisationId: org, documentId: row.id, version: 1, ...stored[i]!, uploadedById: ctx.userId } });
      await audit({ organisationId: org, actorId: ctx.userId, action: "suDocument.uploaded", entityType: "ServiceUserDocument", entityId: row.id, data: { serviceUserId: su.id, section: doc.section, category: doc.category, filename: stored[i]!.filename, sizeBytes: stored[i]!.sizeBytes, sensitive: details.sensitive, via: "support-plan-import" } }, tx);
      if (doc.section === "COUNCIL" && doc.category === "COUNCIL_SUPPORT_PLAN") await promptCarePlanReview(tx, org, ctx.userId, su, row.id, 1);
      documents++;
    }

    const totals = weeklyTotals(d.visits);
    await audit({ organisationId: org, actorId: ctx.userId, action: "serviceUser.import.confirmed", entityType: "ServiceUser", entityId: su.id, data: { contacts: d.contacts.length, templates, documents, packageId, careActive, weeklyMinutes: totals.total, councilMinutes: totals.COUNCIL, flags: d.flags.slice(0, 40) } as Prisma.InputJsonValue }, tx);
    return { serviceUserId: su.id, reference, contacts: d.contacts.length, templates, documents, packageId, careActive };
  });
}

/** What the confirmation step shows: totals and the gap against the commissioned minutes. */
export function importSummary(d: ImportDraft) {
  const visits = (d.visits ?? []).map((v) => ({ weekdays: (v.weekdays ?? []).map(Number), durationMin: Number(v.durationMin) || 0, carers: Number(v.carers) || 1, fundedBy: (v.fundedBy ?? "COUNCIL") as FundedBy }));
  const totals = weeklyTotals(visits);
  const raw = d.package?.commissionedMinutesPerWeek;
  const commissioned = raw === null || raw === undefined || String(raw).trim() === "" ? null : Number(raw);
  return { ...totals, commissioned, gap: commissioned === null ? null : totals.COUNCIL - commissioned, label: (v: { startTime: string }) => (parseHhmm(v.startTime) === null ? v.startTime : hhmm(parseHhmm(v.startTime)!)) };
}

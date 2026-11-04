import type { CareIntakeFact, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, hhmm, londonDate, parseHhmm } from "@/lib/london";
import {
  ACCEPTED, APPLY_ORDER, CONTACT_KIND_LABEL, MED_SUPPORT, PLAN_SECTION_KEYS, PLAN_SECTION_LABEL, dayList, displayValue, externalReferenceValue, reconcileHours, sectionLabel,
  type IntakeSection, type callNoteValue, type contactValue, type incidentValue, type medArrangementValue, type medItemValue, type planValue, type riskValue, type skinValue, type visitValue,
} from "@/lib/care-coordinator-rules";
import { guessCallType, type FundedBy } from "@/lib/su-import-rules";
import type { z } from "zod";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { serviceUserWhere, type Scope } from "@/server/rota/scope";
import { createTemplateInTx, type TemplateInput } from "@/server/rota/templates";
import { draftFingerprint, saveDraft, startDraft } from "../care-plans";
import { addMedication, medicationEnabled } from "../medication";
import { createRiskDraft } from "../risks";
import { linkExternalReferenceInTx } from "../external-references";
import { checkArea, detailData, detailsSchema, nextServiceUserReference } from "../service-users";
import { categoriesFor, parseDetails, promptCarePlanReview } from "../su-documents";
import { coordinatorAccess, intakeInScope } from "./intake";
import { createIntakeCallNote } from "../call-notes";
import { rotaScope } from "@/server/rota/scope";

type Tx = Prisma.TransactionClient;

/**
 * Saving an approved intake into the existing Service User profile, one section at a time.
 *
 *  - A section is saved only after a manager approved it, by someone allowed to edit records. Everything goes through
 *    the existing domain services or the same rules they use (scope, permissions, audit), never arbitrary SQL.
 *  - Idempotent: every fact records what it became (appliedRef) in the same transaction that created it, so retrying a
 *    failed section skips what is already saved. Contacts, visits and medicines already on the record are not repeated.
 *  - A failure marks the section FAILED with the reason; nothing is presented as set up when it is not. Each section is
 *    read back after saving and the result is recorded (applyResult) with what was created.
 *  - Clinical content stays inactive: the care plan is a DRAFT for a different person to approve; risks are DRAFT for an
 *    independent assessor; medicines become DRAFT only from current, complete, non-discharge sources and otherwise go to
 *    the reconciliation queue; historical incidents and skin findings become review items, never live records.
 */

interface SectionResult { created: string[]; skipped: string[]; notes: string[]; verified: boolean }

const facts = (tx: Tx, intakeId: string, section: string) => tx.careIntakeFact.findMany({ where: { intakeId, section, decision: { in: [...ACCEPTED] } }, orderBy: { position: "asc" } });
const markApplied = (tx: Tx, f: CareIntakeFact, ref: string) => tx.careIntakeFact.update({ where: { id: f.id }, data: { appliedAt: new Date(), appliedRef: ref } });
const docLabel = async (tx: Tx, id: string | null, page: number | null) => {
  if (!id) return "added by hand";
  const d = await tx.careIntakeDocument.findUnique({ where: { id }, select: { name: true } });
  return `${d?.name ?? "document"}${page ? `, page ${page}` : ""}`;
};

export async function applySection(ctx: Ctx, intakeId: string, section: IntakeSection) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  // Claim the section so two people pressing Save at once cannot both run it.
  const claim = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status === "CANCELLED" || intake.status === "DRAFT") throw new ConflictError("This intake is not approved");
    const s = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
    if (s.status !== "APPROVED") throw new ConflictError(`${sectionLabel(section)} has not been approved by a manager`);
    if (s.applyStatus === "DONE") return null;
    if (section !== "PERSONAL" && !intake.serviceUserId) throw new ConflictError("Save Personal details first: the person does not exist yet");
    if ((section === "MEDICATION" || section === "INCIDENTS" || section === "BODY_MAP") && !access.sensitive) throw new ForbiddenError("A registered manager or administrator saves restricted sections");
    await tx.careIntakeSection.update({ where: { id: s.id }, data: { attempts: { increment: 1 } } });
    await tx.careIntake.update({ where: { id: intake.id }, data: { status: "APPLYING" } });
    return intake;
  });
  if (!claim) return { section, status: "DONE" as const, result: null };
  try {
    const result = await run(ctx, scope, claim.id, section);
    await db.$transaction(async (tx) => {
      await tx.careIntakeSection.update({ where: { intakeId_section: { intakeId, section } }, data: { applyStatus: "DONE", applyResult: result as unknown as Prisma.InputJsonValue, applyError: null, appliedById: ctx.userId, appliedAt: new Date() } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.section.applied", entityType: "CareIntake", entityId: intakeId, data: { section, created: result.created.length, skipped: result.skipped.length, verified: result.verified } }, tx);
      await settleStatus(tx, intakeId);
    });
    if (section === "PERSONAL") {
      // The originals go into Council or Other Documents as soon as the person exists. If filing fails, the person is
      // still saved and "File the original documents" can be pressed again.
      try {
        const filed = await fileDocuments(ctx, intakeId);
        if (filed) result.created.push(`${filed} original document${filed === 1 ? "" : "s"} filed in Council or Other Documents`);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        result.notes.push(`The original documents were not filed: ${e.message}. Use "File the original documents" to try again.`);
      }
      await db.careIntakeSection.update({ where: { intakeId_section: { intakeId, section } }, data: { applyResult: result as unknown as Prisma.InputJsonValue } });
    }
    return { section, status: "DONE" as const, result };
  } catch (e) {
    const message = e instanceof AppError ? e.message : "Saving failed unexpectedly. The error has been logged; try again.";
    await db.$transaction(async (tx) => {
      await tx.careIntakeSection.update({ where: { intakeId_section: { intakeId, section } }, data: { applyStatus: "FAILED", applyError: message.slice(0, 1000) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.section.failed", entityType: "CareIntake", entityId: intakeId, data: { section, error: message.slice(0, 300) } }, tx);
      await settleStatus(tx, intakeId);
    });
    if (!(e instanceof AppError)) throw e;
    return { section, status: "FAILED" as const, error: message };
  }
}

/** Saves every approved section that is not saved yet, in order. A failed Personal details stops the rest. */
export async function applyApproved(ctx: Ctx, intakeId: string) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  await intakeInScope(db, scope, intakeId);
  const sections = await db.careIntakeSection.findMany({ where: { intakeId } });
  const out: { section: string; status: string; error?: string }[] = [];
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  for (const key of APPLY_ORDER) {
    const s = sections.find((x) => x.section === key);
    if (!s || s.status !== "APPROVED" || s.applyStatus === "DONE") continue;
    if ((key === "MEDICATION" || key === "INCIDENTS" || key === "BODY_MAP") && !sensitive) { out.push({ section: key, status: "BLOCKED", error: "A registered manager saves this section" }); continue; }
    const r = await applySection(ctx, intakeId, key);
    out.push({ section: key, status: r.status, error: "error" in r ? r.error : undefined });
    if (key === "PERSONAL" && r.status === "FAILED") break;
  }
  return out;
}

async function settleStatus(tx: Tx, intakeId: string) {
  const intake = await tx.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  const sections = await tx.careIntakeSection.findMany({ where: { intakeId } });
  const withFacts = new Set((await tx.careIntakeFact.findMany({ where: { intakeId, decision: { in: [...ACCEPTED] } }, select: { section: true } })).map((f) => f.section));
  const relevant = sections.filter((s) => withFacts.has(s.section) && s.status !== "REJECTED");
  const done = relevant.every((s) => s.status === "APPROVED" && s.applyStatus === "DONE");
  const status = done && relevant.length ? "COMPLETED" : relevant.some((s) => s.status === "OPEN") ? "SUBMITTED" : "APPROVED";
  if (status !== intake.status) await tx.careIntake.update({ where: { id: intakeId }, data: { status } });
}

async function run(ctx: Ctx, scope: Scope, intakeId: string, section: IntakeSection): Promise<SectionResult> {
  switch (section) {
    case "PERSONAL": return applyPersonal(ctx, scope, intakeId);
    case "CONTACTS": return applyContacts(ctx, scope, intakeId);
    case "CARER_PREFERENCES": return applyPreferences(ctx, scope, intakeId);
    case "PACKAGE": return applyPackage(ctx, scope, intakeId);
    case "CARE_PLAN": return applyCarePlan(ctx, scope, intakeId);
    case "RISKS": return applyRisks(ctx, scope, intakeId);
    case "MEDICATION": return applyMedication(ctx, scope, intakeId);
    case "INCIDENTS": return applyHistory(ctx, scope, intakeId, "INCIDENTS");
    case "BODY_MAP": return applyHistory(ctx, scope, intakeId, "BODY_MAP");
    case "VISITS": return applyVisits(ctx, scope, intakeId);
    case "CALL_NOTES": return applyCallNotes(ctx, scope, intakeId);
  }
}

async function suFor(tx: Tx, scope: Scope, intakeId: string) {
  const intake = await tx.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  const su = intake.serviceUserId ? await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId } }) : null;
  if (!su) throw new ConflictError("The person for this intake is not on record yet");
  return { intake, su };
}

// ── Personal details ───────────────────────────────────────────────────────

async function applyPersonal(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  return db.$transaction(async (tx) => {
    const intake = await tx.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    const all = await facts(tx, intakeId, "PERSONAL");
    const fs = all.filter((f) => f.destination.startsWith("person."));
    const refs = all.filter((f) => f.destination === "externalReference");
    const values: Record<string, string> = {};
    for (const f of fs) values[f.destination.slice(7)] = String(f.value);
    const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
    const skipped: string[] = [];
    if (!sensitive) for (const k of ["dateOfBirth", "nhsNumber"]) if (values[k]) { skipped.push(`${k === "dateOfBirth" ? "Date of birth" : "NHS number"} needs a registered manager to save`); delete values[k]; }
    if (intake.mode === "NEW" && !intake.serviceUserId) {
      const parsed = detailsSchema.safeParse({ ...values, carerGenderPreference: "ANY", areaId: intake.areaId ?? undefined });
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the personal details");
      const area = await checkArea(tx, scope, intake.areaId);
      const reference = await nextServiceUserReference(tx, scope.organisationId);
      const su = await tx.serviceUser.create({ data: { organisationId: scope.organisationId, reference, csbReference: reference, status: "ASSESSMENT", areaId: area?.id ?? null, branchId: area?.branchId ?? null, createdById: ctx.userId, ...detailData(ctx, parsed.data) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.created", entityType: "ServiceUser", entityId: su.id, data: { via: "care-coordinator", intakeId, reference: intake.reference } }, tx);
      await tx.careIntake.update({ where: { id: intakeId }, data: { serviceUserId: su.id } });
      for (const f of fs) await markApplied(tx, f, `ServiceUser:${su.id}`);
      const linked = await applyReferences(tx, ctx, scope, su.id, refs, sensitive);
      const back = await tx.serviceUser.findUniqueOrThrow({ where: { id: su.id } });
      const verified = back.firstName === parsed.data.firstName && back.lastName === parsed.data.lastName;
      return { created: [`Service user ${reference} (Assessment)`, ...linked.created], skipped: [...skipped, ...linked.skipped], notes: ["The person starts at Assessment. They become Active when the draft rota is created after the care plan is approved."], verified };
    }
    const { su } = await suFor(tx, scope, intakeId);
    // Update an existing person: only the approved fields, with the record's version check.
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) data[k] = k === "dateOfBirth" ? dbDate(v) : k === "postcode" ? v.toUpperCase() : k === "nhsNumber" ? v.replace(/\s/g, "") : v;
    const changed = Object.keys(data).filter((k) => { const cur = (su as Record<string, unknown>)[k]; return (cur instanceof Date ? fromDbDate(cur) : cur) !== (data[k] instanceof Date ? fromDbDate(data[k] as Date) : data[k]); });
    if (changed.length) {
      const done = await tx.serviceUser.updateMany({ where: { id: su.id, version: su.version }, data: { ...Object.fromEntries(changed.map((k) => [k, data[k]])), version: { increment: 1 } } });
      if (!done.count) throw new ConflictError("The person's record was changed by someone else while saving. Try again.");
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.updated", entityType: "ServiceUser", entityId: su.id, data: { via: "care-coordinator", intakeId, fields: changed } }, tx);
    }
    for (const f of fs) if (values[f.destination.slice(7)] !== undefined) await markApplied(tx, f, `ServiceUser:${su.id}`);
    const linked = await applyReferences(tx, ctx, scope, su.id, refs, sensitive);
    return { created: [...(changed.length ? [`Updated ${changed.length} personal detail${changed.length === 1 ? "" : "s"}`] : []), ...linked.created], skipped: [...skipped, ...(changed.length || linked.created.length ? [] : ["The record already matched"]), ...linked.skipped], notes: [], verified: true };
  });
}

/** External references (council client, package, framework, NHS) go to the encrypted register, unverified. A manager
 *  verifies them later on the profile; nothing here marks a reference as verified. */
async function applyReferences(tx: Tx, ctx: Ctx, scope: Scope, serviceUserId: string, refs: CareIntakeFact[], sensitive: boolean) {
  const out = { created: [] as string[], skipped: [] as string[] };
  for (const f of refs) {
    if (f.appliedAt) continue;
    const parsed = externalReferenceValue.safeParse(f.value);
    if (!parsed.success) { out.skipped.push(`${f.label}: the reference could not be read, check it and add it by hand`); continue; }
    const r = parsed.data;
    if (r.type === "NHS" && !sensitive) { out.skipped.push(`${f.label} needs a registered manager to save`); continue; }
    if (r.type === "NHS" && !/^\d{3} ?\d{3} ?\d{4}$/.test(r.value)) { out.skipped.push(`${f.label}: an NHS number has 10 digits`); continue; }
    const res = await linkExternalReferenceInTx(tx, ctx, scope.organisationId, serviceUserId, { type: r.type, issuer: r.issuer, value: r.value, sourceDocumentId: f.sourceDocumentId, sourcePage: f.sourcePage, verificationNote: "Read from documents by the Care Coordinator; not verified" });
    if (res.status === "conflict") { out.skipped.push(`${f.label}: this reference is already on another person's profile. Investigate before linking.`); continue; }
    await markApplied(tx, f, `ServiceUserExternalReference:${res.id}`);
    if (res.status === "created") out.created.push(`${f.label} added to the reference register (not yet verified)`);
    else out.skipped.push(`${f.label} is already on the profile`);
  }
  return out;
}

// ── Contacts ───────────────────────────────────────────────────────────────

async function applyContacts(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  return db.$transaction(async (tx) => {
    const { su } = await suFor(tx, scope, intakeId);
    const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
    for (const f of await facts(tx, intakeId, "CONTACTS")) {
      if (f.appliedAt) continue;
      const c = f.value as z.output<typeof contactValue>;
      const dup = await tx.serviceUserContact.findFirst({ where: { serviceUserId: su.id, kind: c.kind, name: { equals: c.name, mode: "insensitive" } } });
      if (dup) { await markApplied(tx, f, `existing:ServiceUserContact:${dup.id}`); out.skipped.push(`${c.name} is already a contact`); continue; }
      const notes = [c.isKeyHolder ? "Key holder (from documents)" : null, c.authority ? `Authority as written in the documents: "${c.authority}". Not verified; check the registration before relying on it.` : null, `Source: ${await docLabel(tx, f.sourceDocumentId, f.sourcePage)}`].filter(Boolean).join(" ");
      const row = await tx.serviceUserContact.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, kind: c.kind, name: c.name, relationship: c.relationship, phone: c.phone, email: c.email, address: c.address, isEmergency: c.isEmergency, canReceiveUpdates: false, isPrimary: false, notes: notes.slice(0, 2000) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.contact.added", entityType: "ServiceUser", entityId: su.id, data: { kind: row.kind, contactId: row.id, via: "care-coordinator", intakeId } }, tx);
      await markApplied(tx, f, `ServiceUserContact:${row.id}`);
      out.created.push(`${CONTACT_KIND_LABEL[c.kind]}: ${c.name}`);
    }
    out.verified = (await tx.careIntakeFact.count({ where: { intakeId, section: "CONTACTS", decision: { in: [...ACCEPTED] }, appliedAt: null } })) === 0;
    out.notes.push("Next of kin is never treated as having legal authority. Record a lasting power of attorney only after seeing it.");
    return out;
  });
}

// ── Carer preferences ──────────────────────────────────────────────────────

async function applyPreferences(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  return db.$transaction(async (tx) => {
    const { su } = await suFor(tx, scope, intakeId);
    const fs = await facts(tx, intakeId, "CARER_PREFERENCES");
    const gender = fs.find((f) => f.destination === "preference.gender");
    const notes = fs.filter((f) => f.destination === "preference.note").map((f) => String(f.value));
    const prefs = [su.carePreferences, notes.length ? `Carer preferences from documents (not staffing decisions): ${notes.join("; ")}` : null].filter(Boolean).join("\n").slice(0, 2000) || null;
    const done = await tx.serviceUser.updateMany({ where: { id: su.id, version: su.version }, data: { ...(gender ? { carerGenderPreference: gender.value as "ANY" | "FEMALE" | "MALE" } : {}), carePreferences: prefs, version: { increment: 1 } } });
    if (!done.count) throw new ConflictError("The person's record was changed by someone else while saving. Try again.");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.updated", entityType: "ServiceUser", entityId: su.id, data: { via: "care-coordinator", intakeId, fields: [gender ? "carerGenderPreference" : null, notes.length ? "carePreferences" : null].filter(Boolean) } }, tx);
    for (const f of fs) await markApplied(tx, f, `ServiceUser:${su.id}`);
    return { created: [gender ? `Care-worker gender preference: ${String(gender.value).toLowerCase()}` : null, notes.length ? `${notes.length} preference note${notes.length === 1 ? "" : "s"}` : null].filter((x): x is string => !!x), skipped: [], notes: ["Preferences are not staffing allocations. Named carers are chosen on the rota."], verified: true };
  });
}

// ── Care package ───────────────────────────────────────────────────────────

async function applyPackage(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  return db.$transaction(async (tx) => {
    const { su, intake } = await suFor(tx, scope, intakeId);
    const fs = await facts(tx, intakeId, "PACKAGE");
    if (fs.every((f) => f.appliedAt)) return { created: [], skipped: ["Already saved"], notes: [], verified: true };
    const v = (k: string) => fs.find((f) => f.destination === `package.${k}`)?.value;
    const startDate = v("startDate") as string | undefined;
    if (!startDate) throw new ValidationError("Approve a package start date before saving the care package");
    const endDate = v("endDate") as string | undefined;
    if (endDate && endDate < startDate) throw new ValidationError("The package end date is before its start");
    const current = await tx.carePackage.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" } });
    if (current) throw new ConflictError(`The person already has an active package from ${fromDbDate(current.startDate)}. A manager must end or edit it on the Care Package tab; it was not replaced automatically.`);
    const minutes = v("minutesPerWeek") as number | undefined;
    const visitFacts = (await facts(tx, intakeId, "VISITS")).map((f) => f.value as z.output<typeof visitValue>);
    const rec = reconcileHours(visitFacts.map((x) => ({ weekdays: x.weekdays, durationMin: x.durationMin, carers: x.carers, fundedBy: x.fundedBy as FundedBy })), minutes ?? null);
    const requirements = [v("funder") ? `Commissioned by: ${v("funder")}` : null, v("requirements") ? String(v("requirements")) : null, `Set up from Care Coordinator intake ${intake.reference}.`, rec.matches || minutes === undefined ? null : `Check: ${rec.message}`].filter(Boolean).join("\n").slice(0, 2000);
    const row = await tx.carePackage.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, reference: (v("reference") as string | undefined) ?? null, commissionedMinutesPerWeek: minutes ?? null, startDate: dbDate(startDate), endDate: endDate ? dbDate(endDate) : null, requirements } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "care.package.created", entityType: "ServiceUser", entityId: su.id, data: { packageId: row.id, minutes: row.commissionedMinutesPerWeek, via: "care-coordinator", intakeId } }, tx);
    for (const f of fs) await markApplied(tx, f, `CarePackage:${row.id}`);
    const back = await tx.carePackage.findUniqueOrThrow({ where: { id: row.id } });
    return { created: [`Care package from ${startDate}${endDate ? ` to ${endDate}` : ""}${minutes !== undefined ? `, ${minutes} minutes a week` : ""}`], skipped: [], notes: [rec.message, "The funder is recorded by name. Linking a finance funder stays a finance decision."], verified: fromDbDate(back.startDate) === startDate && back.commissionedMinutesPerWeek === (minutes ?? null) };
  });
}

// ── Care plan (draft) ──────────────────────────────────────────────────────

async function applyCarePlan(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  const { su, intake } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const section = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: "CARE_PLAN" } } });
  const prior = (section.applyResult as { planId?: string } | null)?.planId;
  let plan = prior ? await db.carePlan.findFirst({ where: { id: prior, serviceUserId: su.id, status: "DRAFT" }, include: { sections: true } }) : null;
  if (!plan) {
    const open = await db.carePlan.findFirst({ where: { serviceUserId: su.id, status: { in: ["DRAFT", "IN_REVIEW"] } } });
    if (open) throw new ConflictError(`Care plan version ${open.version} is already ${open.status === "DRAFT" ? "being drafted" : "in review"}. Finish or discard it first; it was not overwritten.`);
    const started = await startDraft(ctx, su.id);
    await db.careIntakeSection.update({ where: { id: section.id }, data: { applyResult: { planId: started.id } } });
    plan = await db.carePlan.findUniqueOrThrow({ where: { id: started.id }, include: { sections: true } });
  }
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section: "CARE_PLAN", decision: { in: [...ACCEPTED] } }, orderBy: { position: "asc" } });
  const sections: Record<string, { body: string; outcomes?: string }> = {};
  for (const key of PLAN_SECTION_KEYS) {
    const mine = fs.filter((f) => f.destination === `careplan.${key}`);
    const existing = plan.sections.find((s) => s.key === key);
    if (!mine.length) { sections[key] = { body: existing?.body || "Not documented in the source documents. To be completed at assessment.", outcomes: existing?.outcomes ?? undefined }; continue; }
    const parts: string[] = existing?.body ? [existing.body, ""] : [];
    const outcomes: string[] = existing?.outcomes ? [existing.outcomes] : [];
    for (const f of mine) {
      const v = f.value as z.output<typeof planValue>;
      const src = await db.$transaction((tx) => docLabel(tx, f.sourceDocumentId, f.sourcePage));
      parts.push([v.canDo ? `What I can do myself: ${v.canDo}` : null, v.support ? `Support I need: ${v.support}` : null, v.how ? `How to support me: ${v.how}` : null, v.clarify ? `To clarify with a professional: ${v.clarify}` : null, `(Source: ${src})`].filter(Boolean).join("\n"));
      if (v.outcome) outcomes.push(v.outcome);
    }
    sections[key] = { body: parts.join("\n\n").slice(0, 10000), outcomes: outcomes.join("\n").slice(0, 4000) || undefined };
  }
  const summaryFact = fs.find((f) => f.destination === "careplan.summary");
  const summary = (summaryFact ? String(summaryFact.value) : `Draft prepared from the documents in Care Coordinator intake ${intake.reference}. Not approved: a different manager must check and approve it before carers use it.`).slice(0, 2000);
  const fresh = await db.carePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { sections: true } });
  await saveDraft(ctx, plan.id, { fingerprint: draftFingerprint(fresh, fresh.sections), summary, reviewDue: fresh.reviewDue ? fromDbDate(fresh.reviewDue) : addDays(londonDate(), 182), sections });
  await db.$transaction(async (tx) => {
    for (const f of fs) if (!f.appliedAt) await markApplied(tx, f, `CarePlan:${plan!.id}`);
  });
  const back = await db.carePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { sections: true } });
  const filled = back.sections.filter((s) => fs.some((f) => f.destination === `careplan.${s.key}`)).length;
  return { created: [`Care plan version ${back.version} saved as a DRAFT (${filled} of 9 sections filled from documents)`], skipped: [], notes: ["Submit the draft from the Care tab. A different manager approves it; until then carers keep any earlier approved plan.", ...PLAN_SECTION_KEYS.filter((k) => !fs.some((f) => f.destination === `careplan.${k}`)).map((k) => `${PLAN_SECTION_LABEL[k]}: not documented, needs assessment`)], verified: back.status === "DRAFT" && filled === new Set(fs.filter((f) => f.destination !== "careplan.summary").map((f) => f.destination)).size };
}

// ── Risk assessments (drafts) ──────────────────────────────────────────────

async function applyRisks(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  const { su } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section: "RISKS", decision: { in: [...ACCEPTED] }, appliedAt: null }, orderBy: { position: "asc" } });
  for (const f of fs) {
    const r = f.value as z.output<typeof riskValue>;
    const dup = await db.riskAssessment.findFirst({ where: { serviceUserId: su.id, status: { in: ["DRAFT", "ACTIVE"] }, type: r.type, title: { equals: r.title, mode: "insensitive" } } });
    if (dup) { await db.$transaction((tx) => markApplied(tx, f, `existing:RiskAssessment:${dup.id}`)); out.skipped.push(`${r.title} already exists`); continue; }
    const src = await db.$transaction((tx) => docLabel(tx, f.sourceDocumentId, f.sourcePage));
    const reviewDue = r.reviewDue && r.reviewDue > londonDate() ? r.reviewDue : addDays(londonDate(), 14);
    const hazards = [r.hazard, r.whoAffected ? `Who could be affected: ${r.whoAffected}` : null, `Source: ${src}`, r.openQuestions ? `Outstanding: ${r.openQuestions}` : null, r.levelIsProvisional ? `Level ${r.level} is PROVISIONAL (set by the coordinator, not stated in the documents). The assessor must confirm or change it.` : null].filter(Boolean).join("\n").slice(0, 4000);
    const controls = (r.existingControls ? `Documented controls: ${r.existingControls}` : "No controls are documented. The assessor must set the controls before approving.").slice(0, 4000);
    const created = await createRiskDraft(ctx, su.id, { type: r.type, title: r.title, hazards, controls, level: r.level ?? "MEDIUM", reviewDue, requiredActions: r.recommendedActions ? `For review: ${r.recommendedActions}` : undefined, responsiblePerson: r.recommendedActions ? (r.responsiblePerson ?? "Registered manager") : (r.responsiblePerson ?? undefined) });
    await db.$transaction((tx) => markApplied(tx, f, `RiskAssessment:${created.id}`));
    out.created.push(`${r.title} (DRAFT, review by ${reviewDue})`);
  }
  out.verified = (await db.riskAssessment.count({ where: { serviceUserId: su.id, status: "DRAFT" } })) >= out.created.length;
  out.notes.push("Draft risk assessments are not active and not shown to carers. A different manager reviews each one on the Risk Assessments tab.");
  return out;
}

// ── Medication (reconciliation first) ──────────────────────────────────────

const TIME_WORDS: [RegExp, string][] = [[/morning|breakfast|\bam\b|08:00|09:00/i, "MORNING"], [/lunch|midday|12:00|13:00/i, "LUNCH"], [/tea|afternoon|evening meal|16:|17:/i, "TEA"], [/bed|night|20:|21:|22:/i, "BED"]];
function timeRanges(times: string[], frequency: string | null) {
  const text = [...times, frequency ?? ""].join(" ");
  const out = TIME_WORDS.filter(([re]) => re.test(text)).map(([, k]) => k);
  if (!out.length && /once (a|daily)|od\b/i.test(text)) return [];
  return out;
}
const ROUTES: Record<string, string> = { oral: "ORAL", mouth: "ORAL", tablet: "ORAL", topical: "TOPICAL", cream: "TOPICAL", skin: "TOPICAL", inhal: "INHALED", eye: "EYE", ear: "EAR", nasal: "NASAL", nose: "NASAL", patch: "TRANSDERMAL" };

async function applyMedication(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  const { su, intake } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section: "MEDICATION", decision: { in: [...ACCEPTED] } }, orderBy: { position: "asc" } });
  const docs = await db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, category: true, name: true } });
  const arrangement = fs.find((f) => f.destination === "medication.arrangement")?.value as z.output<typeof medArrangementValue> | undefined;
  const enabled = await medicationEnabled(scope.organisationId);
  const canDraft = enabled && hasOrgPermission(ctx, "medication.manage");
  for (const f of fs) {
    if (f.appliedAt) continue;
    const src = await db.$transaction((tx) => docLabel(tx, f.sourceDocumentId, f.sourcePage));
    const doc = docs.find((d) => d.id === f.sourceDocumentId);
    const fromDischarge = !!doc && /DISCHARGE/.test(doc.category);
    let description = "";
    let draftId: string | null = null;
    if (f.destination === "medication.arrangement") {
      const a = f.value as z.output<typeof medArrangementValue>;
      description = a.support === "SELF" ? `Medication support: self-administers (${a.detail}). No staff MAR is created. Confirm with the person and record any change.` : a.support === "PROMPT" ? `Medication support: prompting only (${a.detail}). Carers prompt; this is recorded as prompting, never administration.` : `Medication support: ${MED_SUPPORT[a.support].toLowerCase()} (${a.detail}). Each medicine needs reconciling against a current list before carers support it.`;
    } else if (f.destination === "medication.allergy") {
      description = `Allergy in the documents: ${String(f.value)}. Confirm with the GP or pharmacy and add it to the care plan.`;
    } else {
      const m = f.value as z.output<typeof medItemValue>;
      const why: string[] = [];
      if (!arrangement || arrangement.support === "SELF" || arrangement.support === "UNKNOWN") why.push(arrangement?.support === "SELF" ? "the person self-administers, so no staff MAR is created" : "the support arrangement is not approved or not clear");
      if (fromDischarge) why.push("it comes from a hospital discharge letter, which can be out of date and never overwrites current medication");
      if (f.temporal !== "CURRENT") why.push("it is not confirmed as current");
      if (m.status !== "CURRENT") why.push(`it is marked ${m.status.toLowerCase()}`);
      if (!m.dose) why.push("the dose is missing");
      if (m.asRequired && !m.prnInstructions) why.push("as-required instructions are incomplete");
      const ranges = timeRanges(m.times, m.frequency);
      if (!m.asRequired && !ranges.length) why.push("when it is due is not clear");
      if (!enabled) why.push("medication records are switched off for this organisation");
      else if (!canDraft) why.push("only someone who manages medication can prepare a draft medicine");
      if (!why.length && canDraft) {
        const route = Object.entries(ROUTES).find(([k]) => (m.route ?? m.name).toLowerCase().includes(k))?.[1] ?? "ORAL";
        const support = arrangement!.support as "PROMPT" | "ASSIST" | "ADMINISTER";
        const dup = await db.medication.findFirst({ where: { serviceUserId: su.id, status: { in: ["DRAFT", "ACTIVE"] }, name: { equals: m.name, mode: "insensitive" } } });
        if (dup) why.push("a medicine with this name is already on the record");
        else {
          const med = await addMedication(ctx, su.id, { name: m.name, strength: m.strength ?? undefined, dose: m.dose!, route, support, timeRanges: m.asRequired ? [] : ranges, asRequired: m.asRequired, instructions: [m.frequency, m.prnInstructions, `From ${src}`].filter(Boolean).join(". ").slice(0, 1000), startDate: londonDate() } as Parameters<typeof addMedication>[2]);
          draftId = med.id;
          description = `${displayValue("medication.item", m)}: prepared as a DRAFT medicine (not on the MAR). A second person who manages medication must check it against the current prescription and approve it.`;
        }
      }
      if (!draftId) description = `${displayValue("medication.item", m)}: not added to the MAR because ${why.join("; ")}. Reconcile with the current GP or pharmacy list.`;
    }
    await db.$transaction(async (tx) => {
      const item = await tx.careIntakeReviewItem.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "MEDICATION", description: description.slice(0, 2000), sourceRef: src.slice(0, 300), restricted: true, createdById: ctx.userId } });
      await markApplied(tx, f, draftId ? `Medication:${draftId}` : `CareIntakeReviewItem:${item.id}`);
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.medication.reconciliation", entityType: "ServiceUser", entityId: su.id, data: { intakeId, reference: intake.reference, factId: f.id, reviewItemId: item.id, draftMedicationId: draftId } }, tx);
    });
    out.created.push(`${f.label}: ${draftId ? "draft medicine for second-person approval" : "on the reconciliation list"}`);
  }
  out.notes.push("Nothing here is active on the MAR. Draft medicines need a second person's approval; everything else is in the person's medication reconciliation queue.");
  return out;
}

// ── Historical incidents and skin findings ─────────────────────────────────

async function applyHistory(ctx: Ctx, scope: Scope, intakeId: string, section: "INCIDENTS" | "BODY_MAP"): Promise<SectionResult> {
  const { su } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section, decision: { in: [...ACCEPTED] }, appliedAt: null }, orderBy: { position: "asc" } });
  for (const f of fs) {
    const src = await db.$transaction((tx) => docLabel(tx, f.sourceDocumentId, f.sourcePage));
    const text = section === "INCIDENTS"
      ? (() => { const v = f.value as z.output<typeof incidentValue>; return `HISTORICAL incident from documents (${v.date ?? "date not given"}): ${v.type}. ${v.description}${v.consequences ? ` Consequences: ${v.consequences}.` : ""}${v.actions ? ` Actions documented: ${v.actions}.` : ""} This is history, not a new incident. Report a new incident only if it happened in your service.`; })()
      : (() => { const v = f.value as z.output<typeof skinValue>; return `Skin finding in documents (${v.date ?? "date not given"}${v.area ? `, ${v.area}` : ""}): ${v.finding}. ${v.description} Not a current observation. A competent person checks the skin at the first visit and records any current finding on the body map.`; })();
    await db.$transaction(async (tx) => {
      const item = await tx.careIntakeReviewItem.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: section === "INCIDENTS" ? "INCIDENT_HISTORY" : "BODY_MAP", description: text.slice(0, 2000), sourceRef: src.slice(0, 300), restricted: true, createdById: ctx.userId } });
      await markApplied(tx, f, `CareIntakeReviewItem:${item.id}`);
    });
    out.created.push(`${f.label}: ${section === "INCIDENTS" ? "kept as incident history to check" : "kept as a skin finding to check at the first visit"}`);
  }
  out.notes.push(section === "INCIDENTS" ? "No incident records were created. Historical incidents stay as history." : "No body map observations were created. Historical findings are never shown as current.");
  return out;
}

// ── Call Notes: general communication, approved with the section ───────────

async function applyCallNotes(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section: "CALL_NOTES", decision: { in: [...ACCEPTED] } }, orderBy: { position: "asc" } });
  for (const f of fs) {
    if (f.appliedAt) { out.skipped.push(`${f.label}: already saved`); continue; }
    await db.$transaction(async (tx) => {
      const { su, intake } = await suFor(tx, scope, intakeId);
      const doc = f.sourceDocumentId ? await tx.careIntakeDocument.findUnique({ where: { id: f.sourceDocumentId }, select: { name: true, documentDate: true } }) : null;
      const section = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: "CALL_NOTES" } } });
      const note = await createIntakeCallNote(tx, ctx, {
        organisationId: scope.organisationId, serviceUserId: su.id, intake: { id: intake.id, reference: intake.reference, createdAt: intake.createdAt }, fact: f, documentName: doc?.name ?? null, documentDate: doc?.documentDate ?? null,
        approvedById: section.decidedById, value: f.value as z.output<typeof callNoteValue>, sourceLabel: `${intake.reference} · ${await docLabel(tx, f.sourceDocumentId, f.sourcePage)}`,
      });
      await markApplied(tx, f, `CallNote:${note.id}`);
      out.created.push(`${note.reference}: ${f.label}`);
    });
  }
  out.notes.push("Only general communication becomes a Call Note. Anything for another record is decided in that record's own section.");
  return out;
}

// ── Visits: templates and care tasks ───────────────────────────────────────

async function applyVisits(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  return db.$transaction(async (tx) => {
    const { su, intake } = await suFor(tx, scope, intakeId);
    const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
    const fs = await facts(tx, intakeId, "VISITS");
    const pkg = await tx.carePackage.findFirst({ where: { serviceUserId: su.id, status: "ACTIVE" } });
    const callTypes = await tx.callType.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true } });
    if (!callTypes.length) throw new ValidationError("Add at least one call type in Rota Settings first");
    const area = await checkArea(tx, scope, su.areaId);
    let createdTasks = 0;
    for (const f of fs) {
      if (f.appliedAt) continue;
      const v = f.value as z.output<typeof visitValue>;
      const start = parseHhmm(v.startTime)!;
      if (v.fundedBy !== "COUNCIL") {
        const item = await tx.careIntakeReviewItem.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "MISSING_INFO", description: `${v.label} ${v.startTime} (${dayList(v.weekdays)}) is informal or family support in the documents. It was not scheduled. If the agency is commissioned for it, edit the row to "Council" in a new intake or add a template by hand.`, sourceRef: (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300), restricted: false, createdById: ctx.userId } });
        await markApplied(tx, f, `CareIntakeReviewItem:${item.id}`);
        out.skipped.push(`${v.label} ${v.startTime}: informal support, not scheduled`);
        continue;
      }
      const dup = await tx.visitTemplate.findFirst({ where: { serviceUserId: su.id, enabled: true, startMinute: start, weekdays: { hasSome: v.weekdays } } });
      if (dup) { await markApplied(tx, f, `existing:VisitTemplate:${dup.id}`); out.skipped.push(`${v.label} ${v.startTime} already has a repeating visit`); continue; }
      const taskIds: string[] = [];
      for (const name of v.tasks.slice(0, 30)) {
        const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
        if (!clean) continue;
        let task = await tx.careTask.findFirst({ where: { organisationId: scope.organisationId, name: { equals: clean, mode: "insensitive" } } });
        if (!task) { task = await tx.careTask.create({ data: { organisationId: scope.organisationId, name: clean, description: `Added from Care Coordinator intake ${intake.reference}` } }); createdTasks++; }
        if (!task.active) continue;
        if (!taskIds.includes(task.id)) taskIds.push(task.id);
      }
      const callTypeId = v.callTypeId && callTypes.some((c) => c.id === v.callTypeId) ? v.callTypeId : guessCallType(v.startTime, `${v.label} ${v.tasks.join(" ")}`, callTypes);
      const effectiveFrom = v.effectiveFrom ?? (pkg ? fromDbDate(pkg.startDate) : londonDate());
      const effectiveTo = v.effectiveTo ?? (pkg?.endDate ? fromDbDate(pkg.endDate) : null);
      const notes = [`${v.label}.`, v.tasks.length ? `Tasks: ${v.tasks.join("; ")}.` : null, v.medicationPrompt ? "Medication support at this visit, as in the care plan and MAR." : null, `Source: ${await docLabel(tx, f.sourceDocumentId, f.sourcePage)}.`].filter(Boolean).join(" ").slice(0, 2000);
      const input: TemplateInput = { serviceUserId: su.id, callTypeId, areaId: area?.id ?? null, cycleWeeks: [1, 2, 3, 4], weekdays: v.weekdays, startMinute: start, durationMin: v.durationMin, carersRequired: v.carers, medicationRequired: v.medicationPrompt, alertOnLate: true, timeLocked: false, rotaType: "NORMAL", effectiveFrom, effectiveTo, notes, taskIds, extraPreferredStaffIds: [] };
      const t = await createTemplateInTx(tx, scope, ctx.userId, input);
      await markApplied(tx, f, `VisitTemplate:${t.id}`);
      out.created.push(`${v.label} ${hhmm(start)}–${hhmm((start + v.durationMin) % 1440)}, ${dayList(v.weekdays)}, ${v.carers} carer${v.carers > 1 ? "s" : ""}, ${taskIds.length} tasks`);
    }
    const rec = reconcileHours(fs.map((f) => f.value as z.output<typeof visitValue>).map((x) => ({ weekdays: x.weekdays, durationMin: x.durationMin, carers: x.carers, fundedBy: x.fundedBy as FundedBy })), pkg?.commissionedMinutesPerWeek ?? null);
    out.notes.push(rec.message);
    if (createdTasks) out.notes.push(`${createdTasks} new care task${createdTasks === 1 ? " was" : "s were"} added to the organisation's task list.`);
    out.notes.push("No carers were assigned and no visits were created. Create the draft rota from this intake once the care plan is approved.");
    out.verified = (await tx.careIntakeFact.count({ where: { intakeId, section: "VISITS", decision: { in: [...ACCEPTED] }, appliedAt: null } })) === 0;
    return out;
  });
}

// ── Filing the original documents ──────────────────────────────────────────

/** Files every intake document in Council or Other Documents (original file, unchanged). Runs with Personal details. */
export async function fileDocuments(ctx: Ctx, intakeId: string) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.documents");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (!intake.serviceUserId) throw new ConflictError("Save Personal details first");
    const su = await tx.serviceUser.findFirstOrThrow({ where: { id: intake.serviceUserId } });
    const personal = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: "PERSONAL" } } });
    if (intake.mode === "NEW" && personal.applyStatus !== "DONE") throw new ConflictError("Save Personal details first");
    const docs = await tx.careIntakeDocument.findMany({ where: { intakeId, filedDocumentId: null }, orderBy: { position: "asc" } });
    let filed = 0;
    for (const d of docs) {
      if (!categoriesFor(d.section).some((c) => c.key === d.category)) throw new ValidationError(`Choose a valid category for ${d.name}`);
      const details = parseDetails(d.section, { name: d.name, category: d.category, issuingAuthority: d.issuer ?? undefined, receivedOn: londonDate(), effectiveFrom: d.documentDate ? fromDbDate(d.documentDate) : undefined, notes: `Filed from Care Coordinator intake ${intake.reference}. Original file, unchanged (SHA-256 ${d.sha256.slice(0, 16)}…).`, markSensitive: d.sensitive });
      const row = await tx.serviceUserDocument.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, section: d.section, ...details, sensitive: d.sensitive || details.sensitive, createdById: ctx.userId } });
      await tx.serviceUserDocumentVersion.create({ data: { organisationId: scope.organisationId, documentId: row.id, version: 1, filename: d.filename, contentType: d.contentType, sizeBytes: d.sizeBytes, sha256: d.sha256, storageKey: d.storageKey, scanStatus: d.scanStatus, uploadedById: d.createdById } });
      await tx.careIntakeDocument.update({ where: { id: d.id }, data: { filedDocumentId: row.id } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "suDocument.uploaded", entityType: "ServiceUserDocument", entityId: row.id, data: { serviceUserId: su.id, section: d.section, category: d.category, filename: d.filename, sizeBytes: d.sizeBytes, sensitive: row.sensitive, via: "care-coordinator", intakeId } }, tx);
      if (d.section === "COUNCIL" && d.category === "COUNCIL_SUPPORT_PLAN") await promptCarePlanReview(tx, scope.organisationId, ctx.userId, su, row.id, 1);
      filed++;
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.documents.filed", entityType: "CareIntake", entityId: intakeId, data: { filed } }, tx);
    return filed;
  });
}

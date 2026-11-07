import type { CareIntakeFact, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, hhmm, londonDate, parseHhmm } from "@/lib/london";
import {
  ACCEPTED, APPLY_ORDER, OPEN_DECISIONS, RESTRICTED_SECTIONS, SAVE_CLAIM_MS, inReview, CARE_PLAN_TOPICS, CONTACT_KIND_LABEL, MED_SUPPORT, PLAN_SECTION_KEYS, PLAN_SECTION_LABEL, dayList, displayValue, externalReferenceValue, reconcileHours, sectionLabel,
  type IntakeSection, type callNoteValue, type contactValue, type incidentValue, type medArrangementValue, type medItemValue, type planValue, type riskValue, type skinValue, type visitValue,
} from "@/lib/care-coordinator-rules";
import { guessCallType, type FundedBy } from "@/lib/su-import-rules";
import { z } from "zod";
import { audit, currentAutomation } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { serviceUserWhere, type Scope } from "@/server/rota/scope";
import { durationCheck, visitTasks } from "./visit-tasks";
import { DISCHARGE_CATEGORIES, openDischargeReview } from "../discharge-review";
import { addPendingVersion, currentSupportPlan, recordVersionStatus } from "../document-versions";
import { createTemplateInTx, type TemplateInput } from "@/server/rota/templates";
import { draftFingerprint, saveDraft, startDraft } from "../care-plans";
import { addMedication, medicationEnabled } from "../medication";
import { createRiskDraft } from "../risks";
import { linkExternalReferenceInTx, referenceKeyConfigured } from "../external-references";
import { checkArea, detailData, detailsSchema, nextServiceUserReference } from "../service-users";
import { categoriesFor, parseDetails, promptCarePlanReview } from "../su-documents";
import { coordinatorAccess, intakeInScope, isRestrictedFact } from "./intake";
import { findPossibleDuplicates } from "../su-import";
import { createIntakeCallNote } from "../call-notes";
import { rotaScope } from "@/server/rota/scope";

type Tx = Prisma.TransactionClient;

/**
 * Approve & Save to CRM: the authorised Care Coordinator approves the reviewed intake and it is saved into the Service
 * User profile, one section at a time (owner's brief, 7 Nov 2026: one coordinator, one review, one approval; there is
 * no separate manager approval).
 *
 *  - A section is saved only after the coordinator approved it (approveAndSave records who, per section). Everything
 *    goes through the existing domain services or the same rules they use (scope, permissions, audit), never arbitrary SQL.
 *  - Idempotent: every fact records what it became (appliedRef) in the same transaction that created it, so retrying a
 *    failed section skips what is already saved. Contacts, visits and medicines already on the record are not repeated.
 *  - A failure marks the section FAILED with the reason; nothing is presented as set up when it is not, and sections
 *    already saved stay saved. Each section is read back after saving and the result is recorded (applyResult). The
 *    intake is Completed only when every approved section is saved and nothing is left to decide.
 *  - Concurrency: the intake row is locked while it is approved, and each section is claimed (applyStatus SAVING with
 *    claimedAt) so two people pressing the button at once cannot both save the same section.
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

/**
 * Sections the AI CSB Coordinator may save as drafts before the coordinator approves the intake (brief of 6 Nov 2026):
 * the person is created at Assessment, the care plan and risks are DRAFTs for their own approvals, visit templates only
 * reach the rota once care is activated. Restricted sections (medication, incident history, skin) are never drafted
 * automatically: they are approved with the intake, and only by someone allowed to see restricted records.
 */
export const DRAFT_SECTIONS = ["PERSONAL", "CONTACTS", "CARER_PREFERENCES", "PACKAGE", "CARE_PLAN", "RISKS", "VISITS", "CALL_NOTES"] as const satisfies readonly IntakeSection[];
export const isDraftSection = (s: string) => (DRAFT_SECTIONS as readonly string[]).includes(s);

/**
 * opts.automated (automatic setup by CSB AI, 7 Nov 2026): also routes the restricted sections. Medication, incident
 * history and skin findings then become restricted review items only (medication reconciliation, history to check):
 * no draft medicine, nothing on the MAR, no incident or body map record, and nothing the person who started the setup
 * may not see is shown to them.
 */
export async function applySection(ctx: Ctx, intakeId: string, section: IntakeSection, opts: { prepare?: boolean; automated?: boolean } = {}) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const automated = !!opts.automated && !!opts.prepare;
  const prepare = !!opts.prepare && (isDraftSection(section) || automated);
  // Claim the section so two people pressing Save at once cannot both run it.
  const claim = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (prepare && !inReview(intake.status)) throw new ConflictError("Drafts are prepared while the coordinator is reviewing the intake");
    if (prepare && intake.mode !== "NEW" && (section === "PACKAGE" || section === "VISITS")) throw new ConflictError(`${sectionLabel(section)} changes for someone already receiving care are saved only when you approve them (Approve & Save to CRM)`);
    const s = await tx.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
    if (s.status === "REJECTED") throw new ConflictError(`${sectionLabel(section)} was rejected, so nothing from it is saved`);
    if (!prepare && s.status !== "APPROVED") throw new ConflictError(`${sectionLabel(section)} has not been approved yet. Press Approve & Save to CRM.`);
    if (s.applyStatus === "SAVING" && s.claimedAt && Date.now() - s.claimedAt.getTime() < SAVE_CLAIM_MS) throw new ConflictError(`${sectionLabel(section)} is being saved right now. Wait a moment, then reload.`);
    const unapplied = await tx.careIntakeFact.count({ where: { intakeId, section, decision: { in: [...ACCEPTED] }, appliedAt: null, id: { notIn: await handedFactIds(tx, intakeId) } } });
    if (!unapplied && s.applyStatus === "DONE") return null;
    if (prepare && !unapplied) return null;
    if (intake.status === "CANCELLED" || intake.status === "COMPLETED") throw new ConflictError("This intake is closed");
    if (section !== "PERSONAL" && !intake.serviceUserId) throw new ConflictError("Save Personal details first: the person does not exist yet");
    if (RESTRICTED_SECTIONS.has(section) && !access.sensitive && !automated) throw new ForbiddenError("Only someone allowed to see restricted records (a registered manager or administrator) saves this section");
    await tx.careIntakeSection.update({ where: { id: s.id }, data: { attempts: { increment: 1 }, applyStatus: "SAVING", claimedAt: new Date() } });
    await tx.careIntake.update({ where: { id: intake.id }, data: { status: "APPLYING" } });
    return { intake, sectionStatus: s.status };
  });
  if (!claim) return { section, status: "DONE" as const, result: null };
  try {
    const result = await run(ctx, scope, claim.intake.id, section, automated);
    await db.$transaction(async (tx) => {
      // A section the coordinator already approved keeps that approval when the AI drafts more facts into it.
      await tx.careIntakeSection.update({ where: { intakeId_section: { intakeId, section } }, data: { applyStatus: "DONE", applyResult: result as unknown as Prisma.InputJsonValue, applyError: null, claimedAt: null, appliedById: ctx.userId, appliedAt: new Date(), ...(prepare && claim.sectionStatus !== "APPROVED" ? { status: "DRAFTED", decidedById: null, decidedAt: null } : {}) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: prepare ? "coordinator.section.drafted" : "coordinator.section.applied", entityType: "CareIntake", entityId: intakeId, data: { section, created: result.created.length, skipped: result.skipped.length, verified: result.verified } }, tx);
      if (prepare) await tx.careIntake.update({ where: { id: intakeId }, data: { status: "DRAFT" } });
      else await settleStatus(tx, intakeId);
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
      await tx.careIntakeSection.update({ where: { intakeId_section: { intakeId, section } }, data: { applyStatus: "FAILED", applyError: message.slice(0, 1000), claimedAt: null } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.section.failed", entityType: "CareIntake", entityId: intakeId, data: { section, error: message.slice(0, 300), prepare } }, tx);
      if (prepare) await tx.careIntake.update({ where: { id: intakeId }, data: { status: "DRAFT" } });
      else await settleStatus(tx, intakeId);
    });
    if (!(e instanceof AppError)) throw e;
    return { section, status: "FAILED" as const, error: message };
  }
}

export interface ApproveSaveReport {
  intakeId: string;
  reference: string;
  serviceUserId: string | null;
  /** Sections the coordinator approved in this action. */
  approved: IntakeSection[];
  /** Every section with something approved, in save order, with what happened to it now. */
  sections: { section: IntakeSection; label: string; status: "SAVED" | "ALREADY_SAVED" | "FAILED" | "NOT_RUN" | "RESTRICTED"; created: string[]; error?: string }[];
  filed: number;
  filedError?: string;
  completed: boolean;
  /** Facts still to decide after saving (questions, warnings, restricted facts). */
  openFacts: number;
}

const approveSchema = z.object({
  notADuplicate: z.boolean().default(false),
  areaId: z.string().trim().max(40).optional().transform((v) => v || undefined),
  lockVersion: z.number().int().nonnegative().nullable().default(null),
});

/**
 * The single approval (owner's brief, 7 Nov 2026). The authorised coordinator has checked every fact; this approves
 * every section that has approved facts, records their name on each section, then saves each section into the CRM in
 * order (Personal details first, visits last) and reports what was actually saved.
 *
 *  - Allowed with careIntake.approve and the coordinator's ordinary record permissions; no second person is needed.
 *  - Refused while documents are still being read, when the page is out of date (lockVersion) or when someone else is
 *    saving it right now. Undecided facts do not block what is ready; they stay listed and the intake is not Completed.
 *  - Identity first: a new person needs an approved first and last name, an area when the coordinator works in areas,
 *    and no possible duplicate on record unless the coordinator confirmed it is a different person.
 *  - Restricted sections (medication, incident history, skin) are approved and saved only by someone allowed to see
 *    restricted records. Clinical content stays inactive whoever presses the button (see the file comment above).
 *  - A failed section is explained by name and can be retried with the same button: saved sections are never repeated
 *    and facts record what they became, so contacts, packages and visits are not duplicated.
 */
export async function approveAndSave(ctx: Ctx, intakeId: string, input: z.input<typeof approveSchema> = {}): Promise<ApproveSaveReport> {
  const access = coordinatorAccess(ctx);
  requireOrgPermission(ctx, "careIntake.approve");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const p = approveSchema.safeParse(input);
  if (!p.success) throw new ValidationError("Check the approval details");
  const opts = p.data;

  const step = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status === "CANCELLED") throw new ConflictError("This intake was cancelled. Nothing more is saved from it.");
    if (intake.status === "APPLYING" && Date.now() - intake.updatedAt.getTime() < SAVE_CLAIM_MS) throw new ConflictError("This intake is being saved right now. Wait a moment, then reload.");
    if (opts.lockVersion !== null && intake.lockVersion !== opts.lockVersion) throw new ConflictError("The intake changed since you opened this page (for example a document finished reading). Reload and check it before approving.");
    const docs = await tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true, readStatus: true, name: true } });
    const reading = docs.filter((d) => d.readStatus === "PENDING");
    if (reading.length) throw new ConflictError(`${reading.map((d) => d.name).join(", ")} ${reading.length === 1 ? "is" : "are"} still being read. Wait until reading finishes, check the new facts, then approve.`);
    const facts = await tx.careIntakeFact.findMany({ where: { intakeId } });
    const sections = await tx.careIntakeSection.findMany({ where: { intakeId } });
    const sensitiveDoc = new Map(docs.map((d) => [d.id, d.sensitive]));
    const hiddenFromMe = (f: (typeof facts)[number]) => !access.sensitive && isRestrictedFact(f, !!(f.sourceDocumentId && sensitiveDoc.get(f.sourceDocumentId)));
    const open = facts.filter((f) => OPEN_DECISIONS.has(f.decision) && !f.appliedAt);
    // Facts still undecided (or with a question) do not block the records that are ready: they stay on the intake,
    // listed for attention, and the intake is not Completed until they are settled (brief of 7 Nov 2026, point 9).
    const openMine = open.filter((f) => !hiddenFromMe(f));
    const accepted = facts.filter((f) => ACCEPTED.has(f.decision));
    const unfiled = intake.serviceUserId ? docs.length - (await tx.careIntakeDocument.count({ where: { intakeId, filedDocumentId: { not: null } } })) : 0;
    if (!accepted.length && !unfiled) throw new ValidationError("Nothing has been approved under Check facts, so there is nothing to set up yet");

    // The sections this coordinator approves now: everything with approved facts that is theirs to approve.
    const withFacts = new Set(accepted.map((f) => f.section));
    // A section already approved is approved again (with this coordinator's name) when it has newly approved facts.
    const handed = new Set(await handedFactIds(tx, intakeId));
    const fresh = new Set(accepted.filter((f) => !f.appliedAt && !handed.has(f.id)).map((f) => f.section));
    const approve = sections.filter((s) => withFacts.has(s.section) && s.status !== "REJECTED" && (s.status !== "APPROVED" || fresh.has(s.section)) && (!RESTRICTED_SECTIONS.has(s.section) || access.sensitive));

    let areaId = intake.areaId;
    if (intake.mode === "NEW" && !intake.serviceUserId) {
      for (const k of ["person.firstName", "person.lastName"]) if (!accepted.some((f) => f.destination === k)) throw new ValidationError(`Approve the person's ${k === "person.firstName" ? "first" : "last"} name under Personal details before saving`);
      if (opts.areaId) {
        const area = await tx.area.findFirst({ where: { id: opts.areaId, organisationId: scope.organisationId, active: true } });
        if (!area || (scope.areaIds && !scope.areaIds.includes(area.id))) throw new ValidationError("Choose one of your areas");
        areaId = area.id;
      }
      if (scope.areaIds && !areaId) throw new ValidationError("Choose the area the person lives in");
      const name = (k: string) => String(accepted.find((f) => f.destination === k)?.value ?? "");
      const dupes = await findPossibleDuplicates(scope, { firstName: name("person.firstName"), lastName: name("person.lastName"), dateOfBirth: name("person.dateOfBirth") || undefined, postcode: name("person.postcode") || undefined }, tx);
      if (dupes.length && !opts.notADuplicate && !intake.notDuplicateById) throw new ConflictError(`${dupes[0]!.name} (${dupes[0]!.reference}) is already on record: ${dupes[0]!.reason.toLowerCase()}. Nothing was saved. Start an intake for that person instead, or tick "This is a different person".`);
      if (dupes.length && !intake.notDuplicateById) await tx.careIntake.update({ where: { id: intake.id }, data: { notDuplicateById: ctx.userId } });
    }

    const now = new Date();
    for (const s of approve) {
      const n = accepted.filter((f) => f.section === s.section).length;
      await tx.careIntakeSection.update({ where: { id: s.id }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.section.approved", entityType: "CareIntake", entityId: intake.id, data: { section: s.section, facts: n, wasDrafted: s.status === "DRAFTED" } }, tx);
    }
    await tx.careIntake.update({ where: { id: intake.id }, data: { status: "APPLYING", submittedById: ctx.userId, submittedAt: now, areaId, lockVersion: { increment: 1 } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.intake.approved", entityType: "CareIntake", entityId: intake.id, data: { sections: approve.map((s) => s.section), accepted: accepted.length, rejected: facts.filter((f) => f.decision === "REJECTED").length, duplicates: facts.filter((f) => f.decision === "DUPLICATE").length, openFacts: openMine.length, restrictedOpen: open.length - openMine.length, notADuplicate: opts.notADuplicate } }, tx);
    return { intake, approved: approve.map((s) => s.section as IntakeSection), withFacts };
  });

  // Save each approved section in order. A section that fails is explained and the rest carry on, except that nothing
  // can be saved for a new person until Personal details are saved.
  const report: ApproveSaveReport = { intakeId, reference: step.intake.reference, serviceUserId: null, approved: step.approved, sections: [], filed: 0, completed: false, openFacts: 0 };
  let personalFailed = false;
  try {
    for (const key of APPLY_ORDER) {
      if (!step.withFacts.has(key)) continue;
      const s = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: key } } });
      if (s.status === "REJECTED") continue;
      const label = sectionLabel(key);
      if (s.status !== "APPROVED") { report.sections.push({ section: key, label, status: "RESTRICTED", created: [], error: "Only someone allowed to see restricted records (a registered manager or administrator) approves and saves this section" }); continue; }
      if (personalFailed) { report.sections.push({ section: key, label, status: "NOT_RUN", created: [], error: "not saved yet, because Personal details must be saved first" }); continue; }
      try {
        const r = await applySection(ctx, intakeId, key);
        if (r.status === "DONE") report.sections.push({ section: key, label, status: r.result ? "SAVED" : "ALREADY_SAVED", created: r.result?.created ?? [] });
        else report.sections.push({ section: key, label, status: "FAILED", created: [], error: r.error });
        if (key === "PERSONAL" && r.status !== "DONE") personalFailed = true;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        report.sections.push({ section: key, label, status: "FAILED", created: [], error: e.message });
        if (key === "PERSONAL") personalFailed = true;
      }
    }
    // The originals are filed in the person's documents once the person exists (an updated plan for someone already
    // on record has no Personal details to save, so it is filed here).
    const fresh = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    if (fresh.serviceUserId && (await db.careIntakeDocument.count({ where: { intakeId, filedDocumentId: null } }))) {
      try {
        report.filed = await fileDocuments(ctx, intakeId);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        report.filedError = e.message;
      }
    }
  } finally {
    // Never left "Saving": the status is worked out again from what is actually saved.
    await db.$transaction((tx) => settleStatus(tx, intakeId));
  }
  const after = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  report.serviceUserId = after.serviceUserId;
  report.completed = after.status === "COMPLETED";
  report.openFacts = await db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] }, appliedAt: null } });
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.intake.saved", entityType: "CareIntake", entityId: intakeId, data: { sections: report.sections.map((x) => [x.section, x.status]), filed: report.filed, completed: report.completed } });
  return report;
}

/** Whether any section was not saved: the screen then shows the message as an error that names each one. */
export const approveSaveFailed = (r: ApproveSaveReport) => r.sections.some((s) => s.status === "FAILED" || s.status === "NOT_RUN");

/** What the screen says after Approve & Save to CRM, in plain words. Names exactly which sections were not saved. */
export function approveSaveText(r: ApproveSaveReport) {
  const saved = r.sections.filter((s) => s.status === "SAVED" || s.status === "ALREADY_SAVED");
  const failed = r.sections.filter((s) => s.status === "FAILED" || s.status === "NOT_RUN");
  const restricted = r.sections.filter((s) => s.status === "RESTRICTED");
  const parts = [`${r.reference} approved by you. ${saved.length} section${saved.length === 1 ? "" : "s"} saved to the CRM and read back${saved.length ? ` (${saved.map((s) => s.label).join(", ")})` : ""}.`];
  if (failed.length) parts.push(`Not saved: ${failed.map((s) => `${s.label} (${s.error ?? "failed"})`).join("; ")}. Fix the cause and press Approve & Save to CRM again; saved sections are not repeated.`);
  if (restricted.length) parts.push(`${restricted.map((s) => s.label).join(", ")} ${restricted.length === 1 ? "waits" : "wait"} for someone allowed to see restricted records.`);
  if (r.filed) parts.push(`${r.filed} original document${r.filed === 1 ? "" : "s"} filed in the person's documents.`);
  if (r.filedError) parts.push(`The original documents were not filed: ${r.filedError}`);
  if (r.completed) parts.push("The intake is complete. You can now prepare the draft rota.");
  else if (r.openFacts) parts.push(`${r.openFacts} fact${r.openFacts === 1 ? " still needs" : "s still need"} attention under Check facts; ${r.openFacts === 1 ? "it was" : "they were"} not saved. The intake is complete once ${r.openFacts === 1 ? "it is" : "they are"} settled.`);
  return parts.join(" ");
}

/**
 * The intake's status, worked out from what is saved. Completed only when every section with approved facts was
 * approved by the coordinator and saved, no approved fact is unsaved and nothing is left to decide. Otherwise it is
 * back in coordinator review, where failed sections show their reason and can be saved again.
 */
async function settleStatus(tx: Tx, intakeId: string) {
  const intake = await tx.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  if (intake.status === "CANCELLED") return;
  const sections = await tx.careIntakeSection.findMany({ where: { intakeId } });
  const facts = await tx.careIntakeFact.findMany({ where: { intakeId }, select: { id: true, section: true, decision: true, appliedAt: true } });
  const rejected = new Set(sections.filter((s) => s.status === "REJECTED").map((s) => s.section));
  const withFacts = new Set(facts.filter((f) => ACCEPTED.has(f.decision)).map((f) => f.section));
  const relevant = sections.filter((s) => withFacts.has(s.section) && s.status !== "REJECTED");
  // A fact handed to a person as an exception (a date of birth only a manager may save) is accounted for.
  const handed = new Set(await handedFactIds(tx, intakeId));
  const unsaved = facts.some((f) => ACCEPTED.has(f.decision) && !f.appliedAt && !rejected.has(f.section) && !handed.has(f.id));
  const open = facts.some((f) => OPEN_DECISIONS.has(f.decision) && !f.appliedAt);
  const saving = sections.some((s) => s.applyStatus === "SAVING");
  const done = relevant.length > 0 && relevant.every((s) => s.status === "APPROVED" && s.applyStatus === "DONE") && !unsaved && !open;
  const status = done ? "COMPLETED" : saving ? "APPLYING" : "DRAFT";
  if (status !== intake.status) await tx.careIntake.update({ where: { id: intakeId }, data: { status } });
}

async function run(ctx: Ctx, scope: Scope, intakeId: string, section: IntakeSection, automated = false): Promise<SectionResult> {
  switch (section) {
    case "PERSONAL": return applyPersonal(ctx, scope, intakeId);
    case "CONTACTS": return applyContacts(ctx, scope, intakeId);
    case "CARER_PREFERENCES": return applyPreferences(ctx, scope, intakeId);
    case "PACKAGE": return applyPackage(ctx, scope, intakeId);
    case "CARE_PLAN": return applyCarePlan(ctx, scope, intakeId);
    case "RISKS": return applyRisks(ctx, scope, intakeId);
    case "MEDICATION": return applyMedication(ctx, scope, intakeId, automated);
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
    const forManager: CareIntakeFact[] = [];
    if (!sensitive) for (const k of ["dateOfBirth", "nhsNumber"]) if (values[k]) { skipped.push(`${k === "dateOfBirth" ? "Date of birth" : "NHS number"} needs a registered manager to save. It is listed for a manager under Audit & Exceptions.`); delete values[k]; forManager.push(...fs.filter((f) => f.destination === `person.${k}`)); }
    if (intake.mode === "NEW" && !intake.serviceUserId) {
      const parsed = detailsSchema.safeParse({ ...values, carerGenderPreference: "ANY", areaId: intake.areaId ?? undefined });
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the personal details");
      const area = await checkArea(tx, scope, intake.areaId);
      const reference = await nextServiceUserReference(tx, scope.organisationId);
      const su = await tx.serviceUser.create({ data: { organisationId: scope.organisationId, reference, csbReference: reference, status: "ASSESSMENT", areaId: area?.id ?? null, branchId: area?.branchId ?? null, createdById: ctx.userId, ...detailData(ctx, parsed.data) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.created", entityType: "ServiceUser", entityId: su.id, data: { via: "care-coordinator", intakeId, reference: intake.reference } }, tx);
      await tx.careIntake.update({ where: { id: intakeId }, data: { serviceUserId: su.id } });
      // Only what was really written is marked saved: a date of birth or NHS number left for a manager stays open.
      for (const f of fs) if (values[f.destination.slice(7)] !== undefined) await markApplied(tx, f, `ServiceUser:${su.id}`);
      await handToManager(tx, ctx, scope, intake, su.id, forManager);
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
    await handToManager(tx, ctx, scope, intake, su.id, forManager);
    const linked = await applyReferences(tx, ctx, scope, su.id, refs, sensitive);
    return { created: [...(changed.length ? [`Updated ${changed.length} personal detail${changed.length === 1 ? "" : "s"}`] : []), ...linked.created], skipped: [...skipped, ...(changed.length || linked.created.length ? [] : ["The record already matched"]), ...linked.skipped], notes: [], verified: true };
  });
}

/** Facts handed to a person as an exception instead of being saved (for example a date of birth only a manager may save). */
export async function handedFactIds(tx: Tx | typeof db, intakeId: string): Promise<string[]> {
  return (await tx.careIntakeReviewItem.findMany({ where: { intakeId, factId: { not: null } }, select: { factId: true } })).map((r) => r.factId!);
}

/** A date of birth or NHS number the saver may not write stays unsaved and becomes a follow-up for a registered manager,
 *  so it is never shown as saved and never lost. Raised once per fact. */
async function handToManager(tx: Tx, ctx: Ctx, scope: Scope, intake: { id: string; reference: string }, serviceUserId: string, fs: CareIntakeFact[]) {
  for (const f of fs) {
    if (await tx.careIntakeReviewItem.findUnique({ where: { factId: f.id } })) continue;
    const what = f.destination === "person.dateOfBirth" ? "date of birth" : "NHS number";
    const item = await tx.careIntakeReviewItem.create({ data: { organisationId: scope.organisationId, serviceUserId, intakeId: intake.id, factId: f.id, category: "MANAGER_FIELD", severity: "FOLLOW_UP", title: `Save the ${what}`, recordTab: "personal", description: `The documents give a ${what} (${String(f.value)}), but only a registered manager may save it, so it was left for one. Check it against the original and save it on the Personal details tab.`, sourceRef: (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300), restricted: false, automated: !!currentAutomation(), createdById: ctx.userId } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.exception.raised", entityType: "CareIntake", entityId: intake.id, data: { itemId: item.id, category: "MANAGER_FIELD", severity: "FOLLOW_UP" } }, tx);
  }
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
    if (r.typeUnclear) { out.skipped.push(`${f.label}: choose what this reference identifies before saving it`); continue; }
    if (r.type === "NHS" && !sensitive) { out.skipped.push(`${f.label} needs a registered manager to save`); continue; }
    if (r.type === "NHS" && !/^\d{3} ?\d{3} ?\d{4}$/.test(r.value)) { out.skipped.push(`${f.label}: an NHS number has 10 digits`); continue; }
    if (!referenceKeyConfigured()) { out.skipped.push(`${f.label}: the reference register is not set up on this system yet, so it was not saved. Add it on the Reference Numbers tab once it is.`); continue; }
    const res = await linkExternalReferenceInTx(tx, ctx, scope.organisationId, serviceUserId, { type: r.type, issuer: r.issuer, value: r.value, systemLabel: r.system ?? null, sourceDocumentId: f.sourceDocumentId, sourcePage: f.sourcePage, sourceQuote: f.quote, verificationNote: "Read from documents by the Care Coordinator; not verified" });
    if (res.status === "conflict") { out.skipped.push(`${f.label}: this reference is already on another person's profile. Investigate before linking.`); continue; }
    await markApplied(tx, f, `ServiceUserExternalReference:${res.id}`);
    if (res.status === "created") out.created.push(`${f.label} added to the reference register (not yet verified)`);
    else if (res.status === "reinstated") out.created.push(`${f.label} was superseded earlier and is back in use (not yet verified)`);
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
    // Only facts not saved yet, so saving again never repeats a preference note.
    const fs = (await facts(tx, intakeId, "CARER_PREFERENCES")).filter((f) => !f.appliedAt);
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
    const { su } = await suFor(tx, scope, intakeId);
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
    // The package text holds only the approved staffing and support instructions. The funder named in the documents
    // and an hours mismatch become package questions for a person to settle; where the facts came from is kept on
    // each fact (appliedRef) and shown on the Care Package tab, so none of it is pasted into the text.
    const requirements = v("requirements") ? String(v("requirements")) : null;
    const row = await tx.carePackage.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, reference: (v("reference") as string | undefined) ?? null, commissionedMinutesPerWeek: minutes ?? null, startDate: dbDate(startDate), endDate: endDate ? dbDate(endDate) : null, requirements } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "care.package.created", entityType: "ServiceUser", entityId: su.id, data: { packageId: row.id, minutes: row.commissionedMinutesPerWeek, via: "care-coordinator", intakeId } }, tx);
    const questions: string[] = [];
    for (const f of fs) {
      if (f.destination === "package.funder") {
        const item = await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "FUNDING", description: `The documents name "${String(f.value)}" as the commissioning authority. It is not linked to a finance funder yet: finance checks it and links the funder on the Care Package tab.`.slice(0, 2000), sourceRef: (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300), restricted: false, createdById: ctx.userId } });
        await markApplied(tx, f, `CareIntakeReviewItem:${item.id}`);
        questions.push("Funding to verify");
        continue;
      }
      if (f.destination === "package.minutesPerWeek" && !rec.matches) {
        await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "PACKAGE_HOURS", description: rec.message.slice(0, 2000), sourceRef: (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300), restricted: false, createdById: ctx.userId } });
        questions.push("Commissioned hours to check");
      }
      await markApplied(tx, f, `CarePackage:${row.id}`);
    }
    const back = await tx.carePackage.findUniqueOrThrow({ where: { id: row.id } });
    return { created: [`Care package from ${startDate}${endDate ? ` to ${endDate}` : ""}${minutes !== undefined ? `, ${minutes} minutes a week` : ""}`, ...questions.map((q) => `Package question: ${q}`)], skipped: [], notes: [rec.message, "The funder named in the documents is a package question for finance. Linking a finance funder stays a finance decision."], verified: fromDbDate(back.startDate) === startDate && back.commissionedMinutesPerWeek === (minutes ?? null) && back.requirements === requirements };
  });
}

// ── Care plan (draft) ──────────────────────────────────────────────────────

async function applyCarePlan(ctx: Ctx, scope: Scope, intakeId: string): Promise<SectionResult> {
  const { su, intake } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const section = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section: "CARE_PLAN" } } });
  // The draft this intake started (kept while the section runs; afterwards found through the saved facts).
  const prior = (section.applyResult as { planId?: string } | null)?.planId ?? (await db.careIntakeFact.findFirst({ where: { intakeId, section: "CARE_PLAN", appliedRef: { startsWith: "CarePlan:" } }, select: { appliedRef: true } }))?.appliedRef?.slice("CarePlan:".length);
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
    // Facts saved by an earlier run are already in the draft's text; only new ones are added.
    const mine = fs.filter((f) => f.destination === `careplan.${key}` && !f.appliedAt);
    const existing = plan.sections.find((s) => s.key === key);
    if (!mine.length) { sections[key] = { body: existing?.body || "Not documented in the source documents. To be completed at assessment.", outcomes: existing?.outcomes ?? undefined }; continue; }
    const parts: string[] = existing?.body ? [existing.body, ""] : [];
    const outcomes: string[] = existing?.outcomes ? [existing.outcomes] : [];
    for (const f of mine) {
      const v = f.value as z.output<typeof planValue>;
      const src = await db.$transaction((tx) => docLabel(tx, f.sourceDocumentId, f.sourcePage));
      const topic = v.topic ? CARE_PLAN_TOPICS[v.topic].label : null;
      parts.push([topic ? `${topic}` : null, v.canDo ? `What I can do myself: ${v.canDo}` : null, v.support ? `Support I need: ${v.support}` : null, v.how ? `How staff should support me: ${v.how}` : null, v.preferences ? `My preferences: ${v.preferences}` : null, v.clarify ? `To clarify with a professional: ${v.clarify}` : null, `(Source: ${src})`].filter(Boolean).join("\n"));
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
    const hazards = [r.hazard, r.whoAffected ? `Who could be affected: ${r.whoAffected}` : null, `Source: ${src}`, r.openQuestions ? `Outstanding: ${r.openQuestions}` : null, !r.level ? "NO RISK LEVEL IS STATED in the documents. The level shown is only a placeholder so the draft can be saved; the assessor must set it." : r.levelIsProvisional ? `Level ${r.level} is PROVISIONAL (set by the coordinator, not stated in the documents). The assessor must confirm or change it.` : null].filter(Boolean).join("\n").slice(0, 4000);
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

async function applyMedication(ctx: Ctx, scope: Scope, intakeId: string, automated = false): Promise<SectionResult> {
  const { su, intake } = await db.$transaction((tx) => suFor(tx, scope, intakeId));
  const out: SectionResult = { created: [], skipped: [], notes: [], verified: true };
  const fs = await db.careIntakeFact.findMany({ where: { intakeId, section: "MEDICATION", decision: { in: [...ACCEPTED] } }, orderBy: { position: "asc" } });
  const docs = await db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, category: true, name: true } });
  const arrangement = fs.find((f) => f.destination === "medication.arrangement")?.value as z.output<typeof medArrangementValue> | undefined;
  const enabled = await medicationEnabled(scope.organisationId);
  // CSB AI never prepares a medicine: from an unverified support plan everything goes to reconciliation.
  const canDraft = enabled && hasOrgPermission(ctx, "medication.manage") && !automated;
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
      else if (automated) why.push("CSB AI read it from a support plan, which is not a verified prescription");
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
      const item = await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "MEDICATION", description: description.slice(0, 2000), sourceRef: src.slice(0, 300), restricted: true, createdById: ctx.userId } });
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
      const item = await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: section === "INCIDENTS" ? "INCIDENT_HISTORY" : "BODY_MAP", description: text.slice(0, 2000), sourceRef: src.slice(0, 300), restricted: true, createdById: ctx.userId } });
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
        const item = await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, factId: f.id, category: "MISSING_INFO", severity: "INFO", title: "Family or informal visit not scheduled", recordTab: "template", description: `${v.label} ${v.startTime} (${dayList(v.weekdays)}) is informal or family support in the documents. It was not scheduled. If the agency is commissioned for it, edit the row to "Council" in a new intake or add a template by hand.`, sourceRef: (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300), restricted: false, createdById: ctx.userId } });
        await markApplied(tx, f, `CareIntakeReviewItem:${item.id}`);
        out.skipped.push(`${v.label} ${v.startTime}: informal support, not scheduled`);
        continue;
      }
      const dup = await tx.visitTemplate.findFirst({ where: { serviceUserId: su.id, enabled: true, startMinute: start, weekdays: { hasSome: v.weekdays } } });
      if (dup) { await markApplied(tx, f, `existing:VisitTemplate:${dup.id}`); out.skipped.push(`${v.label} ${v.startTime} already has a repeating visit`); continue; }
      const taskIds: string[] = [];
      const { tasks: carerTasks, heldMedication } = visitTasks(v.tasks);
      const src = (await docLabel(tx, f.sourceDocumentId, f.sourcePage)).slice(0, 300);
      const when = `${v.label} ${v.startTime} (${dayList(v.weekdays)})`;
      if (heldMedication.length) {
        // Never a carer task from a document: medication waits for an authorised medication record.
        await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, category: "MEDICATION", description: `${when}: medication task${heldMedication.length === 1 ? "" : "s"} not given to carers until the medication record is authorised: ${heldMedication.join("; ")}.`.slice(0, 2000), sourceRef: src, restricted: true, createdById: ctx.userId } });
        out.notes.push(`${when}: ${heldMedication.length} medication task${heldMedication.length === 1 ? " was" : "s were"} held back until medication is authorised.`);
      }
      const fit = durationCheck(carerTasks, v.durationMin);
      if (!fit.fits) {
        await tx.careIntakeReviewItem.create({ data: { automated: !!currentAutomation(), organisationId: scope.organisationId, serviceUserId: su.id, intakeId, category: "VISIT_TASKS", description: `${when}: ${carerTasks.length} tasks look like about ${fit.needed} minutes of care in a ${v.durationMin}-minute visit. Check the tasks or the visit length with the council. Nothing was changed.`, sourceRef: src, restricted: false, createdById: ctx.userId } });
        out.notes.push(`${when}: the tasks may not fit in ${v.durationMin} minutes. Flagged for you to check.`);
      }
      for (const clean of carerTasks) {
        let task = await tx.careTask.findFirst({ where: { organisationId: scope.organisationId, name: { equals: clean, mode: "insensitive" } } });
        if (!task) { task = await tx.careTask.create({ data: { organisationId: scope.organisationId, name: clean, description: `Added from Care Coordinator intake ${intake.reference}` } }); createdTasks++; }
        if (!task.active) continue;
        if (!taskIds.includes(task.id)) taskIds.push(task.id);
      }
      const callTypeId = v.callTypeId && callTypes.some((c) => c.id === v.callTypeId) ? v.callTypeId : guessCallType(v.startTime, `${v.label} ${v.tasks.join(" ")}`, callTypes);
      const effectiveFrom = v.effectiveFrom ?? (pkg ? fromDbDate(pkg.startDate) : londonDate());
      const effectiveTo = v.effectiveTo ?? (pkg?.endDate ? fromDbDate(pkg.endDate) : null);
      const notes = [`${v.label}${v.visitType ? ` (${v.visitType})` : ""}.`, v.tasks.length ? `Tasks: ${v.tasks.join("; ")}.` : null, v.instructions ? `Instructions: ${v.instructions}` : null, v.temporary ? `Temporary visit${v.effectiveTo ? ` until ${v.effectiveTo}` : ", end date to confirm"}.` : null, v.medicationPrompt ? "Medication support at this visit, as in the care plan and MAR." : null, `Source: ${await docLabel(tx, f.sourceDocumentId, f.sourcePage)}.`].filter(Boolean).join(" ").slice(0, 2000);
      const input: TemplateInput = { serviceUserId: su.id, callTypeId, areaId: area?.id ?? null, cycleWeeks: [1, 2, 3, 4], weekdays: v.weekdays, startMinute: start, durationMin: v.durationMin, carersRequired: v.carers, medicationRequired: v.medicationPrompt, alertOnLate: true, timeLocked: false, rotaType: "NORMAL", effectiveFrom, effectiveTo, notes, taskIds, extraPreferredStaffIds: [] };
      const t = await createTemplateInTx(tx, scope, ctx.userId, input);
      await markApplied(tx, f, `VisitTemplate:${t.id}`);
      out.created.push(`${v.label} ${hhmm(start)}–${hhmm((start + v.durationMin) % 1440)}, ${dayList(v.weekdays)}, ${v.carers} carer${v.carers > 1 ? "s" : ""}, ${taskIds.length} tasks`);
    }
    const rec = reconcileHours(fs.map((f) => f.value as z.output<typeof visitValue>).map((x) => ({ weekdays: x.weekdays, durationMin: x.durationMin, carers: x.carers, fundedBy: x.fundedBy as FundedBy })), pkg?.commissionedMinutesPerWeek ?? null);
    out.notes.push(rec.message);
    if (createdTasks) out.notes.push(`${createdTasks} new care task${createdTasks === 1 ? " was" : "s were"} added to the organisation's task list.`);
    out.notes.push("No carers were assigned. Any draft rota from these visits is unpublished, so carers see nothing until care is made Active and the rota is published.");
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
      // A revised support plan for someone who already has one becomes its next version, waiting for review; the
      // plan in force stays current until a person approves the new one (version control, phase 8).
      const existingPlan = intake.mode !== "NEW" && d.section === "COUNCIL" && d.category === "COUNCIL_SUPPORT_PLAN" ? await currentSupportPlan(tx, su.id) : null;
      if (existingPlan) {
        const pending = await addPendingVersion(tx, { organisationId: scope.organisationId, documentId: existingPlan.id, actorId: ctx.userId, file: { filename: d.filename, contentType: d.contentType, sizeBytes: d.sizeBytes, sha256: d.sha256, storageKey: d.storageKey, scanStatus: d.scanStatus }, documentDate: d.documentDate, receivedOn: dbDate(londonDate()), effectiveFrom: d.documentDate, intakeId: intake.id, note: `Revised plan from Care Coordinator intake ${intake.reference}. Waiting for review; the earlier version stays in force until it is approved.` });
        await tx.careIntakeDocument.update({ where: { id: d.id }, data: { filedDocumentId: existingPlan.id } });
        await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "suDocument.version.pending", entityType: "ServiceUserDocument", entityId: existingPlan.id, data: { serviceUserId: su.id, version: pending.version, intakeId } }, tx);
        filed++;
        continue;
      }
      const details = parseDetails(d.section, { name: d.name, category: d.category, issuingAuthority: d.issuer ?? undefined, receivedOn: londonDate(), effectiveFrom: d.documentDate ? fromDbDate(d.documentDate) : undefined, notes: `Filed from Care Coordinator intake ${intake.reference}. Original file, unchanged (SHA-256 ${d.sha256.slice(0, 16)}…).`, markSensitive: d.sensitive });
      const row = await tx.serviceUserDocument.create({ data: { organisationId: scope.organisationId, serviceUserId: su.id, section: d.section, ...details, sensitive: d.sensitive || details.sensitive, createdById: ctx.userId } });
      const v1 = await tx.serviceUserDocumentVersion.create({ data: { organisationId: scope.organisationId, documentId: row.id, version: 1, filename: d.filename, contentType: d.contentType, sizeBytes: d.sizeBytes, sha256: d.sha256, storageKey: d.storageKey, scanStatus: d.scanStatus, uploadedById: d.createdById, documentDate: d.documentDate, receivedOn: details.receivedOn, effectiveFrom: details.effectiveFrom, intakeId: intake.id } });
      await recordVersionStatus(tx, { organisationId: scope.organisationId, documentId: row.id, versionId: v1.id, status: "CURRENT", actorId: ctx.userId, note: `Filed from Care Coordinator intake ${intake.reference}` });
      await tx.careIntakeDocument.update({ where: { id: d.id }, data: { filedDocumentId: row.id } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "suDocument.uploaded", entityType: "ServiceUserDocument", entityId: row.id, data: { serviceUserId: su.id, section: d.section, category: d.category, filename: d.filename, sizeBytes: d.sizeBytes, sensitive: row.sensitive, via: "care-coordinator", intakeId } }, tx);
      if (d.section === "COUNCIL" && d.category === "COUNCIL_SUPPORT_PLAN") await promptCarePlanReview(tx, scope.organisationId, ctx.userId, su, row.id, 1);
      // A hospital discharge letter opens a post-discharge review linked to it (phase 7); the support plan is untouched.
      if (DISCHARGE_CATEGORIES.has(d.category)) await openDischargeReview(tx, { organisationId: scope.organisationId, serviceUserId: su.id, serviceUserName: `${su.firstName} ${su.lastName}`, intakeId: intake.id, intakeDocumentId: d.id, documentId: row.id, actorId: ctx.userId });
      filed++;
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.documents.filed", entityType: "CareIntake", entityId: intakeId, data: { filed } }, tx);
    return filed;
  });
}

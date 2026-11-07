import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, londonDate, mondayOf, parseHhmm } from "@/lib/london";
import { ACCEPTED, APPLY_ORDER, OPEN_DECISIONS, inReview, sectionLabel, type IntakeSection } from "@/lib/care-coordinator-rules";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { createProposedRota } from "@/server/rota/build";
import { applyTemplateChanges, updateTemplate } from "@/server/rota/templates";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { findPossibleDuplicates } from "../su-import";
import { DRAFT_SECTIONS, applySection, approveAndSave, approveSaveText, fileDocuments, isDraftSection, type ApproveSaveReport } from "./apply";
import { checkAcceptable, coordinatorAccess, intakeInScope, isRestrictedFact } from "./intake";

/**
 * The AI CSB Coordinator's preparation step (brief of 6 Nov 2026, phases 3 and 4): from what the documents say, it
 * fills the person's real CRM records as drafts and proposes a rota, so nobody retypes the support plan.
 *
 *  1. Facts whose words were found on the page, with no conflict, are accepted for drafting, and so are facts the AI
 *     read from a scanned page (labelled as not checked word for word). A quote missing from a page with text,
 *     anything contradicted, restricted or already on the record differently stays for the coordinator.
 *  2. Identity first: a new person is created only with a first and last name and when no one similar is on record
 *     (or the coordinator confirmed it is a different person). Otherwise the intake stays a prospective intake.
 *  3. The draft-safe sections are saved through the same code as Approve & Save to CRM: the person at Assessment,
 *     contacts, preferences, the care package, the care plan as a DRAFT, risks as DRAFTs, visit templates, call notes.
 *     Medication, incident history and skin findings are never drafted automatically: the coordinator decides them and
 *     only someone allowed to see restricted records saves them. The coordinator then approves the whole intake once.
 *  4. A proposed rota for the next weeks: unpublished visits that cannot be published until care is activated.
 *
 * Every step is idempotent (facts record what they became) and can be run again: it carries on from where it stopped.
 * Counts in the report are read back from the database, never estimated.
 */

export interface PrepareReport {
  intakeId: string;
  reference: string;
  serviceUserId: string | null;
  serviceUserReference: string | null;
  blocked: string | null;
  duplicate: { name: string; reference: string; reason: string } | null;
  accepted: number;
  sections: { section: IntakeSection; label: string; status: "DRAFTED" | "FAILED" | "NOTHING" | "REJECTED" | "SKIPPED"; created: string[]; error?: string }[];
  rota: { visits: number; unassignedSlots: number; alreadyBuilt: number; weekStart: string; weeks: number; error?: string } | null;
  attention: { facts: number; restricted: number; followUps: number };
  /** Option C (supporting document): documents filed in the person's records, or why they were not. */
  filed?: number;
  filedError?: string;
}

const AUTO_NOTE = "Accepted for drafting by the AI CSB Coordinator: the words were found on the page and nothing contradicts them.";
const SCANNED_NOTE = "Accepted for drafting by the AI CSB Coordinator from a scanned page: the AI read the page image, so the words could not be checked automatically. Compare with the original before relying on it.";
const SCANNED_ONLY = /^Page \d+ is scanned, so the quote could not be checked\.( Compare with the original\.)?$/;

export async function prepareDrafts(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean; rotaWeeks?: number } = {}): Promise<PrepareReport> {
  try {
    return await prepare(ctx, intakeId, opts);
  } catch (e) {
    // A database refusal is turned into a plain message naming the check that failed (its code, table and fields,
    // never the record's contents), so the screen can say what stopped and support can find it. Each section is
    // saved in its own transaction, so a refused one leaves nothing half-written.
    const why = databaseRefusal(e);
    if (why) throw new ConflictError(`Drafts could not be prepared: the database refused a change (${why}). The facts read from the documents are kept; check them, then press Prepare records again or tell support this code.`);
    throw e;
  }
}

/** The code, table and fields of a Prisma request error, or null for any other error. Contains no record data. */
export function databaseRefusal(e: unknown): string | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = (e.meta ?? {}) as { modelName?: unknown; target?: unknown; field_name?: unknown };
  const fields = Array.isArray(meta.target) ? meta.target.join(", ") : typeof meta.target === "string" ? meta.target : typeof meta.field_name === "string" ? meta.field_name : null;
  return [e.code, typeof meta.modelName === "string" ? meta.modelName : null, fields].filter(Boolean).join(" ").slice(0, 200);
}

/**
 * Step 1 of preparing (and of Confirm & Set Up Records): accepts the safe facts for drafting and settles identity. A
 * new person needs a first and last name and no possible duplicate on record, unless the coordinator confirmed it is a
 * different person. Returns why it stopped (blocked) instead of throwing, so the caller decides how to say it.
 */
export async function acceptSafeFacts(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean }) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (!inReview(intake.status)) throw new ConflictError(intake.status === "APPLYING" ? "This intake is being saved to the CRM right now. Wait a moment, then reload." : "Drafts are prepared while the coordinator is reviewing. This intake is finished or cancelled.");
    // A supporting document (option C) changes no records by itself: it is filed, and its facts wait for a person.
    const allowed = intake.mode === "DOCUMENT" ? [] : DRAFT_SECTIONS.filter((s) => !(intake.mode === "EXISTING" && (s === "PACKAGE" || s === "VISITS")));
    const docs = await tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true } });
    // Checked facts, and facts the AI read from a scanned page (an image has no text to check a quote against; most
    // council plans arrive scanned). A quote missing from a page that has text is never accepted: that is a misreading.
    const candidates = (await tx.careIntakeFact.findMany({ where: { intakeId, section: { in: [...allowed] }, decision: "PENDING", appliedAt: null, OR: [{ verification: "VERIFIED", conflict: null }, { verification: "UNVERIFIED", origin: "AI", conflict: { startsWith: "Page " } }] }, orderBy: { position: "asc" } }))
      .filter((f) => f.verification === "VERIFIED" || SCANNED_ONLY.test(f.conflict ?? ""));
    const ok = candidates.filter((f) => {
      if (isRestrictedFact(f, !!docs.find((d) => d.id === f.sourceDocumentId)?.sensitive) && !access.sensitive) return false;
      try {
        checkAcceptable(f.destination, f.value, f.temporal, { draft: true });
        return true;
      } catch {
        return false;
      }
    });
    // Identity before anything is written for a new person.
    if (intake.mode === "NEW" && !intake.serviceUserId) {
      const all = await tx.careIntakeFact.findMany({ where: { intakeId, section: "PERSONAL", destination: { startsWith: "person." } } });
      const value = (k: string) => {
        const f = all.find((x) => x.destination === k && ACCEPTED.has(x.decision)) ?? ok.find((x) => x.destination === k);
        return f ? String(f.value) : "";
      };
      if (!value("person.firstName") || !value("person.lastName")) return { intake, blocked: "The documents do not give the person's first and last name clearly enough. Check Personal details, then try again.", duplicate: null, accepted: 0 };
      const dupes = await findPossibleDuplicates(scope, { firstName: value("person.firstName"), lastName: value("person.lastName"), dateOfBirth: value("person.dateOfBirth") || undefined, postcode: value("person.postcode") || undefined }, tx);
      if (dupes.length && !opts.notADuplicate && !intake.notDuplicateById) {
        const d = dupes[0]!;
        return { intake, blocked: `${d.name} (${d.reference}) is already on record: ${d.reason.toLowerCase()}. Nothing was created. Start an intake for that person instead, or confirm this is a different person.`, duplicate: { name: d.name, reference: d.reference, reason: d.reason }, accepted: 0 };
      }
      if (dupes.length) await tx.careIntake.update({ where: { id: intake.id }, data: { notDuplicateById: ctx.userId } });
    }
    // Two writes, not one per fact: a long plan has dozens of facts, and the transaction must stay short.
    const decidedAt = new Date();
    for (const [verified, note] of [[true, AUTO_NOTE], [false, SCANNED_NOTE]] as const) {
      const ids = ok.filter((f) => (f.verification === "VERIFIED") === verified).map((f) => f.id);
      if (ids.length) await tx.careIntakeFact.updateMany({ where: { id: { in: ids } }, data: { decision: "APPROVED", decisionNote: note, decidedById: ctx.userId, decidedAt, lockVersion: { increment: 1 } } });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.drafts.accepted", entityType: "CareIntake", entityId: intake.id, data: { accepted: ok.length, sections: [...new Set(ok.map((f) => f.section))] } }, tx);
    return { intake, blocked: null, duplicate: null, accepted: ok.length };
  });
}

async function prepare(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean; rotaWeeks?: number }): Promise<PrepareReport> {
  const step1 = await acceptSafeFacts(ctx, intakeId, opts);
  const scope = await rotaScope(ctx, "serviceUser.edit");

  const report: PrepareReport = { intakeId, reference: step1.intake.reference, serviceUserId: step1.intake.serviceUserId, serviceUserReference: null, blocked: step1.blocked, duplicate: step1.duplicate, accepted: step1.accepted, sections: [], rota: null, attention: { facts: 0, restricted: 0, followUps: 0 } };
  if (!step1.blocked && step1.intake.mode === "DOCUMENT") {
    // Option C: file the document in the person's records, in the category it was classified into. Nothing else.
    try {
      report.filed = await fileDocuments(ctx, intakeId);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      report.filedError = e.message;
    }
  } else if (!step1.blocked) {
    for (const section of APPLY_ORDER) {
      if (!isDraftSection(section)) continue;
      const s = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
      const pending = await db.careIntakeFact.count({ where: { intakeId, section, decision: { in: [...ACCEPTED] }, appliedAt: null } });
      if (!pending) continue;
      if (s.status === "REJECTED") { report.sections.push({ section, label: sectionLabel(section), status: "REJECTED", created: [] }); continue; }
      if (step1.intake.mode === "EXISTING" && (section === "PACKAGE" || section === "VISITS")) { report.sections.push({ section, label: sectionLabel(section), status: "SKIPPED", created: [], error: "Changes for someone already receiving care are saved only when you approve them with Approve & Save to CRM" }); continue; }
      try {
        const r = await applySection(ctx, intakeId, section, { prepare: true });
        if (r.status === "DONE") report.sections.push({ section, label: sectionLabel(section), status: "DRAFTED", created: r.result?.created ?? [] });
        else report.sections.push({ section, label: sectionLabel(section), status: "FAILED", created: [], error: r.error });
        if (section === "PERSONAL" && r.status !== "DONE") break;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        report.sections.push({ section, label: sectionLabel(section), status: "FAILED", created: [], error: e.message });
        if (section === "PERSONAL") break;
      }
    }
  }

  const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  report.serviceUserId = intake.serviceUserId;
  if (intake.serviceUserId && !step1.blocked) {
    const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId }, select: { reference: true } });
    report.serviceUserReference = su?.reference ?? null;
    if (intake.mode === "NEW" && hasOrgPermission(ctx, "rota.build")) report.rota = await proposeRotaFor(ctx, intake.serviceUserId, opts.rotaWeeks ?? 2);
  }
  const [open, restricted, followUps] = await Promise.all([
    db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] } } }),
    db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] }, section: { in: ["MEDICATION", "INCIDENTS", "BODY_MAP"] } } }),
    intake.serviceUserId ? db.careIntakeReviewItem.count({ where: { serviceUserId: intake.serviceUserId, status: "OPEN" } }) : Promise.resolve(0),
  ]);
  report.attention = { facts: open, restricted, followUps };
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.drafts.prepared", entityType: "CareIntake", entityId: intakeId, data: { blocked: !!report.blocked, sections: report.sections.map((s) => [s.section, s.status]), rotaVisits: report.rota?.visits ?? 0, open } });
  return report;
}

export interface ConfirmReport {
  save: ApproveSaveReport;
  /** Safe facts accepted for the coordinator by this confirmation (words found on the page, nothing contradicts). */
  accepted: number;
  rota: PrepareReport["rota"];
  attention: { facts: number; restricted: number; followUps: number };
  confirmedAt: string;
}

/**
 * Confirm & Set Up Records (owner's brief, 7 Nov 2026): the authorised Care Coordinator's one confirmation. There is no
 * separate manager approval.
 *
 *  1. Safe facts still waiting are accepted on the coordinator's behalf (the same rule as preparing: words found on the
 *     page, nothing contradicts them, not restricted, not clinical-only), labelled so on each fact.
 *  2. Identity is checked: a new person needs a name and no possible duplicate, unless the coordinator confirmed it.
 *  3. Every section with approved facts is approved under the coordinator's name and saved to the CRM (approveAndSave):
 *     profile, contacts, package, care plan and risk DRAFTS, medicines as drafts or reconciliation items, visit
 *     templates, call notes (urgent ones wait for the Call Notes review). Clinical records keep their own reviews.
 *  4. For a new person, the proposed rota: unpublished visits that carers cannot see until care is activated.
 *  5. Anything not settled (questions, warnings, restricted facts) is listed for attention and does not block the
 *     ordinary records. The intake is Completed only when nothing is left.
 * Every step is audited with the coordinator's id and the time; running it again repeats nothing already saved.
 */
export async function confirmAndSetUp(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean; areaId?: string; lockVersion?: number | null; rotaWeeks?: number } = {}): Promise<ConfirmReport> {
  coordinatorAccess(ctx);
  requireOrgPermission(ctx, "careIntake.approve");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const before = await intakeInScope(db, scope, intakeId);
  if (opts.lockVersion != null && before.lockVersion !== opts.lockVersion) throw new ConflictError("The intake changed since you opened this page (for example a document finished reading). Reload and check it before confirming.");
  const reading = await db.careIntakeDocument.findMany({ where: { intakeId, readStatus: "PENDING" }, select: { name: true } });
  if (reading.length) throw new ConflictError(`${reading.map((d) => d.name).join(", ")} ${reading.length === 1 ? "is" : "are"} still being read. Wait until reading finishes, check the new facts, then confirm.`);
  let accepted = 0;
  if (before.mode !== "DOCUMENT" && inReview(before.status)) {
    const s1 = await acceptSafeFacts(ctx, intakeId, { notADuplicate: opts.notADuplicate });
    if (s1.blocked) throw s1.duplicate ? new ConflictError(s1.blocked) : new ValidationError(s1.blocked);
    accepted = s1.accepted;
  }
  const save = await approveAndSave(ctx, intakeId, { notADuplicate: opts.notADuplicate ?? false, areaId: opts.areaId, lockVersion: null });
  const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  let rota: PrepareReport["rota"] = null;
  if (intake.mode === "NEW" && intake.serviceUserId && hasOrgPermission(ctx, "rota.build") && save.sections.some((x) => x.section === "VISITS" && (x.status === "SAVED" || x.status === "ALREADY_SAVED"))) {
    rota = await proposeRotaFor(ctx, intake.serviceUserId, opts.rotaWeeks ?? 2);
  }
  const [open, restricted, followUps] = await Promise.all([
    db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] }, appliedAt: null } }),
    db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] }, appliedAt: null, section: { in: ["MEDICATION", "INCIDENTS", "BODY_MAP"] } } }),
    intake.serviceUserId ? db.careIntakeReviewItem.count({ where: { serviceUserId: intake.serviceUserId, intakeId, status: "OPEN" } }) : Promise.resolve(0),
  ]);
  const confirmedAt = new Date();
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.intake.confirmed", entityType: "CareIntake", entityId: intakeId, data: { at: confirmedAt.toISOString(), autoAccepted: accepted, sections: save.sections.map((x) => [x.section, x.status]), filed: save.filed, rotaVisits: rota?.visits ?? 0, openFacts: open, restrictedOpen: restricted, followUps, completed: save.completed } });
  return { save, accepted, rota, attention: { facts: open, restricted, followUps }, confirmedAt: confirmedAt.toISOString() };
}

/** The confirmation's result in plain words for the screen. */
export function confirmReportText(r: ConfirmReport) {
  const parts = [approveSaveText(r.save)];
  if (r.accepted) parts.push(`${r.accepted} checked fact${r.accepted === 1 ? " was" : "s were"} accepted on your confirmation.`);
  if (r.rota?.error) parts.push(`The draft rota was not prepared: ${r.rota.error}`);
  else if (r.rota) parts.push(`Draft rota: ${r.rota.visits} unpublished visit${r.rota.visits === 1 ? "" : "s"}${r.rota.alreadyBuilt ? ` (${r.rota.alreadyBuilt} already there)` : ""}, ${r.rota.unassignedSlots} place${r.rota.unassignedSlots === 1 ? "" : "s"} still need a carer. Carers are not told until care is activated and the rota is published.`);
  if (r.attention.followUps) parts.push(`${r.attention.followUps} follow-up${r.attention.followUps === 1 ? " needs" : "s need"} attention (for example medication to reconcile).`);
  return parts.join(" ");
}

/**
 * After Confirm & Set Up Records the coordinator can prepare the draft rota again (owner's brief, 7 Nov 2026, step 8): unpublished
 * proposed visits from the saved visit templates, through Build Rota's own checks. Carers see nothing: the visits cannot
 * be published until care is activated after the care plan's own approval. Running it again adds nothing twice.
 */
export async function proposeIntakeRota(ctx: Ctx, intakeId: string, weeks = 2) {
  coordinatorAccess(ctx);
  if (!hasOrgPermission(ctx, "rota.build")) throw new ForbiddenError("You cannot build rotas");
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) throw new ValidationError("Choose between 1 and 8 weeks");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const intake = await intakeInScope(db, scope, intakeId);
  if (!intake.serviceUserId) throw new ConflictError("Approve and save the intake first: the person is not on record yet");
  const r = await proposeRotaFor(ctx, intake.serviceUserId, weeks);
  if (!r) throw new ConflictError("There are no saved repeating visits for this person yet. Approve and save the Visits section first.");
  if (r.error) throw new ConflictError(r.error);
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.rota.proposed", entityType: "CareIntake", entityId: intakeId, data: { visits: r.visits, unassignedSlots: r.unassignedSlots, alreadyBuilt: r.alreadyBuilt, weekStart: r.weekStart, weeks } });
  return r;
}

/** Unpublished proposed visits from this week (or next, late on Sunday) for the person's visit templates. */
async function proposeRotaFor(ctx: Ctx, serviceUserId: string, weeks: number): Promise<PrepareReport["rota"]> {
  const weekStart = mondayOf(londonDate());
  const templates = await db.visitTemplate.count({ where: { serviceUserId, enabled: true } });
  if (!templates) return null;
  try {
    const r = await createProposedRota(ctx, serviceUserId, { weekStart, weeks });
    return { visits: r.visits, unassignedSlots: r.unassignedSlots, alreadyBuilt: r.alreadyBuilt, weekStart, weeks };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return { visits: 0, unassignedSlots: 0, alreadyBuilt: 0, weekStart, weeks, error: e.message };
  }
}

/** What the person's records hold now, read from the database, for the chat and the intake screen. */
export async function draftSummary(ctx: Ctx, intakeId: string) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const intake = await intakeInScope(db, scope, intakeId);
  if (!intake.serviceUserId) return { intake: { id: intake.id, reference: intake.reference, status: intake.status }, serviceUser: null };
  const suId = intake.serviceUserId;
  const today = londonDate();
  const [su, contacts, pkg, plan, risks, templates, proposed, open] = await Promise.all([
    db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: suId }, select: { id: true, reference: true, firstName: true, lastName: true, status: true } }),
    db.serviceUserContact.count({ where: { serviceUserId: suId } }),
    db.carePackage.findFirst({ where: { serviceUserId: suId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, commissionedMinutesPerWeek: true, startDate: true } }),
    db.carePlan.findFirst({ where: { serviceUserId: suId }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true } }),
    db.riskAssessment.findMany({ where: { serviceUserId: suId }, select: { id: true, title: true, status: true } }),
    db.visitTemplate.findMany({ where: { serviceUserId: suId, enabled: true }, select: { id: true, startMinute: true, durationMin: true, weekdays: true, carersRequired: true, notes: true }, orderBy: { startMinute: "asc" } }),
    db.visit.findMany({ where: { serviceUserId: suId, publishedAt: null, status: "SCHEDULED", date: { gte: dbDate(today), lte: dbDate(addDays(today, 27)) } }, select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, carersRequired: true }, orderBy: { scheduledStart: "asc" }, take: 200 }),
    db.careIntakeFact.findMany({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] } }, select: { section: true, label: true, conflict: true, verification: true }, take: 50 }),
  ]);
  if (!su) return { intake: { id: intake.id, reference: intake.reference, status: intake.status }, serviceUser: null };
  return {
    intake: { id: intake.id, reference: intake.reference, status: intake.status },
    serviceUser: su,
    contacts,
    carePackage: pkg,
    carePlan: plan,
    risks,
    templates,
    proposedVisits: proposed,
    needsAttention: open,
  };
}

/** The report in plain words, from the committed counts. */
export function prepareReportText(r: PrepareReport) {
  if (r.blocked) return `Nothing was created yet. ${r.blocked}`;
  const lines: string[] = [];
  if (r.filed !== undefined || r.filedError) lines.push(r.filedError ? `Supporting document: not filed (${r.filedError}).` : `Supporting document: ${r.filed} filed in ${r.serviceUserReference ?? "the person"}'s records. No other records were changed.`);
  const drafted = r.sections.filter((s) => s.status === "DRAFTED");
  if (r.serviceUserReference) lines.push(`Records prepared for ${r.serviceUserReference} (care not active yet).`);
  for (const s of drafted) lines.push(`${s.label}: ${s.created.length ? s.created.join("; ") : "nothing new"}.`);
  for (const s of r.sections.filter((x) => x.status === "FAILED" || x.status === "SKIPPED")) lines.push(`${s.label}: not saved (${s.error ?? "see the intake"}).`);
  if (r.rota) lines.push(r.rota.error ? `Draft rota: not created (${r.rota.error}).` : r.rota.visits ? `Draft rota: ${r.rota.visits} proposed visit${r.rota.visits === 1 ? "" : "s"} over ${r.rota.weeks} weeks from ${r.rota.weekStart}, unpublished, ${r.rota.unassignedSlots} carer place${r.rota.unassignedSlots === 1 ? "" : "s"} still open. Carers are not told.` : `Draft rota: no new visits (${r.rota.alreadyBuilt} already proposed).`);
  const a = r.attention;
  if (a.facts || a.followUps) lines.push(`Still needs attention: ${[a.facts ? `${a.facts} fact${a.facts === 1 ? "" : "s"} to check${a.restricted ? ` (${a.restricted} restricted)` : ""}` : null, a.followUps ? `${a.followUps} follow-up${a.followUps === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}.`);
  if (!drafted.length && !r.rota?.visits && r.filed === undefined && !r.filedError) lines.push("Nothing new could be drafted: every remaining fact needs a person to check it.");
  return lines.join("\n");
}

/**
 * Corrects a prepared visit's start time (and optionally its length) for someone whose care is not active yet: the
 * template is changed through the template service, then its unpublished proposed visits are moved through Template +
 * Future Rota (the same rules as the Templates screen). Live care is changed on the Templates screen instead.
 */
export async function correctDraftVisit(ctx: Ctx, templateId: string, change: { startTime: string; durationMin?: number }) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "rota.edit");
  const start = parseHhmm(change.startTime);
  if (start === null) throw new ValidationError("Give the start time as HH:MM");
  const t = await db.visitTemplate.findFirst({ where: { id: templateId, organisationId: scope.organisationId }, include: { tasks: { select: { careTaskId: true } }, serviceUser: { select: { id: true, status: true } } } });
  if (!t || !(await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: t.serviceUserId }, select: { id: true } }))) throw new NotFoundError("Visit template");
  if (t.serviceUser.status === "ACTIVE") throw new ConflictError("Care is active for this person, so change the visit on the Templates screen, where the effect on the live rota is shown first.");
  const updated = await updateTemplate(ctx, t.id, t.version, {
    serviceUserId: t.serviceUserId, callTypeId: t.callTypeId, areaId: t.areaId, cycleWeeks: t.cycleWeeks, weekdays: t.weekdays, startMinute: start, durationMin: change.durationMin ?? t.durationMin, carersRequired: t.carersRequired,
    preferredStaff1Id: t.preferredStaff1Id, preferredStaff2Id: t.preferredStaff2Id, extraPreferredStaffIds: t.extraPreferredStaffIds, shadowStaffId: t.shadowStaffId, timeLocked: t.timeLocked, medicationRequired: t.medicationRequired, alertOnLate: t.alertOnLate,
    rotaType: t.rotaType, runRouteTemplateId: t.runRouteTemplateId, effectiveFrom: fromDbDate(t.effectiveFrom), effectiveTo: t.effectiveTo ? fromDbDate(t.effectiveTo) : null, notes: t.notes, taskIds: t.tasks.map((x) => x.careTaskId).filter((x): x is string => !!x),
  });
  const moved = await applyTemplateChanges(ctx, t.id, updated.version);
  return { templateId: t.id, startTime: change.startTime, durationMin: updated.durationMin, proposedVisitsMoved: moved.filter((r) => r.ok).length, notMoved: moved.filter((r) => !r.ok).map((r) => `${r.reference}: ${r.message ?? "kept"}`) };
}

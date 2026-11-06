import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, londonDate, mondayOf, parseHhmm } from "@/lib/london";
import { ACCEPTED, APPLY_ORDER, OPEN_DECISIONS, sectionLabel, type IntakeSection } from "@/lib/care-coordinator-rules";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { createProposedRota } from "@/server/rota/build";
import { applyTemplateChanges, updateTemplate } from "@/server/rota/templates";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { findPossibleDuplicates } from "../su-import";
import { DRAFT_SECTIONS, applySection, isDraftSection } from "./apply";
import { checkAcceptable, coordinatorAccess, intakeInScope, isRestrictedFact } from "./intake";

/**
 * The AI CSB Coordinator's preparation step (brief of 6 Nov 2026, phases 3 and 4): from what the documents say, it
 * fills the person's real CRM records as drafts and proposes a rota, so nobody retypes the support plan.
 *
 *  1. Facts whose words were found on the page, with no conflict, are accepted for drafting. Anything unverified,
 *     contradicted, restricted or already on the record differently stays for the coordinator.
 *  2. Identity first: a new person is created only with a first and last name and when no one similar is on record
 *     (or the coordinator confirmed it is a different person). Otherwise the intake stays a prospective intake.
 *  3. The draft-safe sections are saved through the same code as a manager-approved section: the person at Assessment,
 *     contacts, preferences, the care package, the care plan as a DRAFT, risks as DRAFTs, visit templates, call notes.
 *     Medication, incident history and skin findings always go to a manager.
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
  sections: { section: IntakeSection; label: string; status: "DRAFTED" | "FAILED" | "NOTHING" | "WITH_MANAGER" | "SKIPPED"; created: string[]; error?: string }[];
  rota: { visits: number; unassignedSlots: number; alreadyBuilt: number; weekStart: string; weeks: number; error?: string } | null;
  attention: { facts: number; restricted: number; followUps: number };
}

const AUTO_NOTE = "Accepted for drafting by the AI CSB Coordinator: the words were found on the page and nothing contradicts them.";

export async function prepareDrafts(ctx: Ctx, intakeId: string, opts: { notADuplicate?: boolean; rotaWeeks?: number } = {}): Promise<PrepareReport> {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const step1 = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status !== "DRAFT") throw new ConflictError("Drafts are prepared while the coordinator is reviewing. This intake is with a manager or finished.");
    const allowed = DRAFT_SECTIONS.filter((s) => !(intake.mode === "EXISTING" && (s === "PACKAGE" || s === "VISITS")));
    const docs = await tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true } });
    const candidates = await tx.careIntakeFact.findMany({ where: { intakeId, section: { in: [...allowed] }, decision: "PENDING", verification: "VERIFIED", conflict: null, appliedAt: null }, orderBy: { position: "asc" } });
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
      if (!value("person.firstName") || !value("person.lastName")) return { intake, blocked: "The documents do not give the person's first and last name clearly enough. Check Personal details, then prepare the drafts again.", duplicate: null, accepted: 0 };
      const dupes = await findPossibleDuplicates(scope, { firstName: value("person.firstName"), lastName: value("person.lastName"), dateOfBirth: value("person.dateOfBirth") || undefined, postcode: value("person.postcode") || undefined });
      if (dupes.length && !opts.notADuplicate && !intake.notDuplicateById) {
        const d = dupes[0]!;
        return { intake, blocked: `${d.name} (${d.reference}) is already on record: ${d.reason.toLowerCase()}. Nothing was created. Start an intake for that person instead, or confirm this is a different person.`, duplicate: { name: d.name, reference: d.reference, reason: d.reason }, accepted: 0 };
      }
      if (dupes.length) await tx.careIntake.update({ where: { id: intake.id }, data: { notDuplicateById: ctx.userId } });
    }
    for (const f of ok) await tx.careIntakeFact.update({ where: { id: f.id }, data: { decision: "APPROVED", decisionNote: AUTO_NOTE, decidedById: ctx.userId, decidedAt: new Date(), lockVersion: { increment: 1 } } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.drafts.accepted", entityType: "CareIntake", entityId: intake.id, data: { accepted: ok.length, sections: [...new Set(ok.map((f) => f.section))] } }, tx);
    return { intake, blocked: null, duplicate: null, accepted: ok.length };
  });

  const report: PrepareReport = { intakeId, reference: step1.intake.reference, serviceUserId: step1.intake.serviceUserId, serviceUserReference: null, blocked: step1.blocked, duplicate: step1.duplicate, accepted: step1.accepted, sections: [], rota: null, attention: { facts: 0, restricted: 0, followUps: 0 } };
  if (!step1.blocked) {
    for (const section of APPLY_ORDER) {
      if (!isDraftSection(section)) continue;
      const s = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
      const pending = await db.careIntakeFact.count({ where: { intakeId, section, decision: { in: [...ACCEPTED] }, appliedAt: null } });
      if (!pending) continue;
      if (!(s.status === "OPEN" || s.status === "DRAFTED")) { report.sections.push({ section, label: sectionLabel(section), status: "WITH_MANAGER", created: [] }); continue; }
      if (step1.intake.mode === "EXISTING" && (section === "PACKAGE" || section === "VISITS")) { report.sections.push({ section, label: sectionLabel(section), status: "SKIPPED", created: [], error: "Changes for someone already receiving care go to a manager" }); continue; }
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
  const drafted = r.sections.filter((s) => s.status === "DRAFTED");
  if (r.serviceUserReference) lines.push(`Records prepared for ${r.serviceUserReference} (care not active yet).`);
  for (const s of drafted) lines.push(`${s.label}: ${s.created.length ? s.created.join("; ") : "nothing new"}.`);
  for (const s of r.sections.filter((x) => x.status === "FAILED" || x.status === "SKIPPED")) lines.push(`${s.label}: not saved (${s.error ?? "see the intake"}).`);
  if (r.rota) lines.push(r.rota.error ? `Draft rota: not created (${r.rota.error}).` : r.rota.visits ? `Draft rota: ${r.rota.visits} proposed visit${r.rota.visits === 1 ? "" : "s"} over ${r.rota.weeks} weeks from ${r.rota.weekStart}, unpublished, ${r.rota.unassignedSlots} carer place${r.rota.unassignedSlots === 1 ? "" : "s"} still open. Carers are not told.` : `Draft rota: no new visits (${r.rota.alreadyBuilt} already proposed).`);
  const a = r.attention;
  if (a.facts || a.followUps) lines.push(`Still needs attention: ${[a.facts ? `${a.facts} fact${a.facts === 1 ? "" : "s"} to check${a.restricted ? ` (${a.restricted} for a manager)` : ""}` : null, a.followUps ? `${a.followUps} follow-up${a.followUps === 1 ? "" : "s"}` : null].filter(Boolean).join(", ")}.`);
  if (!drafted.length && !r.rota?.visits) lines.push("Nothing new could be drafted: every remaining fact needs a person to check it.");
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

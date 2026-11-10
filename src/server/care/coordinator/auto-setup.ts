import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError, ConflictError } from "@/lib/errors";
import { ACCEPTED, APPLY_ORDER, OPEN_DECISIONS, inReview, sectionLabel, type IntakeSection } from "@/lib/care-coordinator-rules";
import { IDENTITY_FIELDS, display, exceptionSeverity, safetyFromFindings, triage, type ExceptionSeed, type Severity, type TriageFact } from "@/lib/coordinator-triage";
import { fromDbDate } from "@/lib/london";
import { audit, runAsAutomation } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { findPossibleDuplicates } from "../su-import";
import { RISK_LEVEL_NOT_STATED, applySection, fileDocuments, handedFactIds } from "./apply";
import { compareFacts, coordinatorAccess, intakeInScope } from "./intake";
import { proposeRotaFor } from "./prepare";

/**
 * Automatic setup by CSB AI (owner's brief of 7 Nov 2026, "Autonomous AI Care Coordinator").
 *
 * After the documents are read, CSB AI does the routine administration a care coordinator would do, within its
 * authorised scope, and leaves people only the genuine exceptions:
 *
 *   TRIAGE      sort every waiting fact (coordinator-triage.ts): routine facts are accepted by CSB AI, repeats are
 *               consolidated, historical or superseded values are kept for reference only, the rest wait.
 *   IDENTITY    a new person is created only when the name is clear, nothing about identity disagrees and nobody similar
 *               is on record (or a person confirmed it is someone different).
 *   RECORDS     the existing section savers: profile at Assessment, contacts, preferences, care package, the care plan
 *               imported and in use, risk assessments saved and active (each labelled with its source, and as
 *               AI-generated when CSB AI wrote it from the narrative), visit templates, call notes; medication,
 *               incident history and skin findings only as restricted review items. Original documents are filed.
 *               Nothing waits for an approval (owner's brief of 7 Nov 2026, "Remove redundant approval workflows").
 *   ROTA        a proposed, unpublished rota from the templates. Carers are not told.
 *   EXCEPTIONS  the waiting facts and safety findings become review items with a severity; urgent ones reach managers
 *               at once (in-app only, nothing is sent outside).
 *   VERIFIED    everything is read back from the database before the setup is called complete.
 *
 * Provenance: every decision CSB AI takes is stored as decisionSource AUTOMATION, and every audit entry written during
 * the run carries { automation: { by: "CSB AI", initiatedById } }. Nothing is recorded as a person's review.
 * Idempotent and resumable: each stage only touches what is not done yet, so a retry carries on where it stopped.
 * It never activates care, never publishes visits, never records medication or a DNACPR status, and never sends
 * anything out.
 */

export const SETUP_STATUS = { PROCESSING: "Processing", READY: "Ready", NEEDS_ATTENTION: "Needs attention", FAILED: "Failed" } as const;
export type SetupStatus = keyof typeof SETUP_STATUS;
const CLAIM_MS = 5 * 60_000;

export interface SetupBlock {
  kind: "NAME_MISSING" | "IDENTITY_CONFLICT" | "POSSIBLE_DUPLICATE" | "READING";
  message: string;
  match?: { id: string; name: string; reference: string; reason: string };
  destinations?: string[];
}
export interface SetupReport {
  status: SetupStatus;
  startedAt: string;
  finishedAt: string | null;
  startedById: string;
  blocked: SetupBlock | null;
  triage: { routine: number; duplicates: number; notUsed: number; waiting: number };
  sections: { section: IntakeSection; label: string; status: "SAVED" | "FAILED" | "SKIPPED"; created: string[]; error?: string }[];
  rota: { visits: number; unassignedSlots: number; alreadyBuilt: number; weekStart: string; weeks: number; error?: string } | null;
  records: { personal: boolean; contacts: number; package: boolean; carePlan: boolean; risks: number; risksAiGenerated?: number; templates: number; callNotes: number; references: number; reviewItems: number; documentsFiled: number; existingMatched: number; duplicatesConsolidated: number };
  exceptions: Record<Severity, number>;
  failures: string[];
  /** Exceptions found before the person existed, raised once they do. */
  pending?: (ExceptionSeed & { factId: string | null; sourceRef: string })[];
}

const EMPTY_COUNTS = (): Record<Severity, number> => ({ URGENT: 0, REVIEW: 0, FOLLOW_UP: 0, INFO: 0 });

/** Runs (or carries on) the automatic setup of one intake. Safe to call again at any time. */
export async function runAutomaticSetup(ctx: Ctx, intakeId: string, opts: { rotaWeeks?: number } = {}): Promise<SetupReport> {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const claim = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.status === "CANCELLED") throw new ConflictError("This intake was cancelled. Nothing more is set up from it.");
    if (intake.setupStatus === "PROCESSING" && intake.setupStartedAt && Date.now() - intake.setupStartedAt.getTime() < CLAIM_MS && intake.setupById !== null) {
      return { intake, running: true };
    }
    await tx.careIntake.update({ where: { id: intake.id }, data: { setupStatus: "PROCESSING", setupStartedAt: new Date(), setupFinishedAt: null, setupById: ctx.userId } });
    return { intake, running: false };
  });
  if (claim.running) return reportOf(claim.intake.setupReport) ?? blankReport(ctx, "PROCESSING");
  return runAsAutomation({ initiatedById: ctx.userId, run: claim.intake.reference }, async () => {
    try {
      return await setUp(ctx, scope, intakeId, opts);
    } catch (e) {
      const message = e instanceof AppError ? e.message : "An unexpected error stopped the automatic setup. Everything saved so far is kept; run it again to carry on.";
      const prior = reportOf((await db.careIntake.findUnique({ where: { id: intakeId }, select: { setupReport: true } }))?.setupReport) ?? blankReport(ctx, "FAILED");
      const report: SetupReport = { ...prior, status: "FAILED", finishedAt: new Date().toISOString(), failures: [...prior.failures.filter((f) => f !== message), message].slice(-10) };
      await db.careIntake.update({ where: { id: intakeId }, data: { setupStatus: "FAILED", setupFinishedAt: new Date(), setupReport: report as unknown as Prisma.InputJsonValue, ...(claim.intake.status === "APPLYING" ? {} : {}) } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.setup.failed", entityType: "CareIntake", entityId: intakeId, data: { error: message.slice(0, 300) } });
      throw e;
    }
  });
}

function blankReport(ctx: Ctx, status: SetupStatus): SetupReport {
  return { status, startedAt: new Date().toISOString(), finishedAt: null, startedById: ctx.userId, blocked: null, triage: { routine: 0, duplicates: 0, notUsed: 0, waiting: 0 }, sections: [], rota: null, records: { personal: false, contacts: 0, package: false, carePlan: false, risks: 0, templates: 0, callNotes: 0, references: 0, reviewItems: 0, documentsFiled: 0, existingMatched: 0, duplicatesConsolidated: 0 }, exceptions: EMPTY_COUNTS(), failures: [] };
}
export function reportOf(v: unknown): SetupReport | null {
  return v && typeof v === "object" && !Array.isArray(v) && "status" in v && "records" in v ? (v as SetupReport) : null;
}

/** A document filed as a risk assessment, or named as one. */
export const isRiskAssessment = (d: { category: string; name: string }) => /RISK_ASSESSMENT/.test(d.category) || /risk assessment/i.test(d.name);

const stage = (intakeId: string, s: string) => db.careIntake.update({ where: { id: intakeId }, data: { setupStage: s } });

async function setUp(ctx: Ctx, scope: Scope, intakeId: string, opts: { rotaWeeks?: number }): Promise<SetupReport> {
  const report = blankReport(ctx, "PROCESSING");
  const prior = reportOf((await db.careIntake.findUniqueOrThrow({ where: { id: intakeId }, select: { setupReport: true } })).setupReport);
  if (prior?.pending?.length) report.pending = prior.pending;

  // Wait for every document to be read: the facts must be complete before anything is decided.
  const reading = await db.careIntakeDocument.findMany({ where: { intakeId, OR: [{ readStatus: "PENDING" }, { readStage: { in: ["QUEUED", "READING", "RETRYING"] } }] }, select: { name: true } });
  if (reading.length) {
    report.blocked = { kind: "READING", message: `${reading.map((d) => d.name).join(", ")} ${reading.length === 1 ? "is" : "are"} still being read. Setup carries on by itself when reading finishes.` };
    return finish(ctx, scope, intakeId, report, "PROCESSING");
  }

  // ── TRIAGE ──
  const sorted = await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (!inReview(intake.status) && intake.status !== "APPLYING" && intake.status !== "COMPLETED") throw new ConflictError("This intake is closed.");
    if (intake.status !== "DRAFT") await tx.careIntake.update({ where: { id: intake.id }, data: { status: "DRAFT" } });
    await compareFacts(tx, scope, intakeId);
    const [facts, docs] = await Promise.all([
      tx.careIntakeFact.findMany({ where: { intakeId }, orderBy: { position: "asc" } }),
      tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, name: true, documentDate: true, sensitive: true, findings: true, category: true } }),
    ]);
    const outcomes = triage({
      mode: intake.mode,
      facts: facts.map((f): TriageFact => ({ ...f, value: f.value as unknown, existingValue: f.existingValue as unknown })),
      docs: docs.map((d) => ({ id: d.id, name: d.name, documentDate: d.documentDate ? fromDbDate(d.documentDate) : null, sensitive: d.sensitive, riskAssessment: isRiskAssessment(d) })),
    });
    const now = new Date();
    const decide = async (ids: string[], decision: string, note: (id: string) => string) => {
      for (const id of ids) await tx.careIntakeFact.update({ where: { id }, data: { decision, decisionSource: "AUTOMATION", decisionNote: note(id).slice(0, 1000), decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
    };
    const byKind = <K extends (typeof outcomes)[number]["kind"]>(k: K) => outcomes.filter((o): o is Extract<(typeof outcomes)[number], { kind: K }> => o.kind === k);
    const notes = new Map(outcomes.map((o) => [o.factId, o.note]));
    const routine = byKind("ROUTINE"), dupes = byKind("DUPLICATE"), unused = byKind("NOT_USED"), waiting = byKind("WAIT");
    await decide(routine.map((o) => o.factId), "APPROVED", (id) => notes.get(id)!);
    await decide(dupes.map((o) => o.factId), "DUPLICATE", (id) => notes.get(id)!);
    await decide(unused.map((o) => o.factId), "REJECTED", (id) => notes.get(id)!);
    const factById = new Map(facts.map((f) => [f.id, f]));
    const docName = new Map(docs.map((d) => [d.id, d.name]));
    const src = (factId: string | null, docId?: string | null, page?: number | null) => {
      const f = factId ? factById.get(factId) : null;
      const d = f?.sourceDocumentId ?? docId ?? null;
      const p = f?.sourcePage ?? page ?? null;
      return `${intake.reference} · ${d ? (docName.get(d) ?? "document") : "added by hand"}${p ? `, page ${p}` : ""}`.slice(0, 300);
    };
    const seeds: NonNullable<SetupReport["pending"]> = [
      ...routine.filter((o) => o.exception).map((o) => ({ ...o.exception!, factId: o.factId, sourceRef: src(o.factId) })),
      ...waiting.filter((o) => o.exception).map((o) => ({ ...o.exception!, factId: o.factId, sourceRef: src(o.factId) })),
      ...safetyFromFindings(docs.flatMap((d) => (Array.isArray(d.findings) ? (d.findings as { kind?: string; text?: string; page?: number | null }[]) : []).filter((x) => x.kind === "FLAG" && typeof x.text === "string").map((x) => ({ documentId: d.id, page: x.page ?? null, text: x.text! })))).map((s) => ({ ...s, factId: null, sourceRef: src(null, s.documentId, s.page) })),
    ];
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.setup.triaged", entityType: "CareIntake", entityId: intakeId, data: { routine: routine.length, duplicates: dupes.length, notUsed: unused.length, waiting: waiting.length, exceptions: seeds.length } }, tx);
    return { intake, routine: routine.length, dupes: dupes.length, unused: unused.length, waiting, seeds };
  });
  report.triage = { routine: sorted.routine, duplicates: sorted.dupes, notUsed: sorted.unused, waiting: sorted.waiting.length };
  // Seeds from an earlier run are kept until raised; a fact's seed replaces its earlier one.
  const seedKey = (s: { factId: string | null; title: string; sourceRef: string }) => s.factId ?? `${s.title}|${s.sourceRef}`;
  const merged = new Map((report.pending ?? []).map((s) => [seedKey(s), s]));
  for (const s of sorted.seeds) merged.set(seedKey(s), s);
  report.pending = [...merged.values()];
  await stage(intakeId, "TRIAGE");

  // ── IDENTITY ──
  let intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  if (intake.mode === "NEW" && !intake.serviceUserId) {
    const block = await identityBlock(scope, intakeId, intake.notDuplicateById, sorted.waiting.filter((w) => w.identity).map((w) => w.factId));
    if (block) {
      report.blocked = block;
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.setup.identity-question", entityType: "CareIntake", entityId: intakeId, data: { kind: block.kind, match: block.match?.reference ?? null } });
      return finish(ctx, scope, intakeId, report, "NEEDS_ATTENTION");
    }
  }
  await stage(intakeId, "IDENTITY");

  // ── RECORDS ──
  {
    // A supporting document changes no records, except a risk assessment's risks (triage accepts nothing else from it).
    for (const section of intake.mode === "DOCUMENT" ? (["RISKS"] as const) : APPLY_ORDER) {
      const label = sectionLabel(section);
      const unapplied = await db.careIntakeFact.count({ where: { intakeId, section, decision: { in: [...ACCEPTED] }, appliedAt: null, id: { notIn: await handedFactIds(db, intakeId) } } });
      if (!unapplied) continue;
      const s = await db.careIntakeSection.findUniqueOrThrow({ where: { intakeId_section: { intakeId, section } } });
      if (s.status === "REJECTED") { report.sections.push({ section, label, status: "SKIPPED", created: [], error: "This section was rejected by a person, so nothing from it is saved." }); continue; }
      if (intake.mode !== "NEW" && (section === "PACKAGE" || section === "VISITS")) { report.sections.push({ section, label, status: "SKIPPED", created: [], error: "Changes to care already arranged are proposed for review, never saved automatically." }); continue; }
      if (section === "PACKAGE" && !(await db.careIntakeFact.count({ where: { intakeId, destination: "package.startDate", decision: { in: [...ACCEPTED] } } }))) {
        report.sections.push({ section, label, status: "SKIPPED", created: [], error: "The documents do not give a package start date, so the care package was not created." });
        report.pending!.push({ severity: "REVIEW", category: "MISSING_INFO", title: "Care package start date not found", description: "The documents do not say when the package starts, so CSB AI did not create the care package. Add it on the Care Package tab with the start date from the commissioner.", recordTab: "package", restricted: false, factId: null, sourceRef: `${intake.reference}` });
        continue;
      }
      try {
        const r = await applySection(ctx, intakeId, section, { prepare: true, automated: true });
        if (r.status === "DONE") report.sections.push({ section, label, status: "SAVED", created: r.result?.created ?? [] });
        else report.sections.push({ section, label, status: "FAILED", created: [], error: r.error });
        if (section === "PERSONAL" && r.status !== "DONE") break;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        report.sections.push({ section, label, status: "FAILED", created: [], error: e.message });
        if (section === "PERSONAL") break;
      }
      intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
    }
  }
  intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  // Details only a registered manager may save (date of birth, NHS number) stay unsaved and go to a manager.
  if (intake.serviceUserId) {
    const managerOnly = await db.careIntakeFact.findMany({ where: { intakeId, decision: { in: [...ACCEPTED] }, appliedAt: null, OR: [{ destination: { in: ["person.dateOfBirth", "person.nhsNumber"] } }, { destination: "externalReference", value: { path: ["type"], equals: "NHS" } }] }});
    const docNames = new Map((await db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, filename: true } })).map((d) => [d.id, d.filename]));
    for (const f of managerOnly) {
      const what = f.destination === "person.dateOfBirth" ? "date of birth" : "NHS number";
      report.pending!.push({ severity: "FOLLOW_UP", category: "MANAGER_FIELD", title: `Save the ${what}`, description: `The documents give a ${what} (${display(f)}), but only a registered manager may save it, so CSB AI left it for one. Check it against the original and save it on the Personal details tab.`, recordTab: "personal", restricted: false, factId: f.id, sourceRef: `${intake.reference} · ${(f.sourceDocumentId && docNames.get(f.sourceDocumentId)) || "document"}${f.sourcePage ? `, page ${f.sourcePage}` : ""}` });
    }
  }
  if (intake.serviceUserId && (await db.careIntakeDocument.count({ where: { intakeId, filedDocumentId: null } }))) {
    try {
      await fileDocuments(ctx, intakeId);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      report.failures.push(`The original documents were not filed: ${e.message}`);
    }
  }
  // Risk levels the support plan does not state: saved as Medium so the assessment is in use, and listed once to set.
  const unstated = intake.serviceUserId ? await db.riskAssessment.findMany({ where: { sourceIntakeId: intakeId, status: "ACTIVE", hazards: { contains: RISK_LEVEL_NOT_STATED } }, select: { title: true } }) : [];
  if (unstated.length) report.pending!.push({ severity: "FOLLOW_UP", category: "RISK_LEVEL", title: "Set the risk levels the plan does not state", description: `The support plan does not give a risk level for ${unstated.map((u) => u.title).join(", ")}. They are saved as Medium and in use. Review each one on the Risk Assessments tab and set the level.`, recordTab: "risks", restricted: false, factId: null, sourceRef: intake.reference });
  await stage(intakeId, "RECORDS");

  // ── ROTA ──
  if (intake.mode === "NEW" && intake.serviceUserId) {
    if (hasOrgPermission(ctx, "rota.build")) report.rota = await proposeRotaFor(ctx, intake.serviceUserId, opts.rotaWeeks ?? 2);
    else report.failures.push("The proposed rota was not built: the person who started this setup cannot build rotas. Someone who can presses Prepare draft rota.");
  }
  await stage(intakeId, "ROTA");

  // ── EXCEPTIONS ──
  if (intake.serviceUserId) {
    const suId = intake.serviceUserId;
    // A section that failed is an exception too, so it is not lost in a report.
    for (const s of report.sections.filter((x) => x.status === "FAILED")) report.pending!.push({ severity: "REVIEW", category: "SETUP", title: `${s.label} could not be saved`, description: `${s.error ?? "Saving failed."} Everything else was kept. Correct the cause, then run the automatic setup again.`, recordTab: null, restricted: false, factId: null, sourceRef: intake.reference });
    // Commissioned hours that the documents never state, when visits are being set up.
    if (intake.mode === "NEW" && (await db.careIntakeFact.count({ where: { intakeId, destination: "visit", decision: { in: [...ACCEPTED] } } })) && !(await db.careIntakeFact.count({ where: { intakeId, destination: "package.minutesPerWeek" } }))) {
      report.pending!.push({ severity: "FOLLOW_UP", category: "PACKAGE_HOURS", title: "Commissioned hours not stated", description: "The documents list visits but do not state the commissioned hours a week, so the visits could not be checked against them. Confirm the hours with the commissioner and add them on the Care Package tab.", recordTab: "package", restricted: false, factId: null, sourceRef: intake.reference });
    }
    await raise(ctx, scope, intakeId, suId, report.pending!);
    report.pending = [];
  }
  await stage(intakeId, "EXCEPTIONS");

  // ── VERIFIED ──
  await verify(scope, intakeId, report);
  const failed = report.sections.some((s) => s.status === "FAILED") || report.failures.length > 0;
  const attention = !!report.blocked || report.exceptions.URGENT + report.exceptions.REVIEW > 0;
  return finish(ctx, scope, intakeId, report, failed ? "FAILED" : attention ? "NEEDS_ATTENTION" : "READY");
}

async function finish(ctx: Ctx, scope: Scope, intakeId: string, report: SetupReport, status: SetupStatus) {
  report.status = status;
  report.finishedAt = status === "PROCESSING" ? null : new Date().toISOString();
  const open = await db.careIntakeFact.count({ where: { intakeId, decision: { in: [...OPEN_DECISIONS] }, appliedAt: null } });
  const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId }, select: { status: true, serviceUserId: true, mode: true } });
  // Completed only when nothing waits and everything was saved; otherwise it stays open for its exceptions.
  const done = status === "READY" && !open && !!intake.serviceUserId;
  const nextStatus = intake.status === "CANCELLED" ? "CANCELLED" : done ? "COMPLETED" : "DRAFT";
  await db.careIntake.update({ where: { id: intakeId }, data: { setupStatus: status, setupStage: status === "PROCESSING" ? undefined : "VERIFIED", ...(status === "PROCESSING" ? { setupStartedAt: null } : {}), setupFinishedAt: report.finishedAt ? new Date(report.finishedAt) : null, setupReport: report as unknown as Prisma.InputJsonValue, status: nextStatus } });
  if (status !== "PROCESSING") {
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.setup.finished", entityType: "CareIntake", entityId: intakeId, data: { status, blocked: report.blocked?.kind ?? null, records: report.records as unknown as Prisma.InputJsonValue, exceptions: report.exceptions, failures: report.failures.length, rotaVisits: report.rota?.visits ?? 0 } });
  }
  return report;
}

/** Why a new person cannot be created yet, or null. */
async function identityBlock(scope: Scope, intakeId: string, notDuplicateById: string | null, identityWaiting: string[]): Promise<SetupBlock | null> {
  const facts = await db.careIntakeFact.findMany({ where: { intakeId, section: "PERSONAL", destination: { startsWith: "person." } } });
  const clash = facts.filter((f) => identityWaiting.includes(f.id) && IDENTITY_FIELDS.has(f.destination));
  if (clash.length) {
    const fields = [...new Set(clash.map((f) => f.label.toLowerCase()))];
    return { kind: "IDENTITY_CONFLICT", message: `The documents disagree about the person's ${fields.join(" and ")}. Choose the right value so CSB AI can create the person.`, destinations: [...new Set(clash.map((f) => f.destination))] };
  }
  const value = (k: string) => {
    const f = facts.find((x) => x.destination === k && ACCEPTED.has(x.decision));
    return f ? String(f.value) : "";
  };
  if (!value("person.firstName") || !value("person.lastName")) return { kind: "NAME_MISSING", message: "The documents do not give the person's first and last name clearly enough, so nobody was created. Add the name in the detailed fact review, then run the setup again." };
  if (notDuplicateById) return null;
  const dupes = await findPossibleDuplicates(scope, { firstName: value("person.firstName"), lastName: value("person.lastName"), dateOfBirth: value("person.dateOfBirth") || undefined, postcode: value("person.postcode") || undefined });
  if (!dupes.length) return null;
  const d = dupes[0]!;
  return { kind: "POSSIBLE_DUPLICATE", message: `This person may already exist: ${d.name} (${d.reference}), ${d.reason.toLowerCase()}. Nobody new was created. Open the existing record, or confirm this is a new person.`, match: { id: d.id, name: d.name, reference: d.reference, reason: d.reason } };
}

/** Writes the exceptions (once each), and tells managers at once about urgent ones. */
async function raise(ctx: Ctx, scope: Scope, intakeId: string, serviceUserId: string, seeds: NonNullable<SetupReport["pending"]>) {
  if (!seeds.length) return;
  await db.$transaction(async (tx) => {
    const su = await tx.serviceUser.findFirstOrThrow({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, firstName: true, lastName: true } });
    const urgent: { id: string; title: string }[] = [];
    for (const s of seeds) {
      const existing = s.factId
        ? await tx.careIntakeReviewItem.findUnique({ where: { factId: s.factId } })
        : await tx.careIntakeReviewItem.findFirst({ where: { intakeId, serviceUserId, factId: null, title: s.title, sourceRef: s.sourceRef } });
      if (existing) continue;
      const item = await tx.careIntakeReviewItem.create({ data: { organisationId: scope.organisationId, serviceUserId, intakeId, factId: s.factId, category: s.category, severity: s.severity, title: s.title.slice(0, 200), description: s.description.slice(0, 2000), sourceRef: s.sourceRef, recordTab: s.recordTab, restricted: s.restricted, automated: true, createdById: ctx.userId } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.exception.raised", entityType: "ServiceUser", entityId: serviceUserId, data: { itemId: item.id, intakeId, category: s.category, severity: s.severity } }, tx);
      if (s.severity === "URGENT") urgent.push({ id: item.id, title: s.title });
    }
    if (urgent.length) await notifyManagers(tx, scope.organisationId, su, urgent);
  });
}

async function notifyManagers(tx: Tx, organisationId: string, su: { id: string; firstName: string; lastName: string }, items: { id: string; title: string }[]) {
  const ms = await tx.membership.findMany({ where: { organisationId, deactivatedAt: null, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER"] } }, select: { userId: true } });
  const users = [...new Set(ms.map((m) => m.userId))];
  if (!users.length) return;
  await tx.notification.createMany({
    data: users.flatMap((userId) => items.map((i) => ({
      organisationId, userId, type: "coordinator.exception.urgent",
      title: `Urgent: ${i.title} for ${su.firstName} ${su.lastName}`,
      body: "CSB AI found this while setting up the person's records from their documents. Nothing was decided or reported automatically: a manager decides what to do today.",
      reason: "You manage care for this organisation.",
      actionUrl: `/rota/service-users/${su.id}?tab=ai-audit`,
      dedupeKey: `coordinator-urgent:${i.id}:${userId}`,
    }))),
    skipDuplicates: true,
  });
}

/** Read-back: what is really in the database for this intake, never what was intended. */
async function verify(scope: Scope, intakeId: string, report: SetupReport) {
  const intake = await db.careIntake.findUniqueOrThrow({ where: { id: intakeId } });
  const applied = await db.careIntakeFact.findMany({ where: { intakeId, appliedRef: { not: null } }, select: { appliedRef: true, section: true } });
  const refs = (prefix: string) => new Set(applied.filter((f) => f.appliedRef!.startsWith(prefix)).map((f) => f.appliedRef)).size;
  const su = intake.serviceUserId ? await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: intake.serviceUserId }, select: { id: true } }) : null;
  const [contacts, pkgs, plans, risks, templates, notes, items, filed] = await Promise.all([
    countIds(applied, "ServiceUserContact:", (ids) => db.serviceUserContact.count({ where: { id: { in: ids } } })),
    countIds(applied, "CarePackage:", (ids) => db.carePackage.count({ where: { id: { in: ids } } })),
    countIds(applied, "CarePlan:", (ids) => db.carePlan.count({ where: { id: { in: ids } } })),
    countIds(applied, "RiskAssessment:", (ids) => db.riskAssessment.count({ where: { id: { in: ids } } })),
    countIds(applied, "VisitTemplate:", (ids) => db.visitTemplate.count({ where: { id: { in: ids } } })),
    countIds(applied, "CallNote:", (ids) => db.callNote.count({ where: { id: { in: ids } } })),
    db.careIntakeReviewItem.count({ where: { intakeId } }),
    db.careIntakeDocument.count({ where: { intakeId, filedDocumentId: { not: null } } }),
  ]);
  report.records = {
    personal: !!su, contacts, package: pkgs > 0, carePlan: plans > 0, risks, risksAiGenerated: await db.riskAssessment.count({ where: { sourceIntakeId: intakeId, origin: "AI_INFERRED" } }), templates, callNotes: notes, references: refs("ServiceUserExternalReference:"), reviewItems: items, documentsFiled: filed,
    existingMatched: refs("existing:"), duplicatesConsolidated: await db.careIntakeFact.count({ where: { intakeId, decision: "DUPLICATE" } }),
  };
  // Every fact CSB AI or a person accepted must be saved, except the sections deliberately left (reported above).
  const skipped = new Set(report.sections.filter((s) => s.status !== "SAVED").map((s) => s.section as string));
  // Facts handed to a person as an exception (for example a date of birth only a manager may save) are accounted for.
  const handed = await handedFactIds(db, intakeId);
  const missing = await db.careIntakeFact.groupBy({ by: ["section"], where: { intakeId, decision: { in: [...ACCEPTED] }, appliedAt: null, id: { notIn: handed } }, _count: true });
  for (const m of missing) if (!skipped.has(m.section) && (intake.mode !== "DOCUMENT" || m.section === "RISKS") && intake.serviceUserId) report.failures.push(`${sectionLabel(m.section)}: ${m._count} accepted fact${m._count === 1 ? " was" : "s were"} not found on the record after saving.`);
  const open = await db.careIntakeReviewItem.findMany({ where: { intakeId, status: "OPEN" }, select: { severity: true, category: true } });
  report.exceptions = EMPTY_COUNTS();
  for (const o of open) report.exceptions[exceptionSeverity(o)]++;
}

async function countIds(applied: { appliedRef: string | null }[], prefix: string, count: (ids: string[]) => Promise<number>) {
  const ids = [...new Set(applied.filter((f) => f.appliedRef?.startsWith(prefix)).map((f) => f.appliedRef!.slice(prefix.length)))];
  return ids.length ? count(ids) : 0;
}

/** The completion summary in plain lines, from the read-back counts. Never estimated. */
export function setupSummaryLines(r: SetupReport, mode: string): string[] {
  const lines: string[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const rec = r.records;
  if (mode === "NEW" && rec.personal) lines.push("Personal details populated");
  if (rec.references) lines.push(`${n(rec.references, "reference number", "reference numbers")} recorded (not yet verified)`);
  if (rec.contacts) lines.push(`${n(rec.contacts, "contact", "contacts")} added`);
  if (rec.package) lines.push("Care package created");
  if (rec.templates) lines.push(`${n(rec.templates, "repeating visit template", "repeating visit templates")} created`);
  if (rec.carePlan) lines.push("Care plan imported from the council support plan and in use");
  if (rec.risks) lines.push(`${n(rec.risks, "risk assessment", "risk assessments")} saved${rec.risksAiGenerated ? ` (${rec.risksAiGenerated} AI-generated from the plan's narrative, labelled as such)` : ""}`);
  if (rec.callNotes) lines.push(`${n(rec.callNotes, "call note", "call notes")} recorded`);
  if (r.rota?.visits) lines.push(`Proposed rota created: ${n(r.rota.visits, "visit", "visits")}, unpublished, ${n(r.rota.unassignedSlots, "carer place", "carer places")} to fill`);
  else if (r.rota && !r.rota.error && r.rota.alreadyBuilt) lines.push(`Proposed rota already in place (${n(r.rota.alreadyBuilt, "visit", "visits")})`);
  if (rec.documentsFiled) lines.push(`${n(rec.documentsFiled, "original document", "original documents")} filed`);
  if (rec.duplicatesConsolidated) lines.push(`${n(rec.duplicatesConsolidated, "repeated entry", "repeated entries")} consolidated`);
  const attention = r.exceptions.URGENT + r.exceptions.REVIEW + r.exceptions.FOLLOW_UP;
  const info = r.exceptions.INFO ? ` (and ${r.exceptions.INFO} for information only)` : "";
  lines.push(attention ? `${n(attention, "matter needs", "matters need")} attention${info}` : `Nothing needs attention${info}`);
  return lines;
}

export { display as factDisplay };

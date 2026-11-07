import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { ACCEPTED, EXTERNAL_REFERENCE_LABEL, OPEN_DECISIONS, sectionLabel } from "@/lib/care-coordinator-rules";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, display, exceptionSeverity, recordTabFor, type Severity } from "@/lib/coordinator-triage";
import { fromDbDate } from "@/lib/london";
import { audit, automationOf } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { reportOf, runAutomaticSetup, setupSummaryLines, SETUP_STATUS, type SetupReport } from "./auto-setup";
import { coordinatorAccess, compareFacts, intakeInScope, isRestrictedFact, namesFor } from "./intake";

/**
 * Exceptions after automatic setup (owner's brief of 7 Nov 2026, sections 8 and 9): the genuine matters CSB AI left for
 * people, on the service user's Audit & Exceptions tab and on the intake. They are CareIntakeReviewItems (the existing
 * follow-up records), so the Care Package tab and the shift check keep seeing the ones they already show.
 *
 * Every resolution is a person's decision: it is stored with their id and audited without the automation marker. A
 * choice between values (two dates of birth, two start dates) saves the chosen fact through the same automatic setup,
 * so nothing is typed twice and nothing is saved twice.
 */

async function scopeFor(ctx: Ctx) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return { access, scope };
}

type Item = Prisma.CareIntakeReviewItemGetPayload<object>;

/** The facts a person can choose between for an exception: its own fact and others still waiting for the same field. */
async function choicesFor(client: Tx | typeof db, item: Pick<Item, "factId" | "intakeId" | "category">) {
  if (!item.factId || !item.intakeId || !["IDENTITY", "CONFLICT", "SOURCE_CHECK", "SCHEDULE", "REFERENCE"].includes(item.category)) return [];
  const f = await client.careIntakeFact.findUnique({ where: { id: item.factId } });
  if (!f || f.appliedAt) return [];
  const same = item.category === "IDENTITY" || item.category === "CONFLICT" || item.category === "SCHEDULE"
    ? await client.careIntakeFact.findMany({ where: { intakeId: item.intakeId, destination: f.destination, decision: { in: [...OPEN_DECISIONS] }, appliedAt: null }, orderBy: { position: "asc" } })
    : [f];
  const sameTime = item.category === "SCHEDULE" ? same.filter((o) => (o.value as { startTime?: string }).startTime === (f.value as { startTime?: string }).startTime) : same;
  const docs = await client.careIntakeDocument.findMany({ where: { id: { in: sameTime.map((o) => o.sourceDocumentId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return sameTime.filter((o) => OPEN_DECISIONS.has(o.decision)).map((o) => ({ factId: o.id, value: display({ destination: o.destination, value: o.value }), source: `${docs.find((d) => d.id === o.sourceDocumentId)?.name ?? "added by hand"}${o.sourcePage ? `, page ${o.sourcePage}` : ""}`, documentId: o.sourceDocumentId, page: o.sourcePage }));
}

/** The exceptions for a person (or one intake), newest-severity first, hiding what the viewer may not see. */
export async function listExceptions(ctx: Ctx, where: { serviceUserId?: string; intakeId?: string; status?: "OPEN" | "RESOLVED" | "ALL"; severity?: string }) {
  const { scope, access } = await scopeFor(ctx);
  if (where.serviceUserId && !(await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: where.serviceUserId }, select: { id: true } }))) throw new NotFoundError("Service user");
  if (where.intakeId) await intakeInScope(db, scope, where.intakeId);
  const base: Prisma.CareIntakeReviewItemWhereInput = { organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope), ...(where.serviceUserId ? { serviceUserId: where.serviceUserId } : {}), ...(where.intakeId ? { intakeId: where.intakeId } : {}) };
  const status = where.status ?? "OPEN";
  const rows = await db.careIntakeReviewItem.findMany({ where: { ...base, ...(status === "ALL" ? {} : { status }), ...(access.sensitive ? {} : { restricted: false }) }, orderBy: { createdAt: "asc" }, take: 300 });
  const hidden = access.sensitive ? 0 : await db.careIntakeReviewItem.count({ where: { ...base, restricted: true, status: "OPEN" } });
  const intakes = await db.careIntake.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.intakeId).filter((x): x is string => !!x))] } }, select: { id: true, reference: true, status: true } });
  const history = rows.length ? await db.auditLog.findMany({ where: { organisationId: scope.organisationId, action: { startsWith: "coordinator.exception." }, entityType: "ServiceUser", ...(where.serviceUserId ? { entityId: where.serviceUserId } : {}) }, orderBy: { createdAt: "asc" }, take: 1000 }) : [];
  const names = await namesFor([...new Set([...rows.flatMap((r) => [r.createdById, r.resolvedById, r.assignedToId]), ...history.map((h) => h.actorId)].filter((x): x is string => !!x))]);
  const out = [];
  for (const r of rows) {
    const severity = exceptionSeverity(r);
    if (where.severity && where.severity !== severity) continue;
    const trail = history.filter((h) => (h.data as { itemId?: string } | null)?.itemId === r.id).map((h) => ({ at: h.createdAt, action: h.action.replace("coordinator.exception.", ""), by: automationOf(h.data) ? `CSB AI (started by ${names.get(h.actorId ?? "") ?? "Unknown"})` : (names.get(h.actorId ?? "") ?? "System") }));
    out.push({
      id: r.id, serviceUserId: r.serviceUserId, intakeId: r.intakeId, intake: intakes.find((i) => i.id === r.intakeId) ?? null, factId: r.factId,
      severity, severityLabel: SEVERITY_LABEL[severity], category: r.category, categoryLabel: CATEGORY_LABEL[r.category] ?? r.category,
      title: r.title ?? CATEGORY_LABEL[r.category] ?? r.category, description: r.description, sourceRef: r.sourceRef, recordTab: r.recordTab ?? recordTabFor(categorySection(r.category)),
      restricted: r.restricted, status: r.status, automated: r.automated, createdAt: r.createdAt,
      raisedBy: r.automated ? `CSB AI (started by ${names.get(r.createdById) ?? "Unknown"})` : (names.get(r.createdById) ?? "Unknown"),
      owner: r.assignedToId ? (names.get(r.assignedToId) ?? "Unknown") : r.category === "MEDICATION" ? "A manager who manages medication" : r.restricted || severity === "URGENT" || r.category === "MANAGER_FIELD" ? "Registered manager" : "Care coordinator",
      resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? "Unknown") : null, resolvedAt: r.resolvedAt, resolution: r.resolution,
      choices: r.status === "OPEN" ? await choicesFor(db, r) : [],
      referenceChoice: r.status === "OPEN" && r.category === "REFERENCE" && r.title === "Say what this Frameworki number is",
      trail,
    });
  }
  out.sort((a, b) => (a.status === b.status ? 0 : a.status === "OPEN" ? -1 : 1) || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.createdAt.getTime() - b.createdAt.getTime());
  return { items: out, hidden };
}
export type ExceptionView = Awaited<ReturnType<typeof listExceptions>>["items"][number];

const categorySection = (c: string) => ({ FUNDING: "PACKAGE", PACKAGE_HOURS: "PACKAGE", MEDICATION: "MEDICATION", INCIDENT_HISTORY: "INCIDENTS", BODY_MAP: "BODY_MAP", VISIT_TASKS: "VISITS", SCHEDULE: "VISITS" })[c] ?? "PERSONAL";

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RESOLVE"), note: z.string().trim().min(5, "Say what was done, so the next person can see it").max(2000) }),
  z.object({ action: z.literal("USE_FACT"), factId: z.string().trim().min(10).max(40), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("LEAVE_OUT"), note: z.string().trim().min(5, "Say why it is left out").max(1000) }),
  z.object({ action: z.literal("REFERENCE_TYPE"), type: z.enum(["COUNCIL_CLIENT", "COUNCIL_PACKAGE", "COUNCIL_FRAMEWORK"]) }),
]);

/**
 * A person settles an exception: closes it with what was done, chooses which value is right (then CSB AI saves it), leaves
 * the information out, or says what a Frameworki number is. Permission follows the item: restricted items need
 * restricted access, medication items need medication management.
 */
export async function resolveException(ctx: Ctx, itemId: string, input: z.input<typeof resolveSchema>) {
  const { scope, access } = await scopeFor(ctx);
  const p = resolveSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the resolution");
  const d = p.data;
  const out = await db.$transaction(async (tx) => {
    const item = await tx.careIntakeReviewItem.findFirst({ where: { id: itemId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
    if (!item || (item.restricted && !access.sensitive)) throw new NotFoundError("Exception");
    if (item.category === "MEDICATION" && !access.medication) throw new ForbiddenError("A manager who can manage medication settles medication reconciliation");
    if (item.status !== "OPEN") throw new ConflictError("This exception is already resolved");
    let resolution = "";
    let rerun = false;
    const now = new Date();
    if (d.action === "RESOLVE") resolution = d.note;
    else {
      if (!item.factId || !item.intakeId) throw new ValidationError("This exception has no read value to choose");
      const intake = await intakeInScope(tx, scope, item.intakeId, true);
      if (intake.status === "CANCELLED") throw new ConflictError("The intake was cancelled");
      const choices = await choicesFor(tx, item);
      if (d.action === "USE_FACT") {
        const chosen = choices.find((c) => c.factId === d.factId);
        if (!chosen) throw new ValidationError("Choose one of the values shown");
        const f = await tx.careIntakeFact.findUniqueOrThrow({ where: { id: chosen.factId } });
        if (isRestrictedFact(f, false) && !access.sensitive) throw new NotFoundError("Exception");
        await tx.careIntakeFact.update({ where: { id: f.id }, data: { decision: "APPROVED", decisionSource: "HUMAN", decisionNote: (d.note || "Chosen on the exception.").slice(0, 1000), decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
        for (const c of choices.filter((x) => x.factId !== chosen.factId)) await tx.careIntakeFact.update({ where: { id: c.factId }, data: { decision: "REJECTED", decisionSource: "HUMAN", decisionNote: "Another value was chosen on the exception.", decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
        resolution = `Used "${chosen.value}" (${chosen.source})${d.note ? `: ${d.note}` : ""}.`;
      } else if (d.action === "LEAVE_OUT") {
        for (const c of choices) await tx.careIntakeFact.update({ where: { id: c.factId }, data: { decision: "REJECTED", decisionSource: "HUMAN", decisionNote: d.note.slice(0, 1000), decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
        resolution = `Left out: ${d.note}`;
      } else {
        const f = await tx.careIntakeFact.findUniqueOrThrow({ where: { id: item.factId } });
        if (f.destination !== "externalReference" || f.appliedAt) throw new ValidationError("This exception is not about a reference number");
        const value = { ...(f.value as Record<string, unknown>), type: d.type, typeUnclear: undefined };
        delete (value as { typeUnclear?: boolean }).typeUnclear;
        await tx.careIntakeFact.update({ where: { id: f.id }, data: { value: value as Prisma.InputJsonValue, editedById: ctx.userId, editedAt: now, decision: "EDITED", decisionSource: "HUMAN", decisionNote: `Saved as ${EXTERNAL_REFERENCE_LABEL[d.type].toLowerCase()}.`, decidedById: ctx.userId, decidedAt: now, conflict: null, lockVersion: { increment: 1 } } });
        resolution = `Saved as ${EXTERNAL_REFERENCE_LABEL[d.type].toLowerCase()}.`;
      }
      await compareFacts(tx, scope, intake.id);
      rerun = d.action !== "LEAVE_OUT";
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.fact.decided", entityType: "CareIntake", entityId: intake.id, data: { factId: item.factId, via: "exception", action: d.action } }, tx);
    }
    const done = await tx.careIntakeReviewItem.updateMany({ where: { id: item.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedById: ctx.userId, resolvedAt: now, resolution: resolution.slice(0, 2000) } });
    if (!done.count) throw new ConflictError("This exception is already resolved");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.exception.resolved", entityType: "ServiceUser", entityId: item.serviceUserId, data: { itemId: item.id, intakeId: item.intakeId, category: item.category, action: d.action } }, tx);
    return { item, rerun };
  });
  // The chosen value is saved by the same automatic setup (idempotent: only what is not saved yet).
  if (out.rerun && out.item.intakeId) await runAutomaticSetup(ctx, out.item.intakeId);
  else if (out.item.intakeId) await refreshCounts(scope, out.item.intakeId);
  return { serviceUserId: out.item.serviceUserId };
}

/** Keeps the intake's exception counts (and Ready / Needs attention) current after a person resolves one. */
async function refreshCounts(scope: Scope, intakeId: string) {
  const intake = await db.careIntake.findFirst({ where: { id: intakeId, organisationId: scope.organisationId } });
  const r = reportOf(intake?.setupReport);
  if (!intake || !r || r.status === "PROCESSING" || r.status === "FAILED") return;
  const open = await db.careIntakeReviewItem.findMany({ where: { intakeId, status: "OPEN" }, select: { severity: true, category: true } });
  const counts: Record<Severity, number> = { URGENT: 0, REVIEW: 0, FOLLOW_UP: 0, INFO: 0 };
  for (const o of open) counts[exceptionSeverity(o)]++;
  const status = r.blocked || counts.URGENT + counts.REVIEW ? "NEEDS_ATTENTION" : "READY";
  await db.careIntake.update({ where: { id: intakeId }, data: { setupStatus: status, setupReport: { ...r, status, exceptions: counts } as unknown as Prisma.InputJsonValue } });
}

/** Before a new person exists: a person picks the right value when the documents disagree about identity. */
export async function chooseIdentityValue(ctx: Ctx, intakeId: string, factId: string) {
  const { scope, access } = await scopeFor(ctx);
  await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.serviceUserId || intake.mode !== "NEW") throw new ConflictError("The person is already on record. Correct their details on the profile.");
    const f = await tx.careIntakeFact.findFirst({ where: { id: factId, intakeId, section: "PERSONAL", decision: { in: [...OPEN_DECISIONS] } } });
    if (!f) throw new ValidationError("Choose one of the values shown");
    if (isRestrictedFact(f, false) && !access.sensitive) throw new ForbiddenError("A registered manager chooses the date of birth or NHS number");
    const now = new Date();
    await tx.careIntakeFact.update({ where: { id: f.id }, data: { decision: "APPROVED", decisionSource: "HUMAN", decisionNote: "Chosen as the right value when the documents disagreed.", decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
    const others = await tx.careIntakeFact.findMany({ where: { intakeId, destination: f.destination, id: { not: f.id }, decision: { in: [...OPEN_DECISIONS] } }, select: { id: true } });
    for (const o of others) await tx.careIntakeFact.update({ where: { id: o.id }, data: { decision: "REJECTED", decisionSource: "HUMAN", decisionNote: "Another value was chosen when the documents disagreed.", decidedById: ctx.userId, decidedAt: now, lockVersion: { increment: 1 } } });
    await compareFacts(tx, scope, intakeId);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.identity.chosen", entityType: "CareIntake", entityId: intakeId, data: { factId: f.id, destination: f.destination, rejected: others.length } }, tx);
  });
  return runAutomaticSetup(ctx, intakeId);
}

/** "Confirm a new person": a person says the possible match on record is someone else. CSB AI then carries on. */
export async function confirmNewPerson(ctx: Ctx, intakeId: string) {
  const { scope } = await scopeFor(ctx);
  await db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.serviceUserId || intake.mode !== "NEW") throw new ConflictError("This intake is not creating a new person");
    await tx.careIntake.update({ where: { id: intake.id }, data: { notDuplicateById: ctx.userId } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.identity.new-person-confirmed", entityType: "CareIntake", entityId: intakeId, data: {} }, tx);
  });
  return runAutomaticSetup(ctx, intakeId);
}

/** The identity question on the intake: which values disagree, for the person to choose from. */
export async function identityChoices(ctx: Ctx, intakeId: string) {
  const { scope, access } = await scopeFor(ctx);
  const intake = await intakeInScope(db, scope, intakeId);
  const r = reportOf(intake.setupReport);
  if (!r?.blocked || r.blocked.kind !== "IDENTITY_CONFLICT" || intake.serviceUserId) return [];
  const facts = await db.careIntakeFact.findMany({ where: { intakeId, destination: { in: r.blocked.destinations ?? [] }, decision: { in: [...OPEN_DECISIONS] } }, orderBy: { position: "asc" } });
  const docs = await db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, name: true } });
  const groups = new Map<string, { destination: string; label: string; restricted: boolean; options: { factId: string; value: string; source: string }[] }>();
  for (const f of facts) {
    const restricted = isRestrictedFact(f, false) && !access.sensitive;
    const g = groups.get(f.destination) ?? { destination: f.destination, label: f.label, restricted, options: [] };
    g.options.push({ factId: f.id, value: restricted ? "Hidden: a registered manager chooses" : display({ destination: f.destination, value: f.value }), source: `${docs.find((d) => d.id === f.sourceDocumentId)?.name ?? "added by hand"}${f.sourcePage ? `, page ${f.sourcePage}` : ""}` });
    groups.set(f.destination, g);
  }
  return [...groups.values()];
}

/** What the person's Audit & Exceptions tab shows: what CSB AI did, what changed since, and what is still open. */
export async function serviceUserAiAudit(ctx: Ctx, serviceUserId: string, f: { status?: "OPEN" | "RESOLVED" | "ALL"; severity?: string } = {}) {
  const { scope, access } = await scopeFor(ctx);
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId } });
  if (!su) throw new NotFoundError("Service user");
  const intakes = await db.careIntake.findMany({ where: { organisationId: scope.organisationId, serviceUserId }, orderBy: { createdAt: "desc" }, include: { documents: { select: { id: true, name: true, filename: true, createdAt: true, category: true, filedDocumentId: true, readMethod: true, sensitive: true } } } });
  const ids = intakes.map((i) => i.id);
  const [facts, trail, exceptions] = await Promise.all([
    db.careIntakeFact.findMany({ where: { intakeId: { in: ids } }, orderBy: { position: "asc" } }),
    db.auditLog.findMany({ where: { organisationId: scope.organisationId, OR: [{ entityType: "ServiceUser", entityId: serviceUserId }, { entityType: "CareIntake", entityId: { in: ids } }] }, orderBy: { createdAt: "desc" }, take: 300 }),
    listExceptions(ctx, { serviceUserId, status: f.status ?? "OPEN", severity: f.severity }),
  ]);
  const docSensitive = new Map(intakes.flatMap((i) => i.documents.map((d) => [d.id, d.sensitive] as const)));
  const names = await namesFor([...new Set([...trail.map((t) => t.actorId), ...facts.flatMap((x) => [x.decidedById, x.editedById]), ...intakes.map((i) => i.setupById)].filter((x): x is string => !!x))]);
  const visible = facts.filter((x) => access.sensitive || !isRestrictedFact(x, !!(x.sourceDocumentId && docSensitive.get(x.sourceDocumentId))));
  const docName = (id: string | null) => intakes.flatMap((i) => i.documents).find((d) => d.id === id)?.name ?? "added by hand";
  const provenance = (x: (typeof facts)[number]) => x.decisionSource === "AUTOMATION" ? `Automatically saved by CSB AI (started by ${names.get(x.decidedById ?? "") ?? "Unknown"})` : x.editedById ? `Corrected and accepted by ${names.get(x.editedById) ?? "Unknown"}` : x.decidedById ? `Reviewed by ${names.get(x.decidedById) ?? "Unknown"}` : "Not decided";
  const saved = visible.filter((x) => x.appliedAt).map((x) => ({
    id: x.id, section: sectionLabel(x.section), label: x.label, value: display({ destination: x.destination, value: x.value }), source: `${docName(x.sourceDocumentId)}${x.sourcePage ? `, page ${x.sourcePage}` : ""}`, quote: x.quote,
    verification: x.verification === "VERIFIED" ? "Verified against the page" : x.verification === "MANUAL" ? "Added by a person" : "Read from a scanned page, not checked word for word",
    provenance: provenance(x), recordTab: recordTabFor(x.section, x.destination), savedAt: x.appliedAt, existing: x.appliedRef?.startsWith("existing:") ?? false,
  }));
  // Corrections since setup: what CSB AI saved compared with what the record says now (values shown only here, to
  // people who can see the record; the audit log keeps field names only).
  const corrections: { field: string; saved: string; now: string; source: string; changedBy: string | null; changedAt: Date | null }[] = [];
  const personFacts = visible.filter((x) => x.appliedAt && x.destination.startsWith("person.") && x.appliedRef?.startsWith("ServiceUser:"));
  for (const x of personFacts) {
    const field = x.destination.slice(7);
    const cur = (su as unknown as Record<string, unknown>)[field];
    const now = cur instanceof Date ? fromDbDate(cur) : cur === null || cur === undefined ? "" : String(cur);
    const was = String(x.value);
    const same = field === "postcode" ? now.replace(/\s/g, "").toUpperCase() === was.replace(/\s/g, "").toUpperCase() : field === "nhsNumber" ? now.replace(/\s/g, "") === was.replace(/\s/g, "") : now === was;
    if (same) continue;
    const change = trail.find((t) => t.action === "serviceUser.updated" && t.createdAt > x.appliedAt! && JSON.stringify(t.data ?? {}).includes(`"${field}"`));
    corrections.push({ field: x.label, saved: was, now: now || "(removed)", source: `${docName(x.sourceDocumentId)}${x.sourcePage ? `, page ${x.sourcePage}` : ""}`, changedBy: change ? (automationOf(change.data) ? "CSB AI" : (names.get(change.actorId ?? "") ?? "Unknown")) : null, changedAt: change?.createdAt ?? null });
  }
  const contactFacts = visible.filter((x) => x.appliedRef?.startsWith("ServiceUserContact:"));
  if (contactFacts.length) {
    const rows = await db.serviceUserContact.findMany({ where: { serviceUserId, id: { in: contactFacts.map((x) => x.appliedRef!.slice("ServiceUserContact:".length)) } } });
    for (const x of contactFacts) {
      const v = x.value as { name?: string; phone?: string | null };
      const row = rows.find((r) => r.id === x.appliedRef!.slice("ServiceUserContact:".length));
      const label = `Contact ${v.name ?? ""}`.trim();
      const change = trail.find((t) => t.action === "serviceUser.contact.updated" && (t.data as { contactId?: string } | null)?.contactId === row?.id);
      if (!row) corrections.push({ field: label, saved: display({ destination: "contact", value: v }), now: "(removed)", source: docName(x.sourceDocumentId), changedBy: null, changedAt: null });
      else if ((v.phone ?? "") !== (row.phone ?? "") || (v.name ?? "") !== row.name) corrections.push({ field: label, saved: display({ destination: "contact", value: v }), now: [row.name, row.phone].filter(Boolean).join(", "), source: `${docName(x.sourceDocumentId)}${x.sourcePage ? `, page ${x.sourcePage}` : ""}`, changedBy: change ? (names.get(change.actorId ?? "") ?? "Unknown") : null, changedAt: change?.createdAt ?? null });
    }
  }
  return {
    serviceUser: { id: su.id, reference: su.reference, name: `${su.preferredName ?? su.firstName} ${su.lastName}` },
    setups: intakes.map((i) => {
      const r = reportOf(i.setupReport);
      // Counts cover every fact (numbers only, nothing restricted is shown), so they match the setup summary.
      const all = facts.filter((x) => x.intakeId === i.id);
      return {
        id: i.id, reference: i.reference, title: i.title, mode: i.mode, status: i.status, setupStatus: i.setupStatus, setupLabel: i.setupStatus ? (SETUP_STATUS[i.setupStatus as keyof typeof SETUP_STATUS] ?? i.setupStatus) : "Set up by hand (before automatic setup)",
        startedBy: i.setupById ? (names.get(i.setupById) ?? "Unknown") : null, finishedAt: i.setupFinishedAt, documents: i.documents.map((d) => ({ id: d.id, name: d.name, filename: d.filename, uploadedAt: d.createdAt, filed: !!d.filedDocumentId, readBy: d.readMethod })),
        summary: r ? setupSummaryLines(r, i.mode) : [], failures: r?.failures ?? [], report: r as SetupReport | null,
        counts: { automatic: all.filter((x) => x.decisionSource === "AUTOMATION" && ACCEPTED.has(x.decision)).length, human: all.filter((x) => x.decisionSource === "HUMAN" && x.decidedById).length, consolidated: all.filter((x) => x.decision === "DUPLICATE").length, waiting: all.filter((x) => OPEN_DECISIONS.has(x.decision) && !x.appliedAt).length },
      };
    }),
    saved, corrections, exceptions,
    trail: trail.map((t) => {
      const auto = automationOf(t.data);
      return { id: t.id, at: t.createdAt, action: t.action, entity: t.entityType, by: auto ? `CSB AI (started by ${names.get(auto.initiatedById) ?? "Unknown"})` : (names.get(t.actorId ?? "") ?? "System"), automated: !!auto };
    }),
  };
}

/** Open exceptions on an intake the viewer may see, for the step's count. */
export async function countOpenExceptions(ctx: Ctx, intakeId: string) {
  const { scope, access } = await scopeFor(ctx);
  return db.careIntakeReviewItem.count({ where: { organisationId: scope.organisationId, intakeId, status: "OPEN", ...(access.sensitive ? {} : { restricted: false }) } });
}

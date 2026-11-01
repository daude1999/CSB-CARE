import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError, type CareRecordInput } from "@/server/ai/provider";
import { CareSummarySchema, type CareSummaryOutput } from "@/server/ai/schemas";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { startDraft } from "./care-plans";
import { OUTCOME_LABEL, medicationEnabled } from "./medication";

/**
 * Care Summary for one person over a period. Two views, always kept apart:
 *  - Recent records: the notes, tasks not done, incidents, risks, plan changes and (when switched on) medication
 *    exceptions in the period, straight from the database. Always available; no AI.
 *  - Care Summary: an optional draft from the configured AI provider, built only from those records. Every point
 *    must cite the records it is based on; points that cite nothing real are dropped before saving. It is stored with
 *    its provenance (provider, who asked, which records) and is marked unapproved until a manager reviews it.
 *
 * The summary never changes a care plan, a diagnosis, an incident or a safeguarding record. A manager can start a care
 * plan review from it; the review is an ordinary draft that goes through the usual second-person approval, and the
 * summary's text is not copied in.
 *
 * Sending care records to an external AI is off until an admin switches it on in Rota Settings and records who
 * authorised it. The person's name and address are never sent; record text is sent as written by staff.
 */

export const PERIODS = { "7": 7, "14": 14, "30": 30 } as const;
export type Period = keyof typeof PERIODS | "custom";

export interface CareRecord extends CareRecordInput {
  id: string;
  href: string;
  at: Date;
}

export interface CareFacts {
  scheduled: number;
  completed: number;
  late: number;
  missed: number;
  notDelivered: number;
  cancelled: number;
}

const MAX_RECORDS = 150;
const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Reads ?period=7|14|30|custom&from&to into a date range ending today by default (at most 92 days). */
export function parsePeriod(sp: Record<string, string | undefined>, today = londonDate()) {
  const period: Period = sp.period === "custom" ? "custom" : sp.period && sp.period in PERIODS ? (sp.period as keyof typeof PERIODS) : "14";
  if (period === "custom" && sp.from && sp.to && isIsoDate(sp.from) && isIsoDate(sp.to) && sp.from <= sp.to) {
    const from = sp.from < addDays(sp.to, -91) ? addDays(sp.to, -91) : sp.from;
    return { period, from, to: sp.to > today ? today : sp.to };
  }
  const days = period === "custom" ? 14 : PERIODS[period];
  return { period: period === "custom" ? ("14" as const) : period, from: addDays(today, -(days - 1)), to: today };
}

function orgOf(ctx: Ctx) {
  if (!ctx.organisationId) throw new ForbiddenError("Choose an organisation first");
  return ctx.organisationId;
}

async function personInScope(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, organisationId: true, firstName: true, lastName: true, preferredName: true } });
  if (!su) throw new NotFoundError("Service user");
  return { scope, su };
}

/** Everything recorded about the person in the period, newest first, each with a short id (N1, T1…) and a link. */
export async function careRecords(ctx: Ctx, serviceUserId: string, range: { from: string; to: string }) {
  const { scope, su } = await personInScope(ctx, serviceUserId);
  const orgId = scope.organisationId;
  const days = { gte: dbDate(range.from), lte: dbDate(range.to) };
  const startUtc = new Date(`${range.from}T00:00:00Z`);
  const endUtc = new Date(`${addDays(range.to, 1)}T00:00:00Z`);
  const showMeds = hasOrgPermission(ctx, "medication.view") && (await medicationEnabled(orgId));
  const today = dbDate(londonDate());

  const [notes, tasks, incidents, risks, plans, visits, mar] = await Promise.all([
    db.visitNote.findMany({ where: { organisationId: orgId, visit: { serviceUserId: su.id, date: days } }, select: { id: true, visitId: true, category: true, text: true, createdAt: true, visit: { select: { date: true } } }, orderBy: { createdAt: "desc" }, take: 120 }),
    db.visitTaskOutcome.findMany({ where: { organisationId: orgId, outcome: { in: ["NOT_DONE", "REFUSED"] }, visit: { serviceUserId: su.id, date: days } }, select: { id: true, visitId: true, outcome: true, note: true, at: true, visitTask: { select: { name: true } }, visit: { select: { date: true } } }, orderBy: { at: "desc" }, take: 60 }),
    db.incident.findMany({ where: { organisationId: orgId, serviceUserId: su.id, OR: [{ occurredAt: { gte: startUtc, lt: endUtc } }, { status: { not: "CLOSED" } }] }, select: { id: true, reference: true, category: true, severity: true, status: true, safeguarding: true, description: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 30 }),
    db.riskAssessment.findMany({ where: { organisationId: orgId, serviceUserId: su.id, status: "ACTIVE", OR: [{ assessedAt: { gte: startUtc, lt: endUtc } }, { reviewDue: { lt: today } }] }, select: { id: true, title: true, level: true, reviewDue: true, assessedAt: true }, take: 30 }),
    db.carePlan.findMany({ where: { organisationId: orgId, serviceUserId: su.id, OR: [{ approvedAt: { gte: startUtc, lt: endUtc } }, { status: "ACTIVE", reviewDue: { lt: today } }] }, select: { id: true, version: true, status: true, approvedAt: true, reviewDue: true, createdAt: true }, take: 10 }),
    db.visit.findMany({ where: { organisationId: orgId, serviceUserId: su.id, date: days }, select: { status: true, scheduledStart: true, actualStart: true } }),
    showMeds ? db.marRecord.findMany({ where: { organisationId: orgId, supersededAt: null, outcome: { in: ["REFUSED", "NOT_GIVEN"] }, visit: { serviceUserId: su.id, date: days } }, select: { id: true, visitId: true, outcome: true, reason: true, at: true, medication: { select: { name: true } } }, orderBy: { at: "desc" }, take: 60 }) : Promise.resolve([]),
  ]);

  const out: CareRecord[] = [];
  const push = (prefix: string, r: Omit<CareRecord, "sid">) => out.push({ ...r, sid: `${prefix}${out.filter((x) => x.sid.startsWith(prefix)).length + 1}` });
  for (const n of notes) push("N", { id: n.id, kind: "Visit note", date: fromDbDate(n.visit.date), text: clip(`${n.category === "GENERAL" ? "" : `${n.category.charAt(0)}${n.category.slice(1).toLowerCase().replace(/_/g, " ")}: `}${n.text}`), href: `/rota/visits/${n.visitId}`, at: n.createdAt });
  for (const t of tasks) push("T", { id: t.id, kind: "Task not done", date: fromDbDate(t.visit.date), text: clip(`${t.visitTask.name}: ${t.outcome === "REFUSED" ? "refused" : "not done"}${t.note ? ` (${t.note})` : ""}`), href: `/rota/visits/${t.visitId}`, at: t.at });
  for (const i of incidents) push("I", { id: i.id, kind: "Incident", date: i.occurredAt.toISOString().slice(0, 10), text: clip(`${i.reference} ${i.category}, ${i.severity.toLowerCase()} severity, ${i.status.toLowerCase()}${i.safeguarding ? ", safeguarding" : ""}: ${i.description}`), href: `/rota/incidents/${i.id}`, at: i.occurredAt });
  for (const r of risks) push("R", { id: r.id, kind: "Risk assessment", date: r.assessedAt.toISOString().slice(0, 10), text: `${r.title}, ${r.level.toLowerCase()} risk${r.reviewDue < today ? `, review overdue since ${fromDbDate(r.reviewDue)}` : ""}`, href: `/rota/risks/${r.id}`, at: r.assessedAt });
  for (const p of plans) push("P", { id: p.id, kind: "Care plan", date: (p.approvedAt ?? p.createdAt).toISOString().slice(0, 10), text: p.status === "ACTIVE" && p.reviewDue && p.reviewDue < today ? `Care plan version ${p.version} review overdue since ${fromDbDate(p.reviewDue)}` : `Care plan version ${p.version} approved`, href: `/rota/care-plans/${su.id}?v=${p.version}`, at: p.approvedAt ?? p.createdAt });
  for (const m of mar) push("M", { id: m.id, kind: "Medication", date: m.at.toISOString().slice(0, 10), text: clip(`${m.medication.name}: ${OUTCOME_LABEL[m.outcome].toLowerCase()}${m.reason ? ` (${m.reason})` : ""}`), href: `/rota/visits/${m.visitId}`, at: m.at });
  out.sort((a, b) => b.at.getTime() - a.at.getTime());

  const facts: CareFacts = {
    scheduled: visits.length,
    completed: visits.filter((v) => v.status === "COMPLETED").length,
    late: visits.filter((v) => v.actualStart && v.actualStart.getTime() - v.scheduledStart.getTime() > 10 * 60_000).length,
    missed: visits.filter((v) => v.status === "MISSED").length,
    notDelivered: visits.filter((v) => v.status === "NOT_DELIVERED").length,
    cancelled: visits.filter((v) => v.status === "CANCELLED").length,
  };
  return { serviceUser: su, records: out, facts, medicationIncluded: showMeds };
}

// ── Switch ────────────────────────────────────────────────────────────────

export async function careSummaryEnabled(organisationId: string) {
  const s = await db.rotaSettings.findUnique({ where: { organisationId }, select: { careSummaryEnabledAt: true } });
  return Boolean(s?.careSummaryEnabledAt);
}

export async function setCareSummaryEnabled(ctx: Ctx, on: boolean, reviewNote: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  if (on && reviewNote.trim().length < 10) throw new ValidationError("Record who authorised sending care records to the AI provider, and when");
  await db.$transaction(async (tx) => {
    await tx.rotaSettings.update({ where: { organisationId }, data: on ? { careSummaryEnabledAt: new Date(), careSummaryEnabledById: ctx.userId, careSummaryReviewNote: reviewNote.trim() } : { careSummaryEnabledAt: null, careSummaryEnabledById: null } });
    await audit({ organisationId, actorId: ctx.userId, action: on ? "care_summary.enabled" : "care_summary.disabled", entityType: "Organisation", entityId: organisationId, data: { reviewNote: reviewNote.trim() || null } }, tx);
  });
}

/** Whether the Care Summary can be generated here, and if not, the honest reason. */
export async function careSummaryAvailability(ctx: Ctx) {
  const enabled = await careSummaryEnabled(orgOf(ctx));
  const provider = getAiProvider();
  const canGenerate = hasOrgPermission(ctx, "care.plan.edit");
  const state: "ready" | "off" | "not_configured" | "no_permission" = !canGenerate ? "no_permission" : !enabled ? "off" : !provider?.summariseCare ? "not_configured" : "ready";
  return { state, providerName: provider?.name ?? null, isSimulated: provider?.isSimulated ?? false };
}

// ── Generating and reviewing ─────────────────────────────────────────────

/** Keeps only points that cite at least one record that was actually sent; unknown ids are removed. */
export function keepCited(output: CareSummaryOutput, sids: Set<string>): { output: CareSummaryOutput; dropped: number } {
  let dropped = 0;
  const clean = (pts: CareSummaryOutput["summary"]) =>
    pts.flatMap((p) => {
      const sources = [...new Set(p.sources.map((s) => s.trim().toUpperCase()))].filter((s) => sids.has(s));
      if (!sources.length || !p.text.trim()) {
        dropped++;
        return [];
      }
      return [{ text: p.text.trim(), sources }];
    });
  return { output: { summary: clean(output.summary), changes: clean(output.changes), concerns: clean(output.concerns), nextActions: clean(output.nextActions), gaps: output.gaps.map((g) => g.trim()).filter(Boolean).slice(0, 10) }, dropped };
}

const rangeSchema = z.object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) }).refine((r) => r.from <= r.to, "The start must be on or before the end");

export async function generateCareSummary(ctx: Ctx, serviceUserId: string, input: { from: string; to: string }) {
  if (!hasOrgPermission(ctx, "care.plan.edit")) throw new ForbiddenError("Only care coordinators and managers can create a Care Summary");
  const range = rangeSchema.safeParse(input);
  if (!range.success) throw new ValidationError("Choose a valid period");
  if (!(await careSummaryEnabled(orgOf(ctx)))) throw new ForbiddenError("Care Summary is switched off for your organisation. An admin can switch it on in Rota Settings.");
  const provider = getAiProvider();
  if (!provider?.summariseCare) throw new AiUnavailableError("No AI provider is configured for Care Summary. The recent records view still shows everything.");

  const { serviceUser: su, records, facts } = await careRecords(ctx, serviceUserId, range.data);
  if (!records.length) throw new ValidationError("There are no records in this period to summarise");
  const sent = records.slice(0, MAX_RECORDS);
  const factLines = [
    `${facts.scheduled} visits were scheduled; ${facts.completed} completed, ${facts.late} started more than 10 minutes late, ${facts.missed} recorded as missed, ${facts.notDelivered} not delivered and ${facts.cancelled} cancelled.`,
    ...(records.length > sent.length ? [`Only the newest ${sent.length} of ${records.length} records were included.`] : []),
  ];
  const raw = await provider.summariseCare({ from: range.data.from, to: range.data.to, records: sent.map(({ sid, kind, date, text }) => ({ sid, kind, date, text })), facts: factLines });
  const parsed = CareSummarySchema.safeParse(raw);
  if (!parsed.success) throw new AiUnavailableError("The AI provider returned an answer in the wrong shape. Nothing was saved.");
  const { output, dropped } = keepCited(parsed.data, new Set(sent.map((r) => r.sid)));
  if (dropped) output.gaps.push(`${dropped} ${dropped === 1 ? "point was" : "points were"} removed because ${dropped === 1 ? "it did" : "they did"} not cite a record.`);
  const [providerName, model] = provider.name.split(":");

  return db.$transaction(async (tx) => {
    const row = await tx.careSummary.create({
      data: {
        organisationId: orgOf(ctx),
        serviceUserId: su.id,
        fromDate: dbDate(range.data.from),
        toDate: dbDate(range.data.to),
        provider: providerName ?? provider.name,
        model: model ?? null,
        isSimulated: provider.isSimulated,
        requestedById: ctx.userId,
        sources: sent.map((r) => ({ sid: r.sid, id: r.id, kind: r.kind, date: r.date, href: r.href })) as Prisma.InputJsonValue,
        output: { ...output, facts: factLines } as Prisma.InputJsonValue,
      },
    });
    await audit({ organisationId: orgOf(ctx), actorId: ctx.userId, action: "care_summary.created", entityType: "ServiceUser", entityId: su.id, data: { careSummaryId: row.id, provider: provider.name, records: sent.length, dropped } }, tx);
    return row;
  });
}

export interface StoredSource {
  sid: string;
  id: string;
  kind: string;
  date: string;
  href: string;
}
export type StoredOutput = CareSummaryOutput & { facts?: string[] };

export async function careSummariesFor(ctx: Ctx, serviceUserId: string) {
  const { su } = await personInScope(ctx, serviceUserId);
  const rows = await db.careSummary.findMany({ where: { organisationId: orgOf(ctx), serviceUserId: su.id }, orderBy: { createdAt: "desc" }, take: 10 });
  return rows.map((r) => ({ ...r, sources: r.sources as unknown as StoredSource[], output: r.output as unknown as StoredOutput }));
}

async function ownedSummary(ctx: Ctx, id: string) {
  const row = await db.careSummary.findFirst({ where: { id, organisationId: orgOf(ctx) } });
  if (!row) throw new NotFoundError("Care Summary");
  await personInScope(ctx, row.serviceUserId);
  return row;
}

/** A manager marks the summary as read and checked against the records, or dismisses it. The text never changes. */
export async function reviewCareSummary(ctx: Ctx, id: string, outcome: "REVIEWED" | "DISMISSED", note: string) {
  if (!hasOrgPermission(ctx, "care.plan.approve")) throw new ForbiddenError("A care manager reviews Care Summaries");
  const row = await ownedSummary(ctx, id);
  if (row.status !== "UNREVIEWED") throw new ConflictError("This summary has already been reviewed");
  if (outcome === "DISMISSED" && note.trim().length < 3) throw new ValidationError("Say why the summary is being dismissed");
  await db.$transaction(async (tx) => {
    const n = await tx.careSummary.updateMany({ where: { id: row.id, status: "UNREVIEWED" }, data: { status: outcome, reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: note.trim() || null } });
    if (!n.count) throw new ConflictError("This summary has already been reviewed");
    await audit({ organisationId: orgOf(ctx), actorId: ctx.userId, action: `care_summary.${outcome.toLowerCase()}`, entityType: "ServiceUser", entityId: row.serviceUserId, data: { careSummaryId: row.id, note: note.trim() || null } }, tx);
  });
}

/** Starts an ordinary care-plan draft linked to the summary. The draft is a copy of the current plan, not the summary. */
export async function startReviewFromSummary(ctx: Ctx, id: string) {
  const row = await ownedSummary(ctx, id);
  if (row.status === "DISMISSED") throw new ConflictError("This summary was dismissed");
  return startDraft(ctx, row.serviceUserId, { sourceSummaryId: row.id });
}

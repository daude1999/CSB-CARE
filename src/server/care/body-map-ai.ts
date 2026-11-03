import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, fromDbDate, londonDate } from "@/lib/london";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit-log";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError, type BodyMapRecordInput, type BodyMapRecommendationInput } from "@/server/ai/provider";
import { BodyMapRecommendationSchema, type BodyMapRecommendationOutput } from "@/server/ai/schemas";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { BODY_MAP_VIEWS, painLabel } from "@/server/care/body-map";
import { createBodyMapTask, isTaskKind, type TaskInput } from "@/server/care/body-map-tasks";
import { ROUTE_LABEL, medicationEnabled } from "@/server/care/medication";
import { serviceUserForRecords } from "@/server/care/su-documents";

/**
 * AI-Assisted Recommendations for the Digital Body Map: administrative decision support, never a diagnosis.
 *
 *  - Off until an admin switches it on in Rota Settings and records who authorised it (data protection and clinical
 *    safety review), exactly like the Care Summary. With AI_PROVIDER=none or the switch off, the body map works as before.
 *  - What is sent: the observation's recorded fields and short-id records (earlier observations of the same area, notes
 *    and follow-ups, matching care plan sections, risk assessments, incidents, documented medication sites and the
 *    organisation's own approved policies). Never photographs and never the person's name or address.
 *  - Every suggestion must cite records that were sent; anything else, and anything that reads like a diagnosis,
 *    medication instruction or safeguarding conclusion, is dropped before saving and counted in the gaps.
 *  - The same information is never sent twice (basis hash). A run on updated information supersedes earlier runs; their
 *    text and outcomes stay exactly as they were shown.
 *  - Suggestions only ever change their own review status. A manager may accept, dismiss or create a task from one; the
 *    task goes through the normal workflows. Nothing here changes a care plan, risk assessment, incident or MAR.
 *
 * Escalation prompts are NOT AI: they are fixed rules (ESCALATION_RULES) checked on every observation, whether or not
 * AI is switched on, so urgent features are never left to a language model.
 */

// ── Escalation prompts (deterministic) ────────────────────────────────────

export interface EscalationPrompt {
  code: string;
  kind: "ESCALATION" | "SAFEGUARDING";
  reason: string;
}

/** Words staff may write that the rules look for. A word is ignored when "no", "not" or "without" comes just before it. */
const OPEN_SKIN = /\b(bleed\w*|open wound|broken skin|skin (?:is |was )?broken|blister\w*|weep\w*|pus|discharg\w*)\b/gi;
const UNEXPLAINED = /\b(unexplained|no known cause|cannot explain|can't explain|could not explain|does not know how|doesn't know how|did not know how|unsure how|finger ?marks?|grip marks?)\b/gi;

function mentions(text: string, re: RegExp) {
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    if (!/\b(no|not|without|nil)\s+$/.test(before)) return m[0].toLowerCase();
  }
  return null;
}

/** The fixed escalation rules, in the order shown. Approved by the owner with this PR; changes need their approval. */
export const ESCALATION_RULES = [
  { code: "SEVERE_PAIN", kind: "ESCALATION", describe: "Severe pain reported" },
  { code: "BURN", kind: "ESCALATION", describe: "A burn recorded" },
  { code: "PRESSURE_SORE", kind: "ESCALATION", describe: "A pressure sore recorded" },
  { code: "OPEN_SKIN", kind: "ESCALATION", describe: "Bleeding, broken skin, blistering, weeping or discharge written in the description" },
  { code: "UNEXPLAINED", kind: "SAFEGUARDING", describe: "An unexplained mark, or finger or grip marks, written in the description" },
  { code: "REPEATED", kind: "ESCALATION", describe: "Two or more earlier observations of the same area in the last 30 days" },
] as const;

export function escalationPrompts(o: { category: string; pain: string; description: string; appearance: string | null }, earlierSameAreaLast30Days: number): EscalationPrompt[] {
  const text = `${o.description} ${o.appearance ?? ""}`;
  const out: EscalationPrompt[] = [];
  if (o.pain === "SEVERE") out.push({ code: "SEVERE_PAIN", kind: "ESCALATION", reason: "Severe pain was reported." });
  if (o.category === "Burn") out.push({ code: "BURN", kind: "ESCALATION", reason: "A burn was recorded." });
  if (o.category === "Pressure sore") out.push({ code: "PRESSURE_SORE", kind: "ESCALATION", reason: "A pressure sore was recorded." });
  const open = mentions(text, OPEN_SKIN);
  if (open) out.push({ code: "OPEN_SKIN", kind: "ESCALATION", reason: `The description mentions "${open}".` });
  const unexplained = mentions(text, UNEXPLAINED);
  if (unexplained) out.push({ code: "UNEXPLAINED", kind: "SAFEGUARDING", reason: `The description mentions "${unexplained}".` });
  if (earlierSameAreaLast30Days >= 2) out.push({ code: "REPEATED", kind: "ESCALATION", reason: `${earlierSameAreaLast30Days} earlier observations of the same area were recorded in the last 30 days.` });
  return out;
}

// ── Switch and availability ───────────────────────────────────────────────

function orgOf(ctx: Ctx) {
  if (!ctx.organisationId) throw new ForbiddenError("Choose an organisation first");
  return ctx.organisationId;
}

export async function bodyMapAiEnabled(organisationId: string) {
  const s = await db.rotaSettings.findUnique({ where: { organisationId }, select: { bodyMapAiEnabledAt: true } });
  return Boolean(s?.bodyMapAiEnabledAt);
}

export async function setBodyMapAiEnabled(ctx: Ctx, on: boolean, reviewNote: string) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  if (on && reviewNote.trim().length < 10) throw new ValidationError("Record who authorised sending body map records to the AI provider (DPIA and clinical safety review), and when");
  await db.$transaction(async (tx) => {
    await tx.rotaSettings.update({ where: { organisationId }, data: on ? { bodyMapAiEnabledAt: new Date(), bodyMapAiEnabledById: ctx.userId, bodyMapAiReviewNote: reviewNote.trim() } : { bodyMapAiEnabledAt: null, bodyMapAiEnabledById: null } });
    await audit({ organisationId, actorId: ctx.userId, action: on ? "bodyMap.ai.enabled" : "bodyMap.ai.disabled", entityType: "Organisation", entityId: organisationId, data: { reviewNote: reviewNote.trim() || null } }, tx);
  });
}

export type AiState = "ready" | "off" | "not_configured" | "no_permission";

/** Whether recommendations can be generated here, and if not, the honest reason. */
export async function bodyMapAiAvailability(ctx: Ctx): Promise<{ state: AiState; providerName: string | null; isSimulated: boolean }> {
  if (!hasOrgPermission(ctx, "bodyMap.record")) return { state: "no_permission", providerName: null, isSimulated: false };
  const enabled = await bodyMapAiEnabled(orgOf(ctx));
  const provider = getAiProvider();
  const state: AiState = !enabled ? "off" : !provider?.recommendBodyMap ? "not_configured" : "ready";
  return { state, providerName: provider?.name ?? null, isSimulated: provider?.isSimulated ?? false };
}

// ── What is considered ────────────────────────────────────────────────────

export interface StoredSource {
  sid: string;
  kind: string;
  label: string;
  href: string;
}

const SKIN = /\b(skin|pressure|wound|bruis\w*|dressing|cream|repositon\w*|reposition\w*|personal care|washing|bathing|continence|mobility|moving|handling|falls?)\b/i;
const POLICY_TOPICS = /\b(skin|pressure|wound|body map|safeguard\w*|incident|first aid|escalat\w*|medication|medicines)\b/i;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Gathers the minimum records needed, each with a short id. Read only; respects the viewer's permissions. */
export async function recommendationContext(ctx: Ctx, observationId: string) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.record");
  const o = await db.bodyMapObservation.findFirst({ where: { id: observationId, organisationId }, include: { reviews: { orderBy: { reviewedAt: "asc" } }, notes: { orderBy: { createdAt: "asc" } }, photos: { select: { id: true } } } });
  if (!o) throw new NotFoundError("Observation");
  const su = await serviceUserForRecords(ctx, o.serviceUserId);
  const base = `/rota/service-users/${su.id}`;
  const today = londonDate();
  const windowStart = new Date(o.observedAt.getTime() - 14 * 86400_000);
  const windowEnd = new Date(o.observedAt.getTime() + 14 * 86400_000);
  const canMeds = hasOrgPermission(ctx, "medication.view") && (await medicationEnabled(organisationId));

  const [earlier, plan, risks, incidents, sites, topical, policies] = await Promise.all([
    db.bodyMapObservation.findMany({ where: { organisationId, serviceUserId: su.id, region: o.region, view: o.view, observedAt: { lt: o.observedAt }, id: { not: o.id } }, orderBy: { observedAt: "desc" }, take: 6 }),
    db.carePlan.findFirst({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" }, include: { sections: { orderBy: { position: "asc" } } }, orderBy: { version: "desc" } }),
    db.riskAssessment.findMany({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" }, orderBy: { assessedAt: "desc" }, take: 30 }),
    db.incident.findMany({ where: { organisationId, serviceUserId: su.id, OR: [{ id: o.incidentId ?? "-" }, { status: { not: "CLOSED" } }, { occurredAt: { gte: windowStart, lte: windowEnd } }] }, orderBy: { occurredAt: "desc" }, take: 10 }),
    canMeds ? db.medicationApplicationSite.findMany({ where: { organisationId, serviceUserId: su.id, endedAt: null, view: o.view, region: o.region, medication: { status: "ACTIVE" } }, include: { medication: true } }) : Promise.resolve([]),
    canMeds ? db.medication.findMany({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE", route: { in: ["TOPICAL", "TRANSDERMAL"] }, sites: { none: { endedAt: null } } } }) : Promise.resolve([]),
    db.policy.findMany({ where: { organisationId, kind: "CUSTOMER", status: "ACTIVE", versions: { some: { status: "PUBLISHED" } } }, select: { id: true, ref: true, title: true }, orderBy: { ref: "asc" } }),
  ]);

  const records: BodyMapRecordInput[] = [];
  const sources: StoredSource[] = [{ sid: "O1", kind: "This observation", label: `${o.category}, ${o.region}, ${day(o.observedAt)}`, href: `${base}?tab=bodymap&obs=${o.id}` }];
  const counters = new Map<string, number>();
  const push = (prefix: string, kind: string, date: string, text: string, label: string, href: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    const sid = `${prefix}${n}`;
    records.push({ sid, kind, date, text });
    sources.push({ sid, kind, label, href });
  };

  for (const e of earlier) push("H", "Earlier observation", day(e.observedAt), clip(`${e.category}; size ${e.size ?? "not recorded"}; appearance ${e.appearance ?? "not recorded"}; ${e.status === "RESOLVED" ? "resolved" : "open"}. ${e.description}`, 400), `${e.category}, ${day(e.observedAt)}`, `${base}?tab=bodymap&obs=${e.id}`);
  for (const r of o.reviews) push("N", "Follow-up", day(r.reviewedAt), clip(`${r.outcome}${r.resolved ? " (marked resolved)" : r.nextFollowUpOn ? ` (next follow-up ${fromDbDate(r.nextFollowUpOn)})` : ""}`, 400), `Follow-up ${day(r.reviewedAt)}`, `${base}?tab=bodymap&obs=${o.id}&pane=history`);
  for (const n of o.notes) push("N", "Note", day(n.createdAt), clip(n.text, 400), `Note ${day(n.createdAt)}`, `${base}?tab=bodymap&obs=${o.id}&pane=history`);
  if (plan) for (const s of plan.sections.filter((x) => SKIN.test(`${x.title} ${x.body}`)).slice(0, 4)) push("P", "Care plan section", day(plan.approvedAt ?? plan.createdAt), clip(`${s.title}: ${s.body}`, 500), `Care plan v${plan.version}: ${s.title}`, `/rota/care-plans/${su.id}`);
  for (const r of risks.filter((x) => x.type === "PRESSURE_SKIN" || x.type === "FALLS" || x.type === "MOVING_HANDLING" || SKIN.test(`${x.title} ${x.hazards}`)).slice(0, 4)) push("R", "Risk assessment", day(r.assessedAt), clip(`${r.title}, ${r.level.toLowerCase()} risk, review due ${fromDbDate(r.reviewDue)}. Controls: ${r.controls}`, 400), r.title, `/rota/risks/${r.id}`);
  for (const i of incidents) push("I", "Incident", day(i.occurredAt), clip(`${i.reference} ${i.category}, ${i.severity.toLowerCase()} severity, ${i.status.toLowerCase()}${i.safeguarding ? ", marked safeguarding" : ""}${i.id === o.incidentId ? ", linked to this observation" : ""}: ${i.description}`, 300), i.reference, `/rota/incidents/${i.id}`);
  for (const s of sites) push("M", "Medication site", day(s.recordedAt), clip(`${s.medication.name}${s.medication.strength ? ` ${s.medication.strength}` : ""}, ${ROUTE_LABEL[s.medication.route as keyof typeof ROUTE_LABEL] ?? s.medication.route}, documented for ${s.region}. Instructions: ${s.medication.instructions ?? "none recorded"}`, 300), `${s.medication.name} (application site)`, `${base}?tab=medication`);
  for (const m of topical) push("M", "Topical medicine without a site", day(m.createdAt), clip(`${m.name}, ${ROUTE_LABEL[m.route as keyof typeof ROUTE_LABEL] ?? m.route}: no application site documented`, 200), `${m.name} (no site recorded)`, `${base}?tab=medication`);
  for (const p of policies.filter((x) => POLICY_TOPICS.test(x.title)).slice(0, 5)) push("G", "Approved policy", "", `${p.ref} ${p.title}`, `${p.ref} ${p.title}`, `/policies/${p.id}`);

  const limits = ["Photographs are never sent; any comparison of photographs must be made by a person."];
  if (!canMeds) limits.push("Medication records were not considered (switched off for the organisation, or not visible to the person asking).");
  if (!plan) limits.push("There is no active care plan.");
  if (!records.some((r) => r.kind === "Approved policy")) limits.push("No approved organisational policy on skin integrity, safeguarding, incidents or medication was found.");

  const input: BodyMapRecommendationInput = {
    observation: { sid: "O1", category: o.category, area: o.region, view: BODY_MAP_VIEWS[o.view], observedOn: day(o.observedAt), pain: painLabel(o.pain), size: o.size, appearance: o.appearance, description: o.description, followUpOn: o.followUpOn ? fromDbDate(o.followUpOn) : null, status: o.status, incidentDecision: o.incidentDecision, photoCount: o.photos.length },
    records,
    limits,
    today,
  };
  return { observation: o, serviceUser: su, input, sources, limits };
}

// ── Guard ─────────────────────────────────────────────────────────────────

/** Phrases a suggestion must never contain: diagnosis, grading, medication instructions, safeguarding conclusions. */
const FORBIDDEN = /\b(diagnos\w*|prescrib\w*|administer\w*|grade \d|category [1-4]\b|stage [1-4]\b|is infected|has an infection|cellulitis|(increase|decrease|reduce|stop|start|change)\s+(the\s+)?(dose|medication|medicine|cream|patch)|apply (the |a )?(cream|ointment|patch|dressing)|abuse (has|was|is) (occurred|taken place|happening|confirmed)|neglect (has|was|is) (occurred|confirmed)|is (being )?abused|deteriorat(ed|ing) badly)\b/i;

export function guardRecommendations(output: BodyMapRecommendationOutput, sids: Set<string>) {
  let dropped = 0;
  const kept = output.recommendations.flatMap((r) => {
    const sources = [...new Set(r.sources.map((s) => s.trim().toUpperCase()))].filter((s) => sids.has(s));
    const text = `${r.title} ${r.explanation} ${r.suggestedAction} ${r.facts.join(" ")}`;
    if (!sources.length || !r.title.trim() || !r.explanation.trim() || FORBIDDEN.test(text)) {
      dropped++;
      return [];
    }
    return [{ ...r, title: clip(r.title.trim(), 200), explanation: clip(r.explanation.trim(), 1000), suggestedAction: clip(r.suggestedAction.trim(), 500), facts: r.facts.map((f) => clip(f.trim(), 300)).filter(Boolean).slice(0, 6), sources }];
  });
  return { kept: kept.slice(0, 8), dropped: dropped + Math.max(0, kept.length - 8) };
}

// ── Generating ────────────────────────────────────────────────────────────

export type GenerateResult = { status: "CREATED" | "NONE"; runId: string; count: number } | { status: "UP_TO_DATE"; runId: string } | { status: "FAILED"; runId: string; message: string };

export async function generateRecommendations(ctx: Ctx, observationId: string, trigger: "AUTO" | "MANUAL"): Promise<GenerateResult> {
  const avail = await bodyMapAiAvailability(ctx);
  if (avail.state === "no_permission") throw new ForbiddenError("Only office staff and managers can ask for recommendations");
  if (avail.state === "off") throw new ForbiddenError("AI-Assisted Recommendations are switched off for your organisation. An admin can switch them on in Rota Settings.");
  const provider = getAiProvider();
  if (!provider?.recommendBodyMap) throw new AiUnavailableError("No AI provider is configured. The body map works as normal without recommendations.");

  const { observation: o, serviceUser: su, input, sources } = await recommendationContext(ctx, observationId);
  const basisHash = createHash("sha256").update(JSON.stringify({ provider: provider.name, input })).digest("hex");
  const existing = await db.bodyMapRecommendationRun.findFirst({ where: { observationId: o.id, basisHash, status: { not: "FAILED" } }, select: { id: true } });
  if (existing) return { status: "UP_TO_DATE", runId: existing.id };
  const [providerName, model] = provider.name.split(":");
  const base = { organisationId: o.organisationId, observationId: o.id, trigger, basisHash, observationVersion: o.version, provider: providerName ?? provider.name, model: model ?? null, isSimulated: provider.isSimulated, requestedById: ctx.userId, sources: sources as unknown as Prisma.InputJsonValue };

  let parsed: BodyMapRecommendationOutput | null = null;
  let failure: string | null = null;
  try {
    const raw = await provider.recommendBodyMap(input);
    const p = BodyMapRecommendationSchema.safeParse(raw);
    if (p.success) parsed = p.data;
    else failure = "The AI provider returned an answer in the wrong shape. Nothing was saved.";
  } catch (e) {
    failure = e instanceof AiUnavailableError ? e.message : "The AI provider could not be reached. Try again later; the body map works as normal.";
    if (!(e instanceof AiUnavailableError)) logger.warn({ err: (e as Error).message }, "body map recommendations failed");
  }
  if (!parsed) {
    const run = await db.$transaction(async (tx) => {
      const r = await tx.bodyMapRecommendationRun.create({ data: { ...base, status: "FAILED", error: failure } });
      await audit({ organisationId: o.organisationId, actorId: ctx.userId, action: "bodyMap.ai.failed", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: su.id, runId: r.id, trigger, provider: provider.name, error: failure } }, tx);
      return r;
    });
    return { status: "FAILED", runId: run.id, message: failure ?? "Recommendations could not be generated" };
  }

  const { kept, dropped } = guardRecommendations(parsed, new Set(sources.map((s) => s.sid)));
  const gaps = [...parsed.gaps.map((g) => clip(g.trim(), 300)).filter(Boolean).slice(0, 10)];
  if (dropped) gaps.push(`${dropped} ${dropped === 1 ? "suggestion was" : "suggestions were"} removed because ${dropped === 1 ? "it" : "they"} cited no record or read like a diagnosis, a medication instruction or a safeguarding conclusion.`);
  try {
    const run = await db.$transaction(async (tx) => {
      await tx.bodyMapRecommendationRun.updateMany({ where: { observationId: o.id, supersededAt: null, status: { not: "FAILED" } }, data: { supersededAt: new Date() } });
      const r = await tx.bodyMapRecommendationRun.create({ data: { ...base, status: kept.length ? "COMPLETED" : "NONE", gaps: gaps as Prisma.InputJsonValue } });
      const bySid = new Map(sources.map((s) => [s.sid, s]));
      for (const [i, k] of kept.entries()) {
        await tx.bodyMapRecommendation.create({
          data: { organisationId: o.organisationId, observationId: o.id, runId: r.id, position: i + 1, category: k.category, title: k.title, explanation: k.explanation, suggestedAction: k.suggestedAction, actionKind: k.actionKind, facts: k.facts as Prisma.InputJsonValue, sources: k.sources.map((s) => bySid.get(s)!) as unknown as Prisma.InputJsonValue },
        });
      }
      await audit({ organisationId: o.organisationId, actorId: ctx.userId, action: "bodyMap.ai.generated", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: su.id, runId: r.id, trigger, provider: provider.name, simulated: provider.isSimulated, recommendations: kept.length, dropped, records: sources.map((s) => s.sid) } }, tx);
      return r;
    });
    return { status: kept.length ? "CREATED" : "NONE", runId: run.id, count: kept.length };
  } catch (e) {
    // Two requests with the same information at once: the other one won, which is what we want.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const won = await db.bodyMapRecommendationRun.findFirst({ where: { observationId: o.id, basisHash, status: { not: "FAILED" } }, select: { id: true } });
      if (won) return { status: "UP_TO_DATE", runId: won.id };
    }
    throw e;
  }
}

/**
 * Runs after a new observation is saved, outside the save itself: it is skipped quietly when AI is off, unavailable or
 * the user may not use it, and any failure is recorded on the run, never on the observation.
 */
export async function autoRecommend(ctx: Ctx, observationId: string) {
  try {
    const a = await bodyMapAiAvailability(ctx);
    if (a.state !== "ready") return null;
    return await generateRecommendations(ctx, observationId, "AUTO");
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "automatic body map recommendations skipped");
    return null;
  }
}

// ── Reading ───────────────────────────────────────────────────────────────

export const REC_CATEGORY_LABEL: Record<string, string> = {
  OBSERVATION_FOLLOW_UP: "Observation follow-up",
  CARE_PLAN_REVIEW: "Care plan review",
  RISK_REVIEW: "Risk assessment review",
  INCIDENT_SAFEGUARDING: "Incident and safeguarding review",
  MEDICATION_REVIEW: "Medication-related review",
  HISTORICAL_COMPARISON: "Historical comparison",
};
export const REC_STATUS_LABEL: Record<string, string> = { NEW: "New", UNDER_REVIEW: "Under review", ACCEPTED: "Accepted", DISMISSED: "Dismissed", ACTION_CREATED: "Action created" };

export async function recommendationRuns(ctx: Ctx, observationId: string) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.record");
  const o = await db.bodyMapObservation.findFirst({ where: { id: observationId, organisationId }, select: { serviceUserId: true } });
  if (!o) throw new NotFoundError("Observation");
  await serviceUserForRecords(ctx, o.serviceUserId);
  const runs = await db.bodyMapRecommendationRun.findMany({ where: { observationId, organisationId }, include: { recommendations: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "desc" }, take: 10 });
  return runs.map((r) => ({
    ...r,
    gaps: r.gaps as unknown as string[],
    sources: r.sources as unknown as StoredSource[],
    recommendations: r.recommendations.map((x) => ({ ...x, facts: x.facts as unknown as string[], sources: x.sources as unknown as StoredSource[] })),
  }));
}

// ── Reviewing ─────────────────────────────────────────────────────────────

async function ownedRecommendation(ctx: Ctx, id: string) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.review");
  const r = await db.bodyMapRecommendation.findFirst({ where: { id, organisationId }, include: { observation: { select: { serviceUserId: true } } } });
  if (!r) throw new NotFoundError("Recommendation");
  await serviceUserForRecords(ctx, r.observation.serviceUserId);
  return r;
}

async function move(ctx: Ctx, id: string, from: string[], data: Prisma.BodyMapRecommendationUpdateManyMutationInput, action: string, note?: string | null) {
  const r = await ownedRecommendation(ctx, id);
  await db.$transaction(async (tx) => {
    const n = await tx.bodyMapRecommendation.updateMany({ where: { id: r.id, status: { in: from } }, data });
    if (n.count !== 1) throw new ConflictError("This recommendation has already been decided. Reload the page to see the latest.");
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action, entityType: "BodyMapObservation", entityId: r.observationId, data: { serviceUserId: r.observation.serviceUserId, recommendationId: r.id, runId: r.runId, title: r.title, note: note ?? null } }, tx);
  });
}

/** "Review suggestion": a manager takes it on. */
export function startRecommendationReview(ctx: Ctx, id: string) {
  return move(ctx, id, ["NEW"], { status: "UNDER_REVIEW", reviewStartedById: ctx.userId, reviewStartedAt: new Date() }, "bodyMap.ai.reviewStarted");
}

const noteSchema = z.string().trim().max(1000).optional();

export async function acceptRecommendation(ctx: Ctx, id: string, note?: string) {
  const n = noteSchema.parse(note) || null;
  return move(ctx, id, ["NEW", "UNDER_REVIEW"], { status: "ACCEPTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n }, "bodyMap.ai.accepted", n);
}

/** Dismissing an incident, safeguarding or medication suggestion needs a reason, so the decision can be checked later. */
export async function dismissRecommendation(ctx: Ctx, id: string, note?: string) {
  const r = await ownedRecommendation(ctx, id);
  const n = noteSchema.parse(note) || null;
  if ((r.category === "INCIDENT_SAFEGUARDING" || r.category === "MEDICATION_REVIEW") && (!n || n.length < 5)) throw new ValidationError("Say why this suggestion is being dismissed");
  return move(ctx, id, ["NEW", "UNDER_REVIEW"], { status: "DISMISSED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n }, "bodyMap.ai.dismissed", n);
}

/** Creates the follow-up task from a suggestion. The suggestion becomes "Action created"; the task uses normal workflows. */
export async function createTaskFromRecommendation(ctx: Ctx, id: string, input: Omit<TaskInput, "kind"> & { kind?: string }) {
  const r = await ownedRecommendation(ctx, id);
  if (!["NEW", "UNDER_REVIEW", "ACCEPTED"].includes(r.status)) throw new ConflictError("This recommendation has already been decided. Reload the page to see the latest.");
  const kind = input.kind && isTaskKind(input.kind) ? input.kind : r.actionKind && isTaskKind(r.actionKind) ? r.actionKind : "MANAGER_REVIEW";
  return createBodyMapTask(ctx, r.observationId, { ...input, kind, title: input.title || r.title.replace(/^\[SIMULATED\]\s*/, ""), details: input.details || r.suggestedAction }, { recommendationId: r.id });
}

/** Today's date, used by pages to set the minimum task due date. */
export const minimumDueDate = () => londonDate();
export const defaultDueDate = () => addDays(londonDate(), 3);

import type { MissedCallStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { caseScope } from "../missed-calls";
import { rotaScope } from "../scope";
import { collectEvidence, type EvidenceItem, type TimelineEntry } from "./evidence";
import { queueInvestigation, type RunReason } from "./queue";
import { automationSwitches } from "./settings";
import { suggestReason, type Suggestion } from "./suggest";
import { requestConfirmations } from "./confirmations";

/**
 * Evidence runs. A run collects the evidence for one case, and is stored only when something changed since the last
 * one (otherwise it is recorded as UNCHANGED, with no new timeline or suggestion). It never changes the case, the
 * visit, its clocks or anything else: it writes only its own run, its suggestion and the audit entry. A closed case is
 * never touched, and nothing here reopens one.
 */

export const PROCESSING_VERSION = 1;

/** Short, safe text for a failed run: no record contents, just what kind of failure it was. */
function safeError(e: unknown) {
  const name = e instanceof Error ? e.name : "Error";
  const code = (e as { code?: string })?.code;
  return `${name}${code ? ` ${code}` : ""}`.slice(0, 200);
}

export async function runInvestigation(caseId: string, reason: RunReason, opts: { requestedById?: string | null; jobId?: string | null } = {}) {
  const c = await db.missedCallCase.findUnique({ where: { id: caseId }, select: { id: true, organisationId: true, stage: true } });
  if (!c) return { skipped: "no case" as const };
  if (c.stage === "CLOSED") return { skipped: "closed" as const };
  const sw = await automationSwitches(db, c.organisationId);
  if (!sw.evidence) return { skipped: "off" as const };

  const run = await db.missedCallInvestigationRun.create({ data: { organisationId: c.organisationId, caseId: c.id, reason, requestedById: opts.requestedById ?? null, jobId: opts.jobId ?? null, processingVersion: PROCESSING_VERSION } });
  try {
    const collected = await collectEvidence(c.id);
    if (!collected) throw new Error("case disappeared");
    const result = await db.$transaction(async (tx) => {
      // One writer per case at a time, so two runs finishing together cannot both add a suggestion.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`missed-inv:${c.id}`}))`;
      const fresh = await tx.missedCallCase.findUniqueOrThrow({ where: { id: c.id }, select: { stage: true } });
      const last = await tx.missedCallInvestigationRun.findFirst({ where: { caseId: c.id, status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { id: true, fingerprint: true } });
      const unchanged = !!last && last.fingerprint === collected.fingerprint;
      await tx.missedCallInvestigationRun.update({
        where: { id: run.id },
        data: unchanged
          ? { status: "UNCHANGED", finishedAt: new Date(), fingerprint: collected.fingerprint }
          : { status: "COMPLETED", finishedAt: new Date(), fingerprint: collected.fingerprint, evidence: collected.items as unknown as Prisma.InputJsonValue, timeline: collected.timeline as unknown as Prisma.InputJsonValue, sourceRefs: collected.refs as unknown as Prisma.InputJsonValue },
      });
      const basis = unchanged ? last!.id : run.id;
      if (!unchanged) await audit({ organisationId: c.organisationId, actorId: opts.requestedById ?? null, action: last ? "rota.missed.auto.evidence_refreshed" : "rota.missed.auto.evidence_collected", entityType: "MissedCallCase", entityId: c.id, data: { runId: run.id, reason, items: collected.items.length } }, tx);
      let draftId: string | null = null;
      if (sw.summary && fresh.stage !== "CLOSED") {
        const existing = await tx.missedCallInvestigationDraft.findFirst({ where: { caseId: c.id, runId: basis }, select: { id: true } });
        if (!existing) draftId = await writeDraft(tx, c.organisationId, c.id, basis, suggestReason(collected.facts), opts.requestedById ?? null);
      }
      return { unchanged, draftId };
    });
    return { runId: run.id, ...result };
  } catch (e) {
    await db.missedCallInvestigationRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: safeError(e) } }).catch(() => undefined);
    logger.warn({ caseId, runId: run.id, err: safeError(e) }, "missed-call evidence run failed");
    throw e;
  }
}

async function writeDraft(tx: Prisma.TransactionClient, organisationId: string, caseId: string, runId: string, s: Suggestion, actorId: string | null) {
  await tx.missedCallInvestigationDraft.updateMany({ where: { caseId, reviewStatus: "PENDING" }, data: { reviewStatus: "SUPERSEDED", reviewedAt: new Date() } });
  const d = await tx.missedCallInvestigationDraft.create({ data: { organisationId, caseId, runId, suggestedReason: s.suggestedReason, classification: s.classification, support: s.support, summary: s as unknown as Prisma.InputJsonValue } });
  await audit({ organisationId, actorId, action: "rota.missed.auto.summary_generated", entityType: "MissedCallCase", entityId: caseId, data: { draftId: d.id, classification: s.classification, suggestedReason: s.suggestedReason, support: s.support } }, tx);
  return d.id;
}

/** The job handler: the carer requests (the first time; idempotent after that), then one evidence run. */
export async function investigateJob(payload: Record<string, unknown>, jobId: string) {
  const caseId = String(payload.caseId ?? "");
  const reason = (String(payload.reason ?? "CATCH_UP") as RunReason);
  // Carers are asked first, so the evidence and the suggestion made in this run already show who has been asked.
  const requested = await requestConfirmations(caseId);
  const r = await runInvestigation(caseId, reason, { requestedById: typeof payload.requestedById === "string" ? payload.requestedById : null, jobId });
  return { ...r, requested };
}

/**
 * Run with the call sweep: cases whose first run never happened (the queue was down, the enqueue failed) get one, and
 * open cases from the last day are re-checked every 10 minutes for rota changes and cover booked elsewhere. Unchanged
 * evidence is recorded as UNCHANGED and adds nothing.
 */
export async function catchUpInvestigations(now = new Date()) {
  const orgs = (await db.rotaSettings.findMany({ where: { missedAutoEvidenceAt: { not: null } }, select: { organisationId: true } })).map((o) => o.organisationId);
  if (!orgs.length) return 0;
  const cases = await db.missedCallCase.findMany({
    where: { organisationId: { in: orgs }, stage: { not: "CLOSED" }, detectedAt: { gte: new Date(now.getTime() - 7 * 86400000), lte: new Date(now.getTime() - 60000) } },
    select: { id: true, detectedAt: true, investigationRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { startedAt: true } } },
    take: 500,
  });
  let queued = 0;
  for (const c of cases) {
    const lastAt = c.investigationRuns[0]?.startedAt;
    const recent = now.getTime() - c.detectedAt.getTime() < 86400000;
    if (!lastAt || (recent && now.getTime() - lastAt.getTime() >= 10 * 60000)) {
      if (await queueInvestigation(c.id, "CATCH_UP", { now, bucketMinutes: 10 })) queued++;
    }
  }
  return queued;
}

/** The coordinator's "Refresh evidence": runs now, so the page shows the result straight away. */
export async function refreshEvidence(ctx: Ctx, caseId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const c = await db.missedCallCase.findFirst({ where: { ...caseScope(scope), id: caseId }, select: { id: true, stage: true, organisationId: true } });
  if (!c) throw new NotFoundError("Missed call");
  if (c.stage === "CLOSED") throw new ConflictError("This case is closed, so its evidence is no longer refreshed");
  if (!(await automationSwitches(db, c.organisationId)).evidence) throw new ValidationError("Evidence collection is switched off in Rostering settings");
  try {
    await requestConfirmations(c.id);
    const r = await runInvestigation(c.id, "MANUAL", { requestedById: ctx.userId });
    return "skipped" in r ? "skipped" : r.unchanged ? "unchanged" : "updated";
  } catch {
    await queueInvestigation(c.id, "MANUAL", { requestedById: ctx.userId });
    throw new ValidationError("The evidence check failed. It will be tried again automatically; the case and its alert are unaffected.");
  }
}

// ── What the screens show ─────────────────────────────────────────────────

export type AutoStatus = "off" | "collecting" | "failed" | "awaiting" | "urgent" | "ready" | "reviewed" | "closed";
export const AUTO_STATUS_LABEL: Record<AutoStatus, string> = {
  off: "Automation off",
  collecting: "Collecting evidence",
  failed: "Evidence check failed",
  awaiting: "Awaiting carer",
  urgent: "Urgent review required",
  ready: "Ready for coordinator review",
  reviewed: "Reviewed",
  closed: "Case closed",
};

/** The automation's own progress. It never replaces or moves the case's stage. */
export function deriveAutoStatus(x: { evidenceOn: boolean; stage: MissedCallStage; lastRun: { status: string } | null; lastGoodRun: boolean; awaitingCarer: boolean; highRisk: boolean; urgentSuggestion: boolean; reasonRecorded: boolean; draftReviewed: boolean }): AutoStatus {
  if (x.stage === "CLOSED") return "closed";
  if (!x.evidenceOn && !x.lastGoodRun) return "off";
  if (x.lastRun?.status === "FAILED") return "failed";
  if (!x.lastGoodRun) return "collecting";
  if (x.reasonRecorded || x.draftReviewed) return "reviewed";
  if (x.highRisk || x.urgentSuggestion) return "urgent";
  if (x.awaitingCarer) return "awaiting";
  return "ready";
}

export interface AutoSummary {
  status: AutoStatus;
  label: string;
  carer: string;
  suggestion: Suggestion["classification"] | null;
  missing: number;
  updatedAt: Date | null;
}

/** One line per case for the queue and lists, in a fixed number of queries whatever the number of cases. */
export async function automationState(organisationId: string, cases: { id: string; stage: MissedCallStage; reasonCode: string | null; highRisk: boolean }[]): Promise<Map<string, AutoSummary>> {
  const out = new Map<string, AutoSummary>();
  if (!cases.length) return out;
  const ids = cases.map((c) => c.id);
  const [sw, runs, confs, drafts] = await Promise.all([
    automationSwitches(db, organisationId),
    db.missedCallInvestigationRun.findMany({ where: { organisationId, caseId: { in: ids } }, orderBy: { startedAt: "desc" }, select: { caseId: true, status: true, startedAt: true, finishedAt: true } }),
    db.missedCallCarerConfirmation.findMany({ where: { organisationId, caseId: { in: ids } }, select: { caseId: true, status: true } }),
    db.missedCallInvestigationDraft.findMany({ where: { organisationId, caseId: { in: ids }, reviewStatus: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" }, select: { caseId: true, classification: true, suggestedReason: true, reviewStatus: true, summary: true } }),
  ]);
  for (const c of cases) {
    const mine = runs.filter((r) => r.caseId === c.id);
    const lastRun = mine[0] ?? null;
    const good = mine.find((r) => r.status === "COMPLETED" || r.status === "UNCHANGED");
    const cf = confs.filter((x) => x.caseId === c.id);
    const draft = drafts.find((d) => d.caseId === c.id) ?? null;
    const summary = draft?.summary as unknown as Suggestion | undefined;
    const status = deriveAutoStatus({ evidenceOn: sw.evidence, stage: c.stage, lastRun, lastGoodRun: !!good, awaitingCarer: cf.some((x) => x.status === "REQUESTED"), highRisk: c.highRisk, urgentSuggestion: !!summary?.urgent, reasonRecorded: !!c.reasonCode, draftReviewed: !!draft && draft.reviewStatus !== "PENDING" });
    out.set(c.id, {
      status,
      label: AUTO_STATUS_LABEL[status],
      carer: carerLine(cf.map((x) => x.status)),
      suggestion: summary?.classification ?? null,
      missing: summary?.missing.length ?? 0,
      updatedAt: good?.finishedAt ?? null,
    });
  }
  return out;
}

export function carerLine(statuses: string[]) {
  if (!statuses.length) return "No carer was booked";
  const n = (s: string) => statuses.filter((x) => x === s).length;
  const parts = [n("RESPONDED") ? `${n("RESPONDED")} answered` : null, n("REQUESTED") ? `${n("REQUESTED")} asked, no answer yet` : null, n("NO_RESPONSE") ? `${n("NO_RESPONSE")} did not answer in time` : null, n("NO_LOGIN") ? `${n("NO_LOGIN")} without a sign-in` : null, n("NOT_REQUESTED") + n("WITHDRAWN") ? `${n("NOT_REQUESTED") + n("WITHDRAWN")} not asked in the app` : null].filter(Boolean);
  return parts.join(", ");
}

/** Everything the case page's Automated investigation section shows. Same scope as the case page itself. */
export async function automationDetail(ctx: Ctx, caseId: string) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const c = await db.missedCallCase.findFirst({ where: { ...caseScope(scope), id: caseId }, select: { id: true, organisationId: true, stage: true, reasonCode: true, visit: { select: { serviceUser: { select: { riskLevel: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true }, take: 1 } } } } } } });
  if (!c) throw new NotFoundError("Missed call");
  const [sw, runs, confirmations, drafts, medsOn] = await Promise.all([
    automationSwitches(db, c.organisationId),
    db.missedCallInvestigationRun.findMany({ where: { caseId: c.id }, orderBy: { startedAt: "desc" }, take: 30 }),
    db.missedCallCarerConfirmation.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" }, include: { staff: { select: { displayName: true } }, responses: { orderBy: { submittedAt: "asc" } } } }),
    db.missedCallInvestigationDraft.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.rotaSettings.findUnique({ where: { organisationId: c.organisationId }, select: { medicationEnabledAt: true } }),
  ]);
  const canMeds = !!medsOn?.medicationEnabledAt && hasOrgPermission(ctx, "medication.view");
  const good = runs.find((r) => r.status === "COMPLETED");
  const lastChecked = runs.find((r) => r.status === "COMPLETED" || r.status === "UNCHANGED");
  const visible = <T extends { restricted?: string }>(xs: T[]) => xs.filter((x) => x.restricted !== "medication" || canMeds);
  const items = good ? visible(good.evidence as unknown as EvidenceItem[]) : [];
  const timeline = good ? visible(good.timeline as unknown as TimelineEntry[]) : [];
  const draft = drafts[0] ?? null;
  const summary = draft ? (draft.summary as unknown as Suggestion) : null;
  const highRisk = c.visit.serviceUser.riskLevel === "HIGH" || c.visit.serviceUser.risks.length > 0;
  const status = deriveAutoStatus({ evidenceOn: sw.evidence, stage: c.stage, lastRun: runs[0] ?? null, lastGoodRun: !!lastChecked, awaitingCarer: confirmations.some((x) => x.status === "REQUESTED"), highRisk, urgentSuggestion: !!summary?.urgent, reasonRecorded: !!c.reasonCode, draftReviewed: !!draft && draft.reviewStatus !== "PENDING" });
  const reviewerIds = drafts.map((d) => d.reviewedById).filter((x): x is string => !!x);
  const reviewers = new Map((await db.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    switches: sw,
    status,
    label: AUTO_STATUS_LABEL[status],
    items,
    timeline,
    lastRun: runs[0] ?? null,
    lastChecked: lastChecked ?? null,
    snapshotRun: good ?? null,
    runCount: runs.length,
    failedRun: runs[0]?.status === "FAILED" ? runs[0] : null,
    confirmations,
    draft,
    summary,
    reviewerName: draft?.reviewedById ? reviewers.get(draft.reviewedById) ?? "A member" : null,
    canRefresh: hasOrgPermission(ctx, "rota.edit") && c.stage !== "CLOSED" && sw.evidence,
    canConfigure: hasOrgPermission(ctx, "org.manage"),
    canReview: hasOrgPermission(ctx, "rota.edit") && (c.stage === "NEW" || c.stage === "INVESTIGATING"),
  };
}
export type AutomationDetail = Awaited<ReturnType<typeof automationDetail>>;

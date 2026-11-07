import type { BackgroundJob, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/server/audit-log";
import { ctxForUser } from "@/server/auth/session";
import type { Ctx } from "@/server/auth/rbac";
import { drain, enqueue, PermanentJobError } from "@/server/jobs/queue";
import { rotaScope } from "@/server/rota/scope";
import { coordinatorAccess, intakeInScope, readIntakeDocument } from "./intake";
import { inReview } from "@/lib/care-coordinator-rules";
import { databaseRefusal, prepareDrafts, prepareReportText } from "./prepare";

/**
 * Background reading of intake documents (owner's brief of 6 Nov 2026, 17:21).
 *
 * Reading a long or scanned support plan with the AI can take minutes, longer than a web request should be held
 * open. So an upload (or "Read again") only stores the original and records a durable job in the Postgres queue; the
 * job reads the document, saves the facts and prepares the drafts and proposed rota. The page shows the job's stage.
 *
 *  - Durable: the job is a BackgroundJob row. The worker runs it where there is one; on Vercel it is started right
 *    after the upload (Next.js after(), which Vercel keeps alive until it finishes) and, should that be cut off, by
 *    the intake page itself, which asks /api/care-coordinator/reads/run while a document is waiting. A job whose run
 *    was cut off is picked up again once its lock lapses (READ_LOCK_MS).
 *  - Resumable: each stage records where it got to. A read that finished is not repeated when only the preparation
 *    failed, and preparation never creates anything twice (prepareDrafts carries on from what is saved).
 *  - No duplicates: a document has at most one job waiting or running; asking again joins it.
 *  - Errors in plain words on the document (readStageNote), never the document's text.
 */

export const READ_JOB = "coordinator.read";
/** Longer than the 5 minutes a Vercel function may run, so a cut-off run is retried soon after, never twice at once. */
export const READ_LOCK_MS = 330_000;
const MAX_ATTEMPTS = 3;
const ACTIVE = ["QUEUED", "RUNNING", "FAILED"] as const;
export const READ_STAGES = ["QUEUED", "READING", "PREPARING", "RETRYING", "DONE", "FAILED"] as const;
export type ReadStage = (typeof READ_STAGES)[number];
export const IN_PROGRESS: ReadonlySet<string> = new Set(["QUEUED", "READING", "PREPARING", "RETRYING"]);

type Payload = { organisationId: string; documentId: string; actorId: string; prepare: boolean };

const setStage = (documentId: string, stage: ReadStage, note: string | null, extra: Prisma.CareIntakeDocumentUpdateInput = {}) =>
  db.careIntakeDocument.update({ where: { id: documentId }, data: { readStage: stage, readStageAt: new Date(), readStageNote: note, ...extra } });

/**
 * Records a background read of one stored document (and, with prepare, the drafts and proposed rota after it).
 * Checks the caller may read it; never takes an organisation from the request. Joins a job already waiting.
 */
export async function queueDocumentRead(ctx: Ctx, documentId: string, opts: { prepare?: boolean } = {}) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const organisationId = scope.organisationId;
  const doc = await db.careIntakeDocument.findFirst({ where: { id: documentId, organisationId } });
  if (!doc) throw new NotFoundError("Document");
  const intake = await intakeInScope(db, scope, doc.intakeId);
  if (!inReview(intake.status)) throw new ConflictError("Documents can only be read while the coordinator is reviewing");
  if (doc.contentType !== "application/pdf") throw new ValidationError("Only PDFs can be read. Add this document's facts by hand.");
  if (doc.readJobId) {
    const current = await db.backgroundJob.findUnique({ where: { id: doc.readJobId } });
    if (current && (ACTIVE as readonly string[]).includes(current.status)) return { jobId: current.id, joined: true };
  }
  const payload: Payload = { organisationId, documentId: doc.id, actorId: ctx.userId, prepare: opts.prepare ?? true };
  const { job } = await enqueue(READ_JOB, payload, { idempotencyKey: `${READ_JOB}:${doc.id}:${Date.now()}`, maxAttempts: MAX_ATTEMPTS });
  await setStage(doc.id, "QUEUED", "Waiting to be read. You can leave this page; the reading carries on.", { readJobId: job.id });
  await audit({ organisationId, actorId: ctx.userId, action: "coordinator.document.read-queued", entityType: "CareIntake", entityId: intake.id, data: { documentId: doc.id, jobId: job.id, prepare: payload.prepare } });
  return { jobId: job.id, joined: false };
}

/** Queues every document of an intake still waiting to be read (after an upload). */
export async function queueIntakeReads(ctx: Ctx, documentIds: string[], opts: { prepare?: boolean } = {}) {
  const out = [];
  for (const id of documentIds) out.push(await queueDocumentRead(ctx, id, opts));
  return out;
}

function parsePayload(p: Record<string, unknown>): Payload {
  const s = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
  const organisationId = s("organisationId"), documentId = s("documentId"), actorId = s("actorId");
  if (!organisationId || !documentId || !actorId) throw new PermanentJobError("The reading job is missing its document");
  return { organisationId, documentId, actorId, prepare: p.prepare !== false };
}

/** Plain words for a failure, safe to show: our own messages as they are, anything else by its kind only. */
function failureText(e: unknown) {
  if (e instanceof AppError) return e.message.slice(0, 300);
  const refused = databaseRefusal(e);
  if (refused) return `The database refused a change (${refused}). The original is stored safely.`;
  const name = e instanceof Error ? e.name : "Error";
  return `An unexpected ${name} stopped the reading. The original is stored safely.`;
}

/** The job: read (unless an earlier run of this job already finished reading), then prepare the drafts. */
export async function runDocumentReadJob(raw: Record<string, unknown>, job: BackgroundJob) {
  const p = parsePayload(raw);
  const doc = await db.careIntakeDocument.findFirst({ where: { id: p.documentId, organisationId: p.organisationId } });
  // A newer request replaced this one, or the document went: nothing to do.
  if (!doc || (doc.readJobId && doc.readJobId !== job.id)) return { skipped: true };
  try {
    const ctx = await ctxForUser(p.actorId, p.organisationId);
    const alreadyRead = !!doc.readAt && doc.readAt >= job.createdAt;
    let read: { facts: number; status: string; reader: string } | null = null;
    if (!alreadyRead) {
      await setStage(doc.id, "READING", doc.pageCount && doc.pageCount > 10 ? `Reading ${doc.pageCount} pages in parts. This can take a few minutes.` : "Reading the document.");
      const r = await readIntakeDocument(ctx, doc.id);
      read = { facts: r.facts, status: r.status, reader: r.reader };
    }
    let report: string | null = null;
    if (p.prepare) {
      const intake = await db.careIntake.findUnique({ where: { id: doc.intakeId }, select: { status: true } });
      if (intake && inReview(intake.status)) {
        await setStage(doc.id, "PREPARING", "Read. Preparing the person's draft records and a proposed rota.");
        try {
          report = prepareReportText(await prepareDrafts(ctx, doc.intakeId)).replace(/\n/g, " ");
        } catch (e) {
          // Preparing is refused for reasons a person must settle (for example someone similar already on record):
          // the reading stands, and the reason is shown.
          if (!(e instanceof AppError)) throw e;
          report = `Read. Drafts were not prepared: ${e.message.slice(0, 300)}`;
        }
      }
    }
    await setStage(doc.id, "DONE", report ?? (read ? `Read: ${read.facts} fact${read.facts === 1 ? "" : "s"} found.` : "Read."));
    return { read, prepared: !!report };
  } catch (e) {
    const last = job.attempts >= job.maxAttempts || e instanceof PermanentJobError || (e instanceof AppError && e.status < 500);
    const text = failureText(e);
    await setStage(doc.id, last ? "FAILED" : "RETRYING", last ? `${text} Press Read again to try again; nothing needs uploading again.` : `${text} Trying again shortly (attempt ${job.attempts + 1} of ${job.maxAttempts}).`);
    logger.warn({ jobId: job.id, documentId: doc.id, attempt: job.attempts, err: e instanceof Error ? e.name : "unknown" }, "coordinator read job failed");
    if (last && !(e instanceof PermanentJobError)) throw Object.assign(new PermanentJobError(text), { cause: e });
    throw e;
  }
}

/** Runs waiting reading jobs now (the worker does this on its own; on Vercel after an upload and from the page). */
export async function runQueuedReads(workerId: string, max = 1) {
  const { handlers } = await import("@/worker/handlers");
  return drain(workerId, handlers, { types: [READ_JOB], max, lockMs: READ_LOCK_MS });
}

/** What the intake page shows while documents are being read, scoped like the page itself. */
export async function readProgress(ctx: Ctx, intakeId: string) {
  coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const organisationId = scope.organisationId;
  await intakeInScope(db, scope, intakeId);
  const docs = await db.careIntakeDocument.findMany({ where: { intakeId, organisationId }, orderBy: { position: "asc" }, select: { id: true, readStage: true, readStageAt: true, readStageNote: true } });
  return { documents: docs.map((d) => ({ id: d.id, stage: d.readStage, at: d.readStageAt?.toISOString() ?? null, note: d.readStageNote })), busy: docs.some((d) => !!d.readStage && IN_PROGRESS.has(d.readStage)) };
}

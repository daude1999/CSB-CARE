import type { JobHandler } from "@/server/jobs/queue";
import { checkSource, scheduleDueSources } from "@/server/sources/engine";
import { analyseChange } from "@/server/changes/workflow";
import { deliverNotification } from "@/server/notifications/notify";
import { performPublication, publishDueScheduled, sendAcknowledgementReminders } from "@/server/policies/workflow";
import { syncCustomersFromMaster } from "@/server/policies/sync";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { sweepCalls } from "@/server/rota/monitor";
import type { RunTrigger } from "@prisma/client";

export const handlers: Record<string, JobHandler> = {
  "source.check": async (p, job) => {
    const trigger = (job.attempts > 1 ? "RETRY" : (p.trigger as RunTrigger)) ?? "SCHEDULED";
    const s = await checkSource(p.sourceId as string, { trigger, jobId: job.id });
    return { ...s };
  },
  "change.analyse": async (p) => analyseChange(p.changeId as string),
  "revision.draft": async (p) => {
    const r = await draftRevisionFromAssessment(p.assessmentId as string, (p.actorId as string) ?? null);
    return { revisionId: r.revision?.id ?? null, created: r.created, reason: r.reason };
  },
  "notification.deliver": async (p, job) => deliverNotification(p.deliveryId as string, job.attempts, job.maxAttempts),
  "publication.publish": async (p) => {
    const pub = await performPublication(p.publicationId as string);
    return { status: pub.status };
  },
  "master.sync": async (p) => {
    const r = await syncCustomersFromMaster(p.masterVersionId as string);
    return { results: r.map((x) => ({ policyId: x.policyId, revisionId: x.revisionId, skipped: x.skipped ?? null })) };
  },
  "maintenance.tick": async () => {
    const scheduled = await scheduleDueSources();
    const publications = await publishDueScheduled();
    const reminders = await sendAcknowledgementReminders();
    const calls = await sweepCalls();
    return { scheduledChecks: scheduled.length, publications, reminders, calls };
  },
};

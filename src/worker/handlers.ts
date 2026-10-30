import type { JobHandler } from "@/server/jobs/queue";
import { checkSource, scheduleDueSources } from "@/server/sources/engine";
import { analyseChange } from "@/server/changes/workflow";
import { deliverNotification } from "@/server/notifications/notify";
import { performPublication, publishDueScheduled, sendAcknowledgementReminders } from "@/server/policies/workflow";
import { syncCustomersFromMaster } from "@/server/policies/sync";
import { draftRevisionFromAssessment } from "@/server/policies/revise";
import { sweepCalls } from "@/server/rota/monitor";
import { escalateOverdueExceptions } from "@/server/rota/exceptions";
import { sweepMissedMedication } from "@/server/care/medication";
import { reconcileStaffAssignments } from "@/server/policies/assignment";
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
  "ack.reconcile": async (p) => reconcileStaffAssignments(p.organisationId as string, p.staffId as string),
  // Call monitoring runs as its own job, so a failing policy or source job never stops late and missed calls being found.
  "rota.sweep": async () => {
    const calls = await sweepCalls();
    const missedMedication = await sweepMissedMedication();
    const escalated = await escalateOverdueExceptions();
    return { ...calls, missedMedication, escalated };
  },
  "maintenance.tick": async () => {
    const scheduled = await scheduleDueSources();
    const publications = await publishDueScheduled();
    const reminders = await sendAcknowledgementReminders();
    return { scheduledChecks: scheduled.length, publications, reminders };
  },
};

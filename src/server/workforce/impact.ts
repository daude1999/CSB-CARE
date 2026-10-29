import type { AlertSeverity, Prisma } from "@prisma/client";
import { londonTime, londonDate } from "@/lib/london";
import { rotaSettings } from "@/server/rota/settings";
import { evaluate, loadFacts, loadPreferenceFacts } from "./eligibility";

type Db = Prisma.TransactionClient;

/** Coordinators who should hear about rota problems: managers and coordinators (plus organisation admins). */
export async function rotaRecipients(tx: Db, organisationId: string) {
  const ms = await tx.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] } }, select: { userId: true } });
  return [...new Set(ms.map((m) => m.userId))];
}

/**
 * Raises an operational alert and in-app notifications inside the caller's transaction. Deduplicated by key, so
 * re-running a check never repeats it. In-app only: the platform sends no e-mail or SMS for rota events.
 */
export async function raiseAlert(
  tx: Db,
  a: { organisationId: string; kind: string; severity?: AlertSeverity; visitId?: string | null; staffId?: string | null; assignmentId?: string | null; message: string; dedupeKey: string; conditionAt?: Date; actionUrl?: string; notify?: boolean },
) {
  const existing = await tx.rotaAlert.findUnique({ where: { dedupeKey: a.dedupeKey } });
  if (existing) return { created: false, alert: existing };
  const alert = await tx.rotaAlert.create({
    data: { organisationId: a.organisationId, kind: a.kind, severity: a.severity ?? "WARNING", visitId: a.visitId ?? null, staffId: a.staffId ?? null, assignmentId: a.assignmentId ?? null, message: a.message, dedupeKey: a.dedupeKey, conditionAt: a.conditionAt ?? null },
  });
  if (a.notify !== false) {
    for (const userId of await rotaRecipients(tx, a.organisationId)) {
      await tx.notification.createMany({
        data: [{ organisationId: a.organisationId, userId, type: `rota.${a.kind.toLowerCase()}`, title: a.message, body: a.message, reason: "You coordinate the rota for this organisation.", actionUrl: a.actionUrl ?? "/rota", dedupeKey: `rota:${a.dedupeKey}:${userId}` }],
        skipDuplicates: true,
      });
    }
  }
  return { created: true, alert };
}

/**
 * Re-checks the future allocations of staff whose HR record, absences or availability changed. Allocations that are
 * no longer valid are flagged for a coordinator's review and alerted; nothing is cancelled, removed or reassigned.
 * Flags whose problem has gone away are cleared. Visits that have started or finished are never touched.
 */
export async function reviewStaffImpact(tx: Db, organisationId: string, staffIds: string[], opts: { source: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const assignments = await tx.visitAssignment.findMany({
    where: { organisationId, staffId: { in: staffIds }, removedAt: null, startsAt: { gt: now }, visit: { status: "SCHEDULED" } },
    include: { visit: { select: { id: true, reference: true, serviceUserId: true, areaId: true, timeLocked: true, scheduledStart: true, scheduledEnd: true, tasks: { select: { careTaskId: true } } } }, staff: { select: { displayName: true } } },
    orderBy: { startsAt: "asc" },
    take: 2000,
  });
  if (!assignments.length) return { flagged: 0, cleared: 0 };
  const from = assignments[0].startsAt;
  const to = assignments.reduce((m, a) => (a.endsAt > m ? a.endsAt : m), from);
  const [settings, facts] = await Promise.all([rotaSettings(tx, organisationId), loadFacts(tx, organisationId, [...new Set(assignments.map((a) => a.staffId))], from, to)]);
  const prefsCache = new Map<string, Awaited<ReturnType<typeof loadPreferenceFacts>>>();
  let flagged = 0;
  let cleared = 0;
  for (const a of assignments) {
    if (!prefsCache.has(a.visit.serviceUserId)) prefsCache.set(a.visit.serviceUserId, await loadPreferenceFacts(tx, organisationId, a.visit.serviceUserId));
    const r = evaluate(settings, facts, { staffId: a.staffId, start: a.visit.scheduledStart, end: a.visit.scheduledEnd, slot: a.slot, visitId: a.visitId, serviceUserId: a.visit.serviceUserId, areaId: a.visit.areaId, careTaskIds: a.visit.tasks.map((t) => t.careTaskId).filter((x): x is string => !!x) }, prefsCache.get(a.visit.serviceUserId) ?? null);
    const reason = r.blocking[0]?.message ?? null;
    if (reason && a.reviewReason !== reason) {
      await tx.visitAssignment.update({ where: { id: a.id }, data: { reviewReason: reason, reviewFlaggedAt: now } });
      await tx.visitEvent.create({ data: { organisationId, visitId: a.visitId, type: "ALLOCATION_FLAGGED", reason: `${opts.source}: ${reason}`, data: { assignmentId: a.id, staffId: a.staffId } } });
      await raiseAlert(tx, {
        organisationId,
        kind: "ALLOCATION_REVIEW",
        visitId: a.visitId,
        staffId: a.staffId,
        assignmentId: a.id,
        message: `${a.staff.displayName} on ${a.visit.reference} (${londonDate(a.startsAt)} ${londonTime(a.startsAt)}) needs review: ${reason}`,
        dedupeKey: `allocation-review:${a.id}:${reason}`,
        actionUrl: `/rota/visits/${a.visitId}`,
      });
      flagged++;
    } else if (!reason && a.reviewReason) {
      await tx.visitAssignment.update({ where: { id: a.id }, data: { reviewReason: null, reviewFlaggedAt: null } });
      await tx.rotaAlert.updateMany({ where: { organisationId, assignmentId: a.id, kind: "ALLOCATION_REVIEW", resolvedAt: null }, data: { resolvedAt: now, resolution: `Resolved automatically: ${opts.source}` } });
      cleared++;
    }
  }
  return { flagged, cleared };
}

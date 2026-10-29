import type { RotaSettings } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dbDate, londonDate, londonTime } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { raiseAlert } from "@/server/workforce/impact";
import { effectiveClocks } from "./attendance";
import { rotaScope, visitWhere } from "./scope";
import { rotaSettings } from "./settings";

/**
 * Call monitoring. The sweep runs from the background job queue (every minute with the worker; on hosts without a
 * worker, when the queue is kicked) and on demand from the monitor screen. It is idempotent: alerts are keyed per
 * visit, and a visit is marked missed once. Only published visits are watched, and nobody is reassigned.
 */

const LOOKBACK_DAYS = 14;
/** Visits older than this are still marked missed, but without sending in-app notifications. */
const NOTIFY_WITHIN_MS = 24 * 3600000;

export async function sweepCalls(opts: { now?: Date; organisationId?: string } = {}) {
  const now = opts.now ?? new Date();
  const run = await db.rotaProcessingRun.create({ data: { kind: "call.sweep", organisationId: opts.organisationId ?? null } });
  let processed = 0;
  let alertsRaised = 0;
  try {
    const candidates = await db.visit.findMany({
      where: {
        ...(opts.organisationId ? { organisationId: opts.organisationId } : {}),
        publishedAt: { not: null },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledStart: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86400000), lte: now },
      },
      select: { id: true, organisationId: true, reference: true, status: true, scheduledStart: true, scheduledEnd: true, alertOnLate: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { scheduledStart: "asc" },
      take: 5000,
    });
    const settingsByOrg = new Map<string, RotaSettings>();
    for (const v of candidates) {
      let s = settingsByOrg.get(v.organisationId);
      if (!s) settingsByOrg.set(v.organisationId, (s = await rotaSettings(db, v.organisationId)));
      const who = `${v.serviceUser.preferredName ?? v.serviceUser.firstName} ${v.serviceUser.lastName}`;
      const lateMin = (now.getTime() - v.scheduledStart.getTime()) / 60000;
      const notify = now.getTime() - v.scheduledStart.getTime() < NOTIFY_WITHIN_MS;
      processed++;
      if (v.status === "SCHEDULED" && lateMin >= s.missedAfterMin) {
        const raised = await db.$transaction(async (tx) => {
          // Re-read under lock: a clock-in may have arrived since the list was read.
          const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Visit" WHERE id = ${v.id} FOR UPDATE`;
          if (rows[0]?.status !== "SCHEDULED") return false;
          await tx.visit.update({ where: { id: v.id }, data: { status: "MISSED", statusChangedAt: now, lockVersion: { increment: 1 } } });
          await tx.visitEvent.create({ data: { organisationId: v.organisationId, visitId: v.id, type: "STATUS", fromStatus: "SCHEDULED", toStatus: "MISSED", data: { source: "call.sweep", minutesAfterStart: Math.round(lateMin) } } });
          if (!v.alertOnLate) return false;
          const r = await raiseAlert(tx, { organisationId: v.organisationId, kind: "MISSED", severity: "CRITICAL", visitId: v.id, message: `Missed call: ${who} at ${londonTime(v.scheduledStart)} (${v.reference}). No one has clocked in.`, dedupeKey: `missed:${v.id}`, conditionAt: new Date(v.scheduledStart.getTime() + s.missedAfterMin * 60000), actionUrl: "/rota/monitor", notify });
          return r.created;
        });
        if (raised) alertsRaised++;
      } else if (v.status === "SCHEDULED" && lateMin >= s.lateAfterMin && v.alertOnLate) {
        const r = await raiseAlert(db, { organisationId: v.organisationId, kind: "LATE", visitId: v.id, message: `Late call: ${who} at ${londonTime(v.scheduledStart)} (${v.reference}) has not started.`, dedupeKey: `late:${v.id}`, conditionAt: new Date(v.scheduledStart.getTime() + s.lateAfterMin * 60000), actionUrl: "/rota/monitor", notify });
        if (r.created) alertsRaised++;
      } else if (v.status === "IN_PROGRESS" && now.getTime() >= v.scheduledEnd.getTime() + s.missedAfterMin * 60000 && v.alertOnLate) {
        const r = await raiseAlert(db, { organisationId: v.organisationId, kind: "OVERRUN", visitId: v.id, message: `Not clocked out: ${who} (${v.reference}) was due to finish at ${londonTime(v.scheduledEnd)}.`, dedupeKey: `overrun:${v.id}`, conditionAt: new Date(v.scheduledEnd.getTime() + s.missedAfterMin * 60000), actionUrl: "/rota/monitor", notify });
        if (r.created) alertsRaised++;
      }
    }
    await db.rotaProcessingRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, processed, alertsRaised } });
    return { processed, alertsRaised };
  } catch (e) {
    logger.error({ err: (e as Error).message }, "call sweep failed");
    await db.rotaProcessingRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, processed, alertsRaised, error: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}

/** The coordinator's "check now": the same sweep, limited to their organisation. */
export async function sweepNow(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.monitor");
  return sweepCalls({ organisationId: scope.organisationId });
}

export type MonitorState = "missed" | "late" | "overrun" | "not_delivered" | "on_visit" | "due" | "later" | "done";

/** Everything the monitor shows for one day, worked out from the visits and the clocks in force. */
export async function monitorBoard(ctx: Ctx, opts: { areaId?: string; now?: Date } = {}) {
  const scope = await rotaScope(ctx, "rota.monitor");
  const now = opts.now ?? new Date();
  const today = londonDate(now);
  const settings = await rotaSettings(db, scope.organisationId);
  const [visits, lastRun, alerts] = await Promise.all([
    db.visit.findMany({
      where: { ...visitWhere(scope), date: dbDate(today), status: { not: "CANCELLED" }, ...(opts.areaId ? { areaId: opts.areaId } : {}) },
      include: {
        serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, postcode: true, phone: true } },
        callType: { select: { name: true } },
        area: { select: { id: true, name: true, colour: true } },
        assignments: { where: { removedAt: null }, select: { id: true, slot: true, staffId: true, acknowledgedAt: true, staff: { select: { id: true, displayName: true, workPhone: true } } }, orderBy: { slot: "asc" } },
        clocks: { orderBy: { at: "asc" } },
      },
      orderBy: { scheduledStart: "asc" },
    }),
    db.rotaProcessingRun.findFirst({ where: { kind: "call.sweep", ok: true, OR: [{ organisationId: scope.organisationId }, { organisationId: null }] }, orderBy: { startedAt: "desc" } }),
    db.rotaAlert.findMany({ where: { organisationId: scope.organisationId, kind: { in: ["LATE", "MISSED"] }, raisedAt: { gte: new Date(now.getTime() - 86400000) }, conditionAt: { not: null } }, select: { raisedAt: true, conditionAt: true } }),
  ]);

  const rows = visits.map((v) => {
    const clocks = effectiveClocks(v.clocks);
    const start = v.scheduledStart.getTime();
    const end = v.scheduledEnd.getTime();
    const t = now.getTime();
    let state: MonitorState;
    if (v.status === "MISSED") state = "missed";
    else if (v.status === "NOT_DELIVERED") state = "not_delivered";
    else if (v.status === "COMPLETED") state = "done";
    else if (v.status === "IN_PROGRESS") state = t >= end + settings.missedAfterMin * 60000 ? "overrun" : "on_visit";
    else if (t >= start + settings.lateAfterMin * 60000) state = "late";
    else if (t >= start - 60 * 60000) state = "due";
    else state = "later";
    const arrivedLateMin = v.actualStart ? Math.round((v.actualStart.getTime() - start) / 60000) : null;
    const durationPct = v.actualStart && v.actualEnd ? Math.round(((v.actualEnd.getTime() - v.actualStart.getTime()) / (end - start)) * 100) : null;
    return { ...v, clocks, state, arrivedLateMin, durationPct, minutesLate: Math.max(0, Math.round((t - start) / 60000)) };
  });

  const latencies = alerts.map((a) => (a.raisedAt.getTime() - (a.conditionAt as Date).getTime()) / 1000).filter((x) => x >= 0).sort((a, b) => a - b);
  const medianLatencySec = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  return { today, now, settings, rows, lastRun, medianLatencySec, alertCount: latencies.length };
}

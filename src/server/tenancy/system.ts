import { db } from "@/lib/db";
import { runSystemScope } from "./scope";

/**
 * The audited way round row-level security: work that must see every organisation.
 *
 * Each call is recorded in the audit log as `rls.bypass` with its reason and who (if anyone) asked for it. Machine
 * paths that repeat all day (the worker's tick, the job kick, cron) pass `audit: "hourly"`: one entry per reason per
 * hour per server process, carrying how many times the path ran, so the audit log shows the bypass was in use
 * without thousands of identical rows.
 *
 * Every call site is listed in docs/SECURITY.md. Adding one is a security decision: review it as such.
 */
export interface SystemScopeOptions {
  /** The signed-in person the work is done for, when there is one (Platform Admin pages). */
  actorId?: string | null;
  audit?: "each" | "hourly";
}

const hourly = new Map<string, { hour: number; count: number }>();

async function record(reason: string, opts: SystemScopeOptions, uses: number) {
  await db.auditLog.create({
    data: { organisationId: null, actorId: opts.actorId ?? null, action: "rls.bypass", entityType: "System", entityId: reason.slice(0, 190), data: { reason, uses } },
  });
}

export async function withSystemScope<T>(reason: string, fn: () => Promise<T> | T, opts: SystemScopeOptions = {}): Promise<T> {
  return runSystemScope(reason, async () => {
    const mode = opts.audit ?? "each";
    if (mode === "hourly") {
      const hour = Math.floor(Date.now() / 3_600_000);
      const seen = hourly.get(reason);
      if (!seen || seen.hour !== hour) {
        hourly.set(reason, { hour, count: 1 });
        await record(reason, opts, seen?.count ?? 1);
      } else seen.count += 1;
    } else {
      await record(reason, opts, 1);
    }
    return fn();
  });
}

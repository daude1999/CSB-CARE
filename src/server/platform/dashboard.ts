import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import { requirePlatform } from "./access";
import { recentActivity } from "./activity";
import { ensureCustomerAccounts } from "./customers";
import { databaseCheck, jobStats } from "./health";
import { recurringRevenue } from "./subscriptions";
import { aiUsage, storageByOrg } from "./usage";

/** The Admin Centre dashboard. Every figure is counted from records; nothing is estimated unless it says so. */
export async function platformDashboard(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  await ensureCustomerAccounts();
  const [byStatus, users, revenue, ai, storage, jobs, dbc, support, activity] = await Promise.all([
    db.customerAccount.groupBy({ by: ["status"], _count: { _all: true } }),
    db.user.count({ where: { deactivatedAt: null, memberships: { some: { deactivatedAt: null } } } }),
    recurringRevenue(),
    aiUsage(ctx),
    storageByOrg(),
    jobStats(),
    databaseCheck(),
    db.supportAccessGrant.groupBy({ by: ["status"], where: { OR: [{ status: "REQUESTED" }, { status: "ACTIVE", expiresAt: { gt: new Date() } }] }, _count: { _all: true } }),
    recentActivity(ctx, 12),
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const storageBytes = [...storage.values()].reduce((a, b) => a + b.bytes, 0);
  const files = [...storage.values()].reduce((a, b) => a + b.files, 0);
  const health = !dbc.ok ? "Down" : jobs.dead > 0 || jobs.failed24h > 0 ? "Degraded" : "Healthy";
  return {
    clients: { total: byStatus.reduce((a, b) => a + b._count._all, 0), active: count("ACTIVE"), trial: count("TRIAL"), suspended: count("SUSPENDED"), closed: count("CLOSED") },
    users,
    revenue,
    ai,
    storage: { bytes: storageBytes, files },
    jobs,
    health,
    support: { requested: support.find((s) => s.status === "REQUESTED")?._count._all ?? 0, active: support.find((s) => s.status === "ACTIVE")?._count._all ?? 0 },
    activity,
  };
}

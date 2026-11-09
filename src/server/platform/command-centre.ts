import { db } from "@/lib/db";
import { aiProviderProblem } from "@/server/ai";
import type { Ctx } from "@/server/auth/rbac";
import { emailProvider } from "@/server/notifications/email";
import { requirePlatform } from "./access";
import { billingStatus } from "./billing";
import { ensureCustomerAccounts } from "./customers";
import { databaseCheck, jobStats } from "./health";
import { getSetting, lastRestoreTest } from "./settings";

/**
 * The Admin Centre's command centre: what needs attention, how the platform is trending, how each client is doing and
 * how far platform setup has got. Everything is counted from records. Nothing reads care content: clients are measured
 * by sign-ins, accounts, storage and AI requests only.
 */

const DAY = 86_400_000;

export type Severity = "critical" | "warning" | "info";
/** Overall platform state, with the reasons behind it so "Degraded" is never shown without an explanation. */
export async function platformStatus() {
  const [dbc, jobs] = await Promise.all([databaseCheck(), jobStats()]);
  const reasons: string[] = [];
  if (!dbc.ok) reasons.push("The database is not responding");
  if (jobs.dead > 0) reasons.push(`${jobs.dead} background job${jobs.dead === 1 ? " has" : "s have"} given up after every retry`);
  if (jobs.failed24h > 0) reasons.push(`${jobs.failed24h} background job${jobs.failed24h === 1 ? "" : "s"} failed in the last 24 hours`);
  if (jobs.oldestQueuedMinutes !== null && jobs.oldestQueuedMinutes > 30) reasons.push(`The oldest waiting job has waited ${jobs.oldestQueuedMinutes} minutes`);
  const state: "Healthy" | "Degraded" | "Down" = !dbc.ok ? "Down" : reasons.length ? "Degraded" : "Healthy";
  return { state, reasons, latencyMs: dbc.latencyMs, jobs };
}

/** One value per day for the last `days` days (oldest first), from a SQL query returning day + n. */
function fillDays(rows: { day: Date | string; n: bigint | number }[], days: number) {
  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.n)]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY).toISOString().slice(0, 10);
    out.push({ day: d, value: byDay.get(d) ?? 0 });
  }
  return out;
}

type DayRow = { day: Date; n: bigint };

/** Daily trends for the last 30 days: sign-ins, failed sign-ins, AI requests and new accounts. */
export async function platformTrends(ctx: Ctx, days = 30) {
  requirePlatform(ctx, "platform.view");
  const since = new Date(Date.now() - (days - 1) * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const [logins, failed, ai, users, activeNow] = await Promise.all([
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM "AuditLog" WHERE "action" = 'auth.login' AND "createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM "LoginAttempt" WHERE "success" = false AND "key" NOT LIKE 'ip:%' AND "createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM "AiUsageEvent" WHERE "createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM "User" WHERE "createdAt" >= ${since} GROUP BY 1`,
    db.session.groupBy({ by: ["userId"], where: { lastSeenAt: { gte: new Date(Date.now() - 15 * 60_000) }, expiresAt: { gt: new Date() } } }),
  ]);
  const series = (rows: DayRow[]) => {
    const points = fillDays(rows, days);
    const total = points.reduce((a, p) => a + p.value, 0);
    const half = Math.floor(days / 2);
    const recent = points.slice(half).reduce((a, p) => a + p.value, 0);
    const earlier = points.slice(0, half).reduce((a, p) => a + p.value, 0);
    return { points, total, recent, earlier };
  };
  return { days, signIns: series(logins), failedSignIns: series(failed), aiRequests: series(ai), newAccounts: series(users), activeNow: activeNow.length };
}

/** Audit actions that count as significant security events on the dashboard. */
export const SECURITY_EVENT_ACTIONS = [
  "platform.account.deactivated", "platform.roles.changed", "platform.support.emergency", "platform.customer.suspended", "platform.customer.closed",
  "platform.member.reset_link.blocked", "admin.member.reset_link.blocked", "platform.sessions.revoked", "platform.password.reset_required", "platform.module.disabled",
];

export interface OperationRow {
  key: string;
  label: string;
  count: number;
  severity: Severity;
  detail: string;
  href: string;
}

/**
 * The dashboard's operational overview: one row per kind of exception, with its count and where it is dealt with.
 * Rows with something in them come first; the rest stay visible as "none" so the list reads the same every day.
 */
export async function operationsOverview(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const now = Date.now();
  const week = new Date(now - 7 * DAY);
  const day = new Date(now - DAY);
  const [status, aiFailed, intakeJobsFailed, supportWaiting, trials, noSub, unpriced, securityEvents, failedSignIns] = await Promise.all([
    platformStatus(),
    db.aiUsageEvent.count({ where: { success: false, createdAt: { gte: week } } }),
    db.backgroundJob.count({ where: { status: { in: ["FAILED", "DEAD"] }, type: { contains: "intake" }, updatedAt: { gte: week } } }),
    db.supportAccessGrant.count({ where: { status: "REQUESTED" } }),
    db.customerSubscription.count({ where: { isCurrent: true, status: "TRIAL", trialEndsAt: { lte: new Date(now + 14 * DAY) } } }),
    db.organisation.count({ where: { subscriptions: { none: { isCurrent: true } }, OR: [{ customerAccount: null }, { customerAccount: { status: { not: "CLOSED" } } }] } }),
    db.customerSubscription.count({ where: { isCurrent: true, status: "ACTIVE", plan: { monthlyPricePence: null, annualPricePence: null } } }),
    db.auditLog.count({ where: { action: { in: SECURITY_EVENT_ACTIONS }, createdAt: { gte: week } } }),
    db.loginAttempt.count({ where: { success: false, key: { not: { startsWith: "ip:" } }, createdAt: { gte: day } } }),
  ]);
  const jobs = status.jobs;
  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const rows: OperationRow[] = [
    { key: "jobs", label: "Failed background jobs", count: jobs.failed24h + jobs.dead, severity: jobs.dead ? "critical" : "warning", detail: jobs.failed24h + jobs.dead ? `${jobs.failed24h} failed in the last 24 hours · ${jobs.dead} given up after every retry` : "None failed in the last 24 hours", href: "/platform-admin/jobs" },
    { key: "ai", label: "Failed AI processing", count: aiFailed + intakeJobsFailed, severity: "warning", detail: aiFailed + intakeJobsFailed ? `${plural(aiFailed, "AI request")} and ${plural(intakeJobsFailed, "document job")} failed in 7 days` : "No failures in the last 7 days", href: "/platform-admin/ai" },
    { key: "support", label: "Pending support requests", count: supportWaiting, severity: "warning", detail: supportWaiting ? "Waiting for the client to approve or decline" : "No requests waiting", href: "/platform-admin/support" },
    { key: "trials", label: "Trial expirations", count: trials, severity: "warning", detail: trials ? `${plural(trials, "trial")} end within 14 days` : "No trial ends in the next 14 days", href: "/platform-admin/renewals" },
    { key: "subscriptions", label: "Subscription issues", count: noSub + unpriced, severity: "info", detail: noSub + unpriced ? [noSub ? `${plural(noSub, "client")} without a subscription` : null, unpriced ? `${plural(unpriced, "active subscription")} on an unpriced plan` : null].filter(Boolean).join(" · ") : "Every client has a priced subscription", href: noSub ? "/platform-admin/clients?plan=none" : "/platform-admin/subscriptions" },
    { key: "security", label: "Security events", count: securityEvents + (failedSignIns >= 10 ? 1 : 0), severity: "info", detail: `${plural(securityEvents, "significant change")} in 7 days · ${plural(failedSignIns, "failed sign-in")} in 24 hours`, href: "/platform-admin/security" },
  ];
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  rows.sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || order[a.severity] - order[b.severity]);
  return { status, rows, issues: rows.filter((r) => r.count > 0 && r.severity !== "info").length + (status.state === "Healthy" ? 0 : 1) };
}

export interface SetupStep {
  key: string;
  done: boolean;
  label: string;
  detail: string;
  href: string;
  /** Needs a developer or the hosting settings, not a platform administrator's click. */
  external?: boolean;
}

/** How far platform setup has got: the commercial and operational switches that make the Admin Centre complete. */
export async function setupChecklist(ctx: Ctx): Promise<SetupStep[]> {
  requirePlatform(ctx, "platform.view");
  const [plans, pricedPlans, orgs, orgsWithSub, inP, outP, supportEmail, restore, admins] = await Promise.all([
    db.subscriptionPlan.count({ where: { active: true } }),
    db.subscriptionPlan.count({ where: { active: true, OR: [{ monthlyPricePence: { not: null } }, { annualPricePence: { not: null } }] } }),
    db.organisation.count({ where: { OR: [{ customerAccount: null }, { customerAccount: { status: { not: "CLOSED" } } }] } }),
    db.organisation.count({ where: { subscriptions: { some: { isCurrent: true } }, OR: [{ customerAccount: null }, { customerAccount: { status: { not: "CLOSED" } } }] } }),
    getSetting("ai.inputPencePerMillionTokens"),
    getSetting("ai.outputPencePerMillionTokens"),
    getSetting("general.supportEmail"),
    lastRestoreTest(),
    db.user.count({ where: { platformRoles: { has: "PLATFORM_ADMIN" }, deactivatedAt: null } }),
  ]);
  return [
    { key: "plans", done: plans > 0, label: "Create your plans", detail: plans ? `${plans} active plan${plans === 1 ? "" : "s"}` : "No plans yet, so no client can be given a subscription", href: "/platform-admin/plans" },
    { key: "prices", done: pricedPlans > 0, label: "Set plan prices", detail: pricedPlans ? `${pricedPlans} of ${plans} plans priced` : "Revenue shows as \"prices not set\" until a plan has a price", href: "/platform-admin/plans" },
    { key: "subs", done: orgs > 0 && orgsWithSub === orgs, label: "Give every client a subscription", detail: `${orgsWithSub} of ${orgs} clients have one`, href: "/platform-admin/clients?plan=none" },
    { key: "support", done: !!supportEmail, label: "Add your support contact", detail: supportEmail ? supportEmail : "Customers see it when suspended and on password pages", href: "/platform-admin/settings?section=general" },
    { key: "aiprices", done: inP !== null && outP !== null, label: "Set AI token prices", detail: inP !== null && outP !== null ? "AI cost is estimated from measured tokens" : "AI cost shows as \"not metered\" until prices are set", href: "/platform-admin/settings?section=ai" },
    { key: "admins", done: admins >= 2, label: "Add a second platform administrator", detail: admins >= 2 ? `${admins} platform administrators` : "Only one person can run the Admin Centre today", href: "/platform-admin/administrators" },
    { key: "restore", done: restore?.outcome === "PASSED", label: "Record a backup restore test", detail: restore ? `Last test ${restore.outcome === "PASSED" ? "passed" : "failed"} on ${restore.testedOn.slice(0, 10)}` : "Health never reports backups as working until a test is recorded", href: "/platform-admin/storage" },
    { key: "email", done: emailProvider().name === "smtp", label: "Connect email", detail: emailProvider().name === "smtp" ? "Invitations and reset links are emailed" : "Needs SMTP settings in hosting. Until then links are handed over in person", href: "/platform-admin/health", external: true },
    { key: "ai", done: !aiProviderProblem(), label: "Connect the AI provider", detail: aiProviderProblem() ?? "Anthropic is configured", href: "/platform-admin/ai", external: true },
    { key: "billing", done: billingStatus().connected, label: "Connect a billing provider", detail: billingStatus().connected ? "Connected" : "Needs a developer once Evantix chooses a provider. Nothing is charged until then", href: "/platform-admin/billing", external: true },
  ];
}

export type SearchHit = { kind: "Client" | "Person" | "Plan"; id: string; title: string; detail: string; href: string };

/** Admin Centre search across clients (name, reference, company number), people (name, email) and plans. */
export async function platformSearch(ctx: Ctx, raw: string): Promise<SearchHit[]> {
  requirePlatform(ctx, "platform.view");
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  await ensureCustomerAccounts();
  const contains = { contains: q, mode: "insensitive" as const };
  const [clients, people, plans] = await Promise.all([
    db.organisation.findMany({
      where: { OR: [{ name: contains }, { customerAccount: { OR: [{ reference: contains }, { legalName: contains }, { tradingName: contains }, { companyNumber: contains }, { contactEmail: contains }] } }] },
      select: { id: true, name: true, customerAccount: { select: { reference: true, status: true } } },
      take: 10,
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { OR: [{ name: contains }, { email: contains }] },
      select: { id: true, name: true, email: true, deactivatedAt: true, platformRoles: true, memberships: { where: { deactivatedAt: null }, select: { organisation: { select: { name: true } } }, take: 2 } },
      take: 15,
      orderBy: { name: "asc" },
    }),
    db.subscriptionPlan.findMany({ where: { OR: [{ name: contains }, { code: contains }] }, select: { id: true, name: true, code: true, active: true }, take: 5 }),
  ]);
  return [
    ...clients.map((c) => ({ kind: "Client" as const, id: c.id, title: c.name, detail: [c.customerAccount?.reference, c.customerAccount?.status ? c.customerAccount.status.charAt(0) + c.customerAccount.status.slice(1).toLowerCase() : null].filter(Boolean).join(" · "), href: `/platform-admin/clients/${c.id}` })),
    ...people.map((p) => ({ kind: "Person" as const, id: p.id, title: p.name, detail: [p.email, p.platformRoles.length ? "Evantix staff" : p.memberships.map((m) => m.organisation.name).join(", "), p.deactivatedAt ? "Deactivated" : null].filter(Boolean).join(" · "), href: `/platform-admin/users/${p.id}` })),
    ...plans.map((p) => ({ kind: "Plan" as const, id: p.id, title: p.name, detail: `${p.code}${p.active ? "" : " · retired"}`, href: "/platform-admin/plans" })),
  ];
}

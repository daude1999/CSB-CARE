import type { BillingPeriod, CustomerStatus, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { MODULE_KEYS } from "@/lib/platform-modules";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { confirmOwnPassword, requireCustomerOrg, requirePlatform, requireReason } from "./access";
import { applyModuleSelection } from "./modules";
import { notifyPlatformAdmins } from "./alerts";

/**
 * Plans and client subscriptions (Admin Centre → Commercial). Plans are configured by Evantix; prices are optional and
 * never assumed. Each subscription change ends the current period row and starts a new one, so the full history of
 * plans, allowances, statuses and effective dates is kept. Suspension never deletes or exposes customer data.
 */

const DAY = 86400_000;

// ── Plans ────────────────────────────────────────────────────────────────

const optInt = z.number().int().min(0).max(100_000_000).nullable();
const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, "The plan code may use letters, numbers, hyphens and underscores"),
  name: z.string().trim().min(2, "Name the plan").max(60),
  description: z.string().trim().max(400).nullable(),
  monthlyPricePence: optInt,
  annualPricePence: optInt,
  includedUsers: optInt,
  includedBranches: optInt,
  storageMb: optInt,
  aiRequestsPerMonth: optInt,
  modules: z.array(z.enum(MODULE_KEYS)).min(1, "Choose at least one module"),
  supportLevel: z.string().trim().max(80).nullable(),
  addOns: z.array(z.string().trim().min(1).max(60)).max(20),
  active: z.boolean(),
});
export type PlanInput = z.input<typeof planSchema>;

export async function listPlans(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  requirePlatform(ctx, "platform.view");
  const plans = await db.subscriptionPlan.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { subscriptions: { where: { isCurrent: true } } } } } });
  return plans.map((p) => ({ ...p, currentClients: p._count.subscriptions }));
}

export async function savePlan(ctx: Ctx, id: string | null, input: PlanInput) {
  requirePlatform(ctx, "platform.commercial");
  const p = planSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the plan");
  const clash = await db.subscriptionPlan.findUnique({ where: { code: p.data.code } });
  if (clash && clash.id !== id) throw new ConflictError(`A plan with the code ${p.data.code} already exists`);
  return db.$transaction(async (tx) => {
    const before = id ? await tx.subscriptionPlan.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundError("Plan");
    const plan = id ? await tx.subscriptionPlan.update({ where: { id }, data: p.data }) : await tx.subscriptionPlan.create({ data: p.data });
    await audit({ actorId: ctx.userId, action: id ? "platform.plan.updated" : "platform.plan.created", entityType: "SubscriptionPlan", entityId: plan.id, data: { code: plan.code, before: before ? planSnapshot(before) : null, after: planSnapshot(plan) } }, tx);
    return plan;
  });
}

function planSnapshot(p: { name: string; monthlyPricePence: number | null; annualPricePence: number | null; includedUsers: number | null; includedBranches: number | null; storageMb: number | null; aiRequestsPerMonth: number | null; modules: string[]; active: boolean }) {
  return { name: p.name, monthlyPricePence: p.monthlyPricePence, annualPricePence: p.annualPricePence, includedUsers: p.includedUsers, includedBranches: p.includedBranches, storageMb: p.storageMb, aiRequestsPerMonth: p.aiRequestsPerMonth, modules: p.modules, active: p.active };
}

// ── Subscriptions ────────────────────────────────────────────────────────

export const subscriptionSchema = z.object({
  planId: z.string().min(1, "Choose a plan"),
  status: z.enum(["TRIAL", "ACTIVE"]),
  billingPeriod: z.enum(["MONTHLY", "ANNUAL"]),
  trialEndsAt: z.coerce.date().nullable(),
  renewsAt: z.coerce.date().nullable(),
  userAllowance: optInt,
  branchAllowance: optInt,
  storageMb: optInt,
  aiRequestsPerMonth: optInt,
  /** Also switch modules to match the plan. */
  applyPlanModules: z.boolean().default(false),
});
export type SubscriptionInput = z.input<typeof subscriptionSchema>;

export async function currentSubscription(organisationId: string) {
  return db.customerSubscription.findFirst({ where: { organisationId, isCurrent: true }, include: { plan: true } });
}

/**
 * Ends the current subscription row (if any) and starts a new one. Used by onboarding and every later change.
 * Allowances left empty fall back to the plan's.
 */
export async function startSubscriptionPeriod(
  tx: Tx,
  organisationId: string,
  actorId: string,
  next: { planId: string; status: SubscriptionStatus; billingPeriod: BillingPeriod; trialEndsAt: Date | null; renewsAt: Date | null; userAllowance: number | null; branchAllowance: number | null; storageMb: number | null; aiRequestsPerMonth: number | null; changeReason: string | null },
) {
  const plan = await tx.subscriptionPlan.findUnique({ where: { id: next.planId } });
  if (!plan) throw new NotFoundError("Plan");
  const before = await tx.customerSubscription.findFirst({ where: { organisationId, isCurrent: true }, include: { plan: { select: { code: true } } } });
  if (before) await tx.customerSubscription.update({ where: { id: before.id }, data: { isCurrent: false, endedAt: new Date() } });
  const row = await tx.customerSubscription.create({
    data: {
      organisationId,
      planId: plan.id,
      status: next.status,
      billingPeriod: next.billingPeriod,
      trialEndsAt: next.status === "TRIAL" ? next.trialEndsAt : null,
      renewsAt: next.renewsAt,
      userAllowance: next.userAllowance ?? plan.includedUsers,
      branchAllowance: next.branchAllowance ?? plan.includedBranches,
      storageMb: next.storageMb ?? plan.storageMb,
      aiRequestsPerMonth: next.aiRequestsPerMonth ?? plan.aiRequestsPerMonth,
      changeReason: next.changeReason,
      createdById: actorId,
    },
  });
  return { before, row, plan };
}

const subSnapshot = (s: { status: string; billingPeriod: string; trialEndsAt: Date | null; renewsAt: Date | null; userAllowance: number | null; branchAllowance: number | null; storageMb: number | null; aiRequestsPerMonth: number | null } & { plan?: { code: string } }) => ({
  plan: s.plan?.code ?? null,
  status: s.status,
  billingPeriod: s.billingPeriod,
  trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
  renewsAt: s.renewsAt?.toISOString() ?? null,
  userAllowance: s.userAllowance,
  branchAllowance: s.branchAllowance,
  storageMb: s.storageMb,
  aiRequestsPerMonth: s.aiRequestsPerMonth,
});

function checkDates(d: { status: "TRIAL" | "ACTIVE"; trialEndsAt: Date | null; renewsAt: Date | null }) {
  if (d.status === "TRIAL" && !d.trialEndsAt) throw new ValidationError("Give the date the trial ends");
  if (d.trialEndsAt && d.trialEndsAt.getTime() < Date.now() - DAY) throw new ValidationError("The trial end date is in the past");
  if (d.renewsAt && d.renewsAt.getTime() < Date.now() - DAY) throw new ValidationError("The renewal date is in the past");
}

/** Starts a trial, activates a plan or changes plan, period, dates or allowances for a client. */
export async function changeSubscription(ctx: Ctx, organisationId: string, input: SubscriptionInput, reasonRaw: string) {
  requirePlatform(ctx, "platform.commercial");
  await requireCustomerOrg(organisationId);
  const p = subscriptionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the subscription");
  checkDates(p.data);
  const reason = requireReason(reasonRaw, "this subscription change");
  const account = await db.customerAccount.findUnique({ where: { organisationId } });
  if (account?.status === "CLOSED") throw new ConflictError("This client is closed. Reopen it before changing its subscription.");
  if (account?.status === "SUSPENDED") throw new ConflictError("This client is suspended. Reinstate it before changing its subscription.");
  return db.$transaction(async (tx) => {
    const { before, row, plan } = await startSubscriptionPeriod(tx, organisationId, ctx.userId, { ...p.data, changeReason: reason });
    await tx.customerAccount.updateMany({ where: { organisationId }, data: { status: p.data.status as CustomerStatus, statusChangedAt: new Date() } });
    if (p.data.applyPlanModules) await applyModuleSelection(tx, organisationId, plan.modules, ctx.userId);
    await audit({ organisationId, actorId: ctx.userId, action: before ? "platform.subscription.changed" : "platform.subscription.started", entityType: "CustomerSubscription", entityId: row.id, data: { reason, before: before ? subSnapshot(before) : null, after: subSnapshot({ ...row, plan: { code: plan.code } }), modulesFromPlan: p.data.applyPlanModules } }, tx);
    return row;
  });
}

/** Moves a trial's end date. */
export async function extendTrial(ctx: Ctx, organisationId: string, newEnd: string, reasonRaw: string) {
  requirePlatform(ctx, "platform.commercial");
  await requireCustomerOrg(organisationId);
  const reason = requireReason(reasonRaw, "extending the trial");
  const sub = await currentSubscription(organisationId);
  if (!sub || sub.status !== "TRIAL") throw new ConflictError("This client is not on a trial");
  const end = new Date(newEnd);
  if (Number.isNaN(end.getTime()) || end.getTime() < Date.now()) throw new ValidationError("Give a future trial end date");
  return db.$transaction(async (tx) => {
    const { row } = await startSubscriptionPeriod(tx, organisationId, ctx.userId, { planId: sub.planId, status: "TRIAL", billingPeriod: sub.billingPeriod, trialEndsAt: end, renewsAt: sub.renewsAt, userAllowance: sub.userAllowance, branchAllowance: sub.branchAllowance, storageMb: sub.storageMb, aiRequestsPerMonth: sub.aiRequestsPerMonth, changeReason: reason });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.subscription.trial_extended", entityType: "CustomerSubscription", entityId: row.id, data: { reason, before: sub.trialEndsAt?.toISOString() ?? null, after: end.toISOString() } }, tx);
  });
}

/**
 * Suspends, reinstates, closes or reopens a client. Suspending or closing needs the administrator's own password and a
 * reason; the customer's staff then see a "suspended" page and get no permissions, but nothing is deleted.
 */
export async function setCustomerStatus(ctx: Ctx, organisationId: string, action: "suspend" | "reinstate" | "close" | "reopen", reasonRaw: string, password?: string) {
  requirePlatform(ctx, "platform.customers");
  const org = await requireCustomerOrg(organisationId);
  const reason = requireReason(reasonRaw, `this ${action === "reinstate" || action === "reopen" ? "reinstatement" : action === "close" ? "closure" : "suspension"}`);
  const account = await ensureAccount(organisationId);
  if (action === "suspend" || action === "close") await confirmOwnPassword(ctx, password);
  const from = account.status;
  const sub = await currentSubscription(organisationId);
  let to: CustomerStatus;
  if (action === "suspend") {
    if (from === "SUSPENDED" || from === "CLOSED") throw new ConflictError(`This client is already ${from.toLowerCase()}`);
    to = "SUSPENDED";
  } else if (action === "close") {
    if (from === "CLOSED") throw new ConflictError("This client is already closed");
    to = "CLOSED";
  } else {
    if (action === "reinstate" && from !== "SUSPENDED") throw new ConflictError("Only a suspended client can be reinstated");
    if (action === "reopen" && from !== "CLOSED") throw new ConflictError("Only a closed client can be reopened");
    to = sub?.status === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt > new Date() ? "TRIAL" : "ACTIVE";
  }
  await db.$transaction(async (tx) => {
    await tx.customerAccount.update({ where: { organisationId }, data: { status: to, statusReason: reason, statusChangedAt: new Date() } });
    if (sub) {
      const subStatus: SubscriptionStatus = to === "SUSPENDED" ? "SUSPENDED" : to === "CLOSED" ? "CANCELLED" : to === "TRIAL" ? "TRIAL" : "ACTIVE";
      if (subStatus !== sub.status) await startSubscriptionPeriod(tx, organisationId, ctx.userId, { planId: sub.planId, status: subStatus, billingPeriod: sub.billingPeriod, trialEndsAt: sub.trialEndsAt, renewsAt: sub.renewsAt, userAllowance: sub.userAllowance, branchAllowance: sub.branchAllowance, storageMb: sub.storageMb, aiRequestsPerMonth: sub.aiRequestsPerMonth, changeReason: reason });
    }
    await audit({ organisationId, actorId: ctx.userId, action: `platform.customer.${action === "suspend" ? "suspended" : action === "reinstate" ? "reinstated" : action === "close" ? "closed" : "reopened"}`, entityType: "Organisation", entityId: organisationId, data: { reason, before: from, after: to } }, tx);
  });
  if (action === "suspend" || action === "close") await notifyPlatformAdmins(ctx, `Client ${action === "suspend" ? "suspended" : "closed"}: ${org.name}`, `${ctx.userName} ${action === "suspend" ? "suspended" : "closed"} ${org.name}. Reason: ${reason}`, `/platform-admin/clients/${organisationId}`);
  return to;
}

/** The customer account row, created on first use for an organisation that predates the Admin Centre. */
export async function ensureAccount(organisationId: string) {
  const existing = await db.customerAccount.findUnique({ where: { organisationId } });
  if (existing) return existing;
  const { ensureCustomerAccounts } = await import("./customers");
  await ensureCustomerAccounts();
  return db.customerAccount.findUniqueOrThrow({ where: { organisationId } });
}

export async function subscriptionHistory(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.view");
  await requireCustomerOrg(organisationId);
  return db.customerSubscription.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, include: { plan: { select: { name: true, code: true } } } });
}

/** Monthly recurring revenue from active, priced subscriptions. Null when no active subscription has a price. */
export async function recurringRevenue() {
  const subs = await db.customerSubscription.findMany({ where: { isCurrent: true, status: "ACTIVE" }, include: { plan: true } });
  let pence = 0;
  let priced = 0;
  for (const s of subs) {
    const monthly = s.billingPeriod === "ANNUAL" ? (s.plan.annualPricePence !== null ? s.plan.annualPricePence / 12 : null) : s.plan.monthlyPricePence;
    if (monthly === null) continue;
    pence += monthly;
    priced++;
  }
  return { mrrPence: priced ? Math.round(pence) : null, active: subs.length, priced, unpriced: subs.length - priced };
}

/** Trials ending and renewals due, for Trials & Renewals. */
export async function trialsAndRenewals(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const now = Date.now();
  const subs = await db.customerSubscription.findMany({
    where: { isCurrent: true, OR: [{ status: "TRIAL" }, { renewsAt: { lte: new Date(now + 90 * DAY) } }] },
    include: { plan: { select: { name: true } }, organisation: { select: { id: true, name: true, customerAccount: { select: { reference: true, status: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const trials = subs.filter((s) => s.status === "TRIAL").map((s) => ({ ...s, daysLeft: s.trialEndsAt ? Math.ceil((s.trialEndsAt.getTime() - now) / DAY) : null })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  const renewals = subs.filter((s) => s.status !== "TRIAL" && s.renewsAt).map((s) => ({ ...s, daysLeft: Math.ceil((s.renewsAt!.getTime() - now) / DAY) })).sort((a, b) => a.daysLeft - b.daysLeft);
  return { trials, renewals };
}

/** Subscription records across all clients (Subscriptions page). */
export async function allSubscriptions(ctx: Ctx, f: { status?: string } = {}) {
  requirePlatform(ctx, "platform.view");
  const status = ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"].includes(f.status ?? "") ? (f.status as SubscriptionStatus) : undefined;
  return db.customerSubscription.findMany({
    where: { isCurrent: true, ...(status ? { status } : {}) },
    include: { plan: { select: { name: true, code: true, monthlyPricePence: true, annualPricePence: true } }, organisation: { select: { id: true, name: true, customerAccount: { select: { reference: true } } } } },
    orderBy: { organisation: { name: "asc" } },
  });
}

/** Internal subscription change records across clients (Billing & Invoices: history, not invoices). */
export async function subscriptionChanges(ctx: Ctx, take = 50) {
  requirePlatform(ctx, "platform.view");
  return db.customerSubscription.findMany({ orderBy: { createdAt: "desc" }, take, include: { plan: { select: { name: true } }, organisation: { select: { id: true, name: true } } } });
}

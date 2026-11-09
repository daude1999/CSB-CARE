import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { MODULES, MODULE_KEYS, isModuleKey, moduleInfo, type ModuleKey } from "@/lib/platform-modules";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { requireCustomerOrg, requirePlatform, requireReason } from "./access";

/**
 * Tenant module entitlements (Admin Centre → Modules & Features and each client's Modules tab). Enforcement is in
 * hasOrgPermission (src/server/auth/rbac.ts): a switched-off module's permissions are not granted on the server, so
 * hidden menus are never the only protection. Switching off deletes nothing.
 */
export type ModuleLimits = Partial<Record<"monthlyRequests" | "monthlySpendPence", number>>;
const limitsSchema = z.object({ monthlyRequests: z.number().int().min(1).max(10_000_000).optional(), monthlySpendPence: z.number().int().min(1).max(100_000_000).optional() });

export function parseLimits(v: unknown): ModuleLimits {
  const p = limitsSchema.safeParse(v ?? {});
  return p.success ? p.data : {};
}

export async function entitlementsFor(organisationId: string) {
  const rows = await db.tenantModuleEntitlement.findMany({ where: { organisationId } });
  const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
  return MODULES.map((m) => {
    const r = byKey.get(m.key);
    return { ...m, enabled: r ? r.enabled : true, explicit: Boolean(r), limits: parseLimits(r?.limits), updatedAt: r?.updatedAt ?? null, updatedById: r?.updatedById ?? null };
  });
}

export async function listClientModules(ctx: Ctx, organisationId: string) {
  requirePlatform(ctx, "platform.view");
  await requireCustomerOrg(organisationId);
  return entitlementsFor(organisationId);
}

/** Sets every module on or off in one go (onboarding and plan changes). Audited once by the caller. */
export async function applyModuleSelection(tx: Tx, organisationId: string, enabled: readonly string[], actorId: string) {
  for (const key of MODULE_KEYS) {
    const on = enabled.includes(key);
    await tx.tenantModuleEntitlement.upsert({
      where: { organisationId_moduleKey: { organisationId, moduleKey: key } },
      create: { organisationId, moduleKey: key, enabled: on, updatedById: actorId },
      update: { enabled: on, updatedById: actorId },
    });
  }
}

/**
 * Switches one module on or off for a client. Switching off a module that day-to-day care depends on needs the
 * client's name typed exactly, and every change needs a reason. The audit entry keeps before and after.
 */
export async function setClientModule(ctx: Ctx, organisationId: string, key: string, input: { enabled: boolean; reason?: string; confirmName?: string }) {
  requirePlatform(ctx, "platform.commercial");
  const org = await requireCustomerOrg(organisationId);
  if (!isModuleKey(key)) throw new NotFoundError("Module");
  const info = moduleInfo(key)!;
  const reason = requireReason(input.reason, input.enabled ? "switching this module on" : "switching this module off");
  const current = await db.tenantModuleEntitlement.findUnique({ where: { organisationId_moduleKey: { organisationId, moduleKey: key } } });
  const wasOn = current ? current.enabled : true;
  if (wasOn === input.enabled) throw new ConflictError(`${info.name} is already ${input.enabled ? "on" : "off"} for this client`);
  if (!input.enabled && info.critical && (input.confirmName ?? "").trim().toLowerCase() !== org.name.trim().toLowerCase())
    throw new ValidationError(`${info.name} is used for day-to-day care. Type the client's name exactly to confirm switching it off.`);
  await db.$transaction(async (tx) => {
    await tx.tenantModuleEntitlement.upsert({
      where: { organisationId_moduleKey: { organisationId, moduleKey: key } },
      create: { organisationId, moduleKey: key, enabled: input.enabled, updatedById: ctx.userId },
      update: { enabled: input.enabled, updatedById: ctx.userId },
    });
    await audit({ organisationId, actorId: ctx.userId, action: input.enabled ? "platform.module.enabled" : "platform.module.disabled", entityType: "TenantModuleEntitlement", entityId: `${organisationId}:${key}`, data: { module: key, before: wasOn, after: input.enabled, reason } }, tx);
  });
}

/** Usage limits for a module (only modules that declare limits). An empty value removes that limit. */
export async function setClientModuleLimits(ctx: Ctx, organisationId: string, key: string, raw: Record<string, number | null>) {
  requirePlatform(ctx, "platform.commercial");
  await requireCustomerOrg(organisationId);
  if (!isModuleKey(key)) throw new NotFoundError("Module");
  const allowed = moduleInfo(key)!.limits?.map((l) => l.key) ?? [];
  if (!allowed.length) throw new ValidationError("This module has no usage limits");
  const next: Record<string, number> = {};
  for (const k of allowed) {
    const v = raw[k];
    if (v !== null && v !== undefined) next[k] = v;
  }
  const p = limitsSchema.safeParse(next);
  if (!p.success) throw new ValidationError("Limits must be whole numbers above zero");
  const current = await db.tenantModuleEntitlement.findUnique({ where: { organisationId_moduleKey: { organisationId, moduleKey: key } } });
  await db.$transaction(async (tx) => {
    await tx.tenantModuleEntitlement.upsert({
      where: { organisationId_moduleKey: { organisationId, moduleKey: key } },
      create: { organisationId, moduleKey: key, enabled: true, limits: p.data as Prisma.InputJsonValue, updatedById: ctx.userId },
      update: { limits: p.data as Prisma.InputJsonValue, updatedById: ctx.userId },
    });
    await audit({ organisationId, actorId: ctx.userId, action: "platform.module.limits", entityType: "TenantModuleEntitlement", entityId: `${organisationId}:${key}`, data: { module: key, before: parseLimits(current?.limits) as Prisma.InputJsonValue, after: p.data as Prisma.InputJsonValue } }, tx);
  });
}

/** Module catalogue with how many clients have each module on (Modules & Features). */
export async function moduleCatalogue(ctx: Ctx) {
  requirePlatform(ctx, "platform.view");
  const [orgs, off] = await Promise.all([
    db.organisation.count(),
    db.tenantModuleEntitlement.groupBy({ by: ["moduleKey"], where: { enabled: false }, _count: { _all: true } }),
  ]);
  const offBy = new Map(off.map((o) => [o.moduleKey, o._count._all]));
  return MODULES.map((m) => ({ ...m, clientsOn: orgs - (offBy.get(m.key) ?? 0), clientsOff: offBy.get(m.key) ?? 0 }));
}

export function moduleName(key: string) {
  return moduleInfo(key)?.name ?? key;
}
export type { ModuleKey };

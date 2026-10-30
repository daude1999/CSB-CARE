import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { isIsoDate, londonDayBounds } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";

/**
 * The organisation's audit log, read-only: every recorded action with who, what and when, filtered and paged, and a
 * CSV for an inspector. Only organisation admins see it, and only their own organisation's entries.
 */

export const PAGE_SIZE = 100;

export const auditFilters = z.object({
  actor: z.string().max(40).optional().catch(undefined),
  action: z.string().trim().max(80).optional().catch(undefined),
  entity: z.string().trim().max(60).optional().catch(undefined),
  from: z.string().refine(isIsoDate).optional().catch(undefined),
  to: z.string().refine(isIsoDate).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});
export type AuditFilters = z.infer<typeof auditFilters>;

function whereFor(organisationId: string, f: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    organisationId,
    ...(f.actor ? { actorId: f.actor } : {}),
    ...(f.action ? { action: { contains: f.action, mode: "insensitive" } } : {}),
    ...(f.entity ? { entityType: f.entity } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: londonDayBounds(f.from).start } : {}), ...(f.to ? { lt: londonDayBounds(f.to).end } : {}) } } : {}),
  };
}

export async function auditPage(ctx: Ctx, input: Record<string, string | undefined>) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const f = auditFilters.parse(input);
  const where = whereFor(organisationId, f);
  const [rows, total, entities, members] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where: { organisationId }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.membership.findMany({ where: { organisationId }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  return { f, rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), entities: entities.map((e) => e.entityType), members: members.map((m) => ({ id: m.userId, name: m.user.name })), names };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV of the filtered log, at most 20,000 rows. The export itself is audited. */
export async function auditCsv(ctx: Ctx, input: Record<string, string | undefined>) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const f = auditFilters.parse(input);
  const rows = await db.auditLog.findMany({ where: whereFor(organisationId, f), orderBy: { createdAt: "desc" }, take: 20_000 });
  const members = await db.membership.findMany({ where: { organisationId }, select: { userId: true, user: { select: { name: true } } } });
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  await audit({ organisationId, actorId: ctx.userId, action: "admin.audit.exported", entityType: "Organisation", entityId: organisationId, data: { rows: rows.length, filters: { ...f, page: undefined } } });
  const head = ["When (UTC)", "Who", "Action", "Record type", "Record id", "Details"];
  return [head.join(","), ...rows.map((r) => [r.createdAt.toISOString(), r.actorId ? names.get(r.actorId) ?? "Former member" : "System", r.action, r.entityType, r.entityId, r.data].map(cell).join(","))].join("\n");
}

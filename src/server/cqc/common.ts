import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { londonDate } from "@/lib/london";
import type { Ctx } from "../auth/rbac";

/** Records a branch-limited member may see: their branches' records and organisation-wide ones. */
export function branchScope(ctx: Ctx): { OR?: { branchId: { in: string[] } | null }[] } {
  return ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {};
}

/** A branch chosen on a form, checked to be the caller's own organisation's and inside their branch grants. */
export async function checkBranch(ctx: Ctx, organisationId: string, branchId: string | null | undefined): Promise<string | null> {
  if (!branchId) {
    if (ctx.branchIds) throw new ValidationError("Choose one of your branches");
    return null;
  }
  const b = await db.branch.findFirst({ where: { id: branchId, organisationId }, select: { id: true } });
  if (!b || (ctx.branchIds && !ctx.branchIds.includes(b.id))) throw new NotFoundError("Branch");
  return b.id;
}

/** Branches the caller may filter by, from the organisation's own records (never a hardcoded list). */
export async function visibleBranches(ctx: Ctx) {
  if (!ctx.organisationId) return [];
  return db.branch.findMany({ where: { organisationId: ctx.organisationId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, services: { select: { serviceTypeCode: true } } }, orderBy: { name: "asc" } });
}

/** Service types configured on the caller's branches. */
export async function visibleServiceTypes(ctx: Ctx) {
  const branches = await visibleBranches(ctx);
  const codes = [...new Set(branches.flatMap((b) => b.services.map((s) => s.serviceTypeCode)))];
  if (!codes.length) return [];
  return db.serviceType.findMany({ where: { code: { in: codes } }, select: { code: true, name: true }, orderBy: { name: "asc" } });
}

/** The next yearly reference for a prefix, e.g. RCA-2026-0001. Uniqueness is also enforced by the database. */
export async function nextReference(tx: Tx, prefix: "RCA" | "CQC", organisationId: string) {
  const stem = `${prefix}-${londonDate().slice(0, 4)}-`;
  const where = { organisationId, reference: { startsWith: stem } };
  const last = prefix === "RCA"
    ? await tx.rcaInvestigation.findFirst({ where, orderBy: { reference: "desc" }, select: { reference: true } })
    : await tx.cqcAssessment.findFirst({ where, orderBy: { reference: "desc" }, select: { reference: true } });
  const n = last ? Number(last.reference.slice(stem.length)) + 1 : 1;
  return `${stem}${String(n).padStart(4, "0")}`;
}

export const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === "P2002";

/** Members of the organisation who hold any of the roles, for choosing owners and for notifications. */
export async function membersWithRoles(organisationId: string, roles: string[]) {
  const ms = await db.membership.findMany({ where: { organisationId, deactivatedAt: null, roles: { hasSome: roles as never } }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  return ms.map((m) => ({ id: m.userId, name: m.user.name }));
}

export async function assertMember(organisationId: string, userId: string, what: string) {
  const m = await db.membership.findUnique({ where: { userId_organisationId: { userId, organisationId } }, select: { deactivatedAt: true } });
  if (!m || m.deactivatedAt) throw new ValidationError(`${what} must be an active member of your organisation`);
}

export function startOfToday() {
  return new Date(`${londonDate()}T00:00:00Z`);
}

export type Json = Prisma.InputJsonValue;

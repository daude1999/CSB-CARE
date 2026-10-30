import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";

/**
 * What a member may see, worked out on the server from their membership on every request:
 * - branch grants (MembershipBranch): none means every branch in the organisation;
 * - area limits (MembershipArea): none means every area the branch grants allow.
 * Areas belong to branches, so branch grants are compiled into the set of areas they cover; a member with both has the
 * intersection. Records without an area stay visible to everyone with the permission, so nothing becomes unreachable.
 */
export const memberScope = cache(async (userId: string, organisationId: string): Promise<{ areaIds: string[] | null; branchIds: string[] | null }> => {
  const m = await db.membership.findUnique({ where: { userId_organisationId: { userId, organisationId } }, select: { areas: { select: { areaId: true } }, branches: { select: { branchId: true } } } });
  const branchIds = m?.branches.map((b) => b.branchId) ?? [];
  const explicitAreas = m?.areas.map((a) => a.areaId) ?? [];
  if (!branchIds.length) return { areaIds: explicitAreas.length ? explicitAreas : null, branchIds: null };
  const branchAreas = (await db.area.findMany({ where: { organisationId, branchId: { in: branchIds } }, select: { id: true } })).map((a) => a.id);
  const areaIds = explicitAreas.length ? explicitAreas.filter((id) => branchAreas.includes(id)) : branchAreas;
  // A branch-limited member always has an area list, even an empty one: an empty list matches nothing.
  return { areaIds, branchIds };
});

/** Which areas a member may work in (null = all). Kept for callers that only need areas. */
export const areaScope = cache(async (userId: string, organisationId: string): Promise<string[] | null> => (await memberScope(userId, organisationId)).areaIds);

export interface Scope {
  organisationId: string;
  areaIds: string[] | null;
  /** Granted branches, null = every branch. */
  branchIds: string[] | null;
}

export async function rotaScope(ctx: Ctx, perm: OrgPermission = "rota.view"): Promise<Scope> {
  const organisationId = requireOrgPermission(ctx, perm);
  return { organisationId, ...(await memberScope(ctx.userId, organisationId)) };
}

/** The branch clause for records that carry a branchId (staff, service users, audits, memberships). */
export function branchWhere<T extends { branchId?: unknown }>(scope: Pick<Scope, "branchIds">): T | Record<string, never> {
  return (scope.branchIds ? { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] } : {}) as T;
}

export function visitWhere(scope: Scope): Prisma.VisitWhereInput {
  return scope.areaIds ? { organisationId: scope.organisationId, OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : { organisationId: scope.organisationId };
}

export function serviceUserWhere(scope: Scope): Prisma.ServiceUserWhereInput {
  const w: Prisma.ServiceUserWhereInput = { organisationId: scope.organisationId };
  const ands: Prisma.ServiceUserWhereInput[] = [];
  if (scope.areaIds) ands.push({ OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] });
  if (scope.branchIds) ands.push({ OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] });
  return ands.length ? { ...w, AND: ands } : w;
}

export function inScope(scope: Scope, areaId: string | null | undefined) {
  return !scope.areaIds || !areaId || scope.areaIds.includes(areaId);
}

/** Throws NotFound for a record outside the caller's organisation or areas (forbidden and missing look the same). */
export function assertInScope(scope: Scope, rec: { organisationId: string; areaId?: string | null } | null, what: string): asserts rec {
  if (!rec || rec.organisationId !== scope.organisationId) throw new NotFoundError(what);
  if (!inScope(scope, rec.areaId)) throw new ForbiddenError(`This ${what.toLowerCase()} is outside your areas`);
}

/**
 * The staff a rota user may list. An area filter from the page narrows the caller's own scope and can never widen it:
 * an area outside the caller's scope matches nobody.
 */
export function staffDirectoryWhere(scope: Scope, f: { area?: string; status?: string; q?: string }): Prisma.StaffMemberWhereInput {
  // Every limit is its own AND clause so a search can never replace the branch or area clause.
  const and: Prisma.StaffMemberWhereInput[] = [];
  if (scope.branchIds) and.push({ OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] });
  if (f.area) and.push(scope.areaIds && !scope.areaIds.includes(f.area) ? { id: { in: [] } } : { areas: { some: { areaId: f.area } } });
  else if (scope.areaIds) and.push({ OR: [{ areas: { some: { areaId: { in: scope.areaIds } } } }, { areas: { none: {} } }] });
  if (f.q) and.push({ OR: [{ displayName: { contains: f.q, mode: "insensitive" } }, { staffNumber: { contains: f.q, mode: "insensitive" } }, { jobTitle: { contains: f.q, mode: "insensitive" } }] });
  return {
    organisationId: scope.organisationId,
    hrMissing: false,
    ...(f.status === "all" ? {} : { employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } }),
    ...(and.length ? { AND: and } : {}),
  };
}

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

/**
 * The service-user clause without the organisation, shared by visits and templates that have no area of their own.
 * Mirrors serviceUserWhere: a limited member sees a service user in one of their areas, or with no area in one of
 * their branches (or with neither, an unallocated referral).
 */
function suClause(scope: Scope): Prisma.ServiceUserWhereInput {
  const ands: Prisma.ServiceUserWhereInput[] = [];
  if (scope.areaIds) ands.push({ OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] });
  if (scope.branchIds) ands.push({ OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] });
  return ands.length ? { AND: ands } : {};
}

/**
 * Visits a member may see. A visit with no area is judged by its service user, so a visit created without an area can
 * never carry another branch's work into a branch-limited coordinator's screens.
 */
export function visitWhere(scope: Scope): Prisma.VisitWhereInput {
  if (!scope.areaIds) return { organisationId: scope.organisationId };
  // Inside AND, so a caller that adds its own OR (a search, the Monitor's two-day window) cannot replace the limit.
  return { organisationId: scope.organisationId, AND: [{ OR: [{ areaId: { in: scope.areaIds } }, { areaId: null, serviceUser: suClause(scope) }] }] };
}

/** Recurring templates a member may see or build; a template with no area is judged by its service user. */
export function templateScopeWhere(scope: Scope): Prisma.VisitTemplateWhereInput {
  if (!scope.areaIds) return {};
  return { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null, serviceUser: suClause(scope) }] };
}

export function serviceUserWhere(scope: Scope): Prisma.ServiceUserWhereInput {
  return { organisationId: scope.organisationId, ...suClause(scope) };
}

export interface ServiceUserRef {
  areaId: string | null;
  branchId: string | null;
}

/** The in-memory twin of suClause. */
export function serviceUserInScope(scope: Pick<Scope, "areaIds" | "branchIds">, su: ServiceUserRef) {
  if (scope.areaIds && su.areaId && !scope.areaIds.includes(su.areaId)) return false;
  if (scope.branchIds && su.branchId && !scope.branchIds.includes(su.branchId)) return false;
  return true;
}

/**
 * Whether a record is inside the member's areas. A record without an area is judged by its service user when one is
 * given; without one, only members limited to no areas can reach it.
 */
export function inScope(scope: Scope, areaId: string | null | undefined, serviceUser?: ServiceUserRef | null) {
  if (!scope.areaIds) return true;
  if (areaId) return scope.areaIds.includes(areaId);
  return serviceUser ? serviceUserInScope(scope, serviceUser) : false;
}

/** Throws NotFound for a record outside the caller's organisation or areas (forbidden and missing look the same). */
export function assertInScope(scope: Scope, rec: { organisationId: string; areaId?: string | null; serviceUser?: ServiceUserRef | null } | null, what: string): asserts rec {
  if (!rec || rec.organisationId !== scope.organisationId) throw new NotFoundError(what);
  if (!inScope(scope, rec.areaId, rec.serviceUser)) throw new ForbiddenError(`This ${what.toLowerCase()} is outside your areas`);
}

/** Whether a rota build touches any of the member's areas. Builds always record the areas they covered. */
export function buildWhere(scope: Scope): Prisma.RotaBuildWhereInput {
  return scope.areaIds ? { organisationId: scope.organisationId, areaIds: { hasSome: scope.areaIds } } : { organisationId: scope.organisationId };
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
    ...(f.status === "all" ? {} : { employmentStatus: { in: ["ACTIVE", "ONBOARDING", "SUSPENDED"] } }),
    ...(and.length ? { AND: and } : {}),
  };
}

/** Branches a member may pick in a branch filter: their granted branches, or every branch in the organisation. */
export async function authorisedBranches(scope: Scope) {
  return db.branch.findMany({ where: { organisationId: scope.organisationId, ...(scope.branchIds ? { id: { in: scope.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * The clause for a branch chosen in a filter. A visit belongs to its service user's branch. A branch the member may not
 * pick matches nothing, so a hand-edited link can never show another branch's visits.
 */
export function visitBranchClause(scope: Pick<Scope, "branchIds">, branchId: string): Prisma.VisitWhereInput {
  if (scope.branchIds && !scope.branchIds.includes(branchId)) return { id: { in: [] } };
  return { serviceUser: { branchId } };
}

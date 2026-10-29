import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";

/**
 * Which areas a coordinator may work in. A membership with no areas covers the whole organisation.
 * Records without an area stay visible to everyone with the permission, so nothing becomes unreachable.
 */
export const areaScope = cache(async (userId: string, organisationId: string): Promise<string[] | null> => {
  const m = await db.membership.findUnique({ where: { userId_organisationId: { userId, organisationId } }, select: { areas: { select: { areaId: true } } } });
  const ids = m?.areas.map((a) => a.areaId) ?? [];
  return ids.length ? ids : null;
});

export interface Scope {
  organisationId: string;
  areaIds: string[] | null;
}

export async function rotaScope(ctx: Ctx, perm: OrgPermission = "rota.view"): Promise<Scope> {
  const organisationId = requireOrgPermission(ctx, perm);
  return { organisationId, areaIds: await areaScope(ctx.userId, organisationId) };
}

export function visitWhere(scope: Scope): Prisma.VisitWhereInput {
  return scope.areaIds ? { organisationId: scope.organisationId, OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : { organisationId: scope.organisationId };
}

export function serviceUserWhere(scope: Scope): Prisma.ServiceUserWhereInput {
  return scope.areaIds ? { organisationId: scope.organisationId, OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : { organisationId: scope.organisationId };
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
  return {
    organisationId: scope.organisationId,
    hrMissing: false,
    ...(f.status === "all" ? {} : { employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } }),
    ...(f.area
      ? scope.areaIds && !scope.areaIds.includes(f.area)
        ? { id: { in: [] } }
        : { areas: { some: { areaId: f.area } } }
      : scope.areaIds
        ? { OR: [{ areas: { some: { areaId: { in: scope.areaIds } } } }, { areas: { none: {} } }] }
        : {}),
    ...(f.q ? { OR: [{ displayName: { contains: f.q, mode: "insensitive" } }, { staffNumber: { contains: f.q, mode: "insensitive" } }, { jobTitle: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { branchScope } from "./common";

/** Investigations the caller may see. */
export function rcaVisibleWhere(ctx: Ctx): Prisma.RcaInvestigationWhereInput {
  const organisationId = ctx.organisationId;
  if (!organisationId) throw new ForbiddenError();
  const branch = branchScope(ctx) as Prisma.RcaInvestigationWhereInput;
  const mine: Prisma.RcaInvestigationWhereInput = { OR: [{ ownerId: ctx.userId }, { managerId: ctx.userId }] };
  if (hasOrgPermission(ctx, "rca.view")) {
    if (hasOrgPermission(ctx, "rca.safeguarding")) return { organisationId, AND: [branch] };
    return { organisationId, AND: [branch, { OR: [{ restricted: false }, ...mine.OR!] }] };
  }
  if (hasOrgPermission(ctx, "rca.investigate")) return { organisationId, AND: [branch, mine] };
  throw new ForbiddenError("You cannot see root cause analyses");
}

/**
 * Evidence files attached to a root cause analysis follow the investigation's own visibility: a person who cannot open
 * a restricted investigation cannot list or download its files, and an investigator can download files on their own
 * investigation without the general evidence permission.
 */
export async function rcaEvidenceAccess(ctx: Ctx, rcaId: string): Promise<boolean> {
  if (!ctx.organisationId) return false;
  if (!hasOrgPermission(ctx, "rca.view") && !hasOrgPermission(ctx, "rca.investigate")) return false;
  return Boolean(await db.rcaInvestigation.findFirst({ where: { id: rcaId, ...rcaVisibleWhere(ctx) }, select: { id: true } }));
}

/** Restricted investigations this person may not open, for hiding their files from the Evidence Library. */
export async function hiddenRcaIds(ctx: Ctx): Promise<string[]> {
  if (!ctx.organisationId) return [];
  const restricted = await db.rcaInvestigation.findMany({ where: { organisationId: ctx.organisationId, restricted: true }, select: { id: true, ownerId: true, managerId: true } });
  if (!restricted.length || hasOrgPermission(ctx, "rca.safeguarding")) return [];
  return restricted.filter((r) => r.ownerId !== ctx.userId && r.managerId !== ctx.userId).map((r) => r.id);
}

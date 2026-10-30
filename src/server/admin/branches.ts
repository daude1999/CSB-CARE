import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { read as readHr } from "@/hr/lib/workspace-tx";
import { reconcileWorkforce } from "@/server/workforce/projection";

const branchSchema = z.object({
  name: z.string().trim().min(2, "Name the branch").max(80),
  address: z.string().trim().max(300).optional(),
  cqcLocationId: z.string().trim().max(40).optional(),
  /** The HR Hub's own id for this branch. Set explicitly; never matched by name. */
  hrBranchKey: z.string().trim().max(80).optional(),
});

/** The HR Hub's branches for this organisation, so an administrator can map each platform branch to one. */
export async function hrBranches(organisationId: string): Promise<{ id: string; name: string }[]> {
  try {
    const state = await readHr(organisationId);
    return (state.branches ?? []).map((b) => ({ id: b.id, name: b.name }));
  } catch {
    return [];
  }
}

export async function listBranches(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  return db.branch.findMany({ where: { organisationId }, orderBy: { name: "asc" }, include: { _count: { select: { areas: true, staff: true, serviceUsers: true, grants: true } }, services: true } });
}

/** Creates or updates a branch. Changing the HR mapping re-projects the workforce so staff move to the right branch. */
export async function saveBranch(ctx: Ctx, input: { id?: string } & z.input<typeof branchSchema>) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const r = branchSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the branch");
  const data = { name: r.data.name, address: r.data.address || null, cqcLocationId: r.data.cqcLocationId || null, hrBranchKey: r.data.hrBranchKey || null };
  if (data.hrBranchKey) {
    const keys = (await hrBranches(organisationId)).map((b) => b.id);
    if (keys.length && !keys.includes(data.hrBranchKey)) throw new ValidationError("That HR branch does not exist in HR & Workforce");
  }
  const id = await db.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.branch.findFirst({ where: { id: input.id, organisationId } });
      if (!before) throw new NotFoundError("Branch");
      if (data.hrBranchKey && (await tx.branch.findFirst({ where: { organisationId, hrBranchKey: data.hrBranchKey, id: { not: before.id } } }))) throw new ConflictError("Another branch is already mapped to that HR branch");
      await tx.branch.update({ where: { id: before.id }, data });
      await audit({ organisationId, actorId: ctx.userId, action: "branch.updated", entityType: "Branch", entityId: before.id, data: { before: { name: before.name, hrBranchKey: before.hrBranchKey }, after: { name: data.name, hrBranchKey: data.hrBranchKey } } }, tx);
      return before.id;
    }
    if (await tx.branch.findFirst({ where: { organisationId, name: data.name } })) throw new ConflictError("A branch with that name already exists");
    if (data.hrBranchKey && (await tx.branch.findFirst({ where: { organisationId, hrBranchKey: data.hrBranchKey } }))) throw new ConflictError("Another branch is already mapped to that HR branch");
    const b = await tx.branch.create({ data: { organisationId, ...data } });
    await audit({ organisationId, actorId: ctx.userId, action: "branch.created", entityType: "Branch", entityId: b.id, data: { name: data.name } }, tx);
    return b.id;
  });
  // Staff are projected from HR by branch key; re-run so a new mapping takes effect without waiting for an HR change.
  await reconcileWorkforce(organisationId).catch(() => undefined);
  return id;
}

/** Replaces a member's branch grants. No grants means every branch. Every change is audited with who granted what. */
export async function setMemberBranches(ctx: Ctx, membershipId: string, branchIds: string[]) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  return db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, organisationId }, include: { branches: true } });
    if (!m) throw new NotFoundError("Member");
    const ids = [...new Set(branchIds)];
    if (ids.length && (await tx.branch.count({ where: { organisationId, id: { in: ids } } })) !== ids.length) throw new NotFoundError("Branch");
    await tx.membershipBranch.deleteMany({ where: { membershipId } });
    if (ids.length) await tx.membershipBranch.createMany({ data: ids.map((branchId) => ({ membershipId, branchId, grantedById: ctx.userId })) });
    await audit({ organisationId, actorId: ctx.userId, action: "member.branches", entityType: "Membership", entityId: membershipId, data: { before: m.branches.map((b) => b.branchId), after: ids } }, tx);
  });
}

import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";

/**
 * Links a sign-in (an existing member of the organisation) to an HR staff identity. This is the only way a login
 * and a staff record become connected: an administrator chooses both explicitly. Matching e-mail addresses are a
 * hint on screen and are never used to link automatically. Optionally grants the Carer role in the same step.
 */
export async function linkLogin(ctx: Ctx, input: { staffId: string; userId: string; grantCarerRole?: boolean; confirm: boolean }) {
  const organisationId = requireOrgPermission(ctx, "workforce.link");
  if (!input.confirm) throw new ValidationError("Confirm that this sign-in belongs to this member of staff");
  return db.$transaction(async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { id: input.staffId, organisationId } });
    if (!staff) throw new NotFoundError("Staff member");
    if (staff.employmentStatus === "ARCHIVED") throw new ValidationError("Archived staff cannot be given a sign-in");
    if (staff.userId) throw new ConflictError("This staff member already has a linked sign-in. Unlink it first.");
    const membership = await tx.membership.findUnique({ where: { userId_organisationId: { userId: input.userId, organisationId } }, include: { user: { select: { deactivatedAt: true } } } });
    if (!membership) throw new NotFoundError("Member");
    if (membership.user.deactivatedAt) throw new ValidationError("That sign-in is deactivated");
    if (await tx.staffMember.findFirst({ where: { organisationId, userId: input.userId } })) throw new ConflictError("That sign-in is already linked to another member of staff");
    await tx.staffMember.update({ where: { id: staff.id }, data: { userId: input.userId, linkedById: ctx.userId, linkedAt: new Date() } });
    if (input.grantCarerRole && !membership.roles.includes("CARER")) await tx.membership.update({ where: { id: membership.id }, data: { roles: { push: "CARER" } } });
    await audit({ organisationId, actorId: ctx.userId, action: "workforce.login.linked", entityType: "StaffMember", entityId: staff.id, data: { userId: input.userId, carerRoleGranted: !!input.grantCarerRole && !membership.roles.includes("CARER") } }, tx);
  });
}

export async function unlinkLogin(ctx: Ctx, staffId: string, reason: string) {
  const organisationId = requireOrgPermission(ctx, "workforce.link");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason");
  return db.$transaction(async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { id: staffId, organisationId } });
    if (!staff?.userId) throw new NotFoundError("Linked sign-in");
    await tx.staffMember.update({ where: { id: staffId }, data: { userId: null, linkedById: null, linkedAt: null } });
    await audit({ organisationId, actorId: ctx.userId, action: "workforce.login.unlinked", entityType: "StaffMember", entityId: staffId, data: { userId: staff.userId, reason: reason.trim() } }, tx);
  });
}

/** The staff identity of the signed-in carer, or a 403. Carers act only as themselves. */
export async function myStaff(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "visit.own");
  const staff = await db.staffMember.findFirst({ where: { organisationId, userId: ctx.userId } });
  if (!staff) throw new ForbiddenError("Your sign-in is not linked to a staff record yet. Ask your office to link it.");
  if (staff.employmentStatus === "ARCHIVED" || staff.hrMissing) throw new ForbiddenError("Your staff record is not active");
  return staff;
}

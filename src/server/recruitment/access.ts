import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";
import { read } from "@/hr/lib/workspace-tx";
import type { User } from "@/hr/lib/domain";

/**
 * Who may use Recruitment, and for which branches. Recruitment sits inside HR & Workforce, so access follows the
 * member's HR Hub account exactly as the rest of HR does: the account's role decides what they can change and its
 * branches decide whose applications they can see. The organisation always comes from the session.
 */
export interface RecruitmentAccess {
  organisationId: string;
  hrUser: User;
  /** Platform branch ids the HR account covers (through Branch.hrBranchKey). */
  branchIds: string[];
  branches: { id: string; name: string; hrBranchKey: string }[];
  canEdit: boolean;
  /** Start onboarding (creates or links the HR employee). */
  canAuthorise: boolean;
  /** Remove the personal details of a closed application once its retention date has passed. */
  canErase: boolean;
}

export async function recruitmentAccess(ctx: Ctx): Promise<RecruitmentAccess> {
  if (!ctx.organisationId || !ctx.hrUserId) throw new ForbiddenError("Recruitment is part of HR & Workforce, which your account does not include");
  const organisationId = ctx.organisationId;
  const state = await read(organisationId);
  const hrUser = state.users.find((u) => u.id === ctx.hrUserId && u.active);
  if (!hrUser) throw new ForbiddenError("Your HR account is not active");
  const branches = (await db.branch.findMany({ where: { organisationId, hrBranchKey: { in: hrUser.branches } }, select: { id: true, name: true, hrBranchKey: true }, orderBy: { name: "asc" } })).map((b) => ({ ...b, hrBranchKey: b.hrBranchKey as string }));
  const canEdit = hrUser.role !== "Branch Viewer";
  return {
    organisationId,
    hrUser,
    branchIds: branches.map((b) => b.id),
    branches,
    canEdit,
    canAuthorise: canEdit,
    canErase: hrUser.role === "Organisation Admin" || hrUser.role === "Group HR",
  };
}

export function requireEdit(a: RecruitmentAccess) {
  if (!a.canEdit) throw new ForbiddenError("Your HR account can view recruitment but not change it");
}

/** Throws NotFound for a branch outside the member's HR branches, so another branch's applications are never revealed. */
export function requireBranch(a: RecruitmentAccess, branchId: string) {
  if (!a.branchIds.includes(branchId)) throw new NotFoundError("Branch");
}

/** Members who may be named as recruiter or interviewer: active members of this organisation. */
export async function staffChoices(organisationId: string) {
  const ms = await db.membership.findMany({ where: { organisationId, deactivatedAt: null, user: { deactivatedAt: null } }, select: { userId: true, hrUserId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  return ms.map((m) => ({ id: m.userId, name: m.user.name, hr: !!m.hrUserId }));
}

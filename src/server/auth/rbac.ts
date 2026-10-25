import type { OrgRole, PlatformRole } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";

/** The authenticated actor for a request, scoped to one active organisation. */
export interface Ctx {
  userId: string;
  userName: string;
  organisationId: string | null;
  branchId: string | null;
  orgRoles: OrgRole[];
  platformRoles: PlatformRole[];
}

export const ORG_PERMISSIONS = {
  "policy.read": ["ORG_ADMIN", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD", "STAFF"],
  "policy.author": ["ORG_ADMIN", "POLICY_AUTHOR"],
  "policy.review": ["POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD"],
  "policy.approve": ["POLICY_APPROVER"],
  "policy.publish": ["POLICY_APPROVER", "ORG_ADMIN"],
  "impact.review": ["COMPLIANCE_LEAD", "POLICY_REVIEWER", "POLICY_APPROVER"],
  "implementation.confirm": ["COMPLIANCE_LEAD", "ORG_ADMIN"],
  "audit.manage": ["COMPLIANCE_LEAD", "ORG_ADMIN"],
  "audit.conduct": ["COMPLIANCE_LEAD", "POLICY_REVIEWER", "ORG_ADMIN"],
  "action.manage": ["COMPLIANCE_LEAD", "ORG_ADMIN"],
  "evidence.upload": ["COMPLIANCE_LEAD", "ORG_ADMIN", "POLICY_AUTHOR"],
  "evidence.read": ["COMPLIANCE_LEAD", "ORG_ADMIN", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER"],
  "staff.view": ["ORG_ADMIN", "COMPLIANCE_LEAD"],
  "org.manage": ["ORG_ADMIN"],
  "report.view": ["ORG_ADMIN", "COMPLIANCE_LEAD", "POLICY_APPROVER"],
  "assistant.use": ["ORG_ADMIN", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD", "STAFF"],
} as const satisfies Record<string, readonly OrgRole[]>;

export const PLATFORM_PERMISSIONS = {
  "sources.manage": ["PLATFORM_ADMIN"],
  "jobs.manage": ["PLATFORM_ADMIN"],
  "changes.triage": ["REGULATORY_REVIEWER", "PLATFORM_ADMIN"],
  "requirements.manage": ["REGULATORY_REVIEWER", "CONTENT_EDITOR"],
  "master.author": ["CONTENT_EDITOR"],
  "master.review": ["REGULATORY_REVIEWER", "CONTENT_EDITOR"],
  "master.approve": ["REGULATORY_REVIEWER"],
  "master.publish": ["REGULATORY_REVIEWER", "PLATFORM_ADMIN"],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type OrgPermission = keyof typeof ORG_PERMISSIONS;
export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export function hasOrgPermission(ctx: Ctx, perm: OrgPermission): boolean {
  if (!ctx.organisationId) return false;
  const allowed = ORG_PERMISSIONS[perm] as readonly OrgRole[];
  return ctx.orgRoles.some((r) => allowed.includes(r));
}

export function hasPlatformPermission(ctx: Ctx, perm: PlatformPermission): boolean {
  const allowed = PLATFORM_PERMISSIONS[perm] as readonly PlatformRole[];
  return ctx.platformRoles.some((r) => allowed.includes(r));
}

export function requireOrgPermission(ctx: Ctx, perm: OrgPermission): string {
  if (!hasOrgPermission(ctx, perm)) throw new ForbiddenError(`Missing permission: ${perm}`);
  return ctx.organisationId as string;
}

export function requirePlatformPermission(ctx: Ctx, perm: PlatformPermission): void {
  if (!hasPlatformPermission(ctx, perm)) throw new ForbiddenError(`Missing platform permission: ${perm}`);
}

export type PolicyAction = "read" | "author" | "review" | "approve" | "publish";

const MASTER_MAP: Record<PolicyAction, PlatformPermission | null> = {
  read: null,
  author: "master.author",
  review: "master.review",
  approve: "master.approve",
  publish: "master.publish",
};

/**
 * Policy-level authorisation. Master templates are governed by platform roles;
 * customer policies by the caller's role in the owning organisation only.
 */
export function canOnPolicy(ctx: Ctx, policy: { kind: string; organisationId: string | null }, action: PolicyAction): boolean {
  if (policy.kind === "MASTER") {
    const perm = MASTER_MAP[action];
    if (!perm) return true; // master template text is readable by all authenticated users
    return hasPlatformPermission(ctx, perm);
  }
  if (!policy.organisationId || policy.organisationId !== ctx.organisationId) return false;
  return hasOrgPermission(ctx, `policy.${action}` as OrgPermission);
}

export function requireOnPolicy(ctx: Ctx, policy: { kind: string; organisationId: string | null }, action: PolicyAction) {
  if (!canOnPolicy(ctx, policy, action)) throw new ForbiddenError(`You cannot ${action} this policy`);
}

/** Prisma where-clause fragment restricting policies to what the caller may see. */
export function visiblePolicyWhere(ctx: Ctx) {
  return ctx.organisationId
    ? { OR: [{ organisationId: ctx.organisationId }, { kind: "MASTER" as const }] }
    : { kind: "MASTER" as const };
}

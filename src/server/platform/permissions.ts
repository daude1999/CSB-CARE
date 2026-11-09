import type { OrgRole } from "@prisma/client";
import { ORG_PERMISSIONS, type OrgPermission } from "@/server/auth/rbac";

/**
 * A readable view of the role-based permission registry (src/server/auth/rbac.ts), for Roles & Permissions. Nothing
 * here grants anything: it describes what the server already enforces. Levels are labels for people; each one lists
 * the real, granular permissions behind it, because modules do not all have the same actions.
 */
export const PERMISSION_GROUPS = [
  "Service User Management",
  "Rostering",
  "Care Plans",
  "Risk Assessments",
  "Medication",
  "HR & Workforce",
  "Finance",
  "Policy & Compliance",
  "CQC & RCA",
  "Reporting & Analytics",
  "Administration",
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const LEVELS = ["No access", "View", "Create", "Edit", "Manage", "Administrative"] as const;
export type Level = (typeof LEVELS)[number];

export function groupOf(perm: string): PermissionGroup {
  const [area] = perm.split(".");
  if (perm.startsWith("care.plan") || area === "careIntake") return "Care Plans";
  if (area === "risk") return "Risk Assessments";
  if (area === "rota" || perm === "visit.own") return "Rostering";
  if (["serviceUser", "callNote", "bodyMap", "incident", "safeguarding"].includes(area!)) return "Service User Management";
  if (area === "medication") return "Medication";
  if (["readiness", "staff", "workforce"].includes(area!)) return "HR & Workforce";
  if (area === "finance") return "Finance";
  if (area === "cqc" || area === "rca") return "CQC & RCA";
  if (["analytics", "report", "operations", "assistant"].includes(area!)) return "Reporting & Analytics";
  if (area === "org") return "Administration";
  return "Policy & Compliance";
}

export function levelOf(perm: string): Exclude<Level, "No access"> {
  const action = perm.split(".").slice(1).join(".");
  if (perm === "org.manage" || perm === "workforce.link") return "Administrative";
  if (/^(view|read|directory|coverage|own)$/.test(action) || action.endsWith("view") || action === "photos") return "View";
  if (/^(record|report|upload|author|create|investigate|use|assess|conduct)$/.test(action)) return "Create";
  if (/^(edit|build|clockCorrect|documents|plan\.edit|monitor|keysafe|sensitive|evidence)$/.test(action)) return "Edit";
  return "Manage";
}

const ORDER: Record<Level, number> = { "No access": 0, View: 1, Create: 2, Edit: 3, Manage: 4, Administrative: 5 };

/** Effective permissions for a set of roles, grouped by module, with the highest level in each group. */
export function effectivePermissions(roles: readonly OrgRole[]) {
  const perms = (Object.keys(ORG_PERMISSIONS) as OrgPermission[]).filter((p) => (ORG_PERMISSIONS[p] as readonly OrgRole[]).some((r) => roles.includes(r)));
  return PERMISSION_GROUPS.map((group) => {
    const inGroup = perms.filter((p) => groupOf(p) === group);
    const level = inGroup.reduce<Level>((best, p) => (ORDER[levelOf(p)] > ORDER[best] ? levelOf(p) : best), "No access");
    return { group, level, permissions: inGroup.map((p) => ({ key: p, level: levelOf(p) })) };
  });
}

/** The role × module matrix for Roles & Permissions. */
export function roleMatrix(roles: readonly OrgRole[]) {
  return roles.map((role) => ({ role, groups: effectivePermissions([role]) }));
}

/** What a role change would add and remove, shown before saving. */
export function permissionDiff(before: readonly OrgRole[], after: readonly OrgRole[]) {
  const has = (roles: readonly OrgRole[]) => new Set((Object.keys(ORG_PERMISSIONS) as OrgPermission[]).filter((p) => (ORG_PERMISSIONS[p] as readonly OrgRole[]).some((r) => roles.includes(r))));
  const a = has(before);
  const b = has(after);
  return { added: [...b].filter((p) => !a.has(p)), removed: [...a].filter((p) => !b.has(p)) };
}

/** Every organisation permission with its module and level, for the role editor's live effective-access view. */
export function permissionCatalogue(): { groups: readonly string[]; perms: Record<string, { group: string; level: Level }> } {
  return { groups: PERMISSION_GROUPS, perms: Object.fromEntries((Object.keys(ORG_PERMISSIONS) as OrgPermission[]).map((p) => [p, { group: groupOf(p), level: levelOf(p) }])) };
}

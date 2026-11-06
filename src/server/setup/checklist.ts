import { db } from "@/lib/db";

export type SetupStep = { key: string; label: string; href: string; done: boolean };

/** The organisation's setup checklist, worked out from what is already recorded. Every step links to a page that completes it. */
export async function setupChecklist(organisationId: string): Promise<SetupStep[]> {
  const [members, keyPeople, ownPolicies, publications, audits] = await Promise.all([
    db.membership.count({ where: { organisationId } }),
    db.membership.count({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "COMPLIANCE_LEAD"] } } }),
    db.policy.count({ where: { organisationId, status: "ACTIVE" } }),
    db.policyPublication.count({ where: { organisationId, status: "PUBLISHED" } }),
    db.audit.count({ where: { organisationId } }),
  ]);
  // Publishing needs no approval rules (owner's brief, 5 Nov 2026), so there is no approval-rules step.
  return [
    { key: "people", label: "Your key people", href: "/staff", done: keyPeople > 0 },
    { key: "staff", label: "Staff information", href: "/staff", done: members >= 3 },
    { key: "adopt", label: "Add your local details to CSB policies", href: "/policies?tab=templates", done: ownPolicies > 0 },
    { key: "publish", label: "Publish policies to staff", href: "/queue", done: publications > 0 },
    { key: "audit", label: "Run your first audit", href: "/audits", done: audits > 0 },
  ];
}

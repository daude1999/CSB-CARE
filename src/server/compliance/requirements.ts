import { db } from "@/lib/db";
import type { Ctx } from "../auth/rbac";

/**
 * The Requirements Register as one organisation sees it. Requirements themselves are shared reference data; the
 * figures beside each one are the caller's own: their policies that cover it (directly, or through the CSB template
 * their policy is based on), evidence files attached to those policies, and open corrective actions raised from audit
 * findings on questions that test the requirement. Nothing from another organisation is counted.
 */
export interface RequirementRegisterRow {
  id: string;
  ref: string;
  title: string;
  exactReference: string;
  source: string;
  legalStatus: string;
  serviceTypes: string[];
  verification: string;
  simulated: boolean;
  policies: number;
  evidence: number;
  openActions: number;
}

export async function requirementRegister(ctx: Ctx): Promise<RequirementRegisterRow[]> {
  const orgId = ctx.organisationId;
  const reqs = await db.regulatoryRequirement.findMany({
    orderBy: { ref: "asc" },
    select: {
      id: true, ref: true, title: true, exactReference: true, legalStatus: true, serviceTypes: true, verificationStatus: true, isSimulated: true,
      source: { select: { name: true } },
      policyLinks: { select: { policyId: true } },
      auditQuestions: { select: { questionId: true } },
    },
  });
  if (!orgId) {
    return reqs.map((r) => ({ ...base(r), policies: new Set(r.policyLinks.map((l) => l.policyId)).size, evidence: 0, openActions: 0 }));
  }
  // The organisation's own policies, keyed by the template they came from, so a link made on a CSB template counts
  // for the organisation's adopted copy.
  const linkedIds = [...new Set(reqs.flatMap((r) => r.policyLinks.map((l) => l.policyId)))];
  const [own, evidence, actions] = await Promise.all([
    db.policy.findMany({ where: { organisationId: orgId, status: "ACTIVE", OR: [{ id: { in: linkedIds } }, { templateId: { in: linkedIds } }] }, select: { id: true, templateId: true } }),
    db.evidenceDocument.groupBy({ by: ["linkedId"], where: { organisationId: orgId, linkedType: "POLICY" }, _count: { _all: true } }),
    db.complianceAction.findMany({ where: { organisationId: orgId, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] }, finding: { questionId: { not: null } } }, select: { finding: { select: { questionId: true } } } }),
  ]);
  const ownOf = new Map<string, string[]>();
  for (const p of own) {
    for (const key of [p.id, p.templateId].filter((x): x is string => Boolean(x))) ownOf.set(key, [...(ownOf.get(key) ?? []), p.id]);
  }
  const evidenceOf = new Map(evidence.map((e) => [e.linkedId, e._count._all]));
  const actionsOf = new Map<string, number>();
  for (const a of actions) {
    const q = a.finding?.questionId;
    if (q) actionsOf.set(q, (actionsOf.get(q) ?? 0) + 1);
  }
  return reqs.map((r) => {
    const policies = new Set(r.policyLinks.flatMap((l) => ownOf.get(l.policyId) ?? []));
    return {
      ...base(r),
      policies: policies.size,
      evidence: [...policies].reduce((n, id) => n + (evidenceOf.get(id) ?? 0), 0),
      openActions: r.auditQuestions.reduce((n, q) => n + (actionsOf.get(q.questionId) ?? 0), 0),
    };
  });
}

function base(r: { id: string; ref: string; title: string; exactReference: string; legalStatus: string; serviceTypes: string[]; verificationStatus: string; isSimulated: boolean; source: { name: string } }) {
  return { id: r.id, ref: r.ref, title: r.title, exactReference: r.exactReference, source: r.source.name, legalStatus: r.legalStatus, serviceTypes: r.serviceTypes, verification: r.verificationStatus, simulated: r.isSimulated };
}

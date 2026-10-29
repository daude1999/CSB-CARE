import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { ReadinessFacts, StaffFacts } from "./evaluate";

type Db = Tx | Prisma.TransactionClient;

/**
 * Everything the readiness rules need for a set of staff, in a handful of indexed queries. Used by the readiness
 * pages, by eligibility inside scheduling transactions and by the snapshot writer.
 */
export async function loadReadinessFacts(tx: Db, organisationId: string, staffIds: string[]): Promise<{ facts: ReadinessFacts; staff: StaffFacts[] }> {
  const [requirements, staffRows, records, assessments, restrictions, exceptions, flags] = await Promise.all([
    tx.readinessRequirement.findMany({ where: { organisationId }, include: { scopes: true } }),
    tx.staffMember.findMany({ where: { organisationId, id: { in: staffIds } }, select: { id: true, jobTitle: true, branchId: true, userId: true, compliance: { select: { category: true, name: true, required: true, recurring: true, dueDate: true, verified: true, hasEvidence: true, hrCheckId: true } } } }),
    tx.staffTrainingRecord.findMany({ where: { organisationId, staffId: { in: staffIds } } }),
    tx.competencyAssessment.findMany({ where: { organisationId, staffId: { in: staffIds } } }),
    tx.staffRestriction.findMany({ where: { organisationId, staffId: { in: staffIds }, liftedAt: null } }),
    tx.readinessException.findMany({ where: { organisationId, staffId: { in: staffIds }, revokedAt: null } }),
    tx.staffReadinessFlag.findMany({ where: { organisationId, staffId: { in: staffIds }, clearedAt: null } }),
  ]);

  // Policy requirements: the current published version of each linked policy, and whether each person's login acknowledged it.
  const policyIds = [...new Set(requirements.filter((r) => r.status === "ACTIVE" && r.category === "POLICY" && r.policyId).map((r) => r.policyId as string))];
  const userIds = staffRows.map((s) => s.userId).filter((x): x is string => !!x);
  const publishedPolicies: ReadinessFacts["publishedPolicies"] = [];
  const acknowledgements: ReadinessFacts["acknowledgements"] = [];
  if (policyIds.length) {
    // The version that counts is the latest material publication; a wording-only update keeps earlier acknowledgements.
    for (const policyId of policyIds) {
      const p = await tx.policy.findFirst({ where: { id: policyId, organisationId }, select: { id: true } });
      const pub = p ? await tx.policyPublication.findFirst({ where: { policyId, status: "PUBLISHED", materialRevision: true }, orderBy: { publishedAt: "desc" }, select: { id: true } }) : null;
      if (pub) publishedPolicies.push({ id: policyId, publicationId: pub.id });
    }
    if (publishedPolicies.length) {
      const acks = await tx.acknowledgement.findMany({
        where: { organisationId, supersededAt: null, publicationId: { in: publishedPolicies.map((p) => p.publicationId) }, OR: [{ staffMemberId: { in: staffIds } }, ...(userIds.length ? [{ userId: { in: userIds } }] : [])] },
        select: { id: true, userId: true, staffMemberId: true, publicationId: true, state: true },
      });
      for (const s of staffRows) {
        for (const p of publishedPolicies) {
          const a = acks.find((x) => x.publicationId === p.publicationId && (x.staffMemberId === s.id || (!!s.userId && x.userId === s.userId)));
          // Acknowledged, assessment passed or exempted with a reason counts; an outstanding assessment does not.
          const met = !!a && (a.state === "ACKNOWLEDGED" || a.state === "ASSESSMENT_PASSED" || a.state === "EXEMPTED");
          acknowledgements.push({ staffId: s.id, policyId: p.id, acknowledged: met, publicationId: a ? p.publicationId : null, acknowledgementId: a?.id ?? null });
        }
      }
    }
  }

  const actorIds = new Set<string>();
  for (const r of records) { actorIds.add(r.enteredById); if (r.verifiedById) actorIds.add(r.verifiedById); }
  for (const a of assessments) actorIds.add(a.assessorId);
  for (const e of exceptions) actorIds.add(e.approvedById);
  const users = actorIds.size ? await tx.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, name: true } }) : [];

  return {
    facts: { requirements, records, assessments, restrictions, exceptions, flags, acknowledgements, publishedPolicies, userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) },
    staff: staffRows,
  };
}

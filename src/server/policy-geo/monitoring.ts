import { db } from "@/lib/db";
import { audit } from "../audit-log";
import { notify, usersWithOrgRoles } from "../notifications/notify";

/**
 * When the monitoring engine records a change to a source, every organisation that relied on it is told, using the
 * existing regulatory-change pipeline:
 * 1. each organisation's "verified" check of the source goes back to "Needs review";
 * 2. each policy that cites the source (PolicySourceLink) becomes a candidate on the change (reason SOURCE_LINK), so it
 *    goes through the normal impact assessment, review and approval;
 * 3. the policy owner gets a review task (a Corrective Action with an owner and a deadline) naming the affected
 *    branches, and a notification linking the previous and updated source text.
 * Nothing is rewritten or published automatically: the published policy stays in force until a person approves a
 * replacement.
 */
export async function flagPoliciesForSourceChange(changeId: string) {
  const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: changeId }, include: { source: true } });
  const now = new Date();
  const reviews = await db.orgSourceReview.findMany({ where: { sourceId: change.sourceId, status: "VERIFIED" } });
  for (const r of reviews) {
    await db.orgSourceReview.update({ where: { id: r.id }, data: { status: "NEEDS_REVIEW" } });
    await audit({ organisationId: r.organisationId, action: "source.review_reset_by_change", entityType: "RegulatorySource", entityId: change.sourceId, data: { changeId, reason: "A change to the source was detected" } });
  }
  const links = await db.policySourceLink.findMany({ where: { sourceId: change.sourceId }, include: { policy: { select: { id: true, ref: true, title: true, ownerId: true, organisationId: true, status: true } } } });
  const byPolicy = new Map<string, { policy: (typeof links)[number]["policy"]; branchIds: Set<string> }>();
  for (const l of links) {
    if (l.policy.status !== "ACTIVE" || !l.policy.organisationId) continue;
    const e = byPolicy.get(l.policyId) ?? { policy: l.policy, branchIds: new Set<string>() };
    if (l.branchKey) e.branchIds.add(l.branchKey);
    byPolicy.set(l.policyId, e);
  }
  let tasks = 0;
  for (const { policy, branchIds } of byPolicy.values()) {
    const organisationId = policy.organisationId!;
    await db.changePolicyCandidate.upsert({
      where: { changeId_policyId_reason_requirementId: { changeId, policyId: policy.id, reason: "SOURCE_LINK", requirementId: "" } },
      create: { changeId, policyId: policy.id, organisationId, reason: "SOURCE_LINK", requirementId: "", evidence: `The policy relies on "${change.source.name}" (recorded by the Policy Generator${branchIds.size ? " for a branch's local arrangements" : ""}).` },
      update: {},
    });
    const marker = `[change:${change.id}]`;
    if (await db.complianceAction.findFirst({ where: { organisationId, description: { contains: marker }, title: { contains: policy.ref } } })) continue;
    const branches = branchIds.size ? await db.branch.findMany({ where: { id: { in: [...branchIds] }, organisationId }, select: { name: true } }) : [];
    const owner = policy.ownerId && (await db.membership.findFirst({ where: { organisationId, userId: policy.ownerId, user: { deactivatedAt: null } } })) ? policy.ownerId : (await usersWithOrgRoles(organisationId, ["COMPLIANCE_LEAD", "ORG_ADMIN"]))[0];
    if (!owner) continue;
    const due = new Date(now.getTime() + 14 * 86400_000);
    const where = branches.length ? ` Affected branches: ${branches.map((b) => b.name).join(", ")}.` : "";
    const action = await db.complianceAction.create({
      data: {
        organisationId,
        title: `Review ${policy.ref} ${policy.title}: source changed`,
        description: `"${change.source.name}" changed (${change.title}).${where} Compare the previous and updated source text, decide whether the policy needs a revision, and record the outcome. The published policy stays in force until a replacement is approved. ${marker}`,
        ownerId: owner,
        dueDate: due,
      },
    });
    await audit({ organisationId, action: "policy.source_change_review_task", entityType: "ComplianceAction", entityId: action.id, data: { changeId, policyId: policy.id, sourceId: change.sourceId, branches: [...branchIds] } });
    await notify({
      organisationId,
      userIds: [owner],
      type: "policy.source_changed",
      title: `${change.isSimulated ? "[SIMULATED] " : ""}Source changed: review ${policy.ref} ${policy.title}`,
      body: `"${change.source.name}" has changed.${where} The published policy is unchanged; review the change and decide whether a revision is needed by ${due.toDateString()}.`,
      reason: "You own a policy that relies on this source.",
      links: [{ label: "See what changed", url: `/changes/${change.id}` }, { label: "Open the policy", url: `/policies/${policy.id}` }, { label: "Review task", url: `/actions/${action.id}` }],
      actionUrl: `/changes/${change.id}`,
      dueAt: due,
      dedupeKey: `source-change:${change.id}:${policy.id}`,
    });
    tasks++;
  }
  return { reviewsReset: reviews.length, policies: byPolicy.size, tasks };
}

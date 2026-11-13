import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { signoffLookups } from "@/server/policies/assignment";
import { memberNames } from "@/server/rota/queries";
import { withdrawRuleAction } from "@/app/signoff-actions";
import { ComplianceTabs } from "@/components/compliance-nav";
import { RuleForm, SCOPE_LABEL } from "@/components/signoff-ui";
import { Badge, Card, Empty, Flash, fmtDate, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Every assignment rule in the organisation in one list: which policy, who must read it, how soon, and whether a
 * knowledge check follows. Rules are created and withdrawn through the same server functions as a policy's own
 * sign-off page; withdrawing keeps every acknowledgement already given.
 */
export default async function AssignmentRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const orgId = ctx.organisationId!;
  const canManage = hasOrgPermission(ctx, "signoff.manage");
  const show = sp.show === "withdrawn" ? "withdrawn" : sp.show === "all" ? "all" : "active";
  const [rules, lookups, staff, counts] = await Promise.all([
    db.policyAssignmentRule.findMany({
      where: { organisationId: orgId, ...(show === "active" ? { withdrawnAt: null } : show === "withdrawn" ? { withdrawnAt: { not: null } } : {}), ...(sp.policy ? { policyId: sp.policy } : {}) },
      include: { policy: { select: { id: true, ref: true, title: true } }, _count: { select: { acknowledgements: true } } },
      orderBy: [{ policy: { ref: "asc" } }, { createdAt: "asc" }],
    }),
    signoffLookups(ctx),
    canManage ? db.staffMember.findMany({ where: { organisationId: orgId, hrMissing: false, employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } }, select: { id: true, displayName: true, jobTitle: true }, orderBy: { displayName: "asc" } }) : [],
    Promise.all([db.policyAssignmentRule.count({ where: { organisationId: orgId, withdrawnAt: null } }), db.policyAssignmentRule.count({ where: { organisationId: orgId, withdrawnAt: { not: null } } })]),
  ]);
  const names = await memberNames(ctx, rules.map((r) => r.ownerId));
  const branchName = new Map(lookups.branches.map((b) => [b.id, b.name]));
  const staffName = new Map((await db.staffMember.findMany({ where: { organisationId: orgId, id: { in: rules.map((r) => r.staffMemberId).filter((x): x is string => Boolean(x)) } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
  const back = `/staff/rules${show !== "active" ? `?show=${show}` : ""}`;
  const target = (r: (typeof rules)[number]) => `${SCOPE_LABEL[r.scope]}${r.scope === "BRANCH" ? `: ${branchName.get(r.branchId ?? "") ?? "a branch outside your scope"}` : r.scope === "JOB_TITLE" ? `: ${r.jobTitle}` : r.scope === "ROLE" ? `: ${r.orgRole?.replace(/_/g, " ").toLowerCase()}` : r.scope === "STAFF" ? `: ${staffName.get(r.staffMemberId ?? "") ?? "a person"}` : ""}`;

  return (
    <>
      <CompliancePageHeader tabs={<ComplianceTabs ctx={ctx} ws="signoff" active="rules" />} title="Staff Sign-off" subtitle="Assignment rules decide who must read each policy. When someone joins, moves branch or changes role in HR, their reading list is brought up to date from these rules." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <SegmentNav label="Which rules" items={[
            { href: "/staff/rules", label: "Active", active: show === "active", count: counts[0] },
            { href: "/staff/rules?show=withdrawn", label: "Withdrawn", active: show === "withdrawn", count: counts[1] },
            { href: "/staff/rules?show=all", label: "All", active: show === "all" },
          ]} />
          <Card className="rounded-tl-none">
            {rules.length ? (
              <table className="table">
                <thead><tr><th>Policy</th><th>Who must read it</th><th>Due</th><th>Requirements</th><th className="text-right">Assigned</th>{canManage && show !== "withdrawn" ? <th><span className="sr-only">Withdraw</span></th> : null}</tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/staff/policy/${r.policy.id}`} className="row-title">{r.policy.ref} {r.policy.title}</Link><div className="text-[12.5px] text-slate-600">Set by {names.get(r.ownerId) ?? "a member"} on {fmtDate(r.createdAt)}</div></td>
                      <td className="text-[14px]">{target(r)}{r.withdrawnAt ? <div className="text-[12.5px] text-slate-600">Withdrawn {fmtDate(r.withdrawnAt)}: {r.withdrawnReason}</div> : null}</td>
                      <td className="whitespace-nowrap text-[14px]">{r.dueDays} days after publication</td>
                      <td><span className="inline-flex flex-wrap gap-1">{r.mandatory ? <Badge tone="rose">Mandatory</Badge> : <Badge>Optional</Badge>}{r.priority === 1 ? <Badge tone="rose">High risk</Badge> : null}{r.requiresAssessment ? <Badge tone="amber">Knowledge check</Badge> : null}{r.withdrawnAt ? <Badge>Withdrawn</Badge> : null}</span></td>
                      <td className="text-right tabular-nums">{r._count.acknowledgements}</td>
                      {canManage && show !== "withdrawn" ? (
                        <td>
                          {!r.withdrawnAt ? (
                            <form action={withdrawRuleAction} className="flex min-w-[220px] gap-2">
                              <input type="hidden" name="back" value={back} /><input type="hidden" name="ruleId" value={r.id} />
                              <input name="reason" required minLength={3} className="input min-w-0 flex-1 py-1 text-[13px]" placeholder="Reason" aria-label={`Why the assignment of ${r.policy.ref} is withdrawn`} />
                              <button className="btn-secondary py-1 text-[13px]">Withdraw</button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{show === "withdrawn" ? "No rule has been withdrawn." : "No assignment rules yet. Without a rule, a policy published with \"staff must acknowledge\" goes to every member."}</Empty>
            )}
          </Card>
        </div>
        {canManage ? (
          <Card title="Add an assignment rule">
            <p className="text-[13px] text-slate-600">Choose a published policy and who must read it. Acknowledging a policy is not training and does not show competence.</p>
            {lookups.policies.length ? <RuleForm back={back} policies={lookups.policies} branches={lookups.branches} roles={lookups.roles} staff={staff} /> : <Empty>No policy has been published yet.</Empty>}
          </Card>
        ) : null}
      </div>
    </>
  );
}

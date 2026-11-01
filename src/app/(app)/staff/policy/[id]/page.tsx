import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ackTimeline, materialPublication, parseSignoffFilters, signoffCounts, signoffLookups, signoffRows } from "@/server/policies/assignment";
import { memberNames } from "@/server/rota/queries";
import { correctAckAction, exemptAckAction, recordAckAssessmentAction, withdrawRuleAction } from "@/app/signoff-actions";
import { AckBadge, AckTimeline, personKey, RuleForm, SCOPE_LABEL, SignoffFilterForm, SignoffSummary } from "@/components/signoff-ui";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";


/** One policy's sign-off: who it is assigned to and why, each person's state and history, and the manager's actions. */
export default async function PolicySignoffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const policy = await db.policy.findFirst({ where: { id, organisationId: ctx.organisationId ?? "", kind: "CUSTOMER" }, select: { id: true, ref: true, title: true } });
  if (!policy) notFound();
  const f = { ...parseSignoffFilters(sp), policy: policy.id };
  const canManage = hasOrgPermission(ctx, "signoff.manage");
  const [all, lookups, rules, pub, staff] = await Promise.all([
    signoffRows(ctx, { ...f, status: undefined }),
    signoffLookups(ctx),
    db.policyAssignmentRule.findMany({ where: { organisationId: ctx.organisationId!, policyId: policy.id }, orderBy: [{ withdrawnAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }] }),
    materialPublication(db, policy.id),
    canManage ? db.staffMember.findMany({ where: { organisationId: ctx.organisationId!, hrMissing: false, employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } }, select: { id: true, displayName: true, jobTitle: true }, orderBy: { displayName: "asc" } }) : [],
  ]);
  const rows = f.status ? all.filter((r) => (f.status === "overdue" ? r.b.overdue : f.status === "cannot_sign" ? r.b.cannotSign : r.b.bucket === f.status)) : all;
  const events = await ackTimeline(ctx, rows.slice(0, 200).map((r) => r.id));
  const names = await memberNames(ctx, [...events.map((e) => e.actorId), ...rules.map((r) => r.ownerId)]);
  const branchName = new Map(lookups.branches.map((b) => [b.id, b.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));
  const back = `/staff/policy/${policy.id}`;

  return (
    <>
      <PageHeader title={`${policy.ref} ${policy.title}`} back="/staff?view=policies" subtitle={pub ? `Staff must acknowledge the version published ${fmtDate(pub.publishedAt)}. A material revision assigns the new version again and keeps every earlier acknowledgement as evidence.` : "This policy has no published version yet, so nothing can be acknowledged."} actions={<Link href={`/policies/${policy.id}`} className="btn-secondary">Open the policy</Link>} />
      <Flash searchParams={sp} />
      <SignoffFilterForm f={f} branches={lookups.branches} roles={lookups.roles} base={back} />
      <SignoffSummary c={signoffCounts(all)} base={back} f={{ ...f, view: "rows" }} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="People">
          {rows.length ? (
            <ul className="rows">
              {rows.slice(0, 200).map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><Link href={`/staff/person/${personKey(r)}`} className="row-title">{r.person}</Link> <span className="text-[13px] text-slate-600">{r.staffMember?.jobTitle ?? "Office member"}{r.staffMember?.branch ? ` · ${r.staffMember.branch.name}` : ""} · {r.publication.version.label} · due {fmtDate(r.dueAt)}</span></div>
                    <AckBadge bucket={r.b.bucket} overdue={r.b.overdue} cannotSign={r.b.cannotSign} />
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[13px] text-[#0646b1]">History{canManage ? " and actions" : ""}</summary>
                    <div className="mt-1.5 space-y-2">
                      <AckTimeline events={events.filter((e) => e.acknowledgementId === r.id)} names={names} />
                      {canManage && r.b.outstanding && !r.acknowledgedAt ? (
                        <form action={exemptAckAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="acknowledgementId" value={r.id} />
                          <input name="reason" required minLength={5} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Reason for the exemption" aria-label={`Exemption reason for ${r.person}`} />
                          <button className="btn-secondary py-1">Exempt</button>
                        </form>
                      ) : null}
                      {canManage && (r.state === "ASSESSMENT_REQUIRED" || r.state === "ASSESSMENT_FAILED") && r.userId !== ctx.userId ? (
                        <form action={recordAckAssessmentAction} className="grid grid-cols-2 gap-2">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="acknowledgementId" value={r.id} />
                          <label><span className="label">Check</span><select name="method" className="input"><option value="DISCUSSION">Manager discussion</option><option value="KNOWLEDGE_CHECK">Knowledge check</option><option value="COMPETENCY_SIGN_OFF">Competency sign-off</option></select></label>
                          <label><span className="label">Result</span><select name="passed" className="input"><option value="true">Passed</option><option value="false">Not passed</option></select></label>
                          <label><span className="label">Score (optional)</span><input type="number" name="score" min={0} max={100} className="input" /></label>
                          <label><span className="label">Pass mark (optional)</span><input type="number" name="passMark" min={0} max={100} className="input" /></label>
                          <label className="col-span-2"><span className="label">What was checked</span><input name="note" required minLength={5} className="input" /></label>
                          <div className="col-span-2"><button className="btn-primary py-1">Record assessment</button></div>
                        </form>
                      ) : null}
                      {canManage && r.acknowledgedAt ? (
                        <form action={correctAckAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="acknowledgementId" value={r.id} />
                          <input name="reason" required minLength={10} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Why this acknowledgement is being corrected" aria-label={`Correction reason for ${r.person}`} />
                          <button className="btn-secondary py-1">Correct (keeps the original)</button>
                        </form>
                      ) : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          ) : <Empty>{all.length ? "Nobody matches these filters." : "Nobody is assigned this policy yet."}</Empty>}
          {rows.length > 200 ? <p className="mt-2 text-[13px] text-slate-600">Showing 200 of {rows.length}. Use the filters or the CSV export.</p> : null}
        </Card>

        <Card title="Who must read it">
          {rules.length ? (
            <ul className="rows">
              {rules.map((r) => (
                <li key={r.id} className="py-2 text-[14px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{SCOPE_LABEL[r.scope]}{r.scope === "BRANCH" ? `: ${branchName.get(r.branchId ?? "") ?? "another branch"}` : r.scope === "JOB_TITLE" ? `: ${r.jobTitle}` : r.scope === "ROLE" ? `: ${r.orgRole?.replace(/_/g, " ").toLowerCase()}` : r.scope === "STAFF" ? `: ${staffName.get(r.staffMemberId ?? "") ?? "a person"}` : ""}</span>
                    {r.mandatory ? <Badge tone="rose">Mandatory</Badge> : <Badge>Optional</Badge>}
                    {r.priority === 1 ? <Badge tone="rose">High risk</Badge> : null}
                    {r.requiresAssessment ? <Badge tone="amber">Assessment</Badge> : null}
                    {r.withdrawnAt ? <Badge>Withdrawn</Badge> : null}
                  </div>
                  <div className="text-[12.5px] text-slate-600">Due {r.dueDays} days after publication · owner {names.get(r.ownerId) ?? "a member"}{r.withdrawnAt ? ` · withdrawn ${fmtDate(r.withdrawnAt)}: ${r.withdrawnReason}` : ""}</div>
                  {canManage && !r.withdrawnAt ? (
                    <form action={withdrawRuleAction} className="mt-1 flex gap-2">
                      <input type="hidden" name="back" value={back} /><input type="hidden" name="ruleId" value={r.id} />
                      <input name="reason" required minLength={3} className="input min-w-0 flex-1 py-1 text-[13px]" placeholder="Why" aria-label="Why the assignment is withdrawn" />
                      <button className="btn-secondary py-1 text-[13px]">Withdraw</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13.5px] text-slate-600">No assignment rules: every member of the organisation is asked to read it, as before. Add a rule to target branches, roles or people.</p>}
          {canManage ? (
            <RuleForm back={back} policyId={policy.id} branches={lookups.branches} roles={lookups.roles} staff={staff} />
          ) : null}
        </Card>
      </div>
    </>
  );
}

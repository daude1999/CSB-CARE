import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { createRiskAction } from "@/app/compliance-actions";
import { RiskFormFields } from "@/components/risk-register-ui";
import { Card, Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Adds a risk to the register. A risk can be raised from an audit finding (?finding=), which stays linked. */
export default async function NewRiskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "risk.manage")) notFound();
  const orgId = ctx.organisationId!;
  const [branches, members, finding] = await Promise.all([
    db.branch.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { organisationId: orgId, user: { deactivatedAt: null } }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    sp.finding ? db.auditFinding.findFirst({ where: { id: sp.finding, organisationId: orgId }, include: { audit: { select: { title: true, branchId: true } } } }) : null,
  ]);
  const back = finding ? `/compliance/risks/new?finding=${finding.id}` : "/compliance/risks/new";
  return (
    <>
      <CompliancePageHeader back="/compliance/risks" title="Add a risk" subtitle="Score the risk before controls (inherent) and with the controls already in place (residual). Ratings use the 5 x 5 matrix on the register and are an internal management tool." />
      <Flash searchParams={sp} />
      <Card>
        {finding ? <p className="mb-3 rounded-[3px] bg-[#f5f9fc] px-3 py-2 text-[13.5px] text-slate-700">Raised from a finding in <strong>{finding.audit.title}</strong>: {finding.description}</p> : null}
        <form action={createRiskAction} className="space-y-4">
          <input type="hidden" name="back" value={back} />
          <RiskFormFields branches={branches} members={members.map((m) => ({ userId: m.userId, name: m.user.name }))} branchRequired={Boolean(ctx.branchIds)} risk={finding ? { title: "", description: finding.description, category: "", branchId: finding.audit.branchId, likelihood: 0, impact: 0, existingControls: "", controlEffectiveness: "NOT_ASSESSED", residualLikelihood: 0, residualImpact: 0, ownerId: "", reviewDate: new Date(Date.now() + 90 * 86400_000), findingId: finding.id } : undefined} />
          <button className="btn-primary" type="submit">Add to the register</button>
        </form>
      </Card>
    </>
  );
}

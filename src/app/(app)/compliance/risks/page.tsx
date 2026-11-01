import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { BAND_LABEL, listRisks, parseRiskFilters, RISK_CATEGORIES, RISK_STATUS, riskBand } from "@/server/compliance/risks";
import { memberNames } from "@/server/rota/queries";
import { ComplianceTabs } from "@/components/compliance-nav";
import { RatingChip, RiskMatrix, RiskRef } from "@/components/risk-register-ui";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The organisational risk register: each risk with its inherent and residual rating, owner, review date and open
 * mitigation actions. Separate from audit findings and corrective actions, which can be linked to a risk.
 */
export default async function RiskRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "risk.view")) notFound();
  const f = parseRiskFilters(sp);
  const orgId = ctx.organisationId!;
  const [risks, open, branches] = await Promise.all([
    listRisks(ctx, f),
    listRisks(ctx, {}),
    db.branch.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = await memberNames(ctx, risks.map((r) => r.ownerId));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const cells = new Map<string, number>();
  for (const r of open) cells.set(`${r.residualLikelihood}:${r.residualImpact}`, (cells.get(`${r.residualLikelihood}:${r.residualImpact}`) ?? 0) + 1);
  const canManage = hasOrgPermission(ctx, "risk.manage");
  const high = open.filter((r) => r.band === "HIGH" || r.band === "EXTREME").length;
  const overdue = open.filter((r) => r.overdue).length;
  const filtered = Boolean(f.q || f.status || f.band || f.category || f.branch || f.overdue);

  return (
    <>
      <PageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="risks" />}
        title="Audits & Improvements"
        subtitle="The risk register: risks to safe, well-led care and to the service, scored before and after controls, each with an owner, a review date and mitigation actions."
        actions={canManage ? <Link href="/compliance/risks/new" className="btn-primary">Add a risk</Link> : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Risk summary" className="panel mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        <span><strong className="tabular-nums">{open.length}</strong> open risk{open.length === 1 ? "" : "s"}</span>
        <Link href="/compliance/risks?band=HIGH_PLUS" className={`no-underline ${high ? "text-[#a3242c]" : ""}`}><strong className="tabular-nums">{high}</strong> rated High or Extreme after controls</Link>
        <Link href="/compliance/risks?overdue=1" className={`no-underline ${overdue ? "text-[#a3242c]" : ""}`}><strong className="tabular-nums">{overdue}</strong> past their review date</Link>
        <Link href="/compliance/risks?status=CLOSED" className="no-underline text-slate-700">Closed risks</Link>
      </section>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <section aria-label="Filters" className="panel">
            <form method="get" action="/compliance/risks" className="flex flex-wrap items-end gap-2">
              <label><span className="label">Search</span><input name="q" defaultValue={f.q ?? ""} placeholder="Reference or words" className="input w-48" /></label>
              <label><span className="label">Status</span><select name="status" defaultValue={f.status ?? ""} className="input"><option value="">Open and monitoring</option>{Object.entries(RISK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="ALL">All, including closed</option></select></label>
              <label><span className="label">Residual rating</span><select name="band" defaultValue={f.band ?? ""} className="input"><option value="">Any</option>{Object.entries(BAND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="HIGH_PLUS">High or Extreme</option></select></label>
              <label><span className="label">Category</span><select name="category" defaultValue={f.category ?? ""} className="input max-w-[220px]"><option value="">Any</option>{Object.entries(RISK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              {branches.length > 1 ? <label><span className="label">Branch</span><select name="branch" defaultValue={f.branch ?? ""} className="input"><option value="">All</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : null}
              <label className="flex items-center gap-2 pb-2 text-[14px]"><input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue} className="h-4 w-4" /> Review overdue</label>
              <button className="btn-primary">Apply</button>
              {filtered ? <Link href="/compliance/risks" className="btn-secondary">Clear</Link> : null}
            </form>
          </section>
          <Card>
            {risks.length ? (
              <table className="table">
                <thead><tr><th>Risk</th><th>Scope</th><th>Inherent</th><th>Residual</th><th>Owner</th><th>Review</th><th className="text-right">Open actions</th></tr></thead>
                <tbody>
                  {risks.map((r) => (
                    <tr key={r.id} data-testid={`risk-${r.ref}`}>
                      <td className="min-w-[240px]"><RiskRef id={r.id} refText={r.ref} title={r.title} /><div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-600">{RISK_CATEGORIES[r.category as keyof typeof RISK_CATEGORIES] ?? r.category}{r.status !== "OPEN" ? <Badge tone={r.status === "CLOSED" ? "slate" : "teal"}>{RISK_STATUS[r.status as keyof typeof RISK_STATUS]}</Badge> : null}</div></td>
                      <td className="text-[13.5px]">{r.branchId ? (branchName.get(r.branchId) ?? "Branch") : "Whole organisation"}</td>
                      <td><RatingChip score={r.inherent} /></td>
                      <td><RatingChip score={r.residual} /></td>
                      <td className="text-[13.5px]">{names.get(r.ownerId) ?? "—"}</td>
                      <td className={`whitespace-nowrap text-[13.5px] tabular-nums ${r.overdue ? "font-medium text-[#a3242c]" : ""}`}>{fmtDate(r.reviewDate)}{r.overdue ? " · overdue" : ""}</td>
                      <td className="text-right tabular-nums">{r.openActions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{filtered ? "No risks match these filters." : canManage ? "The risk register is empty. Add the first risk to start tracking it." : "The risk register is empty."}</Empty>
            )}
          </Card>
        </div>
        <Card title="Open risks after controls">
          <RiskMatrix cells={cells} />
          {open.length ? <p className="mt-2 text-[12.5px] text-slate-600">Highest residual: <strong>{BAND_LABEL[riskBand(Math.max(...open.map((r) => r.residual)))]}</strong>.</p> : null}
        </Card>
      </div>
    </>
  );
}

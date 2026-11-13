import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { BAND_LABEL, listRisks, parseRiskFilters, RISK_CATEGORIES, RISK_STATUS, riskBand } from "@/server/compliance/risks";
import { memberNames } from "@/server/rota/queries";
import { ComplianceTabs } from "@/components/compliance-nav";
import { RiskMatrix } from "@/components/risk-register-ui";
import { Flash, fmtDate } from "@/components/ui";
import { PcBadge, PcFoot, PcSearch, PcTableWrap, type PcTone } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Plus } from "@phosphor-icons/react/dist/ssr";

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

  const EFFECT: Record<string, { label: string; tone: PcTone }> = { EFFECTIVE: { label: "Effective", tone: "green" }, PARTIALLY_EFFECTIVE: { label: "Partly effective", tone: "amber" }, INEFFECTIVE: { label: "Ineffective", tone: "red" }, NOT_ASSESSED: { label: "Not assessed", tone: "grey" } };
  const BRANCH_OPTS = [{ value: "", label: "All" }, ...branches.map((b) => ({ value: b.id, label: b.name }))];

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="risks" />}
        title="Audits & Improvements"
        subtitle="The organisational risk register: risks to safe, well-led care and to the service (risks to one person are in that service user's risk assessments), scored before and after controls, each with an owner, a review date and mitigation actions."
        actions={canManage ? <Link href="/compliance/risks/new" className="pc-btn"><Plus size={16} weight="bold" aria-hidden="true" />Add a risk</Link> : null}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Risk register" className="pc-panel">
          <form method="get" action="/compliance/risks" className="pc-toolbar" role="search" aria-label="Filter risks">
            <PcSearch defaultValue={f.q} placeholder="Search risks" />
            <PcSelect name="status" label="Status" defaultValue={f.status ?? ""} options={[{ value: "", label: "Open and monitoring" }, ...Object.entries(RISK_STATUS).map(([value, label]) => ({ value, label })), { value: "ALL", label: "All, including closed" }]} />
            <PcSelect name="band" label="Rating" defaultValue={f.band ?? ""} options={[{ value: "", label: "Any" }, ...Object.entries(BAND_LABEL).map(([value, label]) => ({ value, label })), { value: "HIGH_PLUS", label: "High or Extreme" }]} />
            <PcSelect name="category" label="Category" defaultValue={f.category ?? ""} options={[{ value: "", label: "Any" }, ...Object.entries(RISK_CATEGORIES).map(([value, label]) => ({ value, label }))]} />
            {branches.length > 1 ? <PcSelect name="branch" label="Branch" defaultValue={f.branch ?? ""} options={BRANCH_OPTS} /> : null}
            <label className="pc-select pr-3"><input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue} className="pc-check" /> Review overdue</label>
            <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
            {filtered ? <Link href="/compliance/risks" className="pc-link">Clear filters</Link> : null}
          </form>
          {risks.length ? (
            <PcTableWrap>
              <table className="pc-table">
                <thead><tr><th>Risk</th><th>Score</th><th>Controls</th><th>Owner</th><th>Next review</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {risks.map((r) => {
                    const eff = EFFECT[r.controlEffectiveness] ?? EFFECT.NOT_ASSESSED!;
                    return (
                      <tr key={r.id} data-testid={`risk-${r.ref}`}>
                        <td className="min-w-[240px] max-w-[380px]">
                          <Link href={`/compliance/risks/${r.id}`} className="pc-strong"><span className="mr-1.5 font-normal text-[#667085]">{r.ref}</span>{r.title}</Link>
                          <span className="pc-sub">{RISK_CATEGORIES[r.category as keyof typeof RISK_CATEGORIES] ?? r.category} · {r.branchId ? (branchName.get(r.branchId) ?? "Branch") : "Whole organisation"}{r.status !== "OPEN" ? ` · ${RISK_STATUS[r.status as keyof typeof RISK_STATUS]}` : ""}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <PcBadge tone={scoreTone(r.residual)} title={`Residual ${r.residual} (with controls); inherent ${r.inherent}`}>{r.residual} · {BAND_LABEL[r.band]}</PcBadge>
                          <span className="pc-sub">Before controls {r.inherent}</span>
                        </td>
                        <td className="max-w-[300px]"><span className="block truncate" title={r.existingControls}>{r.existingControls || "None recorded"}</span><span className="pc-sub">{eff.label}</span></td>
                        <td className="whitespace-nowrap">{names.get(r.ownerId) ?? "—"}</td>
                        <td className={`whitespace-nowrap ${r.overdue ? "font-semibold text-[#b42318]" : ""}`}>{fmtDate(r.reviewDate)}{r.overdue ? <span className="pc-sub text-[#b42318]">Overdue</span> : null}</td>
                        <td className="text-right">{r.openActions ? <span className="font-semibold text-[#101828]">{r.openActions} open</span> : <span className="text-[#667085]">None</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PcTableWrap>
          ) : (
            <p className="pc-empty">{filtered ? "No risks match these filters." : canManage ? "The risk register is empty. Add the first risk to start tracking it." : "The risk register is empty."}</p>
          )}
          <PcFoot shown={risks.length} total={open.length}>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/compliance/risks?band=HIGH_PLUS" className="pc-link">{high} High or Extreme</Link>
              <Link href="/compliance/risks?overdue=1" className="pc-link">{overdue} past review date</Link>
              <Link href="/compliance/risks?status=CLOSED" className="pc-link">Closed risks</Link>
            </span>
          </PcFoot>
        </section>
        <section aria-labelledby="matrix-heading" className="pc-panel self-start p-5">
          <h2 id="matrix-heading" className="pc-panel-title mb-3">Open risks after controls</h2>
          <RiskMatrix cells={cells} />
          {open.length ? <p className="mt-2 text-[12.5px] text-[#475467]">Highest residual: <strong>{BAND_LABEL[riskBand(Math.max(...open.map((r) => r.residual)))]}</strong>. Scores are an internal management tool, not a regulatory rating.</p> : null}
        </section>
      </div>
    </>
  );
}

/** Score colour from the brief: 15 or more red, 8 to 14 amber, below 8 green. */
function scoreTone(score: number): PcTone {
  return score >= 15 ? "red" : score >= 8 ? "amber" : "green";
}

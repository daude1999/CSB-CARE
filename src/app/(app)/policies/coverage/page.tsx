import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcFoot, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { CellBadge } from "@/components/policy-geo-ui";
import { Flash } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { CELL_LABEL, coverageView } from "@/server/policy-geo/coverage";
import { REGIONS, regionName } from "@/server/policy-geo/regions";

export const dynamic = "force-dynamic";

const HOW_LABEL = { branch_policy: "Branch policy", appendix: "Branch appendix", national: "Company policy", not_applicable: "" } as const;
const PAGE = 60;

/**
 * Branch Policy Coverage: for every policy, how each branch is covered (company policy, branch appendix or separate
 * branch policy) and in what state. Every cell comes from stored policies, drafts, sources and acknowledgements.
 */
export default async function BranchCoveragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "policy.coverage")) notFound();
  const sp = await searchParams;
  const f = { branch: sp.branch || undefined, region: sp.region || undefined, la: sp.la || undefined, category: sp.category || undefined, status: sp.status || undefined, owner: sp.owner || undefined, q: sp.q || undefined };
  const page = Math.max(1, Number(sp.page) || 1);
  const [view, categories, las, allBranches] = await Promise.all([
    coverageView(ctx, f),
    db.policyCategory.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    db.localAuthority.findMany({ where: { branchProfiles: { some: { organisationId: ctx.organisationId } } }, orderBy: { name: "asc" }, select: { code: true, name: true } }),
    db.branch.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const { branches, rows, summary, owners } = view;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const filtered = Boolean(Object.values(f).some(Boolean));
  const qs = (p: number) => `/policies/coverage?${new URLSearchParams([...Object.entries(f).filter((e): e is [string, string] => Boolean(e[1])), ["page", String(p)]])}`;
  const canSeeCrossBoundary = hasOrgPermission(ctx, "serviceUser.view");

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="coverage" />}
        title="Branch Coverage"
        subtitle="How each branch is covered for every policy: by the company policy, by a branch appendix or by its own branch policy, and whether that is published, in draft, ready to publish or missing local arrangements."
        actions={canSeeCrossBoundary ? <Link href="/policies/cross-boundary" className="pc-btn-secondary">Cross-boundary safeguarding</Link> : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Branch policy coverage" className="pc-panel">
        <div className="pc-panel-head">
          <p className="text-body leading-6 text-[#344054]" data-testid="coverage-summary">
            <strong>{summary.national}</strong> national · <strong>{summary.shared}</strong> shared with branch appendices · <strong>{summary.branchPolicies}</strong> branch policies.{" "}
            Across the branches shown: <strong>{summary.approved}</strong> published, <strong>{summary.drafts}</strong> in draft, <strong>{summary.awaiting}</strong> ready to publish,{" "}
            <strong className={summary.missingLocal ? "text-[#b42318]" : ""}>{summary.missingLocal}</strong> missing local arrangements, <strong className={summary.needsReview ? "text-[#b54708]" : ""}>{summary.needsReview}</strong> needing review.{" "}
            <Link href="/changes?group=all" className="pc-link">{summary.localChanges} local source change{summary.localChanges === 1 ? "" : "s"} open</Link> · {hasOrgPermission(ctx, "staff.view") ? <Link href="/staff" className="pc-link">{summary.staffOutstanding} staff acknowledgements outstanding</Link> : <>{summary.staffOutstanding} staff acknowledgements outstanding</>}
          </p>
        </div>
        <form method="get" action="/policies/coverage" className="pc-toolbar" role="search" aria-label="Filter coverage">
          <PcSearch defaultValue={f.q} placeholder="Search policies" />
          <PcSelect name="branch" label="Branch" defaultValue={f.branch ?? ""} options={[{ value: "", label: "All" }, ...allBranches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="region" label="Region" defaultValue={f.region ?? ""} options={[{ value: "", label: "All" }, ...REGIONS.map((r) => ({ value: r.code, label: r.name }))]} />
          <PcSelect name="la" label="Local authority" defaultValue={f.la ?? ""} options={[{ value: "", label: "All" }, ...las.map((l) => ({ value: l.code, label: l.name }))]} />
          <PcSelect name="category" label="Category" defaultValue={f.category ?? ""} options={[{ value: "", label: "All" }, ...categories.map((c) => ({ value: c.code, label: c.name }))]} />
          <PcSelect name="status" label="Status" defaultValue={f.status ?? ""} options={[{ value: "", label: "Any" }, ...Object.entries(CELL_LABEL).map(([value, label]) => ({ value, label }))]} />
          <PcSelect name="owner" label="Owner" defaultValue={f.owner ?? ""} options={[{ value: "", label: "Anyone" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]} />
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          {filtered ? <Link href="/policies/coverage" className="pc-link">Clear filters</Link> : null}
        </form>
        {branches.length && shown.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="coverage-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  {branches.map((b) => <th key={b.id}>{b.name}<span className="block text-caption font-normal text-[#667085]">{b.policyProfile?.localAuthority?.name ?? "Area not set"} · {regionName(b.policyProfile?.regionCode)}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} data-testid={`coverage-${r.ref}`}>
                    <td className="min-w-[240px] max-w-[340px]"><Link href={`/policies/${r.id}`} className="pc-strong">{r.ref} {r.title}</Link><span className="pc-sub">{r.category}</span></td>
                    {r.cells.map((c) => (
                      <td key={c.branchId} className="min-w-[170px]">
                        {c.how === "not_applicable" ? <span className="text-meta text-[#98a2b3]">Not this branch</span> : (
                          <>
                            <CellBadge state={c.state} />
                            <span className="pc-sub">{c.policyId && c.how === "branch_policy" ? <Link href={`/policies/${c.policyId}`}>{HOW_LABEL[c.how]} {c.ref}</Link> : HOW_LABEL[c.how]}{c.pendingAcks ? ` · ${c.pendingAcks} to read` : ""}</span>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">{!branches.length ? "No branches match. Configure branches in Branch & Local Authority Configuration." : filtered ? "No policies match these filters." : "No policies yet."}</p>}
        <PcFoot shown={shown.length} total={rows.length} page={page} pages={pages} href={qs} />
      </section>
    </>
  );
}

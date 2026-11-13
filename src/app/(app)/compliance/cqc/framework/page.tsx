import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { PcBadge, PcTableWrap, PcTabs } from "@/components/compliance-ui";
import { NotOfficialBanner, Panel } from "@/components/cqc-ui";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { activeFramework, frameworkCriteria } from "@/server/cqc/framework";
import { KEY_QUESTIONS, KQ_LABEL, SCORING_METHOD, type KeyQuestion } from "@/server/cqc/scoring";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The framework version in use (areas, mapping, sources) and exactly how readiness is worked out. Read-only. */
export default async function FrameworkPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "cqc.view")) notFound();
  const fw = await activeFramework();
  const [criteria, versions] = await Promise.all([frameworkCriteria(fw.id), db.cqcFramework.findMany({ orderBy: { effectiveFrom: "desc" }, select: { id: true, version: true, status: true, effectiveFrom: true } })]);
  const q = (KEY_QUESTIONS as readonly string[]).includes(sp.q ?? "") ? (sp.q as KeyQuestion) : "SAFE";
  return (
    <>
      <CompliancePageHeader back="/compliance/cqc" title="CQC framework and scoring method" subtitle={`${fw.title} · version ${fw.version}`} />
      <div className="space-y-4">
        <NotOfficialBanner />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="pc-panel" aria-label="Assessment areas">
            <div className="px-5 pt-2"><PcTabs label="Key questions" active={q} items={KEY_QUESTIONS.map((k) => ({ key: k, label: KQ_LABEL[k], href: `/compliance/cqc/framework?q=${k}`, count: criteria.filter((c) => c.keyQuestion === k).length }))} /></div>
            <PcTableWrap label="Areas">
              <table className="pc-table">
                <thead><tr><th>Area</th><th>CQC quality statement</th><th>Regulations</th></tr></thead>
                <tbody>
                  {criteria.filter((c) => c.keyQuestion === q).map((c) => (
                    <tr key={c.id}>
                      <td className="min-w-[240px]"><span className="pc-strong"><span className="mr-1.5 font-normal text-[#667085]">{c.code}</span>{c.title}</span>{c.essential ? <PcBadge tone="purple">Essential</PcBadge> : null}<span className="pc-sub">{c.guidance}</span></td>
                      <td className="min-w-[160px]">{c.qualityStatement}</td>
                      <td className="min-w-[160px] text-[13px]">{c.regulations.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PcTableWrap>
          </section>
          <div className="space-y-4">
            <Panel title="About this framework">
              <div className="space-y-2 px-5 py-4 text-[13.5px] text-[#344054]">
                <p>{fw.basis}</p>
                {fw.notes ? <p>{fw.notes}</p> : null}
                <p>Source: <a href={fw.sourceUrl ?? "https://www.cqc.org.uk/assessment"} className="pc-link" target="_blank" rel="noreferrer">CQC assessment framework</a></p>
                <ul className="divide-y divide-[#eaecf0] rounded-lg border border-[#eaecf0]">{versions.map((v) => <li key={v.id} className="flex justify-between px-3 py-1.5"><span>{v.version}</span><span className="text-[#667085]">{v.status === "ACTIVE" ? "In use" : v.status} · from {v.effectiveFrom.toISOString().slice(0, 10)}</span></li>)}</ul>
              </div>
            </Panel>
            <Panel title={<span id="method">How readiness is worked out</span>} testId="scoring-method">
              <div className="space-y-2 px-5 py-4 text-[13.5px] text-[#344054]">
                <p className="text-[12.5px] text-[#667085]">Method {SCORING_METHOD}. The same records always give the same figures.</p>
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li>Each area gets a result: Met (100 points), Partially met (50) or Not met (0). Not applicable needs a reason and is left out.</li>
                  <li>An area with no verified, in-date evidence counts for half. Suggested, awaiting, rejected, outdated or superseded evidence never counts.</li>
                  <li>Each overdue improvement action on the area takes off 10 points, up to 30.</li>
                  <li>A key question’s score is the average of its areas, shown only when at least 75% of its areas are assessed. Otherwise it shows “Low confidence”.</li>
                  <li>The overall score is shown only when all five key questions have a high-confidence score.</li>
                  <li>Safeguarding concerns, serious incidents, high risks and overdue investigations are shown as warnings on the Overview. They are never hidden by a high score.</li>
                  <li>Closing an investigation or an action does not change a score by itself. Only verified evidence and recorded results do.</li>
                </ol>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcTableWrap, PcTabs } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { LINK_TONE } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { discoverEvidenceAction, proposeSuggestionAction, reviewEvidenceAction } from "@/app/cqc-actions";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { visibleBranches } from "@/server/cqc/common";
import { LINK_STATUS, linksFor, SOURCE_TYPES } from "@/server/cqc/evidence";
import { activeFramework, frameworkCriteria } from "@/server/cqc/framework";
import { KEY_QUESTIONS, KQ_LABEL, type KeyQuestion } from "@/server/cqc/scoring";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "AWAITING", label: "Awaiting review" },
  { key: "GAPS", label: "Gaps" },
  { key: "VERIFIED", label: "Verified" },
  { key: "OUTDATED", label: "Outdated" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
] as const;

/**
 * Evidence for CQC areas: the review queue (suggested and linked records waiting for a decision), the gaps (areas with no
 * verified, in-date evidence), and everything already decided. Suggestions never count until a reviewer verifies them.
 */
export default async function CqcEvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "cqc.view")) notFound();
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "AWAITING";
  const branches = await visibleBranches(ctx);
  const branchId = branches.some((b) => b.id === sp.branch) ? sp.branch! : null;
  const kq = (KEY_QUESTIONS as readonly string[]).includes(sp.kq ?? "") ? (sp.kq as KeyQuestion) : null;
  const fw = await activeFramework();
  const criteria = (await frameworkCriteria(fw.id)).filter((c) => !kq || c.keyQuestion === kq);
  const all = await linksFor(ctx, ctx.organisationId, { criterionIds: criteria.map((c) => c.id), branchId });
  const count = (k: string) => (k === "ALL" ? all.length : k === "AWAITING" ? all.filter((l) => l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW").length : all.filter((l) => l.effective === k).length);
  const verifiedBy = new Set(all.filter((l) => l.effective === "VERIFIED").map((l) => l.criterionId));
  const gaps = criteria.filter((c) => !verifiedBy.has(c.id)).sort((x, y) => Number(y.essential) - Number(x.essential) || x.position - y.position);
  const rows = view === "GAPS" ? [] : view === "ALL" ? all : view === "AWAITING" ? all.filter((l) => l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW") : all.filter((l) => l.effective === view);
  // The latest assessment for this scope, so a gap can be opened in it.
  const latest = await db.cqcAssessment.findFirst({ where: { organisationId: ctx.organisationId, frameworkId: fw.id, branchId, status: { in: ["IN_PROGRESS", "AWAITING_APPROVAL", "APPROVED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, reference: true } });
  const canAssess = hasOrgPermission(ctx, "cqc.assess");
  const canVerify = hasOrgPermission(ctx, "cqc.evidence.verify");
  const qs = (o: Record<string, string | null | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ view, branch: branchId, kq, ...o })) if (v) p.set(k, v); return `/compliance/cqc/evidence?${p}`; };
  const back = qs({});
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((l) => [l.linkedById, l.reviewedById]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="evidence" />}
        title="Evidence"
        subtitle="Records that may support each CQC area. Only evidence a reviewer has verified, and that is still in date, counts towards readiness."
        actions={canAssess ? (
          <form action={discoverEvidenceAction}>
            <input type="hidden" name="back" value={back} /><input type="hidden" name="branchId" value={branchId ?? ""} />
            <button className="pc-btn" type="submit"><MagnifyingGlass size={16} weight="bold" aria-hidden="true" />Find possible evidence</button>
          </form>
        ) : null}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <form method="get" action="/compliance/cqc/evidence" className="pc-panel pc-toolbar" role="search" aria-label="Filter evidence">
          <input type="hidden" name="view" value={view} />
          <PcSelect name="branch" label="Branch" defaultValue={branchId ?? ""} options={[{ value: "", label: ctx.branchIds ? "My branches" : "Organisation-wide" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="kq" label="Key question" defaultValue={kq ?? ""} options={[{ value: "", label: "All five" }, ...KEY_QUESTIONS.map((k) => ({ value: k, label: KQ_LABEL[k] }))]} />
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          <span className="ml-auto text-meta text-[#667085]">“Find possible evidence” only suggests. It never verifies anything.</span>
        </form>

        <section className="pc-panel" data-testid="evidence-list">
          <div className="px-5 pt-2">
            <PcTabs label="Evidence status" testId="evidence-views" active={view} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: qs({ view: v.key }), count: v.key === "GAPS" ? gaps.length : count(v.key) }))} />
          </div>
          {view === "GAPS" ? (
            <>
              <PcTableWrap label="Areas without verified evidence">
                <table className="pc-table">
                  <thead><tr><th>Area</th><th>Key question</th><th>Evidence waiting</th><th></th></tr></thead>
                  <tbody>
                    {gaps.map((c) => {
                      const waiting = all.filter((l) => l.criterionId === c.id && (l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW")).length;
                      return (
                        <tr key={c.id} data-testid={`gap-${c.code}`}>
                          <td className="min-w-[260px]"><span className="pc-strong"><span className="mr-1.5 font-normal text-[#667085]">{c.code}</span>{c.title}</span><span className="pc-sub">{c.evidenceExamples.slice(0, 2).join("; ")}</span></td>
                          <td className="whitespace-nowrap">{KQ_LABEL[c.keyQuestion as KeyQuestion]}{c.essential ? <> <PcBadge tone="red">Essential</PcBadge></> : null}</td>
                          <td>{waiting ? <Link href={qs({ view: "AWAITING" })} className="pc-link">{waiting} to review</Link> : <span className="text-[#667085]">None</span>}</td>
                          <td className="text-right">{latest ? <Link href={`/compliance/cqc/assessments/${latest.id}/areas/${c.id}`} className="pc-btn-secondary pc-btn-sm">Link evidence</Link> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </PcTableWrap>
              {!gaps.length ? <p className="pc-empty">Every area in this scope has verified, in-date evidence.</p> : null}
              {!latest && gaps.length ? <p className="border-t border-[#eaecf0] px-5 py-3 text-meta text-[#667085]">Start an assessment for this scope to link evidence to each area.</p> : null}
            </>
          ) : (
            <>
              <PcTableWrap label="Evidence">
                <table className="pc-table">
                  <thead><tr><th>Record</th><th>Area</th><th>Status</th><th>Linked</th><th>Decision</th></tr></thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.id} data-testid={`evidence-${l.id}`}>
                        <td className="min-w-[240px] max-w-[380px]">
                          {l.info.href ? <a href={l.info.href} className="pc-strong">{l.info.label}</a> : <span className="pc-strong">{l.info.label}</span>}
                          <span className="pc-sub">{SOURCE_TYPES[l.sourceType as keyof typeof SOURCE_TYPES] ?? l.sourceType}{l.origin === "DISCOVERED" ? " · suggested by the system" : ""}{l.info.stale ? ` · ${l.info.stale}` : ""}</span>
                        </td>
                        <td className="min-w-[180px]"><span className="mr-1 text-[#667085]">{l.criterion.code}</span>{l.criterion.title}</td>
                        <td className="whitespace-nowrap"><PcBadge tone={LINK_TONE[l.effective] ?? "grey"}>{LINK_STATUS[l.effective]}</PcBadge>{l.effective === "VERIFIED" && l.validUntil ? <span className="pc-sub">until {fmtDate(l.validUntil)}</span> : null}</td>
                        <td className="whitespace-nowrap text-meta">{l.linkedById ? users.get(l.linkedById) : "System"}<span className="pc-sub">{fmtDate(l.createdAt)}</span></td>
                        <td className="min-w-[250px] text-meta">
                          {l.reviewedById ? <span className="block">{users.get(l.reviewedById)} · {fmtDate(l.reviewedAt)}{l.reviewNote ? <span className="pc-sub">{l.reviewNote}</span> : null}</span> : null}
                          {l.status === "SUGGESTED" && canAssess ? (
                            <form action={proposeSuggestionAction} className="mt-1 inline-block">
                              <input type="hidden" name="back" value={back} /><input type="hidden" name="linkId" value={l.id} />
                              <button className="pc-btn-secondary pc-btn-sm" type="submit">Send for review</button>
                            </form>
                          ) : null}
                          {canVerify && !l.info.restricted && l.status !== "SUPERSEDED" ? (
                            <form action={reviewEvidenceAction} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <input type="hidden" name="back" value={back} /><input type="hidden" name="linkId" value={l.id} /><input type="hidden" name="updatedAt" value={l.updatedAt.toISOString()} />
                              <select name="to" className="input h-8 w-auto py-0 text-meta" aria-label={`Decision for ${l.info.label}`} defaultValue="">
                                <option value="" disabled>Decision…</option>
                                {l.status !== "VERIFIED" ? <option value="VERIFIED">Verify</option> : null}
                                <option value="REJECTED">Reject</option>
                                <option value="OUTDATED">Mark outdated</option>
                                <option value="SUPERSEDED">Mark superseded</option>
                              </select>
                              <input name="note" className="input h-8 w-[140px] py-0 text-meta" placeholder="Reason" aria-label="Reason for the decision" />
                              <button className="pc-btn-secondary pc-btn-sm" type="submit">Save</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PcTableWrap>
              {!rows.length ? <p className="pc-empty">{view === "AWAITING" ? "Nothing waiting for review." : "No evidence in this view."}</p> : null}
            </>
          )}
        </section>
      </div>
    </>
  );
}

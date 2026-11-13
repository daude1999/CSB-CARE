import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcFoot, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { ActionDialog } from "@/components/dialog";
import { LevelBadge, TrustBadge } from "@/components/policy-geo-ui";
import { Flash, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { TRUST_LABEL } from "@/server/policy-geo/applicability";
import { referenceLibrary } from "@/server/policy-geo/reference";
import { REGIONS, regionName } from "@/server/policy-geo/regions";
import { proposeSourceAction, refreshSourceAction, reviewSourceAction, supersedeSourceAction, updateSourceDetailsAction } from "@/app/policy-geo-actions";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Local Regulatory & Safeguarding References: the national, regional and local authority sources that branch policies
 * cite, with the organisation's own verification of each. A source is "verified" only after someone here has opened
 * the official page and recorded the check; failed automatic checks are shown as failed, never as unchanged.
 */
export default async function ReferenceLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId) notFound();
  const sp = await searchParams;
  const f = { level: sp.level || undefined, la: sp.la || undefined, trust: sp.trust || undefined, topic: sp.topic || undefined, q: sp.q || undefined };
  const [{ rows, localAuthorities }, categories] = await Promise.all([referenceLibrary(ctx, f), db.policyCategory.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } })]);
  const canVerify = hasOrgPermission(ctx, "policy.sources.verify");
  const canConfigure = hasOrgPermission(ctx, "policy.localConfig");
  const isPlatform = hasPlatformPermission(ctx, "sources.manage");
  const filtered = Boolean(f.level || f.la || f.trust || f.topic || f.q);
  const qs = new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const back = `/compliance/regulatory/references${qs ? `?${qs}` : ""}`;
  const counts = { verified: rows.filter((r) => r.trust === "verified").length, attention: rows.filter((r) => r.trust !== "verified").length };
  const current = rows.filter((r) => r.lifecycle === "CURRENT");

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="references" />}
        title="Regulatory Monitoring"
        subtitle="Local Regulatory & Safeguarding References: the national, regional and local authority sources that branch policies rely on. A source counts as verified only after someone here opens the official page and records the check."
        actions={
          canConfigure ? (
            <ActionDialog trigger="Add official source" title="Add an official source" description="Only an official page from the government, CQC, a council or a safeguarding board. It starts as not yet verified and is reviewed by hand." triggerClassName="pc-btn" size="lg">
              <form action={proposeSourceAction} className="space-y-3" data-testid="propose-source-form">
                <input type="hidden" name="back" value={back} />
                <label className="block"><span className="label">Official title</span><input name="name" required minLength={5} maxLength={300} className="input" /></label>
                <label className="block"><span className="label">Published by</span><input name="issuingOrganisation" required minLength={2} maxLength={200} className="input" placeholder="e.g. Wirral Safeguarding Adults Partnership" /></label>
                <label className="block"><span className="label">Official web address</span><input name="canonicalUrl" type="url" required pattern="https://.*" className="input" placeholder="https://" /></label>
                <label className="block"><span className="label">Applies at</span>
                  <select name="geoLevel" required className="input" defaultValue="LOCAL">
                    <option value="NATIONAL">National (all of England)</option>
                    <option value="REGIONAL">Regional</option>
                    <option value="LOCAL">Local authority</option>
                  </select>
                </label>
                <label className="block"><span className="label">Region (for regional sources)</span>
                  <select name="regionCodes" multiple className="input min-h-[96px]">
                    {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Local authorities (for local, or to narrow a regional source)</span>
                  <select name="localAuthorityCodes" multiple className="input min-h-[120px]">
                    {localAuthorities.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Policy topics it covers (none = all)</span>
                  <select name="topics" multiple className="input min-h-[96px]">
                    {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Version or edition</span><input name="versionLabel" maxLength={200} className="input" /></label>
                  <label className="block"><span className="label">Document reference</span><input name="documentReference" maxLength={200} className="input" /></label>
                  <label className="block"><span className="label">Published on</span><input name="publishedOn" type="date" className="input" /></label>
                  <label className="block"><span className="label">Effective from</span><input name="effectiveOn" type="date" className="input" /></label>
                </div>
                <label className="block"><span className="label">Summary in your own words</span><textarea name="referenceSummary" rows={3} maxLength={4000} className="input" /></label>
                <button className="pc-btn" type="submit">Add source</button>
              </form>
            </ActionDialog>
          ) : null
        }
      />
      <Flash searchParams={sp} />
      <section aria-label="Local and safeguarding references" className="pc-panel">
        <div className="pc-panel-head">
          <p className="text-[14px] text-[#344054]" data-testid="reference-summary">
            <strong className="tabular-nums">{counts.verified}</strong> verified · <strong className={`tabular-nums ${counts.attention ? "text-[#b54708]" : ""}`}>{counts.attention}</strong> not verified, due for review or failing · each branch policy cites only the sources for its own area
          </p>
        </div>
        <form method="get" action="/compliance/regulatory/references" className="pc-toolbar" role="search" aria-label="Filter references">
          <PcSearch defaultValue={f.q} placeholder="Search title or publisher" />
          <PcSelect name="level" label="Level" defaultValue={f.level ?? ""} options={[{ value: "", label: "All" }, { value: "NATIONAL", label: "National" }, { value: "REGIONAL", label: "Regional" }, { value: "LOCAL", label: "Local authority" }]} />
          <PcSelect name="la" label="Applies to" defaultValue={f.la ?? ""} options={[{ value: "", label: "Any area" }, ...localAuthorities.map((l) => ({ value: l.code, label: l.name }))]} />
          <PcSelect name="trust" label="Status" defaultValue={f.trust ?? ""} options={[{ value: "", label: "Any" }, ...Object.entries(TRUST_LABEL).map(([value, label]) => ({ value, label }))]} />
          <PcSelect name="topic" label="Topic" defaultValue={f.topic ?? ""} options={[{ value: "", label: "Any" }, ...categories.map((c) => ({ value: c.code, label: c.name }))]} />
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          {filtered ? <Link href="/compliance/regulatory/references" className="pc-link">Clear filters</Link> : null}
        </form>
        {rows.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="reference-table">
              <thead><tr><th>Source</th><th>Level</th><th>Applies to</th><th>Status</th><th>Last checked here</th><th>Next review</th><th>Policies</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const own = s.addedByOrganisationId === ctx.organisationId || isPlatform;
                  const automatic = s.coverage !== "MANUAL_REVIEW_ONLY" && s.monitoringMethod !== "MANUAL";
                  return (
                    <tr key={s.id} data-testid={`ref-${s.key}`}>
                      <td className="min-w-[260px] max-w-[380px]">
                        <a href={s.canonicalUrl} target="_blank" rel="noreferrer noopener" className="pc-strong">{s.name}</a>
                        <span className="pc-sub">{s.issuingOrganisation ?? "Publisher not recorded"}{s.versionLabel ? ` · ${s.versionLabel}` : ""}</span>
                        <span className="pc-sub">{automatic ? (s.lastSuccessAt ? `Automatic check: last succeeded ${fmtDate(s.lastSuccessAt)}` : "Automatic check: not yet succeeded") : "Reviewed by hand"}{s._count.changes ? <> · <Link href={`/changes?group=all&source=${s.id}`}>{s._count.changes} change{s._count.changes === 1 ? "" : "s"}</Link></> : null}</span>
                      </td>
                      <td><LevelBadge level={s.geoLevel} /></td>
                      <td className="max-w-[220px] text-[13px]">{s.areas || "Not set"}</td>
                      <td><TrustBadge trust={s.trust} />{s.review?.note ? <span className="pc-sub max-w-[200px] truncate" title={s.review.note}>{s.review.note}</span> : null}</td>
                      <td className="whitespace-nowrap">{s.review?.lastCheckedAt ? fmtDate(s.review.lastCheckedAt) : "Never"}</td>
                      <td className="whitespace-nowrap">{s.review?.nextReviewDate ? fmtDate(s.review.nextReviewDate) : "Not set"}</td>
                      <td className="tabular-nums">{s.policies}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canVerify ? (
                            <ActionDialog trigger="Record check" title="Record your check" description={`Open ${s.name} on the official site and record what you found. Marking it verified needs a note and a next review date.`} triggerClassName="pc-btn-secondary pc-btn-sm">
                              <form action={reviewSourceAction} className="space-y-3">
                                <input type="hidden" name="back" value={back} />
                                <input type="hidden" name="sourceId" value={s.id} />
                                <label className="block"><span className="label">Result</span>
                                  <select name="status" className="input" defaultValue="VERIFIED">
                                    <option value="VERIFIED">Verified: the page is current and says what we rely on</option>
                                    <option value="NEEDS_REVIEW">Needs review: something has changed or is unclear</option>
                                    <option value="UNVERIFIED">Not yet verified</option>
                                  </select>
                                </label>
                                <label className="block"><span className="label">What you checked</span><textarea name="note" rows={3} maxLength={2000} className="input" /></label>
                                <label className="block"><span className="label">Next review</span><input type="date" name="nextReviewDate" defaultValue={iso(s.review?.nextReviewDate)} className="input" /></label>
                                <button className="pc-btn" type="submit">Save check</button>
                              </form>
                            </ActionDialog>
                          ) : null}
                          {canVerify && automatic ? (
                            <form action={refreshSourceAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="sourceId" value={s.id} /><button className="pc-btn-secondary pc-btn-sm" type="submit">Check now</button></form>
                          ) : null}
                          {canConfigure && own ? (
                            <ActionDialog trigger="Details" title="Source details" description="Changes are kept in the audit history." triggerClassName="pc-btn-secondary pc-btn-sm" size="lg">
                              <form action={updateSourceDetailsAction} className="space-y-3">
                                <input type="hidden" name="back" value={back} />
                                <input type="hidden" name="sourceId" value={s.id} />
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <label className="block"><span className="label">Version or edition</span><input name="versionLabel" defaultValue={s.versionLabel ?? ""} maxLength={200} className="input" /></label>
                                  <label className="block"><span className="label">Document reference</span><input name="documentReference" defaultValue={s.documentReference ?? ""} maxLength={200} className="input" /></label>
                                  <label className="block"><span className="label">Published on</span><input name="publishedOn" type="date" defaultValue={iso(s.publishedOn)} className="input" /></label>
                                  <label className="block"><span className="label">Effective from</span><input name="effectiveOn" type="date" defaultValue={iso(s.effectiveOn)} className="input" /></label>
                                </div>
                                <label className="block"><span className="label">Summary</span><textarea name="referenceSummary" rows={3} defaultValue={s.referenceSummary ?? ""} maxLength={4000} className="input" /></label>
                                <button className="pc-btn" type="submit">Save details</button>
                              </form>
                              {s.lifecycle === "CURRENT" ? (
                                <form action={supersedeSourceAction} className="mt-5 space-y-3 border-t border-[#eaecf0] pt-4">
                                  <input type="hidden" name="back" value={back} />
                                  <input type="hidden" name="sourceId" value={s.id} />
                                  <p className="text-[14px] font-semibold text-[#101828]">Replaced by a newer source?</p>
                                  <label className="block"><span className="label">Replacement</span>
                                    <select name="replacementId" required className="input" defaultValue="">
                                      <option value="" disabled>Choose the replacement</option>
                                      {current.filter((c) => c.id !== s.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                  </label>
                                  <label className="block"><span className="label">Reason</span><input name="reason" required minLength={5} className="input" /></label>
                                  <button className="pc-btn-secondary" type="submit">Mark as superseded</button>
                                </form>
                              ) : null}
                            </ActionDialog>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">{filtered ? "No sources match these filters." : "No local or safeguarding sources yet."}</p>}
        <PcFoot shown={rows.length} total={rows.length}>
          <span className="pc-note">{f.la ? `Showing what applies in ${localAuthorities.find((l) => l.code === f.la)?.name ?? f.la} (${regionName(localAuthorities.find((l) => l.code === f.la)?.regionCode)}), including national sources.` : "National sources apply everywhere; regional and local ones only in their own area."}</span>
        </PcFoot>
      </section>
    </>
  );
}

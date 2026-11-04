import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcFoot } from "@/components/compliance-ui";
import { TrustBadge } from "@/components/policy-geo-ui";
import { Flash, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { canDecideAuthority, crossBoundaryCases } from "@/server/policy-geo/cross-boundary";
import { regionName } from "@/server/policy-geo/regions";
import { recordGeographyAction, recordIncidentLocationAction, recordSafeguardingDecisionAction } from "@/app/policy-geo-actions";

export const dynamic = "force-dynamic";

/**
 * Cross-boundary safeguarding. People supported by a branch can live, receive care or have an incident in another
 * local authority's area. The page shows each difference, the verified local procedures for every area involved and
 * the manager's recorded decision. The platform never decides which authority leads.
 */
export default async function CrossBoundaryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "serviceUser.view")) notFound();
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const [data, las] = await Promise.all([crossBoundaryCases(ctx, { showAll }), db.localAuthority.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true, regionCode: true } })]);
  const canEdit = hasOrgPermission(ctx, "serviceUser.edit");
  const canIncident = hasOrgPermission(ctx, "incident.manage");
  const canDecide = canDecideAuthority(ctx);
  const back = `/policies/cross-boundary${showAll ? "?show=all" : ""}`;
  const n = (c: string | null | undefined) => (c ? data.names.get(c) ?? c : "Not recorded");
  const laOptions = las.map((l) => <option key={l.code} value={l.code}>{l.name} ({regionName(l.regionCode)})</option>);

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="coverage" />}
        title="Cross-boundary safeguarding"
        subtitle="People whose home, place of care or incident is in a different local authority from their branch. The platform flags each difference and shows the verified local procedures for every area involved. A manager decides which authority's safeguarding procedures apply and records why; the platform never decides this itself."
        back="/policies/coverage"
      />
      <Flash searchParams={sp} />
      <section aria-label="Cross-boundary cases" className="pc-panel">
        <div className="pc-panel-head">
          <p className="text-[14px] text-[#344054]" data-testid="cross-boundary-summary">
            <strong>{data.crossing}</strong> of {data.total} people cross a boundary · <strong className={data.undecided ? "text-[#b42318]" : ""}>{data.undecided}</strong> without a recorded decision · <strong className={data.notRecorded ? "text-[#b54708]" : ""}>{data.notRecorded}</strong> with locations not recorded
          </p>
          <Link href={showAll ? "/policies/cross-boundary" : "/policies/cross-boundary?show=all"} className="pc-link">{showAll ? "Show only flagged people" : "Show everyone"}</Link>
        </div>
        {data.rows.length ? (
          <ul className="divide-y divide-[#eaecf0]" data-testid="cross-boundary-list">
            {data.rows.map(({ person: p, flags, decision, history }) => {
              const branchLa = p.branch?.policyProfile?.localAuthorityCode ?? null;
              const involved = [...new Set([branchLa, p.residenceLocalAuthorityCode, p.careLocationLocalAuthorityCode, ...p.incidents.map((i) => i.occurredLocalAuthorityCode)].filter((c): c is string => !!c))];
              return (
                <li key={p.id} className="px-5 py-4" data-testid={`xb-${p.lastName}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/rota/service-users/${p.id}`} className="text-[15px] font-semibold text-[#101828]">{p.preferredName || p.firstName} {p.lastName}</Link>
                      <p className="text-[13px] text-[#475467]">{p.branch?.name ?? "No branch"} branch · in {n(branchLa)}</p>
                    </div>
                    {decision ? <PcBadge tone="green">Decision recorded: {n(decision.safeguardingLocalAuthorityCode)}</PcBadge> : flags.some((f) => f.kind !== "not_recorded") ? <PcBadge tone="red">Decision needed</PcBadge> : <PcBadge tone="amber">Locations not recorded</PcBadge>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] md:grid-cols-5">
                    <div><dt className="pc-note">Branch area</dt><dd>{n(branchLa)}</dd></div>
                    <div><dt className="pc-note">Lives in</dt><dd>{n(p.residenceLocalAuthorityCode)}</dd></div>
                    <div><dt className="pc-note">Receives care in</dt><dd>{n(p.careLocationLocalAuthorityCode)}</dd></div>
                    <div><dt className="pc-note">Funded by</dt><dd>{p.fundingAuthority ?? "Not recorded"}</dd></div>
                    <div><dt className="pc-note">Safeguarding authority</dt><dd>{p.safeguardingLocalAuthorityCode ? n(p.safeguardingLocalAuthorityCode) : "Not decided"}</dd></div>
                  </dl>
                  {flags.length ? (
                    <ul className="mt-3 space-y-1 text-[13.5px]" aria-label="Differences found">
                      {flags.map((f, i) => <li key={i} className={f.kind === "not_recorded" ? "text-[#b54708]" : "text-[#b42318]"}>{f.text}</li>)}
                    </ul>
                  ) : null}
                  {decision ? (
                    <p className="mt-2 text-[13px] text-[#344054]"><span className="font-semibold">Latest decision</span> by {decision.by}, {fmtDate(decision.decidedAt, true)}: {decision.reasoning}{history.length > 1 ? ` (${history.length - 1} earlier decision${history.length === 2 ? "" : "s"} kept)` : ""}</p>
                  ) : null}

                  {flags.some((f) => f.laCodes.length) ? (
                    <div className="mt-3 rounded-[10px] border border-[#eaecf0] bg-[#fcfcfd] p-3">
                      <p className="text-[13px] font-semibold text-[#344054]">Local procedures for the other areas involved</p>
                      {[...new Set(flags.flatMap((f) => f.laCodes))].map((code) => {
                        const procs = data.procedures.get(code) ?? [];
                        return (
                          <div key={code} className="mt-2 text-[13px]">
                            <span className="font-medium text-[#101828]">{n(code)}:</span>{" "}
                            {procs.length ? procs.map((s, i) => <span key={s.id}>{i ? " · " : ""}<a href={s.canonicalUrl} target="_blank" rel="noreferrer noopener" className="pc-link">{s.name}</a> <TrustBadge trust={s.trust} /></span>) : <span className="text-[#b42318]">No local safeguarding source recorded. Add one in Local &amp; Safeguarding References before relying on this area’s procedures.</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {(canEdit || canDecide || canIncident) ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[13.5px] font-semibold text-[#5b2bb5]">Record locations or a decision</summary>
                      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {canEdit ? (
                          <form action={recordGeographyAction} className="space-y-2 rounded-[10px] border border-[#eaecf0] p-3">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="serviceUserId" value={p.id} />
                            <p className="text-[13.5px] font-semibold text-[#101828]">Where the person lives and receives care</p>
                            <label className="block"><span className="label">Lives in</span><select name="residence" defaultValue={p.residenceLocalAuthorityCode ?? ""} className="input"><option value="">Not recorded</option>{laOptions}</select></label>
                            <label className="block"><span className="label">Receives care in</span><select name="careLocation" defaultValue={p.careLocationLocalAuthorityCode ?? ""} className="input"><option value="">Not recorded</option>{laOptions}</select></label>
                            <label className="block"><span className="label">Funded by</span><input name="fundingAuthority" defaultValue={p.fundingAuthority ?? ""} maxLength={200} className="input" placeholder="e.g. the council, the NHS or self-funded" /></label>
                            <button className="pc-btn-secondary pc-btn-sm" type="submit">Save locations</button>
                          </form>
                        ) : null}
                        {canIncident && p.incidents.length ? (
                          <div className="space-y-2 rounded-[10px] border border-[#eaecf0] p-3">
                            <p className="text-[13.5px] font-semibold text-[#101828]">Where incidents happened (last 12 months)</p>
                            {p.incidents.map((i) => (
                              <form key={i.id} action={recordIncidentLocationAction} className="flex flex-wrap items-end gap-2">
                                <input type="hidden" name="back" value={back} />
                                <input type="hidden" name="incidentId" value={i.id} />
                                <label className="block min-w-[180px] flex-1"><span className="label">{i.reference}{i.safeguarding ? " (safeguarding)" : ""} · {fmtDate(i.occurredAt)}</span><select name="la" defaultValue={i.occurredLocalAuthorityCode ?? ""} className="input"><option value="">Not recorded</option>{laOptions}</select></label>
                                <button className="pc-btn-secondary pc-btn-sm" type="submit">Save</button>
                              </form>
                            ))}
                          </div>
                        ) : null}
                        {canDecide ? (
                          <form action={recordSafeguardingDecisionAction} className="space-y-2 rounded-[10px] border border-[#eaecf0] p-3">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="serviceUserId" value={p.id} />
                            <p className="text-[13.5px] font-semibold text-[#101828]">Manager’s decision</p>
                            <label className="block"><span className="label">Whose safeguarding procedures apply</span>
                              <select name="la" required defaultValue="" className="input">
                                <option value="" disabled>Choose the authority</option>
                                {involved.length ? <optgroup label="Areas involved">{involved.map((c) => <option key={c} value={c}>{n(c)}</option>)}</optgroup> : null}
                                <optgroup label="All local authorities">{laOptions}</optgroup>
                              </select>
                            </label>
                            {p.incidents.length ? (
                              <label className="block"><span className="label">For one incident only (optional)</span>
                                <select name="incidentId" defaultValue="" className="input"><option value="">The person generally</option>{p.incidents.map((i) => <option key={i.id} value={i.id}>{i.reference}</option>)}</select>
                              </label>
                            ) : null}
                            <label className="block"><span className="label">Reasons</span><textarea name="reasoning" required minLength={20} maxLength={4000} rows={3} className="input" placeholder="What you checked and why this authority leads" /></label>
                            <button className="pc-btn pc-btn-sm" type="submit">Record decision</button>
                            <p className="pc-note">Decisions are kept; a later one supersedes, never edits, an earlier one.</p>
                          </form>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="pc-empty">{showAll ? "No active service users." : "No one is flagged: every recorded location is in the branch's own area."}</p>}
        <PcFoot shown={data.rows.length} total={data.total} />
      </section>
    </>
  );
}

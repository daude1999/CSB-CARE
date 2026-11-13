import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcFoot, PcTableWrap } from "@/components/compliance-ui";
import { ActionDialog } from "@/components/dialog";
import { Fact } from "@/components/policy-geo-ui";
import { Flash, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listBranchProfiles } from "@/server/policy-geo/branches";
import { REGIONS, regionName } from "@/server/policy-geo/regions";
import { addLocalAuthorityAction, saveBranchProfileAction, verifyBranchProfileAction } from "@/app/policy-geo-actions";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * Branch & Local Authority Configuration (Company Policy Settings). Each branch's local authority, region,
 * safeguarding board, local procedures and contacts, entered from official sources and verified by a manager. The
 * Policy Generator reads only what is recorded and verified here; nothing is filled in for the office.
 */
export default async function BranchConfigurationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "policy.localConfig")) notFound();
  const sp = await searchParams;
  const branches = await listBranchProfiles(ctx);
  const selected = sp.branch ? branches.find((b) => b.id === sp.branch) ?? null : null;
  const [las, serviceTypes, members, sources, history] = await Promise.all([
    db.localAuthority.findMany({ orderBy: { name: "asc" } }),
    db.serviceType.findMany({ orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { organisationId: ctx.organisationId }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    selected ? db.regulatorySource.findMany({ where: { active: true, lifecycle: "CURRENT", isSimulated: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    selected ? db.auditLog.findMany({ where: { organisationId: ctx.organisationId, entityType: "Branch", entityId: selected.id }, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
  ]);
  const names = new Map(members.map((m) => [m.user.id, m.user.name]));
  const now = new Date();
  const back = selected ? `/policies/branches?branch=${selected.id}` : "/policies/branches";

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="branches" />}
        title="Branch & Local Authority Configuration"
        subtitle="Where each branch operates and the local safeguarding arrangements that apply there. Enter details only from the local authority's or safeguarding board's own pages, then have a manager verify them. The Policy Generator uses only what is recorded here."
        actions={
          <ActionDialog trigger="Add local authority" title="Add a local authority" description="For a branch or service user area that is not in the list yet. Use the council's official name." triggerClassName="pc-btn-secondary">
            <form action={addLocalAuthorityAction} className="space-y-3">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">Name</span><input name="name" required minLength={3} maxLength={120} className="input" placeholder="e.g. Wirral" /></label>
              <label className="block"><span className="label">Region</span>
                <select name="regionCode" required className="input" defaultValue="">
                  <option value="" disabled>Choose a region</option>
                  {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Sub-region or partnership (optional)</span><input name="subRegion" maxLength={120} className="input" placeholder="e.g. Merseyside" /></label>
              <button className="pc-btn" type="submit">Add local authority</button>
            </form>
          </ActionDialog>
        }
      />
      <Flash searchParams={sp} />
      <section aria-label="Branches" className="pc-panel">
        <PcTableWrap>
          <table className="pc-table" data-testid="branch-config-table">
            <thead><tr><th>Branch</th><th>Local authority</th><th>Region</th><th>Safeguarding Adults Board</th><th>Configuration</th><th>Local contacts</th><th>Next review</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {branches.map((b) => {
                const p = b.policyProfile;
                const overdue = p?.nextReviewDate && p.nextReviewDate < now;
                return (
                  <tr key={b.id} data-testid={`branch-row-${b.name}`} aria-selected={selected?.id === b.id}>
                    <td><span className="pc-strong">{b.name}</span><span className="pc-sub">{p?.branchReference ? `Ref ${p.branchReference}` : "No branch reference"}{p?.postcode ? ` · ${p.postcode}` : ""}</span></td>
                    <td>{p?.localAuthority?.name ?? <PcBadge tone="red">Not set</PcBadge>}</td>
                    <td>{p?.regionCode ? regionName(p.regionCode) : <PcBadge tone="red">Not set</PcBadge>}</td>
                    <td className="max-w-[220px] text-meta">{p?.safeguardingAdultsBoard ?? <span className="text-[#b42318]">Not recorded</span>}</td>
                    <td>{p?.lastVerifiedAt ? <PcBadge tone="green">Verified {fmtDate(p.lastVerifiedAt)}</PcBadge> : <PcBadge tone="amber">Not verified</PcBadge>}</td>
                    <td>{p?.contactsVerifiedAt ? <PcBadge tone="green">Confirmed</PcBadge> : p?.safeguardingContacts ? <PcBadge tone="amber">Not confirmed</PcBadge> : <PcBadge tone="red">Missing</PcBadge>}</td>
                    <td className="whitespace-nowrap">{p?.nextReviewDate ? <span className={overdue ? "font-semibold text-[#b42318]" : ""}>{fmtDate(p.nextReviewDate)}{overdue ? " (overdue)" : ""}</span> : "Not set"}</td>
                    <td className="text-right"><Link href={`/policies/branches?branch=${b.id}#edit`} className="pc-link">{selected?.id === b.id ? "Editing" : "Edit"}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PcTableWrap>
        {!branches.length ? <p className="pc-empty">No branches yet. Add branches in Administration, then configure them here.</p> : null}
        <PcFoot shown={branches.length} total={branches.length}>
          <span className="pc-note">{las.length} local authorities in the list</span>
        </PcFoot>
      </section>

      {selected?.policyProfile ? (
        <div id="edit" className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label={`Configure ${selected.name}`} className="pc-panel">
            <div className="pc-panel-head"><h2 className="text-lead font-semibold text-[#101828]">{selected.name}: branch details</h2></div>
            <form action={saveBranchProfileAction} className="space-y-6 p-5" data-testid="branch-profile-form">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="branchId" value={selected.id} />
              <input type="hidden" name="version" value={selected.policyProfile.version} />
              <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <legend className="mb-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#667085]">Location</legend>
                <label className="block"><span className="label">Branch reference</span><input name="branchReference" defaultValue={selected.policyProfile.branchReference ?? ""} maxLength={60} className="input" /></label>
                <label className="block"><span className="label">Postcode</span><input name="postcode" defaultValue={selected.policyProfile.postcode ?? ""} maxLength={10} className="input" autoComplete="off" /></label>
                <label className="block md:col-span-2"><span className="label">Branch address</span><textarea name="address" defaultValue={selected.address ?? ""} maxLength={400} rows={2} className="input" /></label>
                <label className="block"><span className="label">Local authority</span>
                  <select name="localAuthorityCode" defaultValue={selected.policyProfile.localAuthorityCode ?? ""} className="input" data-testid="la-select">
                    <option value="">Not set</option>
                    {las.map((l) => <option key={l.code} value={l.code}>{l.name} ({regionName(l.regionCode)})</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Region</span>
                  <select name="regionCode" defaultValue={selected.policyProfile.regionCode ?? ""} className="input">
                    <option value="">Not set</option>
                    {REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </label>
                <div className="md:col-span-2">
                  <span className="label">Services provided</span>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {serviceTypes.map((t) => (
                      <label key={t.code} className="flex items-center gap-2 text-body"><input type="checkbox" name="serviceTypes" value={t.code} defaultChecked={selected.services.some((s) => s.serviceTypeCode === t.code)} className="pc-check" />{t.name}</label>
                    ))}
                  </div>
                </div>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <legend className="mb-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#667085]">Safeguarding arrangements</legend>
                <label className="block"><span className="label">Safeguarding Adults Board</span><input name="safeguardingAdultsBoard" defaultValue={selected.policyProfile.safeguardingAdultsBoard ?? ""} maxLength={200} className="input" /></label>
                <label className="block"><span className="label">Safeguarding Children Partnership</span><input name="safeguardingChildrenPartnership" defaultValue={selected.policyProfile.safeguardingChildrenPartnership ?? ""} maxLength={200} className="input" /></label>
                <label className="block md:col-span-2"><span className="label">Regional multi-agency guidance that applies</span><textarea name="regionalGuidance" defaultValue={selected.policyProfile.regionalGuidance ?? ""} maxLength={2000} rows={2} className="input" /></label>
                <label className="block md:col-span-2"><span className="label">Local safeguarding procedure (how staff raise a concern here)</span><textarea name="localProcedures" defaultValue={selected.policyProfile.localProcedures ?? ""} maxLength={6000} rows={4} className="input" /><span className="pc-note">Copy the steps from the official local page. Leave blank if not yet confirmed; the generator will mark it for review rather than guess.</span></label>
                <label className="block md:col-span-2"><span className="label">Official referral web page</span><input name="referralUrl" type="url" defaultValue={selected.policyProfile.referralUrl ?? ""} maxLength={400} className="input" placeholder="https://" /></label>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <legend className="mb-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#667085]">Local contacts</legend>
                <p className="pc-note md:col-span-2">Enter contact details exactly as published on the council or safeguarding board’s own website. Never use numbers from memory or other providers’ documents. Changing these clears the “confirmed” mark.</p>
                <label className="block"><span className="label">Safeguarding contacts (office hours)</span><textarea name="safeguardingContacts" defaultValue={selected.policyProfile.safeguardingContacts ?? ""} maxLength={2000} rows={3} className="input" /></label>
                <label className="block"><span className="label">Out-of-hours contacts</span><textarea name="outOfHoursContacts" defaultValue={selected.policyProfile.outOfHoursContacts ?? ""} maxLength={2000} rows={3} className="input" /></label>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <legend className="mb-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#667085]">Health and commissioning</legend>
                <label className="block"><span className="label">Integrated Care Board</span><input name="integratedCareBoard" defaultValue={selected.policyProfile.integratedCareBoard ?? ""} maxLength={200} className="input" /></label>
                <label className="block md:col-span-2"><span className="label">Commissioning arrangements</span><textarea name="commissioningArrangements" defaultValue={selected.policyProfile.commissioningArrangements ?? ""} maxLength={2000} rows={2} className="input" /></label>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <legend className="mb-2 text-meta font-semibold uppercase tracking-[0.04em] text-[#667085]">Ownership and review</legend>
                <label className="block"><span className="label">Responsible manager</span>
                  <select name="responsibleManagerId" defaultValue={selected.policyProfile.responsibleManagerId ?? ""} className="input">
                    <option value="">Not set</option>
                    {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Next review date</span><input type="date" name="nextReviewDate" defaultValue={iso(selected.policyProfile.nextReviewDate)} className="input" /></label>
                <label className="block md:col-span-2"><span className="label">Other sources that apply to this branch</span>
                  <select name="extraSourceIds" multiple defaultValue={selected.policyProfile.extraSourceIds} className="input min-h-[120px]">
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <span className="pc-note">Sources for the branch’s local authority and region are picked up automatically. Add others only when they genuinely apply here.</span>
                </label>
              </fieldset>
              <div className="flex flex-wrap items-center gap-3 border-t border-[#eaecf0] pt-4">
                <button className="pc-btn" type="submit">Save branch</button>
                <Link href="/policies/branches" className="pc-link">Cancel</Link>
                <span className="pc-note">Changing the local authority, region, board or procedures clears the manager’s verification.</span>
              </div>
            </form>
          </section>

          <aside className="space-y-4" aria-label="Verification">
            <section className="pc-panel" aria-label="Verify configuration">
              <div className="pc-panel-head"><h2 className="text-lead font-semibold text-[#101828]">Verification</h2></div>
              <dl className="grid grid-cols-1 gap-3 p-4">
                <Fact label="Configuration">{selected.policyProfile.lastVerifiedAt ? `Verified ${fmtDate(selected.policyProfile.lastVerifiedAt)} by ${names.get(selected.policyProfile.lastVerifiedById ?? "") ?? "a manager"}` : "Not verified"}</Fact>
                <Fact label="Local contacts">{selected.policyProfile.contactsVerifiedAt ? `Confirmed ${fmtDate(selected.policyProfile.contactsVerifiedAt)} by ${names.get(selected.policyProfile.contactsVerifiedById ?? "") ?? "a manager"}` : "Not confirmed"}</Fact>
                <Fact label="Responsible manager">{names.get(selected.policyProfile.responsibleManagerId ?? "") ?? "Not set"}</Fact>
              </dl>
              <form action={verifyBranchProfileAction} className="space-y-3 border-t border-[#eaecf0] p-4" data-testid="verify-profile-form">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="branchId" value={selected.id} />
                <input type="hidden" name="what" value="profile" />
                <label className="block"><span className="label">What you checked</span><textarea name="note" required minLength={10} rows={2} className="input" placeholder="e.g. Checked the council's safeguarding page and the SAB procedures page" /></label>
                <label className="block"><span className="label">Next review</span><input type="date" name="nextReviewDate" required defaultValue={iso(selected.policyProfile.nextReviewDate)} className="input" /></label>
                <button className="pc-btn pc-btn-sm" type="submit">Verify configuration</button>
              </form>
              <form action={verifyBranchProfileAction} className="space-y-3 border-t border-[#eaecf0] p-4" data-testid="verify-contacts-form">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="branchId" value={selected.id} />
                <input type="hidden" name="what" value="contacts" />
                <label className="block"><span className="label">Where the contacts were confirmed</span><textarea name="note" required minLength={10} rows={2} className="input" placeholder="The official page you checked the numbers against" /></label>
                <button className="pc-btn-secondary pc-btn-sm" type="submit">Confirm local contacts</button>
              </form>
            </section>
            <section className="pc-panel" aria-label="History">
              <div className="pc-panel-head"><h2 className="text-lead font-semibold text-[#101828]">History</h2></div>
              {history.length ? (
                <ul className="divide-y divide-[#f2f4f7]">
                  {history.map((h) => (
                    <li key={h.id} className="px-4 py-2.5 text-meta"><span className="font-medium text-[#101828]">{HISTORY_LABEL[h.action] ?? h.action}</span><span className="block text-[#667085]">{fmtDate(h.createdAt, true)} · {names.get(h.actorId ?? "") ?? "System"}</span></li>
                  ))}
                </ul>
              ) : <p className="px-4 py-3 text-meta text-[#667085]">No changes recorded yet.</p>}
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  "branch.policy_profile_updated": "Details changed",
  "branch.policy_profile_verified": "Configuration verified",
  "branch.contacts_verified": "Local contacts confirmed",
};

import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcTableWrap } from "@/components/compliance-ui";
import { GeneratorSteps, LevelBadge, SeverityBadge, TrustBadge } from "@/components/policy-geo-ui";
import { Flash, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getAiProvider } from "@/server/ai";
import { listBranchProfiles } from "@/server/policy-geo/branches";
import { assembleRequirements, recentRuns, type AssembledSource } from "@/server/policy-geo/generator";
import { regionName } from "@/server/policy-geo/regions";
import { generatePolicyAction } from "@/app/policy-geo-actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

const MODES = [
  { value: "SHARED_WITH_APPENDICES", label: "One company policy with a branch appendix", detail: "The shared policy stays the same for every branch. Each branch gets an appendix with its own local authority, safeguarding board, procedures and contacts." },
  { value: "BRANCH_SPECIFIC", label: "A separate policy for each branch", detail: "Each branch gets its own policy, linked to the company policy, for areas where the local arrangements differ a lot." },
  { value: "NATIONAL", label: "National policy only", detail: "No branch-specific content. Use for policies that are the same everywhere in England." },
] as const;
const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.label]));
const METHOD_LABEL: Record<string, string> = { AI: "AI-assisted, checked against sources", SOURCE_GUIDED: "Built from recorded sources (no AI)" };

function SourceTable({ sources, empty }: { sources: AssembledSource[]; empty: string }) {
  if (!sources.length) return <p className="px-5 py-3 text-[13.5px] text-[#b42318]">{empty}</p>;
  return (
    <PcTableWrap>
      <table className="pc-table">
        <thead><tr><th>Ref</th><th>Source</th><th>Level</th><th>Applies to</th><th>Status</th><th>Last checked here</th></tr></thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className="font-semibold">{s.label}</td>
              <td className="min-w-[260px] max-w-[420px]"><a href={s.url} target="_blank" rel="noreferrer noopener" className="pc-strong">{s.name}</a><span className="pc-sub">{s.issuer ?? "Publisher not recorded"}{s.versionLabel ? ` · ${s.versionLabel}` : ""}</span></td>
              <td><LevelBadge level={s.level} /></td>
              <td className="text-[13px]">{s.areas}</td>
              <td><TrustBadge trust={s.trust} /></td>
              <td className="whitespace-nowrap">{s.lastChecked ? fmtDate(s.lastChecked) : "Never"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PcTableWrap>
  );
}

/**
 * The branch-specific Policy Generator: Select policy → Select branches → Review applicable requirements → Generate
 * draft. Checking and publication then happen on the draft through the normal workflow. Every step is a plain
 * GET form, so the choices are in the address bar and the office can go back without losing them.
 */
export default async function PolicyGeneratorPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId || !hasOrgPermission(ctx, "policy.author")) notFound();
  const sp = await searchParams;
  const basis = one(sp.basis);
  const policyId = one(sp.policy) || (basis === "TEMPLATE" ? one(sp.tpl) : basis === "POLICY" ? one(sp.own) : "");
  const title = one(sp.title);
  const ref = one(sp.ref).toUpperCase();
  const category = one(sp.category);
  const mode = one(sp.mode);
  const chosenBranches = many(sp.branch);
  const done = one(sp.done).split(",").filter(Boolean);

  const [branches, ownPolicies, templates, categories, runs] = await Promise.all([
    listBranchProfiles(ctx),
    db.policy.findMany({ where: { organisationId: ctx.organisationId, kind: "CUSTOMER", status: "ACTIVE", currentPublishedVersionId: { not: null } }, select: { id: true, ref: true, title: true, categoryCode: true }, orderBy: { title: "asc" } }),
    db.policy.findMany({ where: { kind: "MASTER", organisationId: null, status: "ACTIVE", currentPublishedVersionId: { not: null } }, select: { id: true, ref: true, title: true, categoryCode: true }, orderBy: { title: "asc" } }),
    db.policyCategory.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    recentRuns(ctx, 10),
  ]);
  const basisPolicy = basis === "TEMPLATE" ? templates.find((t) => t.id === policyId) : basis === "POLICY" ? ownPolicies.find((p) => p.id === policyId) : undefined;
  const step1Done = basis === "NEW" ? title.length >= 5 && /^[A-Z0-9][A-Z0-9-]{2,39}$/.test(ref) && categories.some((c) => c.code === category) : Boolean(basisPolicy);
  const validBranches = chosenBranches.filter((id) => branches.some((b) => b.id === id));
  const step2Done = step1Done && MODES.some((m) => m.value === mode) && (mode === "NATIONAL" ? true : validBranches.length > 0);
  const categoryCode = basisPolicy?.categoryCode ?? category;
  const categoryName = categories.find((c) => c.code === categoryCode)?.name ?? categoryCode;
  const assembly = step2Done ? await assembleRequirements(ctx, { categoryCode, branchIds: mode === "NATIONAL" ? [] : validBranches, basisPolicyId: basisPolicy?.id ?? null }) : null;
  const ai = getAiProvider();
  const aiAvailable = Boolean(ai?.draftBranchPolicy) && !ai?.isSimulated;
  const step = !step1Done ? 1 : !step2Done ? 2 : 3;
  const basisHidden = (
    <>
      <input type="hidden" name="basis" value={basis} />
      {basisPolicy ? <input type="hidden" name="policy" value={basisPolicy.id} /> : null}
      {basis === "NEW" ? <><input type="hidden" name="title" value={title} /><input type="hidden" name="ref" value={ref} /><input type="hidden" name="category" value={category} /></> : null}
    </>
  );
  const criticalCount = assembly ? assembly.nationalGaps.filter((g) => g.severity === "CRITICAL").length + assembly.branches.reduce((n, b) => n + b.gaps.filter((g) => g.severity === "CRITICAL").length, 0) : 0;
  const doneRuns = runs.filter((r) => done.includes(r.id));

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="generator" />}
        title="Policy Generator"
        subtitle="Create a draft that combines national requirements with each branch's regional and local safeguarding arrangements. You see every source before anything is generated, missing or unverified sources are flagged, and an authorised person checks the draft and confirms the local arrangements before publishing it."
      />
      <Flash searchParams={Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]))} />

      {doneRuns.length ? (
        <section className="pc-panel mb-4" aria-label="Drafts generated" data-testid="generated-drafts">
          <div className="pc-panel-head"><h2 className="text-[15px] font-semibold text-[#101828]">Drafts generated</h2><span className="pc-note">Open each draft to check it, resolve gaps and send it for review.</span></div>
          <ul className="divide-y divide-[#f2f4f7]">
            {doneRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px]">
                <span><span className="font-semibold text-[#101828]">{r.policy.ref} {r.policy.title}</span><span className="block text-[13px] text-[#667085]">{r.branchNames.join(", ") || "All branches"} · {METHOD_LABEL[r.method] ?? r.method}</span></span>
                <span className="flex items-center gap-3">{r.openCritical ? <PcBadge tone="red">{r.openCritical} critical gap{r.openCritical === 1 ? "" : "s"}</PcBadge> : <PcBadge tone="green">No critical gaps</PcBadge>}{r.revisionId ? <Link href={`/revisions/${r.revisionId}`} className="pc-link">Open draft</Link> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pc-panel" aria-label="Generate a policy">
        <GeneratorSteps current={step} />

        {/* Step 1 */}
        <div className="border-b border-[#eaecf0] p-5">
          <h2 className="text-[15px] font-semibold text-[#101828]">1. Select policy</h2>
          {step1Done ? (
            <p className="mt-1 text-[14px] text-[#344054]" data-testid="chosen-basis">
              {basisPolicy ? <>{basis === "TEMPLATE" ? "CSB template" : "Your policy"}: <strong>{basisPolicy.ref} {basisPolicy.title}</strong></> : <>New policy: <strong>{ref} {title}</strong></>} · {categoryName}{" "}
              <Link href="/policies/generator" className="pc-link ml-2">Change</Link>
            </p>
          ) : (
            <form method="get" action="/policies/generator" className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="generator-step1">
              <fieldset className="rounded-[10px] border border-[#eaecf0] p-4">
                <legend className="px-1 text-[14px] font-semibold text-[#101828]"><label className="flex items-center gap-2"><input type="radio" name="basis" value="POLICY" defaultChecked={basis !== "TEMPLATE" && basis !== "NEW"} className="pc-check" />One of your policies</label></legend>
                <select name="own" className="input mt-2" defaultValue={basis === "POLICY" ? policyId : ""} aria-label="Your policy">
                  <option value="">Choose a policy</option>
                  {ownPolicies.map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}
                </select>
                <p className="pc-note mt-2">Only published policies can be used as a basis.</p>
              </fieldset>
              <fieldset className="rounded-[10px] border border-[#eaecf0] p-4">
                <legend className="px-1 text-[14px] font-semibold text-[#101828]"><label className="flex items-center gap-2"><input type="radio" name="basis" value="TEMPLATE" defaultChecked={basis === "TEMPLATE"} className="pc-check" />A CSB template</label></legend>
                <select name="tpl" className="input mt-2" defaultValue={basis === "TEMPLATE" ? policyId : ""} aria-label="CSB template">
                  <option value="">Choose a template</option>
                  {templates.map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}
                </select>
                <p className="pc-note mt-2">If you already use this template, your own copy is updated instead.</p>
              </fieldset>
              <fieldset className="rounded-[10px] border border-[#eaecf0] p-4">
                <legend className="px-1 text-[14px] font-semibold text-[#101828]"><label className="flex items-center gap-2"><input type="radio" name="basis" value="NEW" defaultChecked={basis === "NEW"} className="pc-check" />A new policy</label></legend>
                <div className="mt-2 space-y-2">
                  <input name="title" defaultValue={title} maxLength={200} className="input" placeholder="Title" aria-label="New policy title" />
                  <input name="ref" defaultValue={ref} maxLength={40} className="input" placeholder="Reference, e.g. CSB-SG-010" aria-label="New policy reference" />
                  <select name="category" defaultValue={category} className="input" aria-label="Category">
                    <option value="">Category</option>
                    {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
              </fieldset>
              <div className="lg:col-span-3">
                {basis && !step1Done ? <p className="mb-2 text-[13.5px] text-[#b42318]" role="alert">{basis === "NEW" ? "Give a title (5+ characters), a reference such as CSB-SG-010 and a category." : "Choose the policy to start from."}</p> : null}
                <button className="pc-btn" type="submit">Continue</button>
              </div>
            </form>
          )}
        </div>

        {/* Step 2 */}
        <div className="border-b border-[#eaecf0] p-5">
          <h2 className={`text-[15px] font-semibold ${step1Done ? "text-[#101828]" : "text-[#98a2b3]"}`}>2. Select branches</h2>
          {step1Done && step2Done ? (
            <p className="mt-1 text-[14px] text-[#344054]" data-testid="chosen-branches">
              {MODE_LABEL[mode]} · {mode === "NATIONAL" ? "every branch" : branches.filter((b) => validBranches.includes(b.id)).map((b) => b.name).join(", ")}
              <Link href={`/policies/generator?${new URLSearchParams({ basis, ...(basisPolicy ? { policy: basisPolicy.id } : { title, ref, category }) })}`} className="pc-link ml-2">Change</Link>
            </p>
          ) : step1Done ? (
            <form method="get" action="/policies/generator" className="mt-3 space-y-4" data-testid="generator-step2">
              {basisHidden}
              <fieldset>
                <legend className="label">How should branch arrangements be handled?</legend>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {MODES.map((m) => (
                    <label key={m.value} className="flex gap-3 rounded-[10px] border border-[#eaecf0] p-4 has-[:checked]:border-module has-[:checked]:bg-module/[.04]">
                      <input type="radio" name="mode" value={m.value} defaultChecked={(mode || "SHARED_WITH_APPENDICES") === m.value} className="pc-check mt-0.5" />
                      <span><span className="block text-[14px] font-semibold text-[#101828]">{m.label}</span><span className="mt-1 block text-[13px] text-[#475467]">{m.detail}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">Branches (not needed for a national policy)</legend>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {branches.map((b) => {
                    const p = b.policyProfile;
                    return (
                      <label key={b.id} className="flex gap-3 rounded-[10px] border border-[#eaecf0] p-3 has-[:checked]:border-module">
                        <input type="checkbox" name="branch" value={b.id} defaultChecked={validBranches.includes(b.id)} className="pc-check mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-semibold text-[#101828]">{b.name}</span>
                          <span className="block text-[13px] text-[#475467]">{p?.localAuthority?.name ?? "Local authority not set"} · {regionName(p?.regionCode)}</span>
                          <span className="mt-1 block">{p?.lastVerifiedAt ? <PcBadge tone="green">Configuration verified</PcBadge> : <PcBadge tone="amber">Configuration not verified</PcBadge>}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {hasOrgPermission(ctx, "policy.localConfig") ? <p className="pc-note mt-2"><Link href="/policies/branches" className="pc-link">Branch & Local Authority Configuration</Link> is where each branch’s area and local arrangements are recorded.</p> : null}
              </fieldset>
              {mode && !step2Done ? <p className="text-[13.5px] text-[#b42318]" role="alert">Choose at least one branch, or choose a national policy.</p> : null}
              <button className="pc-btn" type="submit">Review requirements</button>
            </form>
          ) : null}
        </div>

        {/* Step 3 and 4 */}
        <div className="p-5">
          <h2 className={`text-[15px] font-semibold ${assembly ? "text-[#101828]" : "text-[#98a2b3]"}`}>3. Review applicable requirements</h2>
          {assembly ? (
            <div className="mt-3 space-y-5" data-testid="generator-review">
              <p className="text-[14px] text-[#344054]">These are the sources the draft will cite, labelled S1, S2 and so on. Regional and local sources are matched to each branch’s own area only. Nothing is generated for an area without its own recorded sources.</p>
              <div className="pc-panel">
                <div className="pc-panel-head"><h3 className="text-[14px] font-semibold text-[#101828]">National (England)</h3></div>
                <SourceTable sources={assembly.national} empty="No national sources recorded for this topic." />
                {assembly.requirements.length ? (
                  <div className="border-t border-[#eaecf0] px-5 py-3">
                    <p className="text-[13px] font-semibold text-[#344054]">Requirements Register entries mapped to this policy</p>
                    <ul className="mt-1 list-disc pl-5 text-[13px] text-[#475467]">{assembly.requirements.map((r) => <li key={r.ref}>{r.ref}: {r.title} ({r.exactReference})</li>)}</ul>
                  </div>
                ) : null}
                {assembly.nationalGaps.length ? <GapList gaps={assembly.nationalGaps} /> : null}
              </div>
              {assembly.branches.map((b) => (
                <div key={b.id} className="pc-panel" data-testid={`review-branch-${b.name}`}>
                  <div className="pc-panel-head">
                    <h3 className="text-[14px] font-semibold text-[#101828]">{b.name}</h3>
                    <span className="text-[13px] text-[#475467]">{b.localAuthority ?? "Local authority not set"} · {b.region ?? "Region not set"}</span>
                  </div>
                  <p className="px-5 pt-3 text-[13px] font-semibold text-[#344054]">Regional</p>
                  <SourceTable sources={b.regional} empty="No regional source recorded for this branch's region." />
                  <p className="px-5 pt-3 text-[13px] font-semibold text-[#344054]">Local authority</p>
                  <SourceTable sources={b.local} empty="No local authority source recorded for this branch." />
                  <GapList gaps={b.gaps} />
                </div>
              ))}

              <form action={generatePolicyAction} className="rounded-[12px] border border-module/[.30] bg-module/[.06] p-5" data-testid="generate-form">
                <input type="hidden" name="back" value={`/policies/generator?${new URLSearchParams([["basis", basis], ...(basisPolicy ? [["policy", basisPolicy.id]] : [["title", title], ["ref", ref], ["category", category]]), ["mode", mode], ...validBranches.map((id) => ["branch", id])])}`} />
                <input type="hidden" name="basis" value={basis} />
                {basisPolicy ? <input type="hidden" name="basisPolicyId" value={basisPolicy.id} /> : <><input type="hidden" name="title" value={title} /><input type="hidden" name="ref" value={ref} /><input type="hidden" name="categoryCode" value={category} /></>}
                <input type="hidden" name="mode" value={mode} />
                {mode === "NATIONAL" ? null : validBranches.map((id) => <input key={id} type="hidden" name="branchIds" value={id} />)}
                <h3 className="text-[15px] font-semibold text-[#101828]">4. Generate draft</h3>
                <p className="mt-1 text-[14px] text-[#344054]">
                  {criticalCount ? <><strong className="text-[#b42318]">{criticalCount} critical gap{criticalCount === 1 ? "" : "s"}</strong> will be recorded on the draft. Where something is missing the draft says <code>[REVIEW REQUIRED]</code> instead of guessing, and it cannot be published until those are completed.</> : "No critical gaps found. The draft still needs checking, and the pre-publication confirmations, before it can be published."}
                </p>
                <label className="mt-3 flex items-start gap-2 text-[14px]">
                  <input type="checkbox" name="useAi" defaultChecked={aiAvailable} disabled={!aiAvailable} className="pc-check mt-0.5" />
                  <span>Use AI to improve the wording of the generated sections{aiAvailable ? "" : " (not available: no AI service is switched on, so the draft is built only from the recorded sources and branch details)"}. AI wording is rejected if it adds contact details, cites a source not listed above, or quotes text the source does not contain.</span>
                </label>
                <button className="pc-btn mt-4" type="submit" data-testid="generate-draft">Generate draft</button>
              </form>
            </div>
          ) : <p className="mt-1 text-[13.5px] text-[#667085]">Choose the policy and branches first.</p>}
        </div>
      </section>

      <section className="pc-panel mt-4" aria-label="Recent generated drafts">
        <div className="pc-panel-head"><h2 className="text-[15px] font-semibold text-[#101828]">Recent generated drafts</h2><span className="pc-note">5. Check the draft and 6. Publish happen on each draft.</span></div>
        {runs.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="recent-runs">
              <thead><tr><th>Policy</th><th>Approach</th><th>Branches</th><th>How</th><th>Critical gaps</th><th>Draft status</th><th>Generated</th><th className="text-right">Open</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="min-w-[220px]"><span className="pc-strong">{r.policy.ref}</span><span className="pc-sub">{r.policy.title}</span></td>
                    <td className="text-[13px]">{MODE_LABEL[r.mode] ?? r.mode}</td>
                    <td className="text-[13px]">{r.branchNames.join(", ") || "All"}</td>
                    <td className="text-[13px]">{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td>{r.openCritical ? <PcBadge tone="red">{r.openCritical} open</PcBadge> : <PcBadge tone="green">None open</PcBadge>}</td>
                    <td>{r.status ? <PcBadge tone={r.status === "PUBLISHED" ? "green" : r.status === "APPROVED" ? "purple" : "blue"}>{r.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</PcBadge> : "—"}</td>
                    <td className="whitespace-nowrap">{fmtDate(r.createdAt, true)}</td>
                    <td className="text-right">{r.revisionId ? <Link href={`/revisions/${r.revisionId}`} className="pc-link">Draft</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">No drafts generated yet.</p>}
      </section>
    </>
  );
}

function GapList({ gaps }: { gaps: { kind: string; severity: string; message: string }[] }) {
  if (!gaps.length) return <p className="border-t border-[#eaecf0] px-5 py-3 text-[13.5px] text-[#067647]">No gaps found for this branch.</p>;
  return (
    <ul className="divide-y divide-[#f2f4f7] border-t border-[#eaecf0]" aria-label="Gaps found">
      {gaps.map((g, i) => (
        <li key={`${g.kind}-${i}`} className="flex items-start gap-3 px-5 py-2.5 text-[13.5px]"><SeverityBadge severity={g.severity} /><span className="text-[#344054]">{g.message}</span></li>
      ))}
    </ul>
  );
}

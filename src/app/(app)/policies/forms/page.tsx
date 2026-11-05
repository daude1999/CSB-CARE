import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcFoot } from "@/components/compliance-ui";
import { startableByRef } from "@/server/forms/records";
import { startFormAction } from "../../../actions";
import { RESOURCE_DOC_TYPES, RESOURCE_TYPE_LABELS, isResourceDocType, resourceRegister } from "@/server/forms/catalogue";
import { FilePdf, FileText, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

function val(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 120) ?? "";
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set");

/** Existing CSB resources only. A downloadable document is not a digital form submission. */
export default async function PolicyFormsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;
  const q = val(params, "q");
  const requestedType = val(params, "type");
  const type = isResourceDocType(requestedType) ? requestedType : "";
  const category = /^[A-Z_]{1,40}$/.test(val(params, "category")) ? val(params, "category") : "";
  const requestedPage = Number(val(params, "page") || 1);
  const [{ rows, total, page: currentPage, pages: pageCount, categories }, onScreen] = await Promise.all([
    resourceRegister(ctx, { q, type, category, page: Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, 500) : 1 }),
    startableByRef(ctx),
  ]);
  const href = (newPage: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (type) p.set("type", type);
    if (category) p.set("category", category);
    if (newPage > 1) p.set("page", String(newPage));
    const query = p.toString();
    return "/policies/forms" + (query ? "?" + query : "");
  };

  return (
    <div className="min-w-0" data-testid="forms-resources-register">
      <CompliancePageHeader
        title="Forms & Resources"
        subtitle="Search CSB forms, templates, checklists and audit tools. Blank documents are not completed digital form records."
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="forms" />}
        actions={ctx.organisationId ? <Link className="btn-secondary" href="/policies/forms/records" data-testid="my-forms-link">My forms &amp; reviews</Link> : undefined}
      />
      <form action="/policies/forms" method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-[13px] font-medium">Search</span>
          <span className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input name="q" aria-label="Search forms" type="search" maxLength={120} defaultValue={q} placeholder="Name or reference" className="min-w-0 w-full bg-transparent outline-none" />
          </span>
        </label>
        <label><span className="mb-1 block text-[13px] font-medium">Type</span>
          <select name="type" defaultValue={type} className="rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="">All types</option>
            {RESOURCE_DOC_TYPES.map((t) => <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label><span className="mb-1 block text-[13px] font-medium">Category</span>
          <select name="category" defaultValue={category} className="max-w-[225px] rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <button type="submit" className="pc-btn">Apply filters</button>
        <Link href="/policies/forms" className="pc-btn-secondary">Clear</Link>
      </form>

      <section aria-label="Forms and resources" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Resource register</h2>
          <span className="text-[13px] text-slate-600">{total} matching resources</span>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Reference and title</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Linked policies</th>
                  <th scope="col" className="px-4 py-3">Version / approval</th>
                  <th scope="col" className="px-4 py-3">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} data-testid="resource-row" className="align-top hover:bg-slate-50">
                    <td className="min-w-[240px] px-4 py-3">
                      <Link href={"/policies/" + r.id} className="font-semibold text-[#175cd3] hover:underline">{r.ref} — {r.title}</Link>
                      {r.description && <p className="mt-1 line-clamp-2 text-slate-600">{r.description}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{r.typeLabel}</td>
                    <td className="px-4 py-3">{r.category}</td>
                    <td className="min-w-[180px] px-4 py-3" data-testid="resource-policies">
                      {r.policies.length ? (
                        <ul className="space-y-0.5">
                          {r.policies.slice(0, 3).map((p) => <li key={p.id}><Link href={"/policies/" + p.id + "#forms"} className="hover:underline" title={p.title}>{p.ref}</Link> <span className="text-slate-600">{p.title}</span></li>)}
                          {r.policies.length > 3 ? <li className="text-slate-600">and {r.policies.length - 3} more</li> : null}
                        </ul>
                      ) : <span className="text-slate-600">None linked</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div>Version {r.versionLabel ?? "—"}</div>
                      <div className="mt-0.5 text-slate-600">Next review {fmtDate(r.nextReviewDate)}</div>
                      <div className="mt-1">
                        {r.approval === "STARTER" ? <PcBadge tone="purple">CSB template · not adopted</PcBadge>
                          : r.approval === "APPROVED" ? <PcBadge tone="green">Approved</PcBadge>
                          : <PcBadge tone="amber">Not yet approved</PcBadge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {onScreen.get(r.ref) ? (
                          <form action={startFormAction}>
                            <input type="hidden" name="definitionId" value={onScreen.get(r.ref)} />
                            <input type="hidden" name="back" value="/policies/forms" />
                            <button type="submit" className="pc-btn pc-btn-sm" data-testid={`start-${r.ref}`}>Fill in on screen</button>
                          </form>
                        ) : null}
                        <Link href={"/policies/" + r.id} className="pc-btn-secondary pc-btn-sm"><FileText size={14} aria-hidden="true" />Open</Link>
                        <a href={"/api/policies/" + r.id + "/download?format=pdf"} download className="pc-btn-secondary pc-btn-sm" aria-label={"Download " + r.title + " as PDF"}><FilePdf size={14} aria-hidden="true" />PDF</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 py-10 text-center text-slate-600">No resources match these filters.</p>}
        <div className="border-t border-slate-200">
          <PcFoot shown={rows.length} total={total} page={currentPage} pages={pageCount} href={href} />
        </div>
      </section>
      <p className="mt-3 text-[12px] text-slate-600">
        This register lists versioned documents to download and print. Only forms marked &ldquo;Fill in on screen&rdquo; can be completed and saved here; more will follow once each has been reviewed.
      </p>
    </div>
  );
}

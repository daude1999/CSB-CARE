import type { Prisma } from "@prisma/client";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { visiblePolicyWhere } from "@/server/auth/rbac";
import { db } from "@/lib/db";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcFoot } from "@/components/compliance-ui";
import { FilePdf, FileText, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const TYPES = ["FORM", "TEMPLATE", "CHECKLIST", "AUDIT_TOOL", "RISK_ASSESSMENT"] as const;
type ResourceType = (typeof TYPES)[number];
const TYPE_LABELS: Record<ResourceType, string> = {
  FORM: "Form", TEMPLATE: "Template", CHECKLIST: "Checklist",
  AUDIT_TOOL: "Audit tool", RISK_ASSESSMENT: "Risk assessment template",
};
const PAGE_SIZE = 25;

function val(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 120) ?? "";
}

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
  const type: ResourceType | "" = TYPES.includes(requestedType as ResourceType) ? requestedType as ResourceType : "";
  const category = val(params, "category");
  const requestedPage = Number(val(params, "page") || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, 500) : 1;

  // Uses the Policy Library's tenant visibility and the existing published-version gate.
  const where: Prisma.PolicyWhereInput = {
    AND: [
      visiblePolicyWhere(ctx),
      { status: "ACTIVE", docType: { in: [...TYPES] }, currentPublishedVersionId: { not: null } },
      ...(type ? [{ docType: type }] : []),
      ...(category ? [{ categoryCode: category }] : []),
      ...(q ? [{ OR: [
        { ref: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ] }] : []),
    ],
  };
  const [total, categories] = await Promise.all([
    db.policy.count({ where }),
    db.policyCategory.findMany({ select: { code: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = await db.policy.findMany({
    where, skip: (currentPage - 1) * PAGE_SIZE, take: PAGE_SIZE,
    orderBy: [{ title: "asc" }, { ref: "asc" }],
    select: {
      id: true, ref: true, title: true, description: true, docType: true, kind: true,
      category: { select: { name: true } },
      currentPublishedVersion: { select: { label: true, approvals: { where: { decision: "APPROVE" }, select: { id: true }, take: 1 } } },
    },
  });
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
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
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
                    <td className="whitespace-nowrap px-4 py-3">{TYPE_LABELS[r.docType as ResourceType] ?? r.docType}</td>
                    <td className="px-4 py-3">{r.category.name}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div>Version {r.currentPublishedVersion?.label ?? "—"}</div>
                      <div className="mt-1">
                        {r.kind === "MASTER" ? <PcBadge tone="purple">CSB starter · approval required</PcBadge>
                          : r.currentPublishedVersion?.approvals.length ? <PcBadge tone="green">Approved</PcBadge>
                          : <PcBadge tone="amber">Check approval</PcBadge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <Link href={"/policies/" + r.id} className="pc-btn-secondary pc-btn-sm"><FileText size={14} aria-hidden="true" />Open</Link>
                        <Link href={"/api/policies/" + r.id + "/download?format=pdf"} className="pc-btn-secondary pc-btn-sm"><FilePdf size={14} aria-hidden="true" />PDF</Link>
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
        This register lists existing versioned CSB documents. Procedure-step links, digital completion, signatures and submission history are separate implementation phases.
      </p>
    </div>
  );
}

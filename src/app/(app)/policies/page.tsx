import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { listPolicies } from "@/server/policies/library";
import { adoptTemplateAction } from "../../actions";
import { DOC_TYPES } from "../../../../prisma/seed-data/library/types";
import { Empty, Flash, fmtDate, PageHeader, Pagination, SegmentNav } from "@/components/ui";
import { Check, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { PolicyAreas } from "./areas";

export const dynamic = "force-dynamic";

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab === "templates" ? "MASTER" : ctx.organisationId ? "CUSTOMER" : "MASTER";
  if (tab === "CUSTOMER" && !sp.view && !sp.q && !sp.category && !sp.type && !sp.overdue && !sp.page) return <PolicyAreas ctx={ctx} area={sp.area} />;
  const page = Number(sp.page ?? 1);
  const docType = DOC_TYPES.some(([code]) => code === sp.type) ? sp.type : undefined;
  const { items, total, pageSize } = await listPolicies(ctx, { q: sp.q, category: sp.category, kind: tab, docType, page, overdueOnly: sp.overdue === "1" });
  const typeCounts = new Map(
    (await db.policy.groupBy({ by: ["docType"], where: tab === "MASTER" ? { kind: "MASTER", organisationId: null, status: "ACTIVE" } : { organisationId: ctx.organisationId, status: "ACTIVE" }, _count: true })).map((g) => [g.docType, g._count]),
  );
  const typeName = new Map<string, string>(DOC_TYPES);
  const baseWhere = tab === "MASTER" ? { kind: "MASTER" as const, organisationId: null, status: "ACTIVE" as const } : { organisationId: ctx.organisationId, status: "ACTIVE" as const };
  const [categories, categoryCounts, otherTabTotal] = await Promise.all([
    db.policyCategory.findMany({ orderBy: { name: "asc" } }),
    db.policy.groupBy({ by: ["categoryCode"], where: { ...baseWhere, ...(docType ? { docType } : {}) }, _count: true }),
    ctx.organisationId ? db.policy.count({ where: tab === "MASTER" ? { organisationId: ctx.organisationId, status: "ACTIVE" } : { kind: "MASTER", organisationId: null, status: "ACTIVE" } }) : Promise.resolve(0),
  ]);
  const categoryCount = new Map(categoryCounts.map((g) => [g.categoryCode, g._count]));
  const allCount = [...typeCounts.values()].reduce((a, b) => a + b, 0);
  const adopted = ctx.organisationId ? new Set((await db.policy.findMany({ where: { organisationId: ctx.organisationId, templateId: { not: null } }, select: { templateId: true } })).map((p) => p.templateId)) : new Set();
  const canAuthor = hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.author");
  const href = (over: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { tab: tab === "MASTER" ? "templates" : undefined, view: tab === "MASTER" ? undefined : "index", type: docType, category: sp.category, q: sp.q, overdue: sp.overdue, ...over };
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return `/policies${qs ? `?${qs}` : ""}`;
  };
  const activeCategory = categories.find((c) => c.code === sp.category);
  const filtered = Boolean(sp.q || sp.category || sp.overdue || docType);
  const now = new Date();
  return (
    <>
      <PageHeader
        back={tab === "MASTER" ? "/" : "/policies"}
        title={tab === "MASTER" ? "Template Library" : "Policy Index"}
        subtitle={tab === "MASTER"
          ? `${allCount} original CSB starter documents, citing the legislation and guidance they draw on. Adopt one, then adapt and approve it through your own governance.`
          : `${allCount} documents your services work to. Each shows whether its text has been through approval and when it is next due for review.`}
        actions={canAuthor ? <Link className="btn-primary" href="/policies/new">Upload Custom Policy</Link> : null}
      />
      <Flash searchParams={sp} />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <SegmentNav label="Library" items={[
          ...(ctx.organisationId ? [{ href: "/policies?view=index", label: "Our library", active: tab === "CUSTOMER", count: tab === "CUSTOMER" ? allCount : otherTabTotal }] : []),
          { href: "/policies?tab=templates", label: "CSB starter templates", active: tab === "MASTER", count: ctx.organisationId ? (tab === "MASTER" ? allCount : otherTabTotal) : undefined },
        ]} />
        <form className="mb-1.5 flex w-full items-center px-2 sm:w-auto sm:px-0 sm:pr-[15px]" role="search">
          {tab === "MASTER" ? <input type="hidden" name="tab" value="templates" /> : <input type="hidden" name="view" value="index" />}
          {docType ? <input type="hidden" name="type" value={docType} /> : null}
          {sp.category ? <input type="hidden" name="category" value={sp.category} /> : null}
          {sp.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
          <label className="flex h-[36px] w-full items-center gap-2 rounded-[4px] border border-slate-300 bg-white px-2.5 sm:w-72">
            <MagnifyingGlass size={18} className="shrink-0 text-slate-600" aria-hidden="true" />
            <input className="h-full min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-slate-500 focus:outline-none" name="q" defaultValue={sp.q} placeholder="Search by title, reference or summary" aria-label="Search policies" />
          </label>
        </form>
      </div>

      <div className="grid gap-3 rounded-[3px] rounded-tl-none bg-white p-[15px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-6 text-sm lg:border-r lg:border-slate-200 lg:pr-4" aria-label="Filters">
          <div>
            <h2 className="mb-2 text-[15px] font-medium">Document type</h2>
            <ul className="space-y-px">
              <FilterRow href={href({ type: undefined, page: undefined })} active={!docType} label="All types" count={allCount} />
              {DOC_TYPES.filter(([code]) => typeCounts.get(code)).map(([code, name]) => (
                <FilterRow key={code} href={href({ type: code, page: undefined })} active={docType === code} label={name} count={typeCounts.get(code)!} />
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-[15px] font-medium">Area of care</h2>
            <ul className="space-y-px">
              <FilterRow href={href({ category: undefined, page: undefined })} active={!sp.category} label="All areas" />
              {categories.filter((c) => categoryCount.get(c.code)).map((c) => (
                <FilterRow key={c.code} href={href({ category: c.code, page: undefined })} active={sp.category === c.code} label={c.name} count={categoryCount.get(c.code)!} />
              ))}
            </ul>
          </div>
          <Link href={href({ overdue: sp.overdue === "1" ? undefined : "1", page: undefined })} className={`flex items-center gap-2 no-underline ${sp.overdue === "1" ? "font-medium text-rose-700" : "text-slate-600 hover:text-navy-900"}`}>
            <span aria-hidden="true" className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${sp.overdue === "1" ? "border-rose-700 bg-rose-700" : "border-slate-400"}`}>{sp.overdue === "1" ? <Check size={10} weight="bold" className="text-white" /> : null}</span>
            Only overdue for review
          </Link>
        </aside>

        <section aria-label="Documents" className="min-w-0">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[14px] text-slate-700">
              {total} {total === 1 ? "document" : "documents"}
              {docType ? <> · {typeName.get(docType)}</> : null}
              {activeCategory ? <> · {activeCategory.name}</> : null}
              {sp.overdue === "1" ? <> · overdue for review</> : null}
              {sp.q ? <> matching “{sp.q}”</> : null}
            </p>
            {filtered ? <Link href={tab === "MASTER" ? "/policies?tab=templates" : "/policies?view=index"} className="text-xs">Clear filters</Link> : null}
          </div>
          {items.length ? (
            <ol className="rows">
              {items.map((p) => {
                const overdue = p.nextReviewDate && p.nextReviewDate < now;
                const v = p.currentPublishedVersion;
                return (
                  <li key={p.id} className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 py-3 sm:grid-cols-[6rem_minmax(0,1fr)_13rem]">
                    <div className="whitespace-nowrap pt-0.5 text-[14px] text-slate-700">{p.ref.replace(/^CSB-/, "")}</div>
                    <div className="min-w-0">
                      <Link href={`/policies/${p.id}`} className="row-title text-[15.5px] leading-snug">{p.title}</Link>
                      {p.description ? <p className="mt-1 line-clamp-1 text-[13px] text-slate-600">{p.description}</p> : null}
                      <p className="mt-1 text-[12.5px] text-slate-600">
                        {!docType && p.docType !== "POLICY" ? <span className="text-slate-700">{typeName.get(p.docType) ?? p.docType} · </span> : null}
                        {p.category.name}
                      </p>
                    </div>
                    <div className="col-start-2 space-y-1.5 text-xs sm:col-start-3 sm:text-right">
                      <VersionState version={v} />
                      <div className={overdue ? "font-medium text-rose-700" : "text-slate-500"}>{overdue ? `Review overdue since ${fmtDate(p.nextReviewDate)}` : `Review by ${fmtDate(p.nextReviewDate)}`}</div>
                      {p.revisions.length ? <div className="text-teal-700">{p.revisions.length === 1 ? "1 revision in progress" : `${p.revisions.length} revisions in progress`}</div> : null}
                      {tab === "MASTER" && ctx.organisationId ? (
                        adopted.has(p.id) ? <div className="text-slate-500">In your library</div> : hasOrgPermission(ctx, "policy.author") ? (
                          <form action={adoptTemplateAction} className="sm:flex sm:justify-end">
                            <input type="hidden" name="templateId" value={p.id} />
                            <input type="hidden" name="back" value="/policies?tab=templates" />
                            <button className="btn-secondary px-2.5 py-1 text-xs" type="submit">Adopt</button>
                          </form>
                        ) : null
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div>
              <Empty>{filtered ? "No documents match these filters." : tab === "CUSTOMER" ? "Your library is empty. Adopt a CSB template or create a policy to get started." : "No templates found."}</Empty>
            </div>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} base="/policies" params={{ q: sp.q, category: sp.category, tab: sp.tab, overdue: sp.overdue, type: docType }} />
        </section>
      </div>
    </>
  );
}

function FilterRow({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "true" : undefined} className={`flex items-center justify-between gap-3 rounded-[3px] px-2.5 py-1.5 no-underline ${active ? "bg-navy-900 font-medium text-white hover:text-white" : "text-slate-700 hover:bg-[#f5f9fc] hover:text-navy-900"}`}>
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined ? <span className={`text-[12px] ${active ? "text-teal-200" : "text-slate-500"}`}>{count}</span> : null}
      </Link>
    </li>
  );
}

function VersionState({ version }: { version: { label: string; origin: string } | null }) {
  if (!version) return <div className="flex items-center gap-1.5 text-amber-800 sm:justify-end"><span aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-amber-600" />No published version</div>;
  if (version.origin === "SEED") {
    return (
      <div className="flex items-center gap-1.5 text-slate-600 sm:justify-end" title="Starter text loaded with the library. It has no approval record yet.">
        <span aria-hidden="true" className="h-2 w-2 rounded-full border-2 border-slate-400" />Starter text {version.label}, not yet approved
      </div>
    );
  }
  return <div className="flex items-center gap-1.5 text-emerald-800 sm:justify-end"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />Approved {version.label}</div>;
}

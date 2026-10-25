import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { listPolicies } from "@/server/policies/library";
import { adoptTemplateAction } from "../../actions";
import { DOC_TYPES } from "../../../../prisma/seed-data/library/types";
import { Empty, Flash, fmtDate, Pagination } from "@/components/ui";
import { Check, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab === "templates" ? "MASTER" : ctx.organisationId ? "CUSTOMER" : "MASTER";
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
    const merged: Record<string, string | undefined> = { tab: tab === "MASTER" ? "templates" : undefined, type: docType, category: sp.category, q: sp.q, overdue: sp.overdue, ...over };
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return `/policies${qs ? `?${qs}` : ""}`;
  };
  const activeCategory = categories.find((c) => c.code === sp.category);
  const filtered = Boolean(sp.q || sp.category || sp.overdue || docType);
  const now = new Date();
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Library · {allCount} {tab === "MASTER" ? "starter documents" : "documents in use"}</p>
          <h1 className="mt-1.5 text-[2rem]">Policies &amp; Procedures</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {tab === "MASTER"
              ? "Original CSB starter documents, citing the legislation and guidance they draw on. Adopt one, then adapt and approve it through your own governance."
              : "The documents your services work to. Each shows whether its text has been through approval and when it is next due for review."}
          </p>
        </div>
        {canAuthor ? <Link className="btn-primary" href="/policies/new">New policy</Link> : null}
      </header>
      <Flash searchParams={sp} />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-300">
        <nav className="-mb-px flex gap-6" aria-label="Library">
          {ctx.organisationId ? (
            <Link href="/policies" aria-current={tab === "CUSTOMER" ? "page" : undefined} className={`border-b-2 pb-2.5 text-sm font-medium no-underline ${tab === "CUSTOMER" ? "border-navy-900 text-navy-900" : "border-transparent text-slate-500 hover:text-navy-900"}`}>
              Our library <span className="ml-1 font-mono text-xs text-slate-400">{tab === "CUSTOMER" ? allCount : otherTabTotal}</span>
            </Link>
          ) : null}
          <Link href="/policies?tab=templates" aria-current={tab === "MASTER" ? "page" : undefined} className={`border-b-2 pb-2.5 text-sm font-medium no-underline ${tab === "MASTER" ? "border-navy-900 text-navy-900" : "border-transparent text-slate-500 hover:text-navy-900"}`}>
            CSB starter templates {ctx.organisationId ? <span className="ml-1 font-mono text-xs text-slate-400">{tab === "MASTER" ? allCount : otherTabTotal}</span> : null}
          </Link>
        </nav>
        <form className="mb-2 flex w-full items-center gap-2 sm:w-auto" role="search">
          {tab === "MASTER" ? <input type="hidden" name="tab" value="templates" /> : null}
          {docType ? <input type="hidden" name="type" value={docType} /> : null}
          {sp.category ? <input type="hidden" name="category" value={sp.category} /> : null}
          {sp.overdue ? <input type="hidden" name="overdue" value="1" /> : null}
          <MagnifyingGlass size={16} className="text-slate-400" aria-hidden="true" />
          <input className="w-full border-0 border-b border-transparent bg-transparent px-1 py-1 text-sm placeholder:text-slate-400 focus:border-navy-900 focus:outline-hidden focus:ring-0 sm:w-64" name="q" defaultValue={sp.q} placeholder="Search by title, reference or summary" aria-label="Search policies" />
        </form>
      </div>

      <div className="grid gap-8 lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="space-y-7 text-sm" aria-label="Filters">
          <div>
            <h2 className="eyebrow mb-2 font-sans">Document type</h2>
            <ul className="space-y-px">
              <FilterRow href={href({ type: undefined, page: undefined })} active={!docType} label="All types" count={allCount} />
              {DOC_TYPES.filter(([code]) => typeCounts.get(code)).map(([code, name]) => (
                <FilterRow key={code} href={href({ type: code, page: undefined })} active={docType === code} label={name} count={typeCounts.get(code)!} />
              ))}
            </ul>
          </div>
          <div>
            <h2 className="eyebrow mb-2 font-sans">Area of care</h2>
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
            <p className="font-serif text-[15px] text-slate-700">
              {total} {total === 1 ? "document" : "documents"}
              {docType ? <> · {typeName.get(docType)}</> : null}
              {activeCategory ? <> · {activeCategory.name}</> : null}
              {sp.overdue === "1" ? <> · overdue for review</> : null}
              {sp.q ? <> matching “{sp.q}”</> : null}
            </p>
            {filtered ? <Link href={tab === "MASTER" ? "/policies?tab=templates" : "/policies"} className="text-xs">Clear filters</Link> : null}
          </div>
          {items.length ? (
            <ol className="border-t-2 border-navy-900">
              {items.map((p) => {
                const overdue = p.nextReviewDate && p.nextReviewDate < now;
                const v = p.currentPublishedVersion;
                return (
                  <li key={p.id} className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 border-b border-slate-200 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)_13rem]">
                    <div className="whitespace-nowrap pt-0.5 font-mono text-xs text-slate-500">{p.ref}</div>
                    <div className="min-w-0">
                      <Link href={`/policies/${p.id}`} className="font-serif text-[17px] font-semibold leading-snug text-navy-900 no-underline decoration-teal-400 decoration-2 hover:text-navy-900 hover:underline">{p.title}</Link>
                      {p.description ? <p className="mt-1 line-clamp-1 text-[13px] text-slate-500">{p.description}</p> : null}
                      <p className="mt-1.5 text-xs text-slate-500">
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
            <div className="border-t-2 border-navy-900 pt-6">
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
      <Link href={href} aria-current={active ? "true" : undefined} className={`relative flex items-baseline justify-between gap-3 py-1 pl-3 no-underline ${active ? "font-medium text-navy-900" : "text-slate-600 hover:text-navy-900"}`}>
        <span aria-hidden="true" className={`absolute inset-y-1 left-0 w-[2px] ${active ? "bg-teal-400" : "bg-slate-200"}`} />
        <span className="min-w-0 truncate">{label}</span>
        {count !== undefined ? <span className="font-mono text-[11px] text-slate-400">{count}</span> : null}
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

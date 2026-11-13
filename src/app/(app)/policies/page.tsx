import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "@/server/auth/rbac";
import {
  libraryHref,
  libraryView,
  parseLibraryQuery,
  QUICK_KEYS,
  QUICK_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  STATUS_KEYS,
  STATUS_LABELS,
  type LibraryQuery,
  type LibraryRow,
  type LibraryTab,
  type LibraryView,
} from "@/server/policies/library-view";
import { adoptTemplateAction } from "../../actions";
import { Flash } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/library/auto-submit";
import { Menu } from "@/components/library/menu";
import { Collapsible, TreeArea } from "@/components/library/tree";
import { DocTile, fmtShort, StatusPill } from "@/components/library/parts";
import { PolicyInspector } from "./inspector";
import { db } from "@/lib/db";
import { CompliancePageHeader } from "@/components/module-header";
import { PcTabs } from "@/components/compliance-ui";
import { ActionDialog } from "@/components/dialog";
import { InspectorShell } from "@/components/library/inspector-shell";
import { UploadPolicyForm } from "@/components/library/upload-policy";
import { workspaceCounts } from "@/server/compliance/workspace-counts";
import { canUseQueue } from "@/components/compliance-nav";
import { CaretLeft, CaretRight, DotsThree, DotsThreeVertical, DownloadSimple, FileDoc, FilePdf, Files, FunnelSimple, ListBullets, MagnifyingGlass, Plus, SquaresFour, ArrowSquareOut, UploadSimple, User, Sparkle } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const QUICK_DOT: Record<(typeof QUICK_KEYS)[number], string> = { due: "#f79009", overdue: "#d92d20", recent: "#12b76a", drafts: "#7a5af8" };
const TAB_LABELS: Record<LibraryTab, string> = { policies: "My Policies", templates: "CSB Central Library", archived: "Archived", calendar: "Review Calendar" };

/**
 * Policy Library (owner's brief of 3 Nov 2026, screenshot 02): categories and quick filters on the left, the register in
 * the middle and the selected policy in an inspector on the right. Closing the inspector gives the register the full
 * width and is remembered, so the first policy is not reopened. Every filter lives in the address bar.
 */
export default async function PolicyLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const view = await libraryView(ctx, parseLibraryQuery(sp, Boolean(ctx.organisationId)));
  const { query } = view;
  const tabs: LibraryTab[] = ctx.organisationId ? ["policies", "templates", "archived", "calendar"] : ["templates"];
  const canCreate = hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.author");
  const canUpload = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "policy.author");
  const selectedId = view.selectedId;
  const counts = await workspaceCounts(ctx, "library");
  const [categories, members] = canUpload
    ? await Promise.all([
        db.policyCategory.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
        db.membership.findMany({ where: { organisationId: ctx.organisationId! }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
      ])
    : [[], []];
  const showInspector = query.tab !== "calendar" && Boolean(selectedId);
  const nav = {
    index: view.position?.index,
    total: view.position?.total,
    prevHref: view.position?.prev ? libraryHref(query, { selected: view.position.prev.id, page: view.position.prev.page, insp: undefined }) : undefined,
    nextHref: view.position?.next ? libraryHref(query, { selected: view.position.next.id, page: view.position.next.page, insp: undefined }) : undefined,
    closeHref: libraryHref(query, { selected: undefined, pane: undefined, insp: "closed" }),
  };
  const tabItems = [
    ...tabs.flatMap((t) => [
      { key: t, label: TAB_LABELS[t], href: libraryHref({ ...query, tab: t }, { page: undefined, selected: undefined, pane: undefined, insp: undefined }), count: counts[t] },
      ...(t === (ctx.organisationId ? "policies" : "templates") ? [{ key: "forms", label: "Forms & Resources", href: "/policies/forms", count: counts.forms }] : []),
    ]),
    ...(canUseQueue(ctx) ? [{ key: "queue", label: "Drafts", href: "/queue", count: counts.queue }] : []),
    ...(ctx.organisationId ? [{ key: "updates", label: "Monthly Updates", href: "/policies/updates" }] : []),
    ...(ctx.organisationId && hasOrgPermission(ctx, "policy.author") ? [{ key: "generator", label: "Policy Generator", href: "/policies/generator" }] : []),
    ...(ctx.organisationId && hasOrgPermission(ctx, "policy.coverage") ? [{ key: "coverage", label: "Branch Coverage", href: "/policies/coverage" }] : []),
    ...(ctx.organisationId && hasOrgPermission(ctx, "policy.localConfig") ? [{ key: "branches", label: "Branch Configuration", href: "/policies/branches" }] : []),
  ];

  return (
    <div className="pl-root min-w-0">
      <CompliancePageHeader
        title={ctx.organisationId ? "Policy Library" : "Template Library"}
        subtitle={ctx.organisationId ? "Your organisation's policies and procedures, with CSB central documents kept up to date automatically. Publish your own documents directly and track who has read them." : "CSB central documents. Each version you publish reaches every eligible organisation's library straight away."}
        actions={
          <>
            {canUpload ? (
              <ActionDialog size="lg" triggerClassName="pc-btn-secondary" trigger={<><UploadSimple size={16} aria-hidden="true" />Upload policy</>} title="Upload policy" description="Bring in your existing policies as drafts. Each file is checked and stored securely. Check the text, then publish it when it is ready.">
                <UploadPolicyForm categories={categories} owners={members.map((m) => m.user)} defaultOwner={ctx.userId} back={libraryHref(query, { selected: undefined })} />
              </ActionDialog>
            ) : null}
            {canUpload ? <Link href="/policies/generator" className="pc-btn-secondary" data-testid="open-generator"><Sparkle size={16} aria-hidden="true" />Generate policy</Link> : null}
            {canCreate ? <Link href="/policies/new" className="pc-btn"><Plus size={16} weight="bold" aria-hidden="true" />Create policy</Link> : null}
          </>
        }
        tabs={<PcTabs label="Policy Library sections" testId="ws-tabs-library" active={query.tab} items={tabItems} />}
      />
      <Flash searchParams={sp} />
      <div className="mb-4" data-keep-inspector="">
        <FilterBar ctx={ctx} view={view} />
      </div>

      <div className={`grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] ${showInspector ? "xl:grid-cols-[220px_minmax(0,1fr)_460px] 2xl:grid-cols-[220px_minmax(0,1fr)_540px]" : ""}`}>
        <div className="lg:sticky lg:top-3" data-keep-inspector="">
          <Collapsible label="Categories and quick filters">
            <Explorer ctx={ctx} view={view} />
          </Collapsible>
        </div>
        {query.tab === "calendar" ? (
          <ReviewCalendar view={view} />
        ) : (
          <>
            <Register ctx={ctx} view={view} selectedId={selectedId} />
            {showInspector && selectedId ? (
              <div className="hidden xl:sticky xl:top-3 xl:block" id="policy-inspector">
                <InspectorShell key={selectedId} closeHref={nav.closeHref}>
                  <PolicyInspector ctx={ctx} query={query} policyId={selectedId} nav={nav} />
                </InspectorShell>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Hidden copies of the workspace state a form doesn't edit itself, so applying one filter keeps the others. */
function KeepState({ query, keys }: { query: LibraryQuery; keys: (keyof LibraryQuery)[] }) {
  const defaults: Partial<Record<keyof LibraryQuery, string>> = { tab: "policies", sort: "updated", layout: "list" };
  return (
    <>
      {keys.map((k) => {
        const v = query[k];
        return v === undefined || v === defaults[k] ? null : <input key={k} type="hidden" name={k} value={String(v)} />;
      })}
    </>
  );
}

function FilterBar({ ctx, view }: { ctx: Ctx; view: LibraryView }) {
  const { query } = view;
  const moreActive = Boolean(query.type || query.service);
  const filtered = Boolean(query.q || query.area || query.category || query.status || query.owner || query.type || query.service || query.quick);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form role="search" aria-label="Filter policies" action="/policies" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <KeepState query={query} keys={["tab", "area", "quick", "sort", "layout", "insp"]} />
        <label className="pl-input w-full sm:w-[238px]">
          <MagnifyingGlass size={16} aria-hidden="true" className="shrink-0 text-[#4f5b6c]" />
          <span className="sr-only">Search policies</span>
          <input type="search" name="q" defaultValue={query.q} placeholder="Search policies…" className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#1f2d42] placeholder:text-[#6b7586] focus:outline-none" />
        </label>
        <AutoSubmitSelect name="category" label="Category" defaultValue={query.category} className="w-[calc(50%-4px)] sm:w-[186px]">
          <option value="">All Categories</option>
          {view.tree.map((a) => (
            <optgroup key={a.key} label={a.label}>
              {a.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </optgroup>
          ))}
        </AutoSubmitSelect>
        <AutoSubmitSelect name="status" label="Status" defaultValue={query.status} className="w-[calc(50%-4px)] sm:w-[156px]">
          <option value="">All Statuses</option>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </AutoSubmitSelect>
        {query.tab !== "templates" ? (
          <AutoSubmitSelect name="owner" label="Owner" defaultValue={query.owner} className="w-[calc(50%-4px)] sm:w-[158px]">
            <option value="">All Owners</option>
            {view.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </AutoSubmitSelect>
        ) : null}
        <Menu
          label="More Filters"
          showLabel
          align="left"
          summaryClassName={`pl-btn-secondary cursor-pointer font-normal ${moreActive ? "border-[#0369d5] text-[#0646b1]" : ""}`}
          trigger={<><FunnelSimple size={16} aria-hidden="true" />More Filters{moreActive ? <span className="sr-only"> (active)</span> : null}</>}
        >
          <div className="w-[240px] space-y-3 px-3.5 py-2.5">
            <AutoSubmitSelect name="type" label="Document type" defaultValue={query.type}>
              <option value="">All document types</option>
              {view.docTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </AutoSubmitSelect>
            <AutoSubmitSelect name="service" label="Service type" defaultValue={query.service}>
              <option value="">All service types</option>
              {view.services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </AutoSubmitSelect>
          </div>
        </Menu>
        <button type="submit" className="pl-btn-secondary sr-only focus:not-sr-only">Apply filters</button>
        {filtered ? <Link href={libraryHref({ ...query, q: undefined, area: undefined, category: undefined, status: undefined, owner: undefined, type: undefined, service: undefined, quick: undefined, page: 1 }, { selected: undefined })} className="px-1 text-[12.5px] text-[#0646b1] hover:underline">Clear filters</Link> : null}
      </form>
      {hasOrgPermission(ctx, "report.view") && ctx.organisationId ? (
        <Menu label="Library options" trigger={<DotsThreeVertical size={18} weight="bold" />}>
          <a href="/api/reports/policies" download className="pl-menu-item"><DownloadSimple size={15} aria-hidden="true" />Export policy register (CSV)</a>
        </Menu>
      ) : null}
    </div>
  );
}

function Explorer({ ctx, view }: { ctx: Ctx; view: LibraryView }) {
  const { query } = view;
  const reset = { area: undefined, category: undefined, page: 1 };
  const isAll = !query.area && !query.category;
  return (
    <>
      <nav aria-label="Categories" className="pl-panel p-[6px]">
        <h2 className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#667085]">Categories</h2>
        <ul className="space-y-px">
          <li>
            <Link href={libraryHref({ ...query, ...reset }, { selected: undefined })} scroll={false} aria-current={isAll ? "true" : undefined} className="pl-tree-row pl-[10px]">
              <Files size={16} aria-hidden="true" className="text-[#3a4b5e]" />
              <span className="min-w-0 flex-1 truncate">All {query.tab === "templates" ? "CSB central documents" : "Policies"}</span>
              <span className="pl-count">{view.treeTotal}</span>
            </Link>
          </li>
          {view.tree.map((a) => (
            <TreeArea
              key={a.key}
              id={a.key}
              label={a.label}
              count={a.count}
              href={libraryHref({ ...query, ...reset, area: a.key === "other" ? undefined : a.key, category: a.key === "other" ? a.categories[0]?.code : undefined }, { selected: undefined })}
              current={query.area === a.key && !query.category}
              defaultOpen={query.area === a.key || a.categories.some((c) => c.code === query.category)}
            >
              {a.categories.map((c) => (
                <li key={c.code}>
                  <Link href={libraryHref({ ...query, page: 1, area: a.key === "other" ? undefined : a.key, category: c.code }, { selected: undefined })} scroll={false} aria-current={query.category === c.code ? "true" : undefined} className="pl-tree-sub">
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="pl-count">{c.count}</span>
                  </Link>
                </li>
              ))}
            </TreeArea>
          ))}
        </ul>
        {!view.tree.length ? <p className="px-3 py-2 text-[12.5px] text-[#646e7f]">No categories to show.</p> : null}
      </nav>

      {query.tab !== "templates" ? (
        <nav aria-label="Quick filters" className="pl-panel px-[14px] py-[12px]">
          <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#667085]">Quick filters</h2>
          <ul className="space-y-px">
            {QUICK_KEYS.map((k) => {
              const on = query.quick === k;
              return (
                <li key={k}>
                  <Link href={libraryHref({ ...query, quick: on ? undefined : k, page: 1 }, { selected: undefined })} scroll={false} aria-current={on ? "true" : undefined} className="pl-quick">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: QUICK_DOT[k] }} />
                    <span className="min-w-0 flex-1 truncate">{QUICK_LABELS[k]}</span>
                    <span className="pl-count">{view.quickCounts[k]}</span>
                  </Link>
                </li>
              );
            })}
            {ctx.organisationId ? (
              <li>
                <Link href={libraryHref({ ...query, owner: query.owner === ctx.userId ? undefined : ctx.userId, page: 1 }, { selected: undefined })} scroll={false} aria-current={query.owner === ctx.userId ? "true" : undefined} className="pl-quick" data-testid="quick-mine">
                  <User size={13} aria-hidden="true" className="shrink-0 text-module" />
                  <span className="min-w-0 flex-1 truncate">Owned by me</span>
                  <span className="pl-count">{view.mineCount}</span>
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </>
  );
}

function Register({ ctx, view, selectedId }: { ctx: Ctx; view: LibraryView; selectedId?: string }) {
  const { query } = view;
  const noun = query.tab === "templates" ? "CSB Central Library" : query.tab === "archived" ? "Archived policies" : "Policies";
  const grid = query.layout === "grid";
  // The panel is titled with the category or area being shown, as in the Harbour library.
  const area = query.area ? view.tree.find((a) => a.key === query.area) : undefined;
  const category = query.category ? view.tree.flatMap((a) => a.categories).find((c) => c.code === query.category) : undefined;
  const listTitle = category?.label ?? area?.label ?? (query.tab === "templates" || query.tab === "archived" ? noun : "All Policies");
  return (
    <section aria-labelledby="register-title" className="hb-pn hb-c-blue min-w-0" data-testid="policy-register" data-keep-inspector="">
      <div className="hb-pn-h">
        <h2 id="register-title">
          {listTitle} <span className="sr-only">(</span><span className="hb-pn-cnt">{view.total}</span><span className="sr-only">)</span>
        </h2>
        <span className="hb-sp" />
        <span className="hidden text-[12px] font-medium text-white/85 xl:inline">Click a policy to read it</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[var(--hb-line-2)] bg-[#fcfcfb] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <form action="/policies" className="flex items-center gap-2">
            <KeepState query={query} keys={["tab", "q", "area", "category", "status", "owner", "type", "service", "quick", "layout", "selected", "insp"]} />
            <AutoSubmitSelect name="sort" label="Sort by" defaultValue={query.sort} className="w-[172px]">
              {SORT_KEYS.map((s) => <option key={s} value={s}>Sort: {SORT_LABELS[s]}</option>)}
            </AutoSubmitSelect>
            <button type="submit" className="sr-only focus:not-sr-only">Sort</button>
          </form>
          <div role="group" aria-label="Layout" className="flex h-[32px] items-center rounded-[6px] bg-[#f1efea] p-[2px]">
            <Link href={libraryHref(query, { layout: "list" })} scroll={false} aria-label="List view" aria-current={!grid ? "true" : undefined} className={`flex h-[28px] w-[34px] items-center justify-center rounded-[5px] ${!grid ? "bg-white text-[#0646b1] shadow-sm" : "text-[#3a4b5e]"}`}><ListBullets size={16} aria-hidden="true" /></Link>
            <Link href={libraryHref(query, { layout: "grid" })} scroll={false} aria-label="Grid view" aria-current={grid ? "true" : undefined} className={`flex h-[28px] w-[34px] items-center justify-center rounded-[5px] ${grid ? "bg-white text-[#0646b1] shadow-sm" : "text-[#3a4b5e]"}`}><SquaresFour size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
      {view.rows.length ? (
        <ul className={grid ? "grid gap-2 px-[10px] pb-[10px] sm:grid-cols-2" : "px-[10px] pb-[6px]"}>
          {view.rows.map((r, i) => (
            <li key={r.id} className={!grid && i > 0 ? "border-t border-[#efece6]" : ""}>
              {grid ? <GridCard ctx={ctx} row={r} query={query} selected={r.id === selectedId} /> : <Row ctx={ctx} row={r} query={query} selected={r.id === selectedId} />}
            </li>
          ))}
        </ul>
      ) : (
        <RegisterEmpty ctx={ctx} view={view} />
      )}
      {view.pageCount > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between border-t border-[#efece6] px-[18px] py-[10px] text-[12.5px] text-[#4f5b6c]">
          {query.page > 1 ? <Link href={libraryHref(query, { page: query.page - 1, selected: undefined })} scroll={false} className="flex items-center gap-1 text-[#0646b1]"><CaretLeft size={12} aria-hidden="true" />Previous</Link> : <span />}
          <span>Page {query.page} of {view.pageCount}</span>
          {query.page < view.pageCount ? <Link href={libraryHref(query, { page: query.page + 1, selected: undefined })} scroll={false} className="flex items-center gap-1 text-[#0646b1]">Next<CaretRight size={12} aria-hidden="true" /></Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

/** Desktop opens the policy in the inspector; smaller screens have no inspector, so the title opens the full record. */
function RowTitle({ row, query, className }: { row: LibraryRow; query: LibraryQuery; className?: string }) {
  return (
    <>
      <Link href={libraryHref(query, { selected: row.id, pane: undefined, insp: undefined })} scroll={false} className={`pl-row-title hidden xl:inline ${className ?? ""}`}>{row.title}</Link>
      <Link href={`/policies/${row.id}`} className={`pl-row-title xl:hidden ${className ?? ""}`}>{row.title}</Link>
    </>
  );
}

function Meta({ row }: { row: LibraryRow }) {
  return (
    <p className="mt-[2px] min-w-0 truncate text-[12.5px] text-[#667085]" title={row.areaLabel ? `${row.areaLabel} › ${row.categoryName}` : row.categoryName}>
      {[row.ref, row.version, row.categoryName].filter(Boolean).join(" · ")}
    </p>
  );
}

function Row({ ctx, row, query, selected }: { ctx: Ctx; row: LibraryRow; query: LibraryQuery; selected: boolean }) {
  return (
    <article className={`pl-row ${selected ? "pl-row-selected" : ""}`} aria-current={selected ? "true" : undefined} data-testid="policy-row">
      <span className="max-sm:hidden"><DocTile status={row.status} /></span>
      <div className="min-w-0 flex-1">
        <h3 className="leading-[21px]"><RowTitle row={row} query={query} /></h3>
        <Meta row={row} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#3a4658] sm:hidden">
          <StatusPill status={row.status} />
          {row.nextReviewDate ? <span className="whitespace-nowrap">Review {fmtShort(row.nextReviewDate)}</span> : null}
          <RowSide ctx={ctx} row={row} query={query} />
        </div>
        {row.description ? <p className="mt-[7px] line-clamp-2 text-[12px] leading-[17px] text-[#4f5b6c]">{row.description}</p> : null}
      </div>
      <div className="flex w-[150px] shrink-0 flex-col items-start gap-[4px] text-[12.5px] text-[#475467] max-sm:hidden">
        <StatusPill status={row.status} />
        {row.ownerName ? <span className="max-w-full truncate">{row.ownerName}</span> : null}
        {row.nextReviewDate ? <span className="whitespace-nowrap">Review {fmtShort(row.nextReviewDate)}</span> : null}
        <RowSide ctx={ctx} row={row} query={query} />
      </div>
      <RowMenu row={row} />
    </article>
  );
}

function GridCard({ ctx, row, query, selected }: { ctx: Ctx; row: LibraryRow; query: LibraryQuery; selected: boolean }) {
  return (
    <article className={`pl-row h-full flex-col gap-2 border-[#efece6] ${selected ? "pl-row-selected" : ""}`} aria-current={selected ? "true" : undefined} data-testid="policy-row">
      <div className="flex items-start justify-between gap-2">
        <DocTile status={row.status} size={40} />
        <StatusPill status={row.status} />
      </div>
      <h3 className="leading-[21px]"><RowTitle row={row} query={query} /></h3>
      <Meta row={row} />
      <p className="mt-auto text-[12.5px] text-[#3a4658]">{row.nextReviewDate ? `Review: ${fmtShort(row.nextReviewDate)}` : null}</p>
      <RowSide ctx={ctx} row={row} query={query} />
    </article>
  );
}

/** Templates show whether the organisation already has them, and let authors adopt them. */
function RowSide({ ctx, row, query }: { ctx: Ctx; row: LibraryRow; query: LibraryQuery }) {
  if (row.kind !== "MASTER" || !ctx.organisationId) return null;
  if (row.adopted) return <span className="text-[12px] text-[#157a3e]">In your library</span>;
  if (!hasOrgPermission(ctx, "policy.author")) return null;
  return (
    <form action={adoptTemplateAction}>
      <input type="hidden" name="templateId" value={row.id} />
      <input type="hidden" name="back" value={libraryHref(query, { selected: row.id })} />
      <button type="submit" className="pl-btn-secondary h-[26px] px-2.5 text-[12px]">Adopt<span className="sr-only"> {row.title}</span></button>
    </form>
  );
}

function RowMenu({ row }: { row: LibraryRow }) {
  return (
    <Menu label={`Actions for ${row.title}`} trigger={<DotsThree size={18} weight="bold" />} className="-mr-2 -mt-1 self-start">
      <Link href={`/policies/${row.id}`} className="pl-menu-item"><ArrowSquareOut size={15} aria-hidden="true" />Open full record</Link>
      {row.version ? <a href={`/api/policies/${row.id}/download?format=pdf`} download className="pl-menu-item"><FilePdf size={15} aria-hidden="true" />Download PDF</a> : null}
      {row.version ? <a href={`/api/policies/${row.id}/download?format=docx`} download className="pl-menu-item"><FileDoc size={15} aria-hidden="true" />Download Word</a> : null}
    </Menu>
  );
}

function RegisterEmpty({ ctx, view }: { ctx: Ctx; view: LibraryView }) {
  const { query } = view;
  const filtered = Boolean(query.q || query.area || query.category || query.status || query.owner || query.type || query.service || query.quick);
  let title = "No policies match these filters.";
  let body: React.ReactNode = <Link href={libraryHref({ ...query, q: undefined, area: undefined, category: undefined, status: undefined, owner: undefined, type: undefined, service: undefined, quick: undefined, page: 1 })} className="text-[#0646b1] hover:underline">Clear filters</Link>;
  if (!filtered) {
    if (query.tab === "archived") {
      title = "No archived policies.";
      body = "Policies you archive appear here with every version kept, and can be restored.";
    } else if (query.tab === "templates") {
      title = "No templates are available.";
      body = null;
    } else {
      title = "Your library is empty.";
      body = hasOrgPermission(ctx, "policy.author") ? <>Adopt a <Link href="/policies?tab=templates" className="text-[#0646b1] hover:underline">CSB template</Link> or <Link href="/policies/new" className="text-[#0646b1] hover:underline">create a policy</Link> to get started.</> : "Your organisation hasn't added any policies yet.";
    }
  }
  return (
    <div className="px-6 pb-12 pt-8 text-center" data-testid="register-empty">
      <p className="pl-serif text-[17px] font-semibold text-[#0b1530]">{title}</p>
      {body ? <p className="mt-1.5 text-[13px] text-[#4f5b6c]">{body}</p> : null}
    </div>
  );
}

function ReviewCalendar({ view }: { view: LibraryView }) {
  const now = new Date();
  const { query } = view;
  return (
    <section aria-labelledby="calendar-title" className="pc-panel min-w-0" data-testid="review-calendar">
      <div className="px-[18px] pb-[6px] pt-[14px]">
        <h2 id="calendar-title" className="text-[16px] font-semibold text-[#101828]">Review Calendar</h2>
        <p className="mt-0.5 text-[12.5px] text-[#646e7f]">Next review dates for {view.total} {view.total === 1 ? "policy" : "policies"}, earliest first. Reviews within 60 days are due; past dates are overdue.</p>
      </div>
      {view.calendar.length ? (
        <div className="px-[18px] pb-[14px]">
          {view.calendar.map((m) => (
            <section key={m.month} aria-label={m.month} className="mt-3">
              <h3 className="border-b border-[#efece6] pb-1.5 text-[13px] font-semibold text-[#0b1530]">{m.month} <span className="font-normal text-[#646e7f]">· {m.rows.length}</span></h3>
              <ul>
                {m.rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#f3f1ec] py-2 text-[13px]">
                    <span className={r.nextReviewDate! < now ? "font-medium text-[#b42318]" : "text-[#3a4658]"}>{fmtShort(r.nextReviewDate)}</span>
                    <span className="min-w-0">
                      <Link href={libraryHref({ ...query, tab: "policies" }, { selected: r.id, page: undefined })} className="block truncate font-medium text-[#0b1530] hover:text-[#0646b1]">{r.title}</Link>
                      <span className="text-[12px] text-[#646e7f]">{r.ref}{r.ownerName ? ` · ${r.ownerName}` : ""}</span>
                    </span>
                    <StatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="px-6 pb-12 pt-8 text-center text-[13px] text-[#4f5b6c]">No review dates match these filters.</p>
      )}
    </section>
  );
}

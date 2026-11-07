import type { ServiceUserStatus } from "@prisma/client";
import { Eye, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { EXACT_REFERENCE_HINT, SearchProblem } from "@/components/search-notice";
import { mayBeExternalReference } from "@/lib/service-user-search";
import { Badge, Empty, StatusBadge } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";
import { AddServiceUserButton, UpdateServiceUserButton, type ServiceUserActionPerms } from "@/components/service-user-actions";
import type { serviceUserDirectory } from "@/server/care/service-users";

export const DIRECTORY_STATUSES: ServiceUserStatus[] = ["ENQUIRY", "ASSESSMENT", "ACTIVE", "PAUSED", "ENDED"];

type Directory = Awaited<ReturnType<typeof serviceUserDirectory>>;
type Params = { q?: string; status?: string; area?: string };

const suName = (s: { firstName: string; lastName: string; preferredName: string | null }) => `${s.preferredName || s.firstName} ${s.lastName}`;
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b2bb5] focus-visible:ring-offset-2";
const ROW_BTN = `inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d0d5dd] bg-white px-2.5 text-[13px] font-semibold text-[#344054] no-underline hover:border-[#5b2bb5] hover:bg-[#f8f5fe] hover:text-[#344054] ${FOCUS}`;

/** Page numbers to show: the first, the last and two either side of the current page, with gaps marked. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
  const out: (number | "gap")[] = [];
  [...keep].sort((a, b) => a - b).forEach((n, i, all) => {
    if (i && n - all[i - 1]! > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

/**
 * The All Service Users directory: count, Add New / Update Existing, the shared search and filters, the full table
 * with View and Update on every row, and pages of 25. Used by the directory page and the Service User Management
 * workspace, so both show exactly the same records with the same permissions.
 */
export function ServiceUserDirectory({ dir, sp, areas, basePath, perms, showButtons = true, demo = false }: { dir: Directory; sp: Params; areas: { id: string; name: string }[]; basePath: string; perms: ServiceUserActionPerms; showButtons?: boolean; demo?: boolean }) {
  const rows = dir.rows;
  const params = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.status) p.set("status", sp.status);
    if (sp.area) p.set("area", sp.area);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${basePath}?${p}#directory`;
  };
  const showAll = `${basePath}?${new URLSearchParams({ q: dir.q, status: "ALL" })}#directory`;
  const filtered = !!(sp.q || sp.status || sp.area);
  const first = dir.total ? (dir.page - 1) * dir.pageSize + 1 : 0;
  const last = Math.min(dir.total, first + rows.length - 1);
  const canUpdate = perms.edit || perms.upload;
  return (
    <section id="directory" aria-labelledby="all-service-users" className="panel scroll-mt-4" data-testid="su-directory">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="all-service-users" className="text-[20px] font-bold text-[#101828]">All Service Users</h2>
          <p className="mt-0.5 text-[14px] text-[#475467]">Manage existing service users and add new referrals.{demo ? " All names in the demo are fictional." : ""}</p>
        </div>
        <p className="shrink-0 text-right" data-testid="su-count">
          <span className="block text-[24px] font-bold leading-7 tabular-nums text-[#101828]">{dir.total.toLocaleString("en-GB")}</span>
          <span className="block text-[13px] text-[#475467]">{dir.total === 1 ? "service user" : "service users"}{filtered ? " matching these filters" : " (not ended)"}</span>
        </p>
      </div>

      {showButtons && (perms.create || perms.upload || perms.edit) ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="su-actions">
          <AddServiceUserButton perms={perms} />
          <UpdateServiceUserButton perms={perms} />
        </div>
      ) : null}

      <section aria-label="Filters" className="mt-4">
      <form method="get" action={`${basePath}#directory`} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem_auto]">
        <label className="sm:col-span-2 lg:col-span-1"><span className="label">Search</span>
          <span className="relative block">
            <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, CSB or SU reference, council or Frameworki number, postcode" className="input pl-9" />
          </span>
        </label>
        <label><span className="label">Status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Current (not ended)</option><option value="ALL">All statuses</option>{DIRECTORY_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
        <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button className="btn-primary">Apply</button>
          <Link href={`${basePath}#directory`} className="btn-secondary">Clear</Link>
        </div>
      </form>
      </section>

      <div className="mt-3">
        {dir.referenceProblem ? <SearchProblem>{dir.referenceProblem}</SearchProblem> : null}
        {dir.hiddenByFilters ? (
          <p role="status" data-testid="hidden-by-filters" className="mb-3 rounded-[3px] border-l-4 border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {dir.hiddenByFilters === 1 ? "1 more person matches" : `${dir.hiddenByFilters} more people match`} “{dir.q}” but {dir.hiddenByFilters === 1 ? "is" : "are"} hidden by the status or area filter. <Link href={showAll}>Show all matches</Link>
          </p>
        ) : null}
      </div>

      {rows.length ? (
        <div className="relative -mx-1 overflow-x-auto px-1">
          <table className="table min-w-[1040px]">
            <thead><tr><th>Name</th><th>Status</th><th>Area</th><th>Postcode</th><th>Risk</th><th>Commissioned</th><th>Repeating visits</th><th>Carer preference</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const mins = s.packages.reduce((n, p) => n + (p.commissionedMinutesPerWeek ?? 0), 0);
                const name = suName(s);
                const reference = s.csbReference ?? s.reference;
                return (
                  <tr key={s.id} data-testid="su-row">
                    <td><Link href={`/rota/service-users/${s.id}`}>{name}</Link><div className="text-[12.5px] text-slate-500">{reference}{s.csbReference && s.reference !== s.csbReference ? ` · legacy ${s.reference}` : ""}{s.matchedReference ? ` · matched ${s.matchedReference}` : ""}</div></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td><AreaDot area={s.area} />{s.branch ? <div className="text-[12.5px] text-slate-500">{s.branch.name}</div> : null}</td>
                    <td>{s.postcode ?? "—"}</td>
                    <td>{s.riskLevel ? <Badge tone={s.riskLevel === "HIGH" ? "rose" : s.riskLevel === "MEDIUM" ? "amber" : "slate"}>{s.riskLevel.toLowerCase()}</Badge> : <span className="text-slate-500">Not assessed</span>}</td>
                    <td className="tabular-nums">{mins ? `${(mins / 60).toFixed(1)} h/week` : "—"}</td>
                    <td className="tabular-nums">{s._count.templates}</td>
                    <td>{s.carerGenderPreference === "ANY" ? "None" : `${s.carerGenderPreference.toLowerCase()} carers`}</td>
                    <td>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Link href={`/rota/service-users/${s.id}`} className={ROW_BTN} data-testid="row-view"><Eye size={15} aria-hidden />View<span className="sr-only"> {name}</span></Link>
                        {canUpdate ? <UpdateServiceUserButton perms={perms} person={{ id: s.id, name, reference }} className={ROW_BTN} testId="row-update" /> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>{dir.q ? `No service users you are allowed to see match “${dir.q}” with these filters.${mayBeExternalReference(dir.q) && !dir.referenceProblem ? ` ${EXACT_REFERENCE_HINT}` : ""}` : "No service users match these filters."}</Empty>}

      {dir.total ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#eaecf0] pt-3">
          <p className="text-[13.5px] text-[#475467]" data-testid="su-showing">Showing {first} to {last} of {dir.total.toLocaleString("en-GB")} service {dir.total === 1 ? "user" : "users"}</p>
          {dir.pages > 1 ? (
            <nav aria-label="Service user pages" className="flex flex-wrap items-center gap-1">
              {dir.page > 1 ? <Link href={params({ page: String(dir.page - 1) })} className={ROW_BTN}>Previous</Link> : <span aria-disabled="true" className={`${ROW_BTN} cursor-default opacity-50`}>Previous</span>}
              {pageList(dir.page, dir.pages).map((n, i) => n === "gap" ? <span key={`g${i}`} aria-hidden className="px-1 text-[#667085]">…</span> : (
                <Link key={n} href={params({ page: String(n) })} aria-current={n === dir.page ? "page" : undefined} aria-label={`Page ${n}`} className={n === dir.page ? `inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] bg-[#5b2bb5] px-2 text-[13px] font-semibold text-white no-underline hover:text-white ${FOCUS}` : `${ROW_BTN} min-w-8 justify-center`}>{n}</Link>
              ))}
              {dir.page < dir.pages ? <Link href={params({ page: String(dir.page + 1) })} className={ROW_BTN}>Next</Link> : <span aria-disabled="true" className={`${ROW_BTN} cursor-default opacity-50`}>Next</span>}
            </nav>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

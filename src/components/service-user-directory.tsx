import type { ServiceUserStatus } from "@prisma/client";
import { Eye, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { EXACT_REFERENCE_HINT, SearchProblem } from "@/components/search-notice";
import { mayBeExternalReference } from "@/lib/service-user-search";
import { AddServiceUserButton, RowDetails, UpdateServiceUserButton, type ServiceUserActionPerms } from "@/components/service-user-actions";
import type { serviceUserDirectory } from "@/server/care/service-users";

export const DIRECTORY_STATUSES: ServiceUserStatus[] = ["ENQUIRY", "ASSESSMENT", "ACTIVE", "PAUSED", "ENDED"];

type Directory = Awaited<ReturnType<typeof serviceUserDirectory>>;
type Params = { q?: string; status?: string; area?: string; branch?: string };
type Option = { id: string; name: string };

const suName = (s: { firstName: string; lastName: string; preferredName: string | null }) => `${s.preferredName || s.firstName} ${s.lastName}`;
const initials = (s: { firstName: string; lastName: string; preferredName: string | null }) => `${(s.preferredName || s.firstName).charAt(0)}${s.lastName.charAt(0)}`.toUpperCase();
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-module focus-visible:ring-offset-2";
const ROW_BTN = `inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#d0d5dd] bg-white px-2.5 text-[14px] font-semibold text-[#344054] no-underline hover:border-module hover:bg-[#f8f5fe] hover:text-[#344054] ${FOCUS}`;
const PAGE_BTN = `inline-flex h-10 min-w-10 items-center justify-center rounded-[8px] border border-[#e4e7ec] bg-white px-3 text-[14px] font-semibold text-[#344054] no-underline hover:border-module hover:text-[#344054] ${FOCUS}`;
const FIELD = "h-11 w-full rounded-[9px] border border-[#d0d5dd] bg-white px-3 text-[14.5px] text-[#101828] focus:border-module focus:outline-none focus:ring-2 focus:ring-module/[.14]";
/** Columns that give way on narrower screens; everything in them is also under the row's ⋮ details. */
const WIDE = "hidden xl:table-cell";
/** The council number gives way first (below 1536px); it stays in the row's ⋮ details and in search. */
const WIDEST = "hidden 2xl:table-cell";
const WIDER = "hidden min-[1420px]:table-cell";

/** Lifecycle status only (never a clinical review flag), as a compact pill. */
const STATUS_PILL: Record<ServiceUserStatus, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "bg-[#e7f6ec] text-[#16794a]" },
  ASSESSMENT: { label: "Assessment", cls: "bg-[#e8f0fd] text-[#2453b3]" },
  ENQUIRY: { label: "Enquiry", cls: "bg-[#f1ecfc] text-module" },
  PAUSED: { label: "Paused", cls: "bg-[#fdf3dc] text-[#94600a]" },
  ENDED: { label: "Ended", cls: "bg-[#f2f4f7] text-[#475467]" },
};

const ARCHIVED_PILL = { label: "Archived", cls: "bg-[#eaecf0] text-[#344054]" };

const london = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(d);
const nextVisitText = (d: Date) => `${london(d, { weekday: "short", day: "numeric", month: "short" }).replace(/^(\w+) /, "$1, ")} ${london(d, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
const dobText = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(d);
const hoursText = (mins: number) => `${(mins / 60).toFixed(2)} hrs / week`;

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

const COUNCIL_PROBLEM = {
  KEY_MISSING: "Council and Frameworki numbers can't be shown because the reference encryption key is not set on the server. Ask your system administrator to add CSB_REFERENCE_SECRET.",
  FAILED: "Council and Frameworki numbers couldn't be read just now. The problem has been logged; the rest of the list is correct.",
} as const;

/**
 * All Service Users: the one service-user workspace. Title and the two management dropdowns, the search and filter
 * toolbar (Search, Branch, Area, Status), the table with View, Update and ⋮ details on every row, and pages of 20.
 */
export function ServiceUserDirectory({ dir, sp, areas, branches, basePath, perms }: { dir: Directory; sp: Params; areas: Option[]; branches: Option[]; basePath: string; perms: ServiceUserActionPerms; demo?: boolean }) {
  const rows = dir.rows;
  const params = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.branch) p.set("branch", sp.branch);
    if (sp.area) p.set("area", sp.area);
    if (sp.status) p.set("status", sp.status);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${basePath}?${p}`;
  };
  const showAll = `${basePath}?${new URLSearchParams({ q: dir.q, status: "ALL" })}`;
  const first = dir.total ? (dir.page - 1) * dir.pageSize + 1 : 0;
  const last = Math.min(dir.total, first + rows.length - 1);
  const canUpdate = perms.edit || perms.upload;
  const showing = dir.total ? <>Showing {first} to {last} of {dir.total.toLocaleString("en-GB")} service {dir.total === 1 ? "user" : "users"}{sp.status === "ARCHIVED" ? " (archived)" : sp.status ? "" : " (not ended)"}</> : null;
  return (
    <section aria-label="All Service Users" className="hb-pn hb-c-purple" data-testid="su-directory">
      {/* The page's title and description are in the module header band; the panel's title bar names the list. */}
      <div className="hb-pn-h"><h2>Service user list <span className="hb-pn-cnt">{dir.total.toLocaleString("en-GB")}</span></h2></div>
      <div className="px-4 pb-5 pt-4 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-end">
        {perms.create || perms.upload || perms.edit ? (
          <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row sm:flex-wrap lg:flex-nowrap lg:justify-end" data-testid="su-actions">
            <AddServiceUserButton perms={perms} />
            <UpdateServiceUserButton perms={perms} />
          </div>
        ) : null}
      </div>

      <section aria-label="Filters" className="mt-6">
        <form method="get" action={basePath} className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_repeat(3,minmax(8.5rem,11rem))_auto]">
          <label className="sm:col-span-2 lg:col-span-1"><span className="sr-only">Search</span>
            <span className="relative block">
              <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475467]" />
              <input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Search by name, CSB reference, council or Frameworki number..." className={`${FIELD} pl-10`} />
            </span>
          </label>
          <label><span className="sr-only">Branch</span><select name="branch" defaultValue={sp.branch ?? ""} className={FIELD}><option value="">All Branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label><span className="sr-only">Area</span><select name="area" defaultValue={sp.area ?? ""} className={FIELD}><option value="">All Areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span className="sr-only">Status</span><select name="status" defaultValue={sp.status ?? ""} className={FIELD}><option value="">Current (not ended)</option><option value="ALL">All Statuses</option>{DIRECTORY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_PILL[s].label}</option>)}<option value="ARCHIVED">Archived</option></select></label>
          <div className="flex gap-2.5 sm:col-span-2 lg:col-span-1">
            <button className={`inline-flex h-11 flex-1 items-center justify-center rounded-[9px] bg-module px-6 text-[15px] font-semibold text-white hover:bg-module-strong lg:flex-none ${FOCUS}`}>Apply</button>
            <Link href={basePath} className={`inline-flex h-11 flex-1 items-center justify-center rounded-[9px] border border-[#344054] bg-white px-6 text-[15px] font-medium text-[#344054] no-underline hover:bg-[#f9fafb] hover:text-[#101828] lg:flex-none ${FOCUS}`}>Clear</Link>
          </div>
        </form>
      </section>

      <div className="mt-3 empty:hidden">
        {dir.referenceProblem ? <SearchProblem>{dir.referenceProblem}</SearchProblem> : null}
        {dir.councilReferenceProblem ? <p role="status" className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13.5px] text-amber-900" data-testid="council-ref-problem">{COUNCIL_PROBLEM[dir.councilReferenceProblem]}</p> : null}
        {dir.hiddenByFilters ? (
          <p role="status" data-testid="hidden-by-filters" className="mb-3 rounded-[8px] border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13.5px] text-sky-900">
            {dir.hiddenByFilters === 1 ? "1 more person matches" : `${dir.hiddenByFilters} more people match`} “{dir.q}” but {dir.hiddenByFilters === 1 ? "is" : "are"} hidden by the status, area or branch filter. <Link href={showAll}>Show all matches</Link>
          </p>
        ) : null}
        {dir.archivedMatches ? (
          <p role="status" data-testid="archived-matches" className="mb-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13.5px] text-slate-800">
            {dir.archivedMatches === 1 ? "1 archived person also matches" : `${dir.archivedMatches} archived people also match`} “{dir.q}”. <Link href={`${basePath}?${new URLSearchParams({ q: dir.q, status: "ARCHIVED" })}`}>Show archived</Link>
          </p>
        ) : null}
      </div>

      {showing ? <p className="mt-4 text-[15px] text-[#344054]" data-testid="su-count">{showing}</p> : null}

      {rows.length ? (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14.5px] text-[#101828]">
            <thead>
              <tr className="whitespace-nowrap bg-[#f6f7f9] text-[13.5px] font-semibold text-[#101828]">
                <th scope="col" className="px-2.5 py-3 2xl:px-3 font-semibold">Service User</th>
                <th scope="col" className="px-2.5 py-3 2xl:px-3 font-semibold">CSB Reference</th>
                <th scope="col" className={`${WIDEST} px-2.5 py-3 2xl:px-3 font-semibold`}>Council / Frameworki Ref</th>
                <th scope="col" className={`${WIDE} px-2.5 py-3 2xl:px-3 font-semibold`}>Area</th>
                <th scope="col" className={`${WIDE} px-2.5 py-3 2xl:px-3 font-semibold`}>Care Package</th>
                <th scope="col" className="px-2.5 py-3 2xl:px-3 font-semibold">Status</th>
                <th scope="col" className={`${WIDER} px-2.5 py-3 2xl:px-3 font-semibold`}>Next Visit</th>
                <th scope="col" className="px-2.5 py-3 2xl:px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const mins = s.packages.reduce((n, p) => n + (p.commissionedMinutesPerWeek ?? 0), 0);
                const name = suName(s);
                const reference = s.csbReference ?? s.reference;
                const pill = s.archivedAt ? ARCHIVED_PILL : STATUS_PILL[s.status];
                const council = s.councilReference;
                return (
                  <tr key={s.id} data-testid="su-row" className="border-b border-[#eaecf0] last:border-b-0">
                    <td className="px-2.5 py-3 2xl:px-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ece7fb] text-[14px] font-bold text-[#4b1fa8]">{initials(s)}</span>
                        <span className="min-w-0">
                          <Link href={`/rota/service-users/${s.id}`} className="block whitespace-nowrap font-semibold text-[#101828] no-underline hover:text-[#4b1fa8] hover:underline">{name}</Link>
                          <span className="block whitespace-nowrap text-[13px] text-[#475467]">{s.matchedReference ? `Search matched ${s.matchedReference}` : s.dateOfBirth ? `DOB: ${dobText(s.dateOfBirth)}` : s.postcode ?? ""}</span>
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-3 2xl:px-3 tabular-nums">{s.csbReference ?? <span className="text-[#667085]">Not recorded</span>}{s.csbReference && s.reference !== s.csbReference ? <span className="block text-[12.5px] text-[#667085]">legacy {s.reference}</span> : null}</td>
                    <td className={`${WIDEST} px-2.5 py-3 2xl:px-3 tabular-nums`} data-testid="council-ref">{council ? <><span>{council.value}</span><span className="block whitespace-nowrap text-[12.5px] text-[#667085]">{council.title}{council.verified ? "" : " · unverified"}{council.others ? ` · +${council.others} more` : ""}</span></> : <span className="text-[#667085]">—</span>}</td>
                    <td className={`${WIDE} px-2.5 py-3 2xl:px-3`}>{s.area?.name ?? <span className="text-[#667085]">No area</span>}</td>
                    <td className={`${WIDE} whitespace-nowrap px-2.5 py-3 2xl:px-3 tabular-nums`}>{mins ? hoursText(mins) : <span className="text-[#667085]">No active package</span>}</td>
                    <td className="px-2.5 py-3 2xl:px-3"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-medium ${pill.cls}`} data-testid="status-pill">{pill.label}</span></td>
                    <td className={`${WIDER} whitespace-nowrap px-2.5 py-3 2xl:px-3 tabular-nums`}>{s.nextVisit ? nextVisitText(s.nextVisit) : <span className="text-[#667085]">None scheduled</span>}</td>
                    <td className="px-2.5 py-3 2xl:px-3">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Link href={`/rota/service-users/${s.id}`} className={ROW_BTN} data-testid="row-view"><Eye size={17} aria-hidden />View<span className="sr-only"> {name}</span></Link>
                        {canUpdate ? <UpdateServiceUserButton perms={perms} person={{ id: s.id, name, reference }} buttonClass={ROW_BTN} testId="row-update" /> : null}
                        <RowDetails name={name}>
                          <p className="mb-1.5 font-semibold text-[#101828]">{name}</p>
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[#344054]">
                            <dt className="text-[#667085]">CSB reference</dt><dd>{s.csbReference ?? "Not recorded"}</dd>
                            <dt className="text-[#667085]">Legacy reference</dt><dd>{s.reference}</dd>
                            <dt className="text-[#667085]">Council ref</dt><dd>{council ? `${council.value} (${council.title}${council.verified ? "" : ", unverified"})` : "—"}</dd>
                            <dt className="text-[#667085]">Branch</dt><dd>{s.branch?.name ?? "—"}</dd>
                            <dt className="text-[#667085]">Area</dt><dd>{s.area?.name ?? "No area"}</dd>
                            <dt className="text-[#667085]">Postcode</dt><dd>{s.postcode ?? "—"}</dd>
                            <dt className="text-[#667085]">Risk</dt><dd>{s.riskLevel ? s.riskLevel.charAt(0) + s.riskLevel.slice(1).toLowerCase() : "Not assessed"}</dd>
                            <dt className="text-[#667085]">Care package</dt><dd>{mins ? hoursText(mins) : "No active package"}</dd>
                            <dt className="text-[#667085]">Repeating visits</dt><dd>{s._count.templates}</dd>
                            <dt className="text-[#667085]">Next visit</dt><dd>{s.nextVisit ? nextVisitText(s.nextVisit) : "None scheduled"}</dd>
                            <dt className="text-[#667085]">Carer preference</dt><dd>{s.carerGenderPreference === "ANY" ? "None" : `${s.carerGenderPreference.toLowerCase()} carers`}</dd>
                          </dl>
                        </RowDetails>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-[10px] border border-dashed border-[#d0d5dd] px-4 py-8 text-center text-[14.5px] text-[#475467]" data-testid="su-empty">
          {dir.q ? `No service users you are allowed to see match “${dir.q}” with these filters.${mayBeExternalReference(dir.q) && !dir.referenceProblem ? ` ${EXACT_REFERENCE_HINT}` : ""}` : "No service users match these filters."}
        </p>
      )}

      {dir.total ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-[#344054]" data-testid="su-showing">{showing}</p>
          {dir.pages > 1 ? (
            <nav aria-label="Service user pages" className="flex flex-wrap items-center gap-1.5">
              {dir.page > 1 ? <Link href={params({ page: String(dir.page - 1) })} className={PAGE_BTN}>Previous</Link> : <span aria-disabled="true" className={`${PAGE_BTN} cursor-default text-[#98a2b3] hover:border-[#e4e7ec]`}>Previous</span>}
              {pageList(dir.page, dir.pages).map((n, i) => n === "gap" ? <span key={`g${i}`} aria-hidden className="px-1 text-[#667085]">…</span> : (
                <Link key={n} href={params({ page: String(n) })} aria-current={n === dir.page ? "page" : undefined} aria-label={`Page ${n}`} className={n === dir.page ? `inline-flex h-10 min-w-10 items-center justify-center rounded-[8px] bg-[#4b1fa8] px-3 text-[14px] font-semibold text-white no-underline hover:text-white ${FOCUS}` : PAGE_BTN}>{n}</Link>
              ))}
              {dir.page < dir.pages ? <Link href={params({ page: String(dir.page + 1) })} className={PAGE_BTN}>Next</Link> : <span aria-disabled="true" className={`${PAGE_BTN} cursor-default text-[#98a2b3] hover:border-[#e4e7ec]`}>Next</span>}
            </nav>
          ) : null}
        </div>
      ) : null}
      </div>
    </section>
  );
}

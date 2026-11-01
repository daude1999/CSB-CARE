import type { ReactNode } from "react";
import { ArrowSquareOut, CalendarBlank, ClockCounterClockwise, Columns, FileXls, FilePdf, MagnifyingGlass, User, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { Ctx } from "@/server/auth/rbac";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { rotaLookups } from "@/server/rota/queries";
import { attendanceRate, coverageReport, coverageTimeline, DEFINITIONS, LATE_THRESHOLDS, OUTCOME_LABEL, parseCoverage, periodLabel, VIEW_LABEL, VIEWS, type CoverageRow, type CoverageView, type Outcome, type Tally } from "@/server/rota/coverage";
import { AppError } from "@/lib/errors";
import { Empty } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit";
import { BTN_SECONDARY, FilterSelect, ListFooter, MENU, PANEL, SortHead, TD, TH, linker } from "@/components/rota-list-ui";

const OUTCOME_BADGE: Record<Outcome, string> = {
  ATTENDED_COMPLETED: "bg-[#e7f6ec] text-[#14713a]",
  ATTENDED_OPEN: "bg-[#e6f0fb] text-[#175cd3]",
  MISSED: "bg-[#fdecec] text-[#b42318]",
  NOT_DELIVERED: "bg-[#f4f3ff] text-[#5925dc]",
  NO_RECORD: "bg-[#fdf3d8] text-[#8a5a00]",
  NOT_DUE: "bg-[#f2f4f7] text-[#475467]",
  CANCELLED: "bg-[#f2f4f7] text-[#667085]",
};

const OPTIONAL = [
  ["branch", "Branch"],
  ["area", "Area"],
  ["call", "Service call"],
  ["reason", "Reassignment reason"],
  ["by", "Authorising coordinator"],
  ["at", "Reassigned at"],
  ["changes", "Staffing changes"],
  ["lateflag", "Late reassignment"],
  ["ack", "Acknowledgement"],
  ["inv", "Investigation"],
] as const;
type Optional = (typeof OPTIONAL)[number][0];
/** Extra columns each report view turns on by default, so the late and uncovered reports show what they are for. */
const VIEW_COLS: Partial<Record<CoverageView, Optional[]>> = { late: ["at", "lateflag", "reason", "by"], reassigned: ["reason", "by", "at", "changes"], uncovered: ["changes", "inv"] };

const day = (d: string) => fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" });
const dur = (m: number | null) => (m === null ? "—" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

function Figure({ label, value, note, tone = "text-[#101828]", href }: { label: string; value: number; note?: ReactNode; tone?: string; href?: string }) {
  const inner = (
    <>
      <span className={`block text-[24px] font-bold leading-tight tabular-nums ${tone}`}>{value.toLocaleString("en-GB")}</span>
      <span className="block text-[14px] font-semibold text-[#101828]">{label}</span>
      {note ? <span className="block text-[12.5px] text-[#475467]">{note}</span> : null}
    </>
  );
  const cls = "min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white px-4 py-2.5 no-underline";
  return href ? <Link href={href} className={`${cls} text-inherit hover:border-[#5b2bb5]`}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

export async function CoverageHistory({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  let f: ReturnType<typeof parseCoverage>;
  let error: string | null = null;
  try {
    f = parseCoverage(sp);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
    f = parseCoverage({ ...sp, range: "7" });
  }
  const lk = await rotaLookups(ctx);
  const branch = f.branch && lk.branches.some((b) => b.id === f.branch) ? f.branch : undefined;
  const area = f.area && lk.areas.some((a) => a.id === f.area && (!branch || a.branchId === branch)) ? f.area : undefined;
  const r = await coverageReport(ctx, { ...f, branch, area });
  const cols = new Set<Optional>([...(sp.cols ?? "").split(",").filter((c): c is Optional => OPTIONAL.some(([k]) => k === c)), ...(sp.cols ? [] : VIEW_COLS[f.view] ?? [])]);
  let hist: Awaited<ReturnType<typeof coverageTimeline>> | null = null;
  if (sp.hv) {
    try {
      hist = await coverageTimeline(ctx, sp.hv, f.late);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }

  const params: Record<string, string | undefined> = {
    tab: "history",
    range: f.range === "7" ? undefined : f.range,
    from: f.range === "custom" ? f.from : undefined,
    to: f.range === "custom" ? f.to : undefined,
    branch, area, call: f.call, q: f.q, day: f.day,
    view: f.view === "all" ? undefined : f.view,
    late: f.late === 30 ? undefined : String(f.late),
    sort: f.sort === "date" ? undefined : f.sort,
    dir: f.dir === "desc" ? undefined : f.dir,
    per: f.per === 25 ? undefined : String(f.per),
    page: r.page === 1 ? undefined : String(r.page),
    cols: sp.cols,
    hv: hist ? sp.hv : undefined,
  };
  const { url, hiddenExcept } = linker("/rota/unassigned", params);
  const exportHref = (format: string) => `/api/rota/coverage?${new URLSearchParams(Object.entries({ ...params, tab: undefined, page: undefined, per: undefined, cols: undefined, hv: undefined, format }).filter((e): e is [string, string] => !!e[1]))}`;
  const s = r.summary;
  const rate = attendanceRate(s);
  const heading = f.range === "custom" ? `Visit Coverage — ${fmtLondonDate(f.from, { day: "numeric", month: "short" })} to ${fmtLondonDate(f.to, { day: "numeric", month: "short" })}` : `Visit Coverage — Last ${f.range} Days`;
  const areas = lk.areas.filter((a) => !branch || a.branchId === branch);
  const dayLink = (d: string, view?: CoverageView) => url({ day: d, view: view === "all" ? undefined : view, page: undefined, hv: undefined }) + "#coverage-visits";
  const sortLink = (key: string) => url({ sort: key === "date" ? undefined : key, dir: f.sort === key && f.dir === "desc" ? "asc" : undefined, page: undefined });
  const today = londonDate();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <div className="mr-auto min-w-0">
          <h2 className="text-[20px] font-bold text-[#101828]">{heading}</h2>
          <p className="text-[14px] text-[#344054]">{periodLabel(f, f.partial)}. Read-only: corrections are made on the visit or in Missed Calls.</p>
        </div>
        <nav aria-label="Reporting period" className="inline-flex rounded-[8px] border border-[#d0d5dd] bg-white p-0.5">
          {(["7", "14", "30", "90"] as const).map((n) => (
            <Link key={n} href={url({ range: n === "7" ? undefined : n, from: undefined, to: undefined, day: undefined, page: undefined, hv: undefined })} aria-current={f.range === n ? "page" : undefined} className={`flex h-9 items-center rounded-[6px] px-3.5 text-[14px] font-semibold no-underline ${f.range === n ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>{n} days</Link>
          ))}
        </nav>
        <details className="relative">
          <summary className={`flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border bg-white px-4 text-[14.5px] font-semibold hover:bg-slate-50 [&::-webkit-details-marker]:hidden ${f.range === "custom" ? "border-[#5b2bb5] text-[#5b2bb5]" : "border-[#d0d5dd] text-[#101828]"}`}><CalendarBlank size={18} aria-hidden />Custom dates</summary>
          <form method="get" className={`${MENU} grid w-[280px] gap-2.5 p-3`} aria-label="Custom period">
            {hiddenExcept(["range", "from", "to", "day", "page", "hv"])}
            <input type="hidden" name="range" value="custom" />
            <label><span className="label">From</span><input type="date" name="from" max={today} defaultValue={f.from} className="input" /></label>
            <label><span className="label">To</span><input type="date" name="to" max={today} defaultValue={f.to} className="input" /></label>
            <p className="text-[12.5px] text-[#475467]">Up to 92 days, ending today at the latest. Today counts as a partial day.</p>
            <button className="btn-primary">Show period</button>
          </form>
        </details>
      </div>
      {error ? <p role="alert" className="mb-3 rounded-[8px] bg-[#fdecec] px-3 py-2 text-[14px] text-[#a3242c]">{error}. Showing the last 7 days instead.</p> : null}

      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-start">
      <AutoSubmitForm label="Report filters" className="grid w-full min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3 lg:max-w-[760px]">
        {hiddenExcept(["branch", "area", "call", "page", "day", "hv"])}
        {lk.branches.length > 1 ? <FilterSelect name="branch" label="Branch" value={branch ?? ""}><option value="">Branch: All my branches</option>{lk.branches.map((b) => <option key={b.id} value={b.id}>Branch: {b.name}</option>)}</FilterSelect> : <input type="hidden" name="branch" value="" />}
        <FilterSelect name="area" label="Area" value={area ?? ""}><option value="">Area: All Areas</option>{areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}</FilterSelect>
        <FilterSelect name="call" label="Service call" value={f.call ?? ""}><option value="">Service Call: All</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</FilterSelect>
      </AutoSubmitForm>
        <div className="flex gap-2.5 lg:ml-auto">
          <a href={exportHref("xlsx")} className={BTN_SECONDARY} download><FileXls size={19} aria-hidden className="text-[#14713a]" />Export Excel</a>
          <a href={exportHref("pdf")} className={BTN_SECONDARY} download><FilePdf size={19} aria-hidden className="text-[#b42318]" />Export PDF</a>
        </div>
      </div>

      <section aria-label="Coverage summary" className="mb-2 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Figure label="Total visits" value={s.total} note={f.partial && s.notDue ? `${s.notDue} not yet due today` : `${s.completed.toLocaleString("en-GB")} completed`} href={url({ view: undefined, day: undefined, page: undefined }) + "#coverage-visits"} />
        <Figure label="Attended" value={s.attended} tone="text-[#14713a]" note={rate === null ? "No visits were due" : `${rate}% of visits due (cancelled left out)`} href={url({ view: "attended", day: undefined, page: undefined }) + "#coverage-visits"} />
        <Figure label="Without recorded attendance" value={s.uncovered} tone={s.uncovered ? "text-[#b42318]" : "text-[#101828]"} note={`${s.missed} missed · ${s.notDelivered} not delivered · ${s.noRecord} no record`} href={url({ view: "uncovered", day: undefined, page: undefined }) + "#coverage-visits"} />
        <Figure label="Cancelled" value={s.cancelled} note="In the total, not in the rate" href={url({ view: "cancelled", day: undefined, page: undefined }) + "#coverage-visits"} />
      </section>
      <div className="mb-4 text-[13px] text-[#475467]" data-testid="coverage-reconcile">
        {s.attended} attended + {s.uncovered} without recorded attendance + {s.cancelled} cancelled{s.notDue ? ` + ${s.notDue} not yet due` : ""} = {s.total} visits. {s.reassigned} reassigned, <Link href={url({ view: "late", page: undefined }) + "#coverage-visits"}>{s.late} late reassignment{s.late === 1 ? "" : "s"}</Link> (under {f.late} minutes before the start).{" "}
        <details className="inline"><summary className="inline cursor-pointer font-semibold text-[#5b2bb5]">Definitions</summary><dl className="mt-2 grid gap-1 rounded-[8px] border border-[#e4e7ec] bg-white p-3 sm:grid-cols-[200px_1fr]">{DEFINITIONS.map(([t, d]) => <div key={t} className="contents"><dt className="font-semibold text-[#101828]">{t}</dt><dd>{d}</dd></div>)}</dl></details>
      </div>

      <section aria-labelledby="daily-h" className={`${PANEL} mb-4`}>
        <h3 id="daily-h" className="px-3.5 pb-2 pt-3 text-[16px] font-bold text-[#101828]">Daily Visit Coverage</h3>
        <div className="overflow-x-auto border-t border-[#eaecf0]">
          <table className="w-full border-collapse whitespace-nowrap text-[14px]">
            <thead className="bg-[#f9fafb]"><tr className="border-b border-[#eaecf0]">{["Day", "Scheduled", "Attended", "Completed", "Without recorded attendance", "Cancelled"].map((h, i) => <th key={h} scope="col" className={`${TH} ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {r.days.map(({ date, t }) => {
                const cell = (n: number, view: CoverageView, tone = "") => <td className={`${TD} text-right tabular-nums`}>{n ? <Link href={dayLink(date, view)} className={`no-underline hover:underline ${tone}`} aria-label={`${n} ${VIEW_LABEL[view].toLowerCase()} visits on ${day(date)}`}>{n}</Link> : <span className="text-[#98a2b3]">0</span>}</td>;
                return (
                  <tr key={date} className={`border-b border-[#f2f4f7] last:border-0 ${f.day === date ? "bg-[#eef4ff]" : ""}`}>
                    <th scope="row" className={`${TD} text-left font-semibold text-[#101828]`}>{day(date)}{date === today ? <span className="ml-1.5 text-[12px] font-normal text-[#8a5a00]">partial day</span> : null}</th>
                    {cell(t.total, "all", "text-[#101828]")}
                    {cell(t.attended, "attended", "text-[#14713a]")}
                    {cell(t.completed, "completed", "text-[#101828]")}
                    {cell(t.uncovered, "uncovered", "font-semibold text-[#b42318]")}
                    {cell(t.cancelled, "cancelled", "text-[#475467]")}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#f9fafb]"><tr className="border-t border-[#eaecf0] font-semibold"><th scope="row" className={`${TD} text-left`}>Total</th>{[s.total, s.attended, s.completed, s.uncovered, s.cancelled].map((n, i) => <td key={i} className={`${TD} text-right tabular-nums`}>{n}</td>)}</tr></tfoot>
          </table>
        </div>
      </section>

      {r.compare ? (
        <details className={`${PANEL} mb-4`} open={sp.compare === "1"}>
          <summary className="cursor-pointer px-3.5 py-3 text-[16px] font-bold text-[#101828]">Branch Comparison <span className="text-[13px] font-normal text-[#475467]">· by the service user&apos;s branch</span></summary>
          <div className="overflow-x-auto border-t border-[#eaecf0]">
            <table className="w-full border-collapse whitespace-nowrap text-[14px]">
              <thead className="bg-[#f9fafb]"><tr className="border-b border-[#eaecf0]">{["Branch", "Total visits", "Attended", "Completed", "No recorded attendance", "Cancelled", "Reassigned", "Late reassignments"].map((h, i) => <th key={h} scope="col" className={`${TH} ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {r.compare.map((b: { id: string | null; name: string; t: Tally }) => (
                  <tr key={b.id ?? "none"} className="border-b border-[#f2f4f7] last:border-0">
                    <th scope="row" className={`${TD} text-left font-semibold`}>{b.id ? <Link href={url({ branch: b.id, area: undefined, page: undefined })} className="text-[#101828]">{b.name}</Link> : b.name}</th>
                    {[b.t.total, b.t.attended, b.t.completed, b.t.uncovered, b.t.cancelled, b.t.reassigned, b.t.late].map((n, i) => <td key={i} className={`${TD} text-right tabular-nums`}>{n}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <div id="coverage-visits" className={`grid grid-cols-1 items-start gap-4 ${hist ? "xl:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <section aria-labelledby="visits-h" className={PANEL}>
          <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2 pt-3">
            <h3 id="visits-h" className="mr-2 text-[16px] font-bold text-[#101828]">Visit Records{f.day ? <span className="font-normal text-[#475467]"> · {day(f.day)} <Link href={url({ day: undefined, page: undefined })} aria-label="Show every day" className="inline-flex align-middle"><X size={14} aria-hidden /></Link></span> : null}</h3>
            <AutoSubmitForm label="Search visit records" className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
              {hiddenExcept(["q", "page", "hv"])}
              <span className="sr-only">Search by service user, carer or reference</span>
              <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
              <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Search visits…" aria-label="Search by service user, carer or reference" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px] placeholder:text-[#667085]" />
            </AutoSubmitForm>
            <details className="relative ml-auto">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-medium text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><Columns size={18} aria-hidden />Columns{cols.size ? <span className="rounded-full bg-[#efeafc] px-1.5 text-[12px] font-semibold text-[#5b2bb5]">+{cols.size}</span> : null}</summary>
              <form method="get" className={`${MENU} z-30 w-[250px] p-3`}>
                {hiddenExcept(["cols"])}
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-semibold text-[#101828]">Extra columns</legend>
                  {OPTIONAL.map(([k, label]) => <label key={k} className="flex items-center gap-2 py-0.5 text-[14px]"><input type="checkbox" name="cols" value={k} defaultChecked={cols.has(k)} className="h-4 w-4" />{label}</label>)}
                </fieldset>
                <div className="mt-2 flex gap-2"><button className="btn-primary py-1">Apply</button><Link href={url({ cols: undefined })} className="btn-secondary py-1">Default</Link></div>
              </form>
            </details>
          </div>
          <nav aria-label="Report view" className="flex flex-wrap items-center gap-1.5 px-3.5 pb-3">
            {VIEWS.map((k) => <Link key={k} href={url({ view: k === "all" ? undefined : k, page: undefined, cols: undefined })} aria-current={f.view === k ? "page" : undefined} className={`rounded-full border px-3 py-1 text-[13.5px] font-semibold no-underline ${f.view === k ? "border-[#5b2bb5] bg-[#5b2bb5] text-white" : "border-[#d0d5dd] bg-white text-[#344054] hover:bg-slate-50"}`}>{VIEW_LABEL[k]}</Link>)}
            {f.view === "late" ? (
              <AutoSubmitForm label="Late threshold" className="ml-1 flex items-center gap-1.5 text-[13.5px]">
                {hiddenExcept(["late", "page"])}
                <label htmlFor="late-min" className="text-[#475467]">Reassigned under</label>
                <select id="late-min" name="late" defaultValue={String(f.late)} className="h-8 rounded-[6px] border border-[#d0d5dd] bg-white px-2">{LATE_THRESHOLDS.map((n) => <option key={n} value={n}>{n} min</option>)}</select>
                <span className="text-[#475467]">before the start</span>
              </AutoSubmitForm>
            ) : null}
          </nav>
          {f.view === "late" ? <p className="px-3.5 pb-2 text-[13px] text-[#475467]">Late reassignment is a reporting rule (the replacement was saved less than {f.late} minutes before the scheduled start, or after it). It is not evidence that care started late.</p> : null}
          {f.view === "uncovered" ? <p className="px-3.5 pb-2 text-[13px] text-[#475467]">Visits recorded as missed or not delivered, and visits with no clock-in and no recorded outcome. A missing clock is not proof that nobody attended. A later recovery visit never changes the original visit&apos;s outcome.</p> : null}
          {r.rows.length ? (
            <div className="overflow-x-auto border-t border-[#eaecf0]">
              <table className="w-full border-collapse text-[14px]">
                <caption className="sr-only">Visit records, {periodLabel(f, f.partial)}</caption>
                <thead className="bg-[#f9fafb]">
                  <tr className="border-b border-[#eaecf0]">
                    <SortHead active={f.sort === "ref"} dir={f.dir} href={sortLink("ref")}>Ref</SortHead>
                    <SortHead active={f.sort === "date"} dir={f.dir} href={sortLink("date")}>Date</SortHead>
                    <SortHead active={f.sort === "su"} dir={f.dir} href={sortLink("su")}>Service User</SortHead>
                    {cols.has("branch") ? <th scope="col" className={TH}>Branch</th> : null}
                    {cols.has("area") ? <th scope="col" className={TH}>Area</th> : null}
                    {cols.has("call") ? <th scope="col" className={TH}>Service Call</th> : null}
                    <th scope="col" className={TH}>Original Carer</th>
                    <th scope="col" className={TH}>Attended By</th>
                    <th scope="col" className={TH}>Scheduled</th>
                    <th scope="col" className={TH}>Clock In</th>
                    <th scope="col" className={TH}>Clock Out</th>
                    <th scope="col" className={TH}>Duration</th>
                    <th scope="col" className={TH}>Reassigned</th>
                    {cols.has("reason") ? <th scope="col" className={TH}>Reason</th> : null}
                    {cols.has("by") ? <th scope="col" className={TH}>Authorised By</th> : null}
                    {cols.has("at") ? <th scope="col" className={TH}>Reassigned At</th> : null}
                    {cols.has("changes") ? <SortHead active={f.sort === "changes"} dir={f.dir} href={sortLink("changes")}>Changes</SortHead> : null}
                    {cols.has("lateflag") ? <th scope="col" className={TH}>Late</th> : null}
                    {cols.has("ack") ? <th scope="col" className={TH}>Acknowledged</th> : null}
                    {cols.has("inv") ? <th scope="col" className={TH}>Investigation</th> : null}
                    <SortHead active={f.sort === "status"} dir={f.dir} href={sortLink("status")}>Final Status</SortHead>
                    <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x: CoverageRow) => {
                    const selected = hist?.row.id === x.id;
                    const lr = x.lastReplacement;
                    return (
                      <tr key={x.id} aria-selected={selected || undefined} className={`border-b border-[#f2f4f7] align-top last:border-0 ${selected ? "bg-[#eef4ff] outline outline-2 -outline-offset-2 outline-[#84adff]" : ""} hover:bg-[#f9f8fe]`}>
                        <td className={`${TD} whitespace-nowrap`}>{x.reference}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{fmtLondonDate(x.date, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                        <td className={`${TD} whitespace-nowrap`}><Link href={`/rota/service-users/${x.serviceUserId}`} className="inline-flex items-center gap-1.5 font-semibold text-[#3b1f99] underline decoration-[#c4b5f4] underline-offset-2"><User size={16} aria-hidden className="text-[#5b2bb5]" />{x.serviceUser}</Link></td>
                        {cols.has("branch") ? <td className={`${TD} whitespace-nowrap`}>{x.branch}</td> : null}
                        {cols.has("area") ? <td className={`${TD} whitespace-nowrap`}>{x.area}</td> : null}
                        {cols.has("call") ? <td className={`${TD} whitespace-nowrap`}>{x.serviceCall}</td> : null}
                        <td className={TD}>{x.original.length ? x.original.join(", ") : <span className="text-[#98a2b3]">None assigned</span>}</td>
                        <td className={TD}>{x.attendance.some((a) => a.in) ? x.attendance.filter((a) => a.in).map((a) => <span key={a.name} className="block whitespace-nowrap">{a.name}{x.attendance.length > 1 ? <span className="text-[12.5px] text-[#475467]"> {a.in}–{a.out ?? "…"}</span> : null}{a.corrected ? <span className="text-[12px] text-[#8a5a00]" title="A clock for this carer was corrected"> (corrected)</span> : null}</span>) : <span className="text-[#98a2b3]">No clock-in</span>}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{x.scheduled}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{x.actualIn ?? "—"}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{x.actualOut ?? "—"}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{dur(x.durationMin)}</td>
                        <td className={TD}>{x.reassigned ? <span className="font-semibold text-[#5b2bb5]">Yes</span> : "No"}</td>
                        {cols.has("reason") ? <td className={`${TD} max-w-[200px]`}>{lr ? lr.reason : "—"}</td> : null}
                        {cols.has("by") ? <td className={`${TD} whitespace-nowrap`}>{lr ? lr.by : "—"}</td> : null}
                        {cols.has("at") ? <td className={`${TD} whitespace-nowrap tabular-nums`}>{lr ? <>{fmtLondonDate(londonDate(lr.at), { day: "2-digit", month: "2-digit" })} {londonTime(lr.at)}<span className="block text-[12.5px] text-[#475467]">{lr.minutesBefore >= 0 ? `${lr.minutesBefore} min before start` : `${-lr.minutesBefore} min after start`}</span></> : "—"}</td> : null}
                        {cols.has("changes") ? <td className={`${TD} tabular-nums`}>{x.changes}</td> : null}
                        {cols.has("lateflag") ? <td className={TD}>{x.late ? <span className="font-semibold text-[#b54708]">Yes</span> : "No"}</td> : null}
                        {cols.has("ack") ? <td className={`${TD} whitespace-nowrap`}>{x.acknowledged}</td> : null}
                        {cols.has("inv") ? <td className={`${TD} whitespace-nowrap`}>{x.investigation ? <Link href={`/rota/missed/${x.investigation.id}`}>{x.investigation.stage.charAt(0) + x.investigation.stage.slice(1).toLowerCase().replace(/_/g, " ")}{x.investigation.escalated ? " · escalated" : ""}</Link> : "—"}</td> : null}
                        <td className={`${TD} whitespace-nowrap`}><span className={`inline-flex rounded-full px-2 py-0.5 text-[13px] font-semibold ${OUTCOME_BADGE[x.outcome]}`}>{OUTCOME_LABEL[x.outcome]}</span></td>
                        <td className={`${TD} whitespace-nowrap`}><Link href={url({ hv: x.id }) + "#coverage-visits"} aria-label={`View history of visit ${x.reference}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#5b2bb5] px-2.5 text-[13.5px] font-semibold text-[#5b2bb5] no-underline hover:bg-[#f6f2fd]"><ClockCounterClockwise size={16} aria-hidden />View History</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="border-t border-[#eaecf0] p-4"><Empty>No visits match {f.view === "all" ? "these filters" : `“${VIEW_LABEL[f.view]}”`} in this period.</Empty></div>}
          <ListFooter total={r.matched} page={r.page} pages={r.pages} per={f.per} noun="visit" testId="coverage-count" href={(p) => url({ page: p ? String(p) : undefined }) + "#coverage-visits"} hidden={hiddenExcept(["per", "page"])} />
        </section>
        {hist ? <HistoryPanel hist={hist} closeHref={url({ hv: undefined }) + "#coverage-visits"} /> : null}
      </div>
    </>
  );
}

const TONE: Record<string, string> = { staff: "border-[#5b2bb5]", clock: "border-[#1f9d4c]", status: "border-[#175cd3]", alert: "border-[#d9473f]", info: "border-[#d0d5dd]" };

function HistoryPanel({ hist, closeHref }: { hist: Awaited<ReturnType<typeof coverageTimeline>>; closeHref: string }) {
  const x = hist.row;
  return (
    <aside aria-labelledby="hist-title" className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)] xl:sticky xl:top-2 xl:max-h-[calc(100vh-40px)]">
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <ClockCounterClockwise size={22} weight="duotone" className="text-[#5b2bb5]" aria-hidden />
        <h3 id="hist-title" className="text-[18px] font-bold text-[#101828]">Visit History</h3>
        <Link href={closeHref} aria-label="Close visit history" className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[#344054] hover:bg-slate-100"><X size={19} weight="bold" aria-hidden /></Link>
      </div>
      <div className="px-4 pb-2">
        <p className="text-[16px] font-bold text-[#101828]">{x.serviceUser}</p>
        <p className="text-[13px] text-[#475467]">Ref {x.reference} · {fmtLondonDate(x.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {x.scheduled}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13.5px]">
          <dt className="text-[#475467]">Original</dt><dd>{x.original.join(", ") || "None assigned"}</dd>
          <dt className="text-[#475467]">Now booked</dt><dd>{x.current.join(", ") || "Nobody"}</dd>
          <dt className="text-[#475467]">Attendance</dt><dd>{x.attendance.length ? x.attendance.map((a) => <span key={a.name} className="block">{a.name}: in {a.in ?? "—"}, out {a.out ?? "—"}{a.corrected ? " (corrected)" : ""}</span>) : "No clock records"}</dd>
          <dt className="text-[#475467]">Outcome</dt><dd><span className={`inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${OUTCOME_BADGE[x.outcome]}`}>{OUTCOME_LABEL[x.outcome]}</span></dd>
        </dl>
      </div>
      <ol className="flex-1 space-y-2.5 overflow-y-auto border-t border-[#eef0f3] px-4 py-3 text-[13.5px]" aria-label="Timeline">
        {hist.items.length ? hist.items.map((it, i) => (
          <li key={i} className={`border-l-[3px] pl-3 ${TONE[it.tone]}`}>
            <span className="block text-[12.5px] tabular-nums text-[#475467]">{fmtLondonDate(londonDate(it.at), { day: "2-digit", month: "2-digit" })} {londonTime(it.at)} · {it.actor}</span>
            <span className="block font-semibold text-[#101828]">{it.title}</span>
            {it.detail ? <span className="block text-[#344054]">{it.detail}</span> : null}
          </li>
        )) : <li className="text-slate-600">No history recorded for this visit.</li>}
      </ol>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[#eef0f3] px-4 py-3 text-[13.5px]">
        <Link href={`/rota/visits/${x.id}`} className="inline-flex items-center gap-1.5 font-semibold"><ArrowSquareOut size={16} aria-hidden />Full visit (clock corrections)</Link>
        {hist.missedCaseId ? <Link href={`/rota/missed/${hist.missedCaseId}`} className="inline-flex items-center gap-1.5 font-semibold"><ArrowSquareOut size={16} aria-hidden />Missed call case</Link> : null}
      </div>
      <p className="px-4 pb-3 text-[12px] text-[#667085]">Built from the visit&apos;s stored assignments, events, clocks and investigation. Anything not recorded shows as Not recorded. Notifications are not listed because the platform does not record their delivery.</p>
    </aside>
  );
}

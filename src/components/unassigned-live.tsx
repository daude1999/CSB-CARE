import { CalendarBlank, CaretDown, MagnifyingGlass, SlidersHorizontal, User, UserPlus, Users } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import type { Ctx } from "@/server/auth/rbac";
import { hasOrgPermission } from "@/server/auth/rbac";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { rotaLookups, suName } from "@/server/rota/queries";
import { PRIORITY_LABEL, PRIORITY_RULE, parseUnassigned, shortCountAhead, unassignedBoard, type Priority, type UnassignedItem } from "@/server/rota/unassigned";
import { bulkVisitsAction, generatePlanAction } from "@/app/rota-actions";
import { Empty } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit";
import { SelectAll } from "@/components/select-all";
import { BulkVisitBar } from "@/components/bulk-visit-bar";
import { FilterSelect, ListFooter, MENU, PANEL, SortHead, SUMMARY_BTN, TD, TH, linker } from "@/components/rota-list-ui";
import { UnassignedCover } from "@/components/unassigned-cover";

const PRIORITY_BADGE: Record<Priority, string> = { URGENT: "bg-[#fdecec] text-[#b42318]", HIGH: "bg-[#fdf3d8] text-[#8a5a00]", NORMAL: "bg-[#eef4ff] text-[#1d4f91]" };
const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

/** Carers booked of carers needed: 0/1, 0/2 and 1/2 are the only states on this list (full visits are not unassigned). */
function Coverage({ item }: { item: UnassignedItem }) {
  const required = Math.min(2, item.visit.carersRequired);
  const filled = required - item.openSlots.length;
  const tone = filled === 0 ? "bg-[#fdecec] text-[#b42318]" : "bg-[#fdf3d8] text-[#8a5a00]";
  const words = filled === 0 ? (required > 1 ? "both carers missing" : "no carer allocated") : "one carer missing";
  return <span title={`${filled} of ${required} carers booked: ${words}`} className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone}`}><Users size={15} weight="fill" aria-hidden />{filled}/{required}<span className="sr-only"> carers, {words}</span></span>;
}

/** Today | Tomorrow | This Week and a custom range, shown in the page header like the Daily Rota's day picker. */
export function LiveRangeControls({ sp }: { sp: Record<string, string | undefined> }) {
  const f = parseUnassigned(sp, londonDate());
  const keep = Object.fromEntries(Object.entries(sp).filter(([k]) => !["when", "from", "to", "days", "page", "cover", "slot", "ctab", "pick", "mq", "ptab", "ok", "error"].includes(k)));
  const { url, hiddenExcept } = linker("/rota/unassigned", keep);
  const period = f.from === f.to ? fmtLondonDate(f.from, { weekday: "short", day: "numeric", month: "short" }) : `${fmtLondonDate(f.from, { day: "numeric", month: "short" })} to ${fmtLondonDate(f.to, { day: "numeric", month: "short" })}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Date range" className="inline-flex rounded-[8px] border border-[#d0d5dd] bg-white p-0.5">
        {([["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This Week"]] as const).map(([k, label]) => (
          <Link key={k} href={url({ when: k === "today" ? undefined : k })} aria-current={f.when === k ? "page" : undefined} title={k === "week" ? "Today and the next six days" : undefined} className={`flex h-9 items-center rounded-[6px] px-4 text-[14.5px] font-semibold no-underline ${f.when === k ? "bg-[#5b2bb5] text-white" : "text-[#101828] hover:bg-slate-50"}`}>{label}</Link>
        ))}
      </nav>
      <details className="relative">
        <summary className={`${SUMMARY_BTN} ${f.when === "custom" ? "border-[#5b2bb5] text-[#5b2bb5]" : ""}`} title="Choose dates"><CalendarBlank size={18} aria-hidden />{period}</summary>
        <form method="get" className={`${MENU} grid w-[280px] gap-2.5 p-3`} aria-label="Custom date range">
          {hiddenExcept([])}
          <input type="hidden" name="when" value="custom" />
          <label><span className="label">From</span><input type="date" name="from" defaultValue={f.from} className="input" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={f.to} className="input" /></label>
          <p className="text-[12.5px] text-[#475467]">Up to 28 days.</p>
          <button className="btn-primary">Show dates</button>
        </form>
      </details>
    </div>
  );
}

export async function UnassignedLive({ ctx, sp }: { ctx: Ctx; sp: Record<string, string | undefined> }) {
  const today = londonDate();
  const f = parseUnassigned(sp, today);
  const lk = await rotaLookups(ctx);
  const branch = f.branch && lk.branches.some((b) => b.id === f.branch) ? f.branch : undefined;
  const area = f.area && lk.areas.some((a) => a.id === f.area && (!branch || a.branchId === branch)) ? f.area : undefined;
  const board = await unassignedBoard(ctx, { ...f, branch, area });
  const ahead = board.summary.visits === 0 && f.when === "today" ? await shortCountAhead(ctx, today) : 0;
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canBuild = hasOrgPermission(ctx, "rota.build");

  const params: Record<string, string | undefined> = {
    tab: sp.tab === "live" ? "live" : undefined,
    when: f.when === "today" ? undefined : f.when,
    from: f.when === "custom" ? f.from : undefined,
    to: f.when === "custom" ? f.to : undefined,
    branch, area, call: f.call, su: f.su, carer: f.carer, priority: f.priority, staffing: f.staffing, carers: f.carers, q: f.q,
    sort: f.sort === "priority" ? undefined : f.sort,
    dir: f.dir === "asc" ? undefined : f.dir,
    per: f.per === 25 ? undefined : String(f.per),
    page: board.page === 1 ? undefined : String(board.page),
    cover: sp.cover, slot: sp.slot, ctab: sp.ctab, pick: sp.pick, mq: sp.mq, ptab: sp.ptab,
  };
  const { url, hiddenExcept } = linker("/rota/unassigned", params);
  const closeCover = { cover: undefined, slot: undefined, ctab: undefined, pick: undefined, mq: undefined, ptab: undefined };
  const back = url(closeCover);
  const areas = lk.areas.filter((a) => !branch || a.branchId === branch);
  const staffOpts = lk.staff.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const suOpts = lk.serviceUsers.filter((s) => !branch || !s.branchId || s.branchId === branch);
  const more = [branch && lk.branches.length > 1 ? 1 : 0, f.su, f.carer, f.carers, f.when === "custom" ? 1 : 0].filter(Boolean).length;
  const sortLink = (key: string) => url({ sort: key === "priority" ? undefined : key, dir: f.sort === key && f.dir === "asc" ? "desc" : undefined, page: undefined });
  const period = f.from === f.to ? fmtLondonDate(f.from, { weekday: "long", day: "numeric", month: "long" }) : `${fmtLondonDate(f.from, { day: "numeric", month: "short" })} to ${fmtLondonDate(f.to, { day: "numeric", month: "short" })}`;
  const planDays = Math.min(7, Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1);
  const coverOpen = !!sp.cover;

  return (
    <>
      <section aria-label="Summary" className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[10px] border border-[#e4e7ec] bg-white px-4 py-2.5 text-[14px] text-[#344054]">
        <span className="font-semibold text-[#101828]">{period}</span>
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        <span><strong data-testid="sum-visits" className="text-[17px] font-bold tabular-nums text-[#101828]">{board.summary.visits}</strong> unassigned visit{board.summary.visits === 1 ? "" : "s"}</span>
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        <Link href={url({ priority: f.priority === "URGENT" ? undefined : "URGENT", page: undefined })} className="text-inherit no-underline hover:underline" title={PRIORITY_RULE}><strong data-testid="sum-urgent" className="text-[17px] font-bold tabular-nums text-[#b42318]">{board.summary.urgent}</strong> urgent</Link>
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        <Link href={url({ staffing: f.staffing === "partial" ? undefined : "partial", page: undefined })} className="text-inherit no-underline hover:underline"><strong data-testid="sum-partial" className="text-[17px] font-bold tabular-nums text-[#8a5a00]">{board.summary.partial}</strong> partially staffed</Link>
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        <span><strong data-testid="sum-slots" className="text-[17px] font-bold tabular-nums text-[#101828]">{board.summary.slots}</strong> empty carer place{board.summary.slots === 1 ? "" : "s"}</span>
        <span className="ml-auto text-[12.5px] text-[#667085]">Upcoming visits only. Past missed visits stay in Missed Calls and Coverage History.</span>
      </section>

      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <AutoSubmitForm label="Filters" className="grid w-full min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1.2fr)_repeat(4,minmax(0,1fr))]">
          {hiddenExcept(["q", "area", "priority", "call", "staffing", "page", "cover", "slot", "ctab", "pick", "mq", "ptab"])}
          <label className="relative min-w-0">
            <span className="sr-only">Search by service user or visit reference</span>
            <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Search visits…" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px] text-[#101828] placeholder:text-[#667085]" />
          </label>
          <FilterSelect name="area" label="Area" value={area ?? ""}><option value="">Area: All Areas</option>{areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}</FilterSelect>
          <FilterSelect name="priority" label="Priority" value={f.priority ?? ""}><option value="">Priority: All</option>{(["URGENT", "HIGH", "NORMAL"] as const).map((p) => <option key={p} value={p}>Priority: {PRIORITY_LABEL[p]}</option>)}</FilterSelect>
          <FilterSelect name="call" label="Service call" value={f.call ?? ""}><option value="">Service Call: All</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</FilterSelect>
          <FilterSelect name="staffing" label="Staffing" value={f.staffing ?? ""}><option value="">Staffing: All</option><option value="none">Fully unassigned</option><option value="partial">Partially staffed</option></FilterSelect>
        </AutoSubmitForm>
        <div className="flex gap-2.5">
          <details className="relative">
            <summary className={SUMMARY_BTN}><SlidersHorizontal size={19} aria-hidden />More Filters{more ? <span className="rounded-full bg-[#5b2bb5] px-2 text-[12.5px] text-white">{more}</span> : null}</summary>
            <form method="get" className={`${MENU} grid w-[300px] gap-2.5 p-3`}>
              {hiddenExcept(["branch", "su", "carer", "carers", "page", "cover", "slot", "ctab", "pick", "mq", "ptab"])}
              {lk.branches.length > 1 ? <label><span className="label">Branch</span><select name="branch" defaultValue={branch ?? ""} className="input"><option value="">All my branches</option>{lk.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : null}
              <label><span className="label">Service user</span><select name="su" defaultValue={f.su ?? ""} className="input"><option value="">Any service user</option>{suOpts.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select></label>
              <label><span className="label">Team member already booked</span><select name="carer" defaultValue={f.carer ?? ""} className="input"><option value="">Anyone</option>{staffOpts.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
              <label><span className="label">Carers needed</span><select name="carers" defaultValue={f.carers ?? ""} className="input"><option value="">Single or double-up</option><option value="single">Single</option><option value="double">Double-up</option></select></label>
              <div className="flex gap-2"><button className="btn-primary">Apply</button><Link href={url({ branch: undefined, su: undefined, carer: undefined, carers: undefined, q: undefined, area: undefined, priority: undefined, call: undefined, staffing: undefined, when: undefined, from: undefined, to: undefined, page: undefined, ...closeCover })} className="btn-secondary">Clear all</Link></div>
            </form>
          </details>
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] bg-[#5b2bb5] px-4 text-[14.5px] font-semibold text-white hover:bg-[#4c2398] [&::-webkit-details-marker]:hidden">Actions<CaretDown size={15} weight="bold" aria-hidden /></summary>
            <div className={`${MENU} w-[290px] py-1 text-[14px]`}>
              {canBuild && f.to >= today ? (
                <form action={generatePlanAction} className="border-b border-[#eef0f3] px-3 py-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="from" value={f.from < today ? today : f.from} />
                  <input type="hidden" name="days" value={String(Math.max(1, planDays))} />
                  <input type="hidden" name="areaId" value={area ?? ""} />
                  <input type="hidden" name="gapMinutes" value="10" />
                  <input type="hidden" name="maxShiftMinutes" value="0" />
                  <input type="hidden" name="respectWeeklyLimits" value="on" />
                  <button className="w-full text-left font-semibold text-[#5b2bb5] hover:underline">Review Suggested Cover Plan</button>
                  <span className="block text-[12.5px] text-[#475467]">Proposes one eligible carer per empty place for these dates ({Math.max(1, planDays)} day{planDays === 1 ? "" : "s"} max 7), never the same person twice at once. Nothing is booked until you accept and apply.</span>
                </form>
              ) : null}
              <Link href={`/rota/visits?date=${f.from}&view=unassigned`} className="block px-3 py-2 no-underline hover:bg-slate-50">Open in Daily Rota</Link>
              <Link href={`/rota/cover?from=${f.from}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Sickness &amp; holiday cover</Link>
              <Link href="/rota/missed" className="block px-3 py-2 no-underline hover:bg-slate-50">Missed calls</Link>
              <Link href={`/rota/unassigned?tab=history${branch ? `&branch=${branch}` : ""}${area ? `&area=${area}` : ""}`} className="block px-3 py-2 no-underline hover:bg-slate-50">Coverage history</Link>
            </div>
          </details>
        </div>
      </div>
      {board.truncated ? <p className="mb-2 rounded-[8px] bg-[#fdf6e8] px-3 py-1.5 text-[14px] text-[#5c3d00]" role="note">Showing the first 2,000 visits short of a carer. Choose fewer days to see the rest.</p> : null}

      <div className={`grid grid-cols-1 items-start gap-4 ${coverOpen ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>
        <section aria-label="Unassigned visits" className={PANEL}>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
              <form id="bulk" action={bulkVisitsAction} className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
                <input type="hidden" name="back" value={back} />
                <BulkVisitBar form="bulk" canPublish={canBuild} staff={lk.staff.map((s) => ({ id: s.id, name: s.displayName }))} callTypes={lk.callTypes.map((c) => ({ id: c.id, name: c.name }))} />
              </form>
            </div>
          ) : null}
          {board.items.length ? (
            <div className="relative min-w-0 overflow-x-auto border-t border-[#eaecf0]">
              <table className="w-full border-collapse whitespace-nowrap text-[14px]">
                <caption className="sr-only">Visits short of a carer, {period}</caption>
                <thead className="bg-[#f9fafb]">
                  <tr className="border-b border-[#eaecf0]">
                    {canEdit ? <th scope="col" className="w-10 px-3 py-2.5"><SelectAll form="bulk" name="visitIds" label="Select all visits on this page" /></th> : null}
                    <SortHead active={f.sort === "priority"} dir={f.dir} href={sortLink("priority")}>Priority</SortHead>
                    <SortHead active={f.sort === "ref"} dir={f.dir} href={sortLink("ref")}>Ref</SortHead>
                    <SortHead active={f.sort === "su"} dir={f.dir} href={sortLink("su")}>Service User</SortHead>
                    <SortHead active={f.sort === "date"} dir={f.dir} href={sortLink("date")}><CalendarBlank size={15} aria-hidden className="text-[#475467]" />Date</SortHead>
                    <th scope="col" className={TH}>Start</th>
                    <th scope="col" className={TH}>End</th>
                    <SortHead active={f.sort === "duration"} dir={f.dir} href={sortLink("duration")}>Duration</SortHead>
                    <SortHead active={f.sort === "carers"} dir={f.dir} href={sortLink("carers")}>Carers</SortHead>
                    <SortHead active={f.sort === "call"} dir={f.dir} href={sortLink("call")}>Service Call</SortHead>
                    <SortHead active={f.sort === "area"} dir={f.dir} href={sortLink("area")}>Area</SortHead>
                    <th scope="col" className={TH}>Reason</th>
                    <th scope="col" className={`${TH} text-right`}><span className="sr-only">Find cover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {board.items.map((it) => {
                    const v = it.visit;
                    const selected = sp.cover === v.id;
                    return (
                      <tr key={v.id} aria-selected={selected || undefined} className={`border-b border-[#f2f4f7] last:border-0 ${selected ? "bg-[#eef4ff] outline outline-2 -outline-offset-2 outline-[#84adff]" : ""} hover:bg-[#f9f8fe]`}>
                        {canEdit ? <td className="px-3 py-2"><input type="checkbox" form="bulk" name="visitIds" value={v.id} aria-label={`Select ${v.reference}`} className="h-4 w-4" /></td> : null}
                        <td className={TD}><span title={it.why} className={`inline-flex rounded-[6px] px-2 py-0.5 text-[13px] font-semibold ${PRIORITY_BADGE[it.priority]}`}>{PRIORITY_LABEL[it.priority]}<span className="sr-only">: {it.why}</span></span></td>
                        <td className={`${TD} tabular-nums`}><Link href={`/rota/visits?date=${fromDbDate(v.date)}&visit=${v.id}`} className="text-[#101828] no-underline hover:underline">{v.reference}</Link></td>
                        <td className={TD}><Link href={`/rota/service-users/${v.serviceUser.id}`} className="inline-flex items-center gap-1.5 font-semibold text-[#3b1f99] underline decoration-[#c4b5f4] underline-offset-2 hover:decoration-[#3b1f99]"><User size={17} aria-hidden className="text-[#5b2bb5]" />{suName(v.serviceUser)}</Link></td>
                        <td className={`${TD} tabular-nums`}>{fmtLondonDate(fromDbDate(v.date), { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                        <td className={`${TD} tabular-nums`}>{londonTime(v.scheduledStart)}</td>
                        <td className={`${TD} tabular-nums`}>{londonTime(v.scheduledEnd)}</td>
                        <td className={`${TD} tabular-nums`}>{dur(mins(v.scheduledStart, v.scheduledEnd))}</td>
                        <td className={TD}><Coverage item={it} /></td>
                        <td className={`${TD} max-w-[150px] truncate`} title={v.callType.name}>{v.callType.name}</td>
                        <td className={TD}>{v.area ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: v.area.colour }} />{v.area.name}</span> : <span className="text-[#98a2b3]">No area</span>}</td>
                        <td className={`${TD} max-w-[220px] truncate text-[#344054]`} title={it.reason}>{it.reason}</td>
                        <td className={`${TD} text-right`}>
                          {canEdit ? (
                            <Link href={url({ cover: v.id, slot: undefined, ctab: undefined, pick: undefined, mq: undefined })} aria-label={`Find cover for ${suName(v.serviceUser)} at ${londonTime(v.scheduledStart)}`} className={`inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[14px] font-semibold no-underline ${selected ? "border-[#5b2bb5] bg-[#5b2bb5] text-white" : "border-[#5b2bb5] bg-white text-[#5b2bb5] hover:bg-[#f6f2fd]"}`}><UserPlus size={17} aria-hidden />Find Cover</Link>
                          ) : <Link href={`/rota/visits?date=${fromDbDate(v.date)}&visit=${v.id}`} className="text-[13.5px]">View</Link>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-[#eaecf0] p-4">
              <Empty>No visits are short of a carer {f.from === f.to ? `on ${fmtLondonDate(f.from, { weekday: "long", day: "numeric", month: "long" })}` : "in these dates"}{f.q || f.priority || f.staffing || area || f.call ? " with these filters" : ""}.</Empty>
              {ahead ? <p className="mt-2 text-center text-[14px]"><Link href={url({ when: "week", page: undefined })}>{ahead} visit{ahead === 1 ? " is" : "s are"} short of a carer in the next 7 days</Link></p> : null}
            </div>
          )}
          <ListFooter total={board.summary.visits} page={board.page} pages={board.pages} per={f.per} noun="unassigned visit" testId="unassigned-count" href={(p) => url({ page: p ? String(p) : undefined })} hidden={hiddenExcept(["per", "page"])} />
        </section>
        {coverOpen ? (
          <div className="xl:sticky xl:top-2">
            <UnassignedCover ctx={ctx} sp={sp} back={back} url={url} />
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-[12.5px] text-[#667085]">Priority rule: {PRIORITY_RULE} A custom range can cover up to 28 days.</p>
    </>
  );
}

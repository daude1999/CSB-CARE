import type { ReactNode } from "react";
import { CalendarBlank, CaretDown, CaretLeft, CaretRight, CaretUp, CheckCircle, Clock, Copy, DotsThreeVertical, Eye, HandHeart, ListBullets, MagnifyingGlass, MapPin, PencilSimple, Plus, Prohibit, SlidersHorizontal, SquaresFour, User, Users, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { addDays, cycleWeekOf, fmtLondonDate, fromDbDate, hhmm, isIsoDate, isoWeekday, londonDate, mondayOf, WEEKDAYS } from "@/lib/london";
import { durationLabel, patternLabel, templateCoverage, weekdaysLabel } from "@/lib/rota-pattern";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { templateDetails, templatePage, templateRef } from "@/server/rota/templates";
import { duplicateTemplateAction, templateBulkAction } from "@/app/rota-actions";
import { Empty, Flash } from "@/components/ui";
import { SelectAll } from "@/components/select-all";
import { AutoSubmitForm } from "@/components/auto-submit";
import { BulkTemplateBar } from "@/components/bulk-visit-bar";
import { ClickableRows } from "@/components/clickable-rows";
import { ChoiceGroup, CoverageBadge, DetailsPanel, StatusBadge, TemplatesHeader, Warnings } from "@/components/template-ui";

export const dynamic = "force-dynamic";

const PER_PAGE = [10, 25, 50, 100] as const;
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
const CONTROL = "h-[42px] rounded-[10px] border border-[#e4e7ec] bg-white text-[14.5px] text-[#101828] shadow-[0_1px_2px_rgba(16,24,40,0.06)]";
const TH = "whitespace-nowrap px-2 py-3 text-left text-[14px] font-bold text-[#101828]";
const TD = "px-2 py-1.5";
const ICON_BTN = `inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[#5b2bb5] hover:bg-[#f4f1fd] ${FOCUS}`;
const MENU_ITEM = "flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] text-[#101828] no-underline hover:bg-[#f4f1fd]";

function FilterSelect({ name, label, value, children }: { name: string; label: string; value: string; children: ReactNode }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select name={name} aria-label={label} defaultValue={value} className={`${CONTROL} w-full appearance-none pl-3 pr-8 font-medium`}>{children}</select>
      <CaretDown size={15} weight="bold" aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#101828]" />
    </label>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-[7px]">
      <span aria-hidden className="mt-0.5 text-[#101828]">{icon}</span>
      <p className="text-[15px] text-[#101828]"><span className="font-medium">{label}:</span> {children}</p>
    </div>
  );
}

/** The real calendar Monday, from this week onwards, whose place in the rota cycle is the chosen pattern week. */
function mondayForWeek(week: number, thisMonday: string, anchor: string, cycleLength: number) {
  for (let i = 0; i < cycleLength; i++) {
    const m = addDays(thisMonday, i * 7);
    if (cycleWeekOf(m, anchor, cycleLength) === week) return m;
  }
  return thisMonday;
}

/**
 * Daily Templates, built to the owner's approved image (design-references/CSB_Daily_Templates_Approved_Roll_Forward.png,
 * 1 Nov 2026): one header row with the template views and Roll Forward; cycle week pills and day cards for a real
 * calendar week of that pattern week; filters; the template table; and Template Details when a template is chosen.
 * Everything here edits the repeating pattern only. Built visits change only when a coordinator applies a change from
 * the template's own page.
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const ctx = await requireRotaPage();
  const lk = await rotaLookups(ctx);
  const settings = await rotaSettings(db, lk.scope.organisationId);
  const cycleLength = settings.cycleLength;
  const anchor = fromDbDate(settings.anchorMonday);
  const today = londonDate();
  const thisMonday = mondayOf(today);
  const thisWeek = cycleWeekOf(thisMonday, anchor, cycleLength);
  const todayDay = isoWeekday(today);
  // A calendar week (?on=Monday) decides the pattern week, so the dates on the day cards are always that week's dates.
  const on = sp.week !== "all" && sp.on && isIsoDate(sp.on) ? mondayOf(sp.on) : undefined;
  const week = sp.week === "all" ? undefined : on ? cycleWeekOf(on, anchor, cycleLength) : Number(sp.week) >= 1 && Number(sp.week) <= cycleLength ? Number(sp.week) : thisWeek;
  const monday = week ? on ?? mondayForWeek(week, thisMonday, anchor, cycleLength) : undefined;
  const day = sp.day === "all" ? undefined : Number(sp.day) >= 1 && Number(sp.day) <= 7 ? Number(sp.day) : todayDay;
  const state = sp.state === "off" || sp.state === "all" ? sp.state : "on";
  const area = sp.area && lk.areas.some((a) => a.id === sp.area) ? sp.area : undefined;
  const call = sp.call && lk.callTypes.some((c) => c.id === sp.call) ? sp.call : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const sort = sp.sort === "su" ? "su" : "time";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const per = PER_PAGE.find((n) => String(n) === sp.per) ?? 25;
  const { rows, total, page, pages } = await templatePage(ctx, { week, day, serviceUserId: sp.su || undefined, staffId: sp.carer || undefined, areaId: area, callTypeId: call, state, noCarer: sp.empty === "1", q }, { page: Number(sp.page) || 1, per, sort, dir });
  const details = sp.tpl ? await templateDetails(ctx, sp.tpl) : null;
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canBuild = hasOrgPermission(ctx, "rota.build");

  const params: Record<string, string | undefined> = { week: sp.week === "all" ? "all" : on ? undefined : sp.week, on, day: sp.day, q, area, carer: sp.carer, su: sp.su, call, state: sp.state, empty: sp.empty, sort: sort === "time" ? undefined : sort, dir: dir === "asc" ? undefined : dir, per: per === 25 ? undefined : String(per), page: page === 1 ? undefined : String(page), tpl: details ? details.template.id : undefined };
  const url = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
    return `/rota/templates${s ? `?${s}` : ""}`;
  };
  const back = url({});
  const hiddenExcept = (skip: string[]) => Object.entries(params).filter(([k, v]) => v && !skip.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const more = [sp.state, sp.empty === "1" ? "1" : undefined, sp.week === "all" ? "1" : undefined, sp.day === "all" ? "1" : undefined].filter(Boolean).length;
  const scopeText = `${week ? `Week ${week}` : "All weeks"}, ${day ? WEEKDAYS[day - 1] : "every day"}${monday ? ` (week of ${fmtLondonDate(monday, { day: "numeric", month: "short" })})` : ""}`;
  const cycleText = cycleLength === 1 ? "a 1-week cycle" : `up to ${cycleLength}-week cycle`;
  const sortHead = (key: "time" | "su", label: string) => {
    const active = sort === key;
    return (
      <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={TH}>
        <Link href={url({ sort: key === "time" ? undefined : key, dir: active && dir === "asc" ? "desc" : undefined, page: undefined })} className="inline-flex items-center gap-1.5 text-inherit no-underline hover:text-[#5b2bb5]">
          {label}{active ? (dir === "asc" ? <CaretUp size={12} weight="bold" aria-hidden /> : <CaretDown size={12} weight="bold" aria-hidden />) : null}
        </Link>
      </th>
    );
  };

  return (
    <div className="daily-templates -mt-1">
      <TemplatesHeader title="Daily Templates" subtitle={`Manage repeating care visits (${cycleText})`} active="daily" canBuild={canBuild} />
      <Flash searchParams={sp} />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 min-[1600px]:gap-x-8">
        <ChoiceGroup
          label="Cycle week"
          items={Array.from({ length: cycleLength }, (_, i) => ({ href: url({ week: String(i + 1), on: undefined, page: undefined }), label: `Week ${i + 1}`, title: i + 1 === thisWeek ? "This calendar week is this cycle week" : undefined, active: week === i + 1, marker: i + 1 === thisWeek }))}
        />
        <nav aria-label="Day" className="flex min-w-0 max-w-full items-stretch gap-1.5 overflow-x-auto p-0.5">
          {monday ? <Link href={url({ on: addDays(monday, -7), week: undefined, page: undefined })} aria-label="Previous week" title="Previous calendar week" className={`flex w-[44px] shrink-0 items-center justify-center min-[1600px]:w-[58px] rounded-[10px] bg-white text-[#101828] shadow-[0_1px_3px_rgba(16,24,40,0.12)] hover:text-[#5b2bb5] ${FOCUS}`}><CaretLeft size={20} weight="bold" aria-hidden /></Link> : null}
          {WEEKDAYS.map((d, i) => {
            const date = monday ? addDays(monday, i) : null;
            const active = day === i + 1;
            return (
              <Link key={d} href={url({ day: String(i + 1), page: undefined })} aria-current={active ? "true" : undefined} title={`${d}${date ? ` ${fmtLondonDate(date, { day: "numeric", month: "long", year: "numeric" })}` : ""}${date === today ? " (today)" : ""}`} className={`relative flex min-w-[74px] shrink-0 flex-col items-center justify-center rounded-[10px] px-2.5 py-1.5 leading-tight no-underline min-[1600px]:min-w-[96px] ${FOCUS} ${active ? "bg-[#5b2bb5] text-white shadow-[0_2px_6px_rgba(91,43,181,0.35)]" : "bg-white text-[#101828] shadow-[0_1px_3px_rgba(16,24,40,0.12)] hover:text-[#5b2bb5]"}`}>
                <span className="text-[15.5px] font-bold">{SHORT[i]}</span>
                {date ? <span className="text-[14px]">{fmtLondonDate(date, { day: "numeric", month: "short" })}</span> : null}
                {date === today ? <span aria-hidden className={`absolute bottom-1 h-1 w-1 rounded-full ${active ? "bg-white" : "bg-[#5b2bb5]"}`} /> : null}
              </Link>
            );
          })}
          {monday ? <Link href={url({ on: addDays(monday, 7), week: undefined, page: undefined })} aria-label="Next week" title="Next calendar week" className={`flex w-[44px] shrink-0 items-center justify-center min-[1600px]:w-[58px] rounded-[10px] bg-white text-[#101828] shadow-[0_1px_3px_rgba(16,24,40,0.12)] hover:text-[#5b2bb5] ${FOCUS}`}><CaretRight size={20} weight="bold" aria-hidden /></Link> : null}
        </nav>
      </div>

      <div className="mb-4 flex flex-col gap-2.5 min-[1400px]:flex-row min-[1400px]:items-start">
        <AutoSubmitForm label="Filters" className="grid w-full min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.9fr)_repeat(4,minmax(0,1fr))]">
          {hiddenExcept(["q", "area", "carer", "su", "call", "page", "tpl"])}
          <label className="relative min-w-0">
            <span className="sr-only">Search by service user, team member or reference</span>
            <MagnifyingGlass size={19} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#475467]" />
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search by service user, team member or reference..." className={`${CONTROL} w-full pl-10 pr-2 placeholder:text-[#667085]`} />
          </label>
          <FilterSelect name="area" label="Area" value={area ?? ""}><option value="">Area: All Areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}</FilterSelect>
          <FilterSelect name="carer" label="Team member" value={sp.carer ?? ""}><option value="">Team Member: All</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</FilterSelect>
          <FilterSelect name="su" label="Service user" value={sp.su ?? ""}><option value="">Service User: All</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</FilterSelect>
          <FilterSelect name="call" label="Call type" value={call ?? ""}><option value="">Call Type: All</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</FilterSelect>
        </AutoSubmitForm>
        <div className="flex justify-end gap-2.5">
          <details className="relative">
            <summary className={`${CONTROL} flex cursor-pointer list-none items-center gap-2 whitespace-nowrap px-4 font-bold hover:bg-slate-50 [&::-webkit-details-marker]:hidden`}><SlidersHorizontal size={19} weight="bold" aria-hidden />More Filters{more ? <span className="rounded-full bg-[#5b2bb5] px-2 text-[12.5px] text-white">{more}</span> : null}</summary>
            <form method="get" aria-label="More filters" className="absolute right-0 z-40 mt-1 grid w-[300px] gap-2.5 rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {hiddenExcept(["state", "empty", "week", "on", "day", "page", "tpl"])}
              {params.week && params.week !== "all" ? <input type="hidden" name="week" value={params.week} /> : null}
              {on ? <input type="hidden" name="on" value={on} /> : null}
              {sp.day && sp.day !== "all" ? <input type="hidden" name="day" value={sp.day} /> : null}
              <label><span className="label">Templates</span><select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Active only</option><option value="off">Inactive only</option><option value="all">Active and inactive</option></select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="empty" value="1" defaultChecked={sp.empty === "1"} className="h-4 w-4" /> Only templates short of a carer</label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="week" value="all" defaultChecked={sp.week === "all"} className="h-4 w-4" /> Every cycle week</label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="day" value="all" defaultChecked={sp.day === "all"} className="h-4 w-4" /> Every day of the week</label>
              <div className="flex gap-2"><button className="btn-primary">Apply</button><Link href="/rota/templates" className="btn-secondary">Clear all</Link></div>
            </form>
          </details>
          {canEdit ? <Link href="/rota/templates/new" className={`flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[10px] bg-[#4b1f9e] px-5 text-[15px] font-bold text-white no-underline hover:bg-[#3d1880] ${FOCUS}`}><Plus size={19} weight="bold" aria-hidden />Add Template</Link> : null}
        </div>
      </div>
      {q || sp.empty === "1" || state !== "on" ? <p className="mb-2 rounded-[8px] bg-[#fdf6e8] px-3 py-1.5 text-[14px] text-[#5c3d00]" role="note">Showing {state === "off" ? "inactive" : state === "all" ? "active and inactive" : "active"} templates{sp.empty === "1" ? " short of a carer" : ""}{q ? ` matching “${q}”` : ""}. <Link href={url({ q: undefined, empty: undefined, state: undefined, page: undefined })}>Show every active template</Link></p> : null}

      <div className={`grid grid-cols-1 items-start gap-4 ${details ? "xl:grid-cols-[minmax(0,1fr)_300px] min-[1600px]:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
        <section aria-label={`Templates: ${scopeText}`} className="min-w-0 rounded-[12px] border border-[#eaecf0] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
          <div className="flex flex-wrap items-center gap-2 px-3 py-3">
            {canEdit ? (
              <>
                <span className="px-1.5"><SelectAll form="tbulk" name="templateIds" label="Select all templates on this page" /></span>
                <form id="tbulk" action={templateBulkAction} className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
                  <input type="hidden" name="back" value={back} />
                  <BulkTemplateBar form="tbulk" staff={lk.staff.map((s) => ({ id: s.id, name: s.displayName }))} callTypes={lk.callTypes.map((c) => ({ id: c.id, name: c.name }))} />
                </form>
              </>
            ) : null}
            <p className="ml-auto text-[14.5px] text-[#344054]" title={scopeText}>{total} template{total === 1 ? "" : "s"}</p>
            <nav aria-label="Template layout" className="flex gap-1.5">
              <span aria-current="page" title="List" className="flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#e4e7ec] bg-white text-[#101828]"><ListBullets size={20} weight="bold" aria-hidden /><span className="sr-only">List (shown)</span></span>
              <Link href="/rota/templates/planner" title="Advanced Templates: carers by day" aria-label="Open Advanced Templates (carers by day)" className={`flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#e4e7ec] bg-white text-[#475467] hover:text-[#5b2bb5] ${FOCUS}`}><SquaresFour size={20} aria-hidden /></Link>
            </nav>
          </div>

          {rows.length ? (
            <div className="relative min-w-0 overflow-x-auto min-[1600px]:overflow-visible">
              <table className="w-full border-collapse text-[14.5px]">
                <caption className="sr-only">Templates for {scopeText}. Choose a row to see its details.</caption>
                <thead>
                  <tr className="border-y border-[#eaecf0]">
                    {canEdit ? <th scope="col" className="w-10 px-3 py-3"><SelectAll form="tbulk" name="templateIds" label="Select all templates on this page" /></th> : null}
                    <th scope="col" className={TH}>Ref</th>
                    {sortHead("su", "Service User")}
                    {sortHead("time", "Time")}
                    <th scope="col" className={TH}>Duration</th>
                    <th scope="col" className={TH} title="Carers planned of carers needed">Carers</th>
                    <th scope="col" className={TH}>Team Member(s)</th>
                    <th scope="col" className={TH}>Service Call</th>
                    <th scope="col" className={TH}>Area</th>
                    <th scope="col" className={TH}>Pattern</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>Actions</th>
                  </tr>
                </thead>
                <ClickableRows>
                  {rows.map((t) => {
                    const ref = templateRef(t.id);
                    const cov = templateCoverage(t);
                    const selected = details?.template.id === t.id;
                    const open = url({ tpl: t.id });
                    const carers = [t.carer1, t.carersRequired > 1 ? t.carer2 : null].filter((c): c is NonNullable<typeof c> => !!c);
                    return (
                      <tr key={t.id} data-href={open} aria-selected={selected || undefined} className={`cursor-pointer border-b border-[#f2f4f7] last:border-0 ${selected ? "bg-[#f4f1fd]" : cov.state === "none" && t.enabled ? "bg-[#fffafa]" : t.enabled ? "" : "bg-[#fafafa] text-[#667085]"} hover:bg-[#f9f8fe]`}>
                        {canEdit ? <td className="px-3 py-2"><input type="checkbox" form="tbulk" name="templateIds" value={t.id} aria-label={`Select ${ref} ${suName(t.serviceUser)} ${t.callType.name}`} className="h-4 w-4" /></td> : null}
                        <td className={`${TD} whitespace-nowrap tabular-nums`}><Link href={open} scroll={false} className="text-[#101828] no-underline hover:underline" aria-label={`Open details of template ${ref}`}>{ref}</Link></td>
                        <td className={`${TD} whitespace-nowrap`}><Link href={`/rota/service-users/${t.serviceUser.id}`} title="Open the service user's record" className="inline-flex items-center gap-2 font-bold text-[#5b2bb5] no-underline hover:underline"><User size={16} weight="fill" aria-hidden />{suName(t.serviceUser)}</Link></td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{hhmm(t.startMinute)}</td>
                        <td className={`${TD} whitespace-nowrap tabular-nums`}>{durationLabel(t.durationMin)}</td>
                        <td className={`${TD} whitespace-nowrap`}><CoverageBadge filled={cov.filled} required={cov.required} icon={<UsersThree size={16} weight="fill" aria-hidden />} /></td>
                        <td className={`${TD} min-w-[130px] max-w-[190px] leading-snug`}>
                          {carers.map((c, i) => <span key={c.id}>{i ? ", " : ""}<Link href={`/rota/staff/${c.id}`} className={`no-underline hover:underline ${c.employmentStatus === "ARCHIVED" || c.hrMissing ? "text-[#b54708]" : "text-[#101828]"}`}>{c.displayName}</Link></span>)}
                          {cov.state !== "full" ? <span className="font-semibold text-[#b42318]">{cov.filled ? ", 1 needed" : "Unassigned"}</span> : null}
                        </td>
                        <td className={`${TD} max-w-[150px] truncate`} title={t.callType.name}>{t.callType.name}</td>
                        <td className={`${TD} max-w-[92px] truncate`} title={t.area?.name ?? "No area"}>{t.area ? t.area.name : <span className="text-[#98a2b3]">—</span>}</td>
                        <td className={`${TD} whitespace-nowrap`} title={`Runs ${weekdaysLabel(t.weekdays)}`}>{patternLabel(t.cycleWeeks, cycleLength)}</td>
                        <td className={`${TD} whitespace-nowrap`}><StatusBadge enabled={t.enabled} /></td>
                        <td className={`${TD} whitespace-nowrap`}>
                          <span className="inline-flex items-center gap-0.5">
                            {canEdit ? <Link href={`/rota/templates/${t.id}`} className={ICON_BTN} title="Edit template" aria-label={`Edit ${ref}`}><PencilSimple size={19} weight="fill" aria-hidden /></Link> : null}
                            <details className="relative">
                              <summary className={`${ICON_BTN} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} title="More actions" aria-label={`More actions for ${ref}`}><DotsThreeVertical size={22} weight="bold" aria-hidden /></summary>
                              <div className="absolute right-0 z-30 mt-1 w-[200px] overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
                                <Link href={open} scroll={false} className={MENU_ITEM}><Eye size={16} aria-hidden />View details</Link>
                                {canEdit ? (
                                  <>
                                    <form action={duplicateTemplateAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateId" value={t.id} /><button className={MENU_ITEM}><Copy size={16} aria-hidden />Duplicate</button></form>
                                    {t.enabled
                                      ? <Link href={url({ tpl: t.id, confirm: "off" })} scroll={false} className={`${MENU_ITEM} text-[#b42318]`}><Prohibit size={16} aria-hidden />Deactivate…</Link>
                                      : <form action={templateBulkAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateIds" value={t.id} /><button name="kind" value="enable" className={`${MENU_ITEM} text-[#15803d]`}><CheckCircle size={16} aria-hidden />Activate</button></form>}
                                  </>
                                ) : null}
                              </div>
                            </details>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </ClickableRows>
              </table>
            </div>
          ) : (
            <div className="border-t border-[#eaecf0] p-4"><Empty>No {state === "off" ? "inactive " : ""}templates for {scopeText} match these filters.{canEdit ? <> <Link href="/rota/templates/new">Add a template</Link>.</> : null}</Empty></div>
          )}

          <div className="grid grid-cols-1 items-center gap-3 border-t border-[#eaecf0] px-4 py-3.5 md:grid-cols-[1fr_auto_1fr]">
            <p data-testid="template-count" data-total={total} className="text-[14.5px] text-[#101828]" aria-live="polite">Showing {total ? (page - 1) * per + 1 : 0} to {(page - 1) * per + rows.length} of {total} template{total === 1 ? "" : "s"}</p>
            <nav aria-label="Template pages" className="flex items-center gap-2">
              {page > 1 ? <Link href={url({ page: page - 1 === 1 ? undefined : String(page - 1) })} aria-label="Previous page" className={`flex h-9 w-10 items-center justify-center rounded-[8px] border border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50 ${FOCUS}`}><CaretLeft size={16} weight="bold" aria-hidden /></Link> : <span aria-hidden className="flex h-9 w-10 items-center justify-center rounded-[8px] border border-[#eaecf0] text-[#d0d5dd]"><CaretLeft size={16} weight="bold" /></span>}
              {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => (
                <span key={n} className="flex items-center gap-2">
                  {i && n - arr[i - 1]! > 1 ? <span className="text-[#667085]">…</span> : null}
                  <Link href={url({ page: n === 1 ? undefined : String(n) })} aria-current={n === page ? "page" : undefined} className={`flex h-9 min-w-10 items-center justify-center rounded-[8px] border px-2 text-[14.5px] tabular-nums no-underline ${FOCUS} ${n === page ? "border-[#5b2bb5] bg-[#5b2bb5] font-bold text-white" : "border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50"}`}>{n}</Link>
                </span>
              ))}
              {page < pages ? <Link href={url({ page: String(page + 1) })} aria-label="Next page" className={`flex h-9 w-10 items-center justify-center rounded-[8px] border border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50 ${FOCUS}`}><CaretRight size={16} weight="bold" aria-hidden /></Link> : <span aria-hidden className="flex h-9 w-10 items-center justify-center rounded-[8px] border border-[#eaecf0] text-[#d0d5dd]"><CaretRight size={16} weight="bold" /></span>}
            </nav>
            <AutoSubmitForm label="Rows per page" className="flex items-center gap-4 md:justify-self-end">
              {hiddenExcept(["per", "page"])}
              <label htmlFor="per" className="text-[14.5px] text-[#101828]">Rows per page</label>
              <span className="relative"><select id="per" name="per" defaultValue={String(per)} className="h-10 w-[110px] appearance-none rounded-[8px] border border-[#e4e7ec] bg-white pl-3 pr-8 text-[14.5px]">{PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}</select><CaretDown size={14} weight="bold" aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span>
            </AutoSubmitForm>
          </div>
          <p className="border-t border-[#eaecf0] px-4 py-2 text-[12.5px] text-[#475467]">Templates are the repeating pattern. Changing one does not change visits already built; apply a change to built visits from the template&apos;s Edit page. A double-up is one template with two carers.</p>
        </section>

        {details ? (
          <div className="xl:sticky xl:top-2">
            <DetailsPanel title="Template Details" closeHref={url({ tpl: undefined })}>
              <TemplateDetailsBody d={details} cycleLength={cycleLength} canEdit={canEdit} back={back} confirmOff={sp.confirm === "off"} confirmHref={url({ confirm: "off" })} />
            </DetailsPanel>
          </div>
        ) : sp.tpl ? <p className="text-[13px] text-slate-600">That template is not available to you, or no longer exists.</p> : null}
      </div>
    </div>
  );
}

type Details = NonNullable<Awaited<ReturnType<typeof templateDetails>>>;

function TemplateDetailsBody({ d, cycleLength, canEdit, back, confirmOff, confirmHref }: { d: Details; cycleLength: number; canEdit: boolean; back: string; confirmOff: boolean; confirmHref: string }) {
  const t = d.template;
  const cov = templateCoverage(t);
  const ref = templateRef(t.id);
  const carers = [t.carer1, t.carersRequired > 1 ? t.carer2 : null];
  return (
    <div>
      <div className="px-4 pb-1 pt-3.5">
        <div className="flex items-start gap-2">
          <Link href={`/rota/service-users/${t.serviceUser.id}`} className="mr-auto text-[20px] font-bold leading-tight text-[#101828] no-underline hover:underline">{suName(t.serviceUser)}</Link>
          <StatusBadge enabled={t.enabled} />
        </div>
        <p className="mt-1 text-[15px] text-[#101828]">Ref: {ref}{t.serviceUser.reference ? <span className="text-[#667085]"> · {t.serviceUser.reference}</span> : null}</p>
      </div>
      <div className="px-4 py-2">
        <Fact icon={<CalendarBlank size={19} weight="bold" />} label="Week">{patternLabel(t.cycleWeeks, cycleLength)}</Fact>
        <Fact icon={<CalendarBlank size={19} weight="bold" />} label={t.weekdays.length === 1 ? "Day" : "Days"}>{t.weekdays.length === 1 ? WEEKDAYS[t.weekdays[0]! - 1] : weekdaysLabel(t.weekdays)}</Fact>
        <Fact icon={<Clock size={19} weight="bold" />} label="Time"><span className="tabular-nums">{hhmm(t.startMinute)} – {hhmm((t.startMinute + t.durationMin) % 1440)}</span> ({durationLabel(t.durationMin)})</Fact>
        <Fact icon={<UsersThree size={19} weight="fill" />} label="Required Carers"><span className="inline-flex items-center gap-2">{t.carersRequired} <CoverageBadge filled={cov.filled} required={cov.required} /></span></Fact>
        <Fact icon={<Users size={19} weight="fill" />} label="Assigned">
          {carers.map((c, i) => (i === 0 || t.carersRequired > 1 ? <span key={i}>{i ? ", " : ""}{c ? <Link href={`/rota/staff/${c.id}`} className="text-[#101828] no-underline hover:underline">{c.displayName}</Link> : <span className="font-semibold text-[#b42318]">Unassigned</span>}</span> : null))}
          {t.shadow ? <span className="text-[#667085]"> (shadow: {t.shadow.displayName})</span> : null}
        </Fact>
        <Fact icon={<HandHeart size={19} weight="fill" />} label="Service Call">{t.callType.name}</Fact>
        <Fact icon={<MapPin size={19} weight="fill" />} label="Area">{t.area?.name ?? "—"}</Fact>
      </div>
      {d.warnings.length ? <div className="px-4 pb-2"><Warnings items={d.warnings} /></div> : null}
      <details className="mx-4 mb-2 rounded-[8px] border border-[#eaecf0] px-3 py-2 text-[13.5px]">
        <summary className="cursor-pointer font-semibold text-[#344054]">More details</summary>
        <dl className="mt-2 space-y-1 text-[#344054]">
          <div><dt className="inline font-medium">Settings: </dt><dd className="inline">{[t.timeLocked ? "Time locked" : null, t.alertOnLate ? "Alert when late" : null, t.medicationRequired ? "Medication prompt" : null, t.rotaType === "ALTERNATE" ? "Alternate rota" : null, t._count.tasks ? `${t._count.tasks} care task${t._count.tasks === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "—"}</dd></div>
          {t.runRoute ? <div><dt className="inline font-medium">Run route: </dt><dd className="inline">{t.runRoute.name}</dd></div> : null}
          <div><dt className="inline font-medium">Runs: </dt><dd className="inline">from {fmtLondonDate(d.effectiveFrom)}{d.effectiveTo ? ` to ${fmtLondonDate(d.effectiveTo)}` : ", no end date"}</dd></div>
          {t.notes ? <div><dt className="inline font-medium">Notes: </dt><dd className="inline whitespace-pre-line">{t.notes}</dd></div> : null}
          <div><dt className="inline font-medium">Built visits: </dt><dd className="inline">{d.futureVisits ? `${d.futureVisits} future visit${d.futureVisits === 1 ? "" : "s"} from this template keep their times and carers unless you apply a change from the Edit page.` : "none in the future yet."}</dd></div>
        </dl>
      </details>
      {canEdit ? (
        <div className="grid grid-cols-2 gap-2.5 border-t border-[#eaecf0] px-4 pb-4 pt-3.5">
          <Link href={`/rota/templates/${t.id}`} className={`col-span-2 flex h-[44px] items-center justify-center gap-2 rounded-[10px] bg-[#4b1f9e] px-2 text-[15.5px] font-bold text-white no-underline hover:bg-[#3d1880] ${FOCUS}`}><PencilSimple size={18} weight="fill" aria-hidden />Edit Template</Link>
          <form action={duplicateTemplateAction}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="templateId" value={t.id} />
            <button title="Make a copy. The copy starts inactive until you check and activate it." className={`flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-[#5b2bb5] bg-white px-2 text-[15px] font-bold text-[#5b2bb5] hover:bg-[#f4f1fd] ${FOCUS}`}><Copy size={18} weight="bold" aria-hidden />Duplicate</button>
          </form>
          {t.enabled ? (
            <Link href={confirmHref} scroll={false} className={`flex h-[42px] items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-[#e5484d] bg-white px-2 text-[15px] font-bold text-[#d92d20] no-underline hover:bg-[#fef3f2] ${FOCUS}`}><Prohibit size={18} weight="bold" aria-hidden />Deactivate</Link>
          ) : (
            <form action={templateBulkAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="templateIds" value={t.id} />
              <button name="kind" value="enable" className={`flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-[#47b26b] bg-white px-2 text-[15px] font-bold text-[#15803d] hover:bg-[#ecfdf3] ${FOCUS}`}><CheckCircle size={18} weight="bold" aria-hidden />Activate</button>
            </form>
          )}
          {t.enabled && confirmOff ? (
            <form action={templateBulkAction} role="alertdialog" aria-labelledby="deactivate-q" className="col-span-2 rounded-[8px] border border-[#f1b5b0] bg-[#fef3f2] p-3">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="templateIds" value={t.id} />
              <p id="deactivate-q" className="mb-2 text-[13.5px] text-[#7a271a]">Deactivate {ref}? Build Rota will skip it from now on. Nothing is deleted, its history is kept, and visits already built are not changed. You can activate it again at any time.</p>
              <div className="flex gap-2">
                <button name="kind" value="disable" className="h-9 rounded-[8px] bg-[#b42318] px-3 text-[14px] font-semibold text-white hover:bg-[#912018]">Yes, deactivate</button>
                <Link href={back} scroll={false} className="flex h-9 items-center rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-semibold text-[#344054] no-underline">Keep it active</Link>
              </div>
            </form>
          ) : null}
        </div>
      ) : <p className="border-t border-[#eaecf0] px-4 py-3 text-[13px] text-[#475467]">You can view templates. Changing them needs rota editing rights.</p>}
    </div>
  );
}

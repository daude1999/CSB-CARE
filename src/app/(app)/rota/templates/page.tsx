import type { ReactNode } from "react";
import { CaretDown, CaretLeft, CaretRight, CheckCircle, Copy, Eye, MagnifyingGlass, PencilSimple, Plus, Prohibit, SlidersHorizontal, User } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { cycleWeekOf, fmtLondonDate, fromDbDate, hhmm, isoWeekday, londonDate, mondayOf, WEEKDAYS } from "@/lib/london";
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
import { ChoiceGroup, CoverageBadge, DetailsPanel, StatusBadge, TemplatesHeading, TemplatesTabs, Warnings } from "@/components/template-ui";

export const dynamic = "force-dynamic";

const PER_PAGE = [25, 50, 100] as const;
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SEL = "h-10 w-full appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-7 text-[14px] text-[#101828]";
const TH = "whitespace-nowrap px-2.5 py-2.5 text-left text-[13.5px] font-semibold text-[#101828]";
const TD = "px-2.5 py-1.5";
const SMALL_BTN = "inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#d0d5dd] bg-white px-2 text-[13px] font-semibold text-[#344054] no-underline hover:bg-[#f4f1fd] hover:text-[#5b2bb5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b2bb5]";

function FilterSelect({ name, label, value, children }: { name: string; label: string; value: string; children: ReactNode }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select name={name} aria-label={label} defaultValue={value} className={SEL}>{children}</select>
      <CaretDown size={15} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#344054]" />
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 py-1.5">
      <dt className="text-[13.5px] text-[#475467]">{label}</dt>
      <dd className="text-[14px] text-[#101828]">{children}</dd>
    </div>
  );
}

/**
 * Daily Templates, built to the owner's approved design (1 Nov 2026): heading, the three connected template views with
 * Roll Forward on the right, cycle week and weekday pickers, a filter bar, one row per template (a double-up is one row
 * with both carers) and a Template Details panel when a template is chosen. Everything here edits the repeating
 * pattern only; built visits change only when a coordinator applies a change from the template's own page.
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const ctx = await requireRotaPage();
  const lk = await rotaLookups(ctx);
  const settings = await rotaSettings(db, lk.scope.organisationId);
  const cycleLength = settings.cycleLength;
  const today = londonDate();
  const thisWeek = cycleWeekOf(mondayOf(today), fromDbDate(settings.anchorMonday), cycleLength);
  const todayDay = isoWeekday(today);
  const week = sp.week === "all" ? undefined : Number(sp.week) >= 1 && Number(sp.week) <= cycleLength ? Number(sp.week) : thisWeek;
  const day = sp.day === "all" ? undefined : Number(sp.day) >= 1 && Number(sp.day) <= 7 ? Number(sp.day) : todayDay;
  const state = sp.state === "off" || sp.state === "all" ? sp.state : "on";
  const area = sp.area && lk.areas.some((a) => a.id === sp.area) ? sp.area : undefined;
  const call = sp.call && lk.callTypes.some((c) => c.id === sp.call) ? sp.call : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const per = PER_PAGE.find((n) => String(n) === sp.per) ?? 25;
  const { rows, total, page, pages } = await templatePage(ctx, { week, day, serviceUserId: sp.su || undefined, staffId: sp.carer || undefined, areaId: area, callTypeId: call, state, noCarer: sp.empty === "1", q }, { page: Number(sp.page) || 1, per });
  const details = sp.tpl ? await templateDetails(ctx, sp.tpl) : null;
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canBuild = hasOrgPermission(ctx, "rota.build");

  const params: Record<string, string | undefined> = { week: sp.week, day: sp.day, q, area, carer: sp.carer, su: sp.su, call, state: sp.state, empty: sp.empty, per: per === 25 ? undefined : String(per), page: page === 1 ? undefined : String(page), tpl: details ? details.template.id : undefined };
  const url = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
    return `/rota/templates${s ? `?${s}` : ""}`;
  };
  const back = url({});
  const hiddenExcept = (skip: string[]) => Object.entries(params).filter(([k, v]) => v && !skip.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const more = [sp.state, sp.empty === "1" ? "1" : undefined, sp.week === "all" ? "1" : undefined, sp.day === "all" ? "1" : undefined].filter(Boolean).length;
  const scopeText = `${week ? `Week ${week}` : "All weeks"}, ${day ? WEEKDAYS[day - 1] : "every day"}`;
  const cycleText = cycleLength === 1 ? "a 1-week cycle" : `up to ${cycleLength}-week cycle`;

  return (
    <div className="daily-templates -mt-1">
      <TemplatesHeading title="Daily Templates" subtitle={`Manage repeating care visits (${cycleText})`} />
      <TemplatesTabs active="daily" canBuild={canBuild} />
      <Flash searchParams={sp} />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <ChoiceGroup
          label="Cycle week"
          items={Array.from({ length: cycleLength }, (_, i) => ({ href: url({ week: String(i + 1), page: undefined }), label: `Week ${i + 1}`, title: i + 1 === thisWeek ? "This calendar week is this cycle week" : undefined, active: week === i + 1, marker: i + 1 === thisWeek }))}
        />
        <ChoiceGroup
          label="Day"
          items={WEEKDAYS.map((d, i) => ({ href: url({ day: String(i + 1), page: undefined }), label: <><span className="min-[1500px]:hidden">{SHORT[i]}</span><span className="hidden min-[1500px]:inline">{d}</span></>, title: i + 1 === todayDay ? `${d} (today)` : d, active: day === i + 1, marker: i + 1 === todayDay }))}
        />
      </div>

      <div className="mb-3 flex flex-col gap-2.5 min-[1400px]:flex-row min-[1400px]:items-start">
        <AutoSubmitForm label="Filters" className="grid w-full min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))]">
          {hiddenExcept(["q", "area", "carer", "su", "call", "page", "tpl"])}
          <label className="relative min-w-0">
            <span className="sr-only">Search templates by service user, reference, carer or call</span>
            <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search templates…" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px] text-[#101828] placeholder:text-[#667085]" />
          </label>
          <FilterSelect name="area" label="Area" value={area ?? ""}><option value="">Area: All Areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>Area: {a.name}</option>)}</FilterSelect>
          <FilterSelect name="carer" label="Team member" value={sp.carer ?? ""}><option value="">Team Member: All</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</FilterSelect>
          <FilterSelect name="su" label="Service user" value={sp.su ?? ""}><option value="">Service User: All</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</FilterSelect>
          <FilterSelect name="call" label="Call type" value={call ?? ""}><option value="">Call Type: All</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</FilterSelect>
        </AutoSubmitForm>
        <div className="flex justify-end gap-2.5">
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 whitespace-nowrap rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><SlidersHorizontal size={19} aria-hidden />More Filters{more ? <span className="rounded-full bg-[#5b2bb5] px-2 text-[12.5px] text-white">{more}</span> : null}</summary>
            <form method="get" aria-label="More filters" className="absolute right-0 z-40 mt-1 grid w-[300px] gap-2.5 rounded-[10px] border border-[#e4e7ec] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {hiddenExcept(["state", "empty", "week", "day", "page", "tpl"])}
              {sp.week && sp.week !== "all" ? <input type="hidden" name="week" value={sp.week} /> : null}
              {sp.day && sp.day !== "all" ? <input type="hidden" name="day" value={sp.day} /> : null}
              <label><span className="label">Templates</span><select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Enabled only</option><option value="off">Disabled only</option><option value="all">Enabled and disabled</option></select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="empty" value="1" defaultChecked={sp.empty === "1"} className="h-4 w-4" /> Only templates short of a carer</label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="week" value="all" defaultChecked={sp.week === "all"} className="h-4 w-4" /> Every cycle week</label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="day" value="all" defaultChecked={sp.day === "all"} className="h-4 w-4" /> Every day of the week</label>
              <div className="flex gap-2"><button className="btn-primary">Apply</button><Link href="/rota/templates" className="btn-secondary">Clear all</Link></div>
            </form>
          </details>
          {canEdit ? <Link href="/rota/templates/new" className="flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] bg-[#5b2bb5] px-4 text-[14.5px] font-semibold text-white no-underline hover:bg-[#4c2398] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]"><Plus size={18} weight="bold" aria-hidden />Add Template</Link> : null}
        </div>
      </div>
      {q || sp.empty === "1" || state !== "on" ? <p className="mb-2 rounded-[8px] bg-[#fdf6e8] px-3 py-1.5 text-[14px] text-[#5c3d00]" role="note">Showing {state === "off" ? "disabled" : state === "all" ? "enabled and disabled" : "enabled"} templates{sp.empty === "1" ? " short of a carer" : ""}{q ? ` matching “${q}”` : ""}. <Link href={url({ q: undefined, empty: undefined, state: undefined, page: undefined })}>Show every enabled template</Link></p> : null}

      <div className={`grid grid-cols-1 items-start gap-4 ${details ? "xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <section aria-label={`Templates: ${scopeText}`} className="min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
            {canEdit ? (
              <form id="tbulk" action={templateBulkAction} className="flex flex-wrap items-center gap-2" aria-label="Bulk actions">
                <input type="hidden" name="back" value={back} />
                <BulkTemplateBar form="tbulk" staff={lk.staff.map((s) => ({ id: s.id, name: s.displayName }))} callTypes={lk.callTypes.map((c) => ({ id: c.id, name: c.name }))} />
              </form>
            ) : null}
            <p className="ml-auto text-[14px] font-semibold text-[#344054]">{scopeText}</p>
          </div>

          {rows.length ? (
            <div className="relative min-w-0 overflow-x-auto border-t border-[#eaecf0]">
              <table className="w-full border-collapse whitespace-nowrap text-[14px]">
                <caption className="sr-only">Templates for {scopeText}. Choose a row to see its details.</caption>
                <thead className="bg-[#f9fafb]">
                  <tr className="border-b border-[#eaecf0]">
                    {canEdit ? <th scope="col" className="w-10 px-3 py-2.5"><SelectAll form="tbulk" name="templateIds" label="Select all templates on this page" /></th> : null}
                    <th scope="col" className={TH}>Ref</th>
                    <th scope="col" className={TH}>Service User</th>
                    <th scope="col" className={TH}>Start</th>
                    <th scope="col" className={TH}>Duration</th>
                    <th scope="col" className={TH} title="Carers planned of carers needed">Carers</th>
                    <th scope="col" className={TH}>Team Member(s)</th>
                    <th scope="col" className={TH}>Service Call</th>
                    {details ? null : <th scope="col" className={TH}>Area</th>}
                    <th scope="col" className={TH}>Pattern</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <ClickableRows>
                  {rows.map((t) => {
                    const ref = templateRef(t.id);
                    const cov = templateCoverage(t);
                    const selected = details?.template.id === t.id;
                    const open = url({ tpl: t.id });
                    const carers = [t.carer1, t.carersRequired > 1 ? t.carer2 : null];
                    return (
                      <tr key={t.id} data-href={open} aria-selected={selected || undefined} className={`cursor-pointer border-b border-[#f2f4f7] last:border-0 ${selected ? "bg-[#f4f1fd] outline outline-2 -outline-offset-2 outline-[#b9a5ec]" : cov.state === "none" && t.enabled ? "bg-[#fffafa]" : t.enabled ? "" : "bg-[#fafafa] text-[#667085]"} hover:bg-[#f9f8fe]`}>
                        {canEdit ? <td className="px-3 py-1.5"><input type="checkbox" form="tbulk" name="templateIds" value={t.id} aria-label={`Select ${ref} ${suName(t.serviceUser)} ${t.callType.name}`} className="h-4 w-4" /></td> : null}
                        <td className={`${TD} tabular-nums`}><Link href={open} scroll={false} className="font-medium text-[#101828] no-underline hover:underline" aria-label={`Open details of template ${ref}`}>{ref}</Link></td>
                        <td className={TD}><Link href={`/rota/service-users/${t.serviceUser.id}`} title="Open the service user's record" className="inline-flex items-center gap-1.5 font-semibold text-[#3b1f99] underline decoration-[#c4b5f4] underline-offset-2 hover:decoration-[#3b1f99]"><User size={17} aria-hidden className="text-[#5b2bb5]" />{suName(t.serviceUser)}</Link></td>
                        <td className={`${TD} tabular-nums`}>{hhmm(t.startMinute)}</td>
                        <td className={`${TD} tabular-nums`}>{durationLabel(t.durationMin)}</td>
                        <td className={TD}><CoverageBadge filled={cov.filled} required={cov.required} /></td>
                        <td className={`${TD} ${details ? "max-w-[170px]" : "max-w-[230px]"} truncate`} title={carers.filter(Boolean).map((c) => c!.displayName).join(", ") || "No carer planned"}>
                          {carers.some(Boolean) ? carers.map((c, i) => (c ? <span key={i}>{i && carers[0] ? ", " : ""}<Link href={`/rota/staff/${c.id}`} className={`underline underline-offset-2 ${c.employmentStatus === "ARCHIVED" || c.hrMissing ? "text-[#b54708] decoration-[#f5c27a]" : "text-[#14713a] decoration-[#9fd6b2]"}`}>{c.displayName}</Link></span> : null)) : null}
                          {cov.state !== "full" ? <span className="font-semibold text-[#b42318]">{cov.filled ? ", 1 needed" : "Unassigned"}</span> : null}
                        </td>
                        <td className={`${TD} max-w-[160px] truncate`} title={t.callType.name}>{t.callType.name}</td>
                        {details ? null : <td className={TD}>{t.area ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: t.area.colour }} />{t.area.name}</span> : <span className="text-[#98a2b3]">—</span>}</td>}
                        <td className={TD} title={`Runs ${weekdaysLabel(t.weekdays)}`}>{patternLabel(t.cycleWeeks, cycleLength)}</td>
                        <td className={TD}><StatusBadge enabled={t.enabled} /></td>
                        <td className={`${TD} text-right`}>
                          <span className="inline-flex gap-1.5">
                            {selected ? null : <Link href={open} scroll={false} className={SMALL_BTN} title="View details" aria-label={`View details of ${ref}`}><Eye size={15} aria-hidden />{details ? null : "View"}</Link>}
                            {canEdit ? <Link href={`/rota/templates/${t.id}`} className={SMALL_BTN} title="Edit template" aria-label={`Edit ${ref}`}><PencilSimple size={15} aria-hidden />{details ? null : "Edit"}</Link> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </ClickableRows>
              </table>
            </div>
          ) : (
            <div className="border-t border-[#eaecf0] p-4"><Empty>No {state === "off" ? "disabled " : ""}templates for {scopeText} match these filters.{canEdit ? <> <Link href="/rota/templates/new">Add a template</Link>.</> : null}</Empty></div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-[#eaecf0] px-3.5 py-3">
            <p data-testid="template-count" data-total={total} className="text-[14px] text-[#344054]" aria-live="polite">Showing {total ? (page - 1) * per + 1 : 0} to {(page - 1) * per + rows.length} of {total} template{total === 1 ? "" : "s"}</p>
            {pages > 1 ? (
              <nav aria-label="Template pages" className="flex items-center gap-1">
                {page > 1 ? <Link href={url({ page: page - 1 === 1 ? undefined : String(page - 1) })} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretLeft size={14} weight="bold" aria-hidden /></Link> : null}
                {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => (
                  <span key={n} className="flex items-center gap-1">
                    {i && n - arr[i - 1]! > 1 ? <span className="px-0.5 text-[#667085]">…</span> : null}
                    <Link href={url({ page: n === 1 ? undefined : String(n) })} aria-current={n === page ? "page" : undefined} className={`flex h-8 min-w-8 items-center justify-center rounded-[6px] border px-2 text-[13px] tabular-nums no-underline ${n === page ? "border-[#5b2bb5] bg-[#5b2bb5] font-semibold text-white" : "border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50"}`}>{n}</Link>
                  </span>
                ))}
                {page < pages ? <Link href={url({ page: String(page + 1) })} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretRight size={14} weight="bold" aria-hidden /></Link> : null}
              </nav>
            ) : null}
            <AutoSubmitForm label="Rows per page" className="ml-auto flex items-center gap-3">
              {hiddenExcept(["per", "page"])}
              <label htmlFor="per" className="text-[14px] text-[#344054]">Rows per page</label>
              <span className="relative"><select id="per" name="per" defaultValue={String(per)} className="h-10 appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px]">{PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}</select><CaretDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" /></span>
            </AutoSubmitForm>
          </div>
          <p className="border-t border-[#eaecf0] px-3.5 py-2 text-[12.5px] text-[#475467]">Templates are the repeating pattern. Changing one does not change visits already built; apply a change to built visits from the template&apos;s Edit page. A double-up is one template with two carers.</p>
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
  const initials = `${(t.serviceUser.preferredName || t.serviceUser.firstName)[0] ?? ""}${t.serviceUser.lastName[0] ?? ""}`;
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-start gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#efeafc] text-[15px] font-bold text-[#5b2bb5]">{initials}</span>
        <div className="min-w-0">
          <Link href={`/rota/service-users/${t.serviceUser.id}`} className="block text-[16px] font-bold text-[#3b1f99] underline decoration-[#c4b5f4] underline-offset-2">{suName(t.serviceUser)}</Link>
          <p className="text-[13.5px] text-[#475467]">{ref}{t.serviceUser.reference ? ` · ${t.serviceUser.reference}` : ""}</p>
        </div>
        <span className="ml-auto"><StatusBadge enabled={t.enabled} /></span>
      </div>
      <dl className="divide-y divide-[#f2f4f7]">
        <Row label="Cycle weeks">{patternLabel(t.cycleWeeks, cycleLength)}</Row>
        <Row label="Days">{weekdaysLabel(t.weekdays)}</Row>
        <Row label="Time"><span className="tabular-nums">{hhmm(t.startMinute)} – {hhmm((t.startMinute + t.durationMin) % 1440)}</span> <span className="text-[#475467]">({durationLabel(t.durationMin)})</span></Row>
        <Row label="Carers needed"><span className="inline-flex items-center gap-2">{t.carersRequired === 2 ? "2 (double-up)" : "1"} <CoverageBadge filled={cov.filled} required={cov.required} /></span></Row>
        <Row label="Team members">
          <ul>
            {carers.map((c, i) => (i === 0 || t.carersRequired > 1 ? <li key={i}>{c ? <Link href={`/rota/staff/${c.id}`}>{c.displayName}</Link> : <span className="font-semibold text-[#b42318]">Unassigned</span>}{t.carersRequired > 1 ? <span className="text-[#667085]"> · carer {i + 1}</span> : null}</li> : null))}
            {t.shadow ? <li>{t.shadow.displayName}<span className="text-[#667085]"> · shadow</span></li> : null}
          </ul>
        </Row>
        <Row label="Service call">{t.callType.name}</Row>
        <Row label="Area">{t.area ? <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: t.area.colour }} />{t.area.name}</span> : "—"}</Row>
        {t.runRoute ? <Row label="Run route">{t.runRoute.name}</Row> : null}
        <Row label="Settings">{[t.timeLocked ? "Time locked" : null, t.alertOnLate ? "Alert when late" : null, t.medicationRequired ? "Medication prompt" : null, t.rotaType === "ALTERNATE" ? "Alternate rota" : null, t._count.tasks ? `${t._count.tasks} care task${t._count.tasks === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "—"}</Row>
        <Row label="Runs">From {fmtLondonDate(d.effectiveFrom)}{d.effectiveTo ? ` to ${fmtLondonDate(d.effectiveTo)}` : ", no end date"}</Row>
        {t.notes ? <Row label="Notes"><span className="whitespace-pre-line">{t.notes}</span></Row> : null}
      </dl>
      <div className="mt-2 space-y-2">
        <Warnings items={d.warnings} />
        <p className="text-[13px] text-[#475467]">{d.futureVisits ? `${d.futureVisits} future visit${d.futureVisits === 1 ? " was" : "s were"} built from this template. They keep their times and carers unless you apply a change from the Edit page.` : "No future visits have been built from this template yet."}</p>
      </div>
      {canEdit ? (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#eaecf0] pt-3">
          <Link href={`/rota/templates/${t.id}`} className="flex h-10 items-center justify-center gap-1.5 rounded-[8px] bg-[#5b2bb5] px-2 text-[14px] font-semibold text-white no-underline hover:bg-[#4c2398]"><PencilSimple size={16} aria-hidden />Edit</Link>
          <form action={duplicateTemplateAction}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="templateId" value={t.id} />
            <button title="Make a copy. The copy starts disabled until you check and enable it." className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border-[1.5px] border-[#5b2bb5] bg-white px-2 text-[14px] font-semibold text-[#5b2bb5] hover:bg-[#f4f1fd]"><Copy size={16} aria-hidden />Duplicate</button>
          </form>
          {t.enabled ? (
            <Link href={confirmHref} scroll={false} className="flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-[#f1b5b0] bg-white px-2 text-[14px] font-semibold text-[#b42318] no-underline hover:bg-[#fef3f2]"><Prohibit size={16} aria-hidden />Deactivate</Link>
          ) : (
            <form action={templateBulkAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="templateIds" value={t.id} />
              <button name="kind" value="enable" className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[#9fd6b2] bg-white px-2 text-[14px] font-semibold text-[#14713a] hover:bg-[#ecfdf3]"><CheckCircle size={16} aria-hidden />Enable</button>
            </form>
          )}
          {t.enabled && confirmOff ? (
            <form action={templateBulkAction} role="alertdialog" aria-labelledby="deactivate-q" className="col-span-3 rounded-[8px] border border-[#f1b5b0] bg-[#fef3f2] p-3">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="templateIds" value={t.id} />
              <p id="deactivate-q" className="mb-2 text-[13.5px] text-[#7a271a]">Deactivate {ref}? Build Rota will skip it from now on. Nothing is deleted, its history is kept, and visits already built are not changed. You can enable it again at any time.</p>
              <div className="flex gap-2">
                <button name="kind" value="disable" className="h-9 rounded-[8px] bg-[#b42318] px-3 text-[14px] font-semibold text-white hover:bg-[#912018]">Yes, deactivate</button>
                <Link href={back} scroll={false} className="flex h-9 items-center rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-semibold text-[#344054] no-underline">Keep it on</Link>
              </div>
            </form>
          ) : null}
        </div>
      ) : <p className="mt-3 border-t border-[#eaecf0] pt-3 text-[13px] text-[#475467]">You can view templates. Changing them needs rota editing rights.</p>}
    </div>
  );
}

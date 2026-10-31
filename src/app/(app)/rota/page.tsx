import { redirect } from "next/navigation";
import { CalendarBlank, CalendarCheck, CaretLeft, CaretRight, ChartBar, CheckCircle, ClockCounterClockwise, Clock, FastForward, FirstAidKit, Gauge, Lightning, Target, Users, UsersThree, UserSwitch, Warning, WarningCircle, XCircle, CalendarPlus, Info } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaActivity, rotaOverview } from "@/server/rota/overview";
import { Flash } from "@/components/ui";
import { NotBuiltNotice } from "@/components/rota-ui";
import { weekIsBuilt } from "@/server/rota/build";
import { AutoSubmitForm } from "@/components/auto-submit";
import { AttentionRow, CoverageChart, DashPanel, KpiCard, StaffRow, StateBars, StateDonut, ordinalDate } from "@/components/rota-dashboard";

export const dynamic = "force-dynamic";

const PERIODS = [
  ["day", "Today"],
  ["week", "This Week"],
  ["next", "Next Week"],
] as const;

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * Rota Dashboard: the operational overview of care delivery, workforce and rota status for a day or week and one
 * authorised branch. Laid out to the owner's approved design (31 Oct 2026). Operational only: no money is shown here.
 */
export default async function RotaDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view")) redirect(rotaHome(ctx));
  const o = await rotaOverview(ctx, { date: sp.date, period: sp.period, branch: sp.branch });
  const activity = await rotaActivity(ctx, { branch: o.branch ?? undefined, take: 4 });
  const notBuilt = o.performance.total === 0 && !(await weekIsBuilt(ctx, o.range.from));
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const keep = { date: o.date, period: o.period, branch: o.branch ?? undefined };
  const url = (extra: Record<string, string | undefined>) => `/rota?${new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => !!e[1]))}`;
  const step = o.period === "day" ? 1 : 7;
  const b = o.branch ? `&branch=${o.branch}` : "";
  const isDay = o.period === "day";
  // Drill-downs: a day opens the Daily Rota list for that day; a week opens it on the week's first day.
  const listFor = (extra: string) => `/rota/visits?date=${o.range.from}&layout=list${extra}${b}`;
  const k = o.kpis;
  const p = o.performance;
  const periodLabel = isDay ? (o.date === o.today ? "Today" : ordinalDate(o.date).split(" ")[0]) : o.period === "week" ? "This week" : "Next week";
  const rangeText = isDay ? ordinalDate(o.date) : `${ordinalDate(o.range.from).replace(/ \d{4}$/, "")} – ${ordinalDate(o.range.to)}`;
  const nextMonday = addDays(mondayOf(o.today), 7);
  const perfRows = [
    { label: "Completed", value: p.states.completed, colour: "#1f9d4c", href: listFor("&status=COMPLETED") },
    { label: "In progress", value: p.states.inProgress, colour: "#2f7de1", href: listFor("&status=IN_PROGRESS") },
    { label: "Still due", value: p.states.due, colour: "#c9c2f2", href: listFor("&status=SCHEDULED") },
    { label: "Missed", value: p.states.missed, colour: "#e5484d", href: listFor("&status=MISSED") },
    ...(p.states.notDelivered ? [{ label: "Not delivered", value: p.states.notDelivered, colour: "#98a2b3", href: listFor("&status=NOT_DELIVERED") }] : []),
  ];

  return (
    <div className="rota-dash -mt-1">
      <header className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarBlank size={40} weight="regular" className="shrink-0 text-[#6b3fd0]" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-tight text-[#0b1530]">Rota Dashboard</h1>
            <p className="text-[15px] text-slate-700">Operational overview of care delivery, workforce and rota status</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {o.branches.length > 1 || o.branch ? (
            <AutoSubmitForm label="Branch" className="flex items-center">
              <input type="hidden" name="date" value={o.date} />
              <input type="hidden" name="period" value={o.period} />
              <label className="sr-only" htmlFor="dash-branch">Branch</label>
              <select id="dash-branch" name="branch" defaultValue={o.branch ?? ""} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14.5px] font-medium text-[#0b1530]">
                <option value="">{o.branches.length > 1 ? "All my branches" : o.branches[0]?.name ?? "All branches"}</option>
                {o.branches.length > 1 ? o.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>) : null}
              </select>
            </AutoSubmitForm>
          ) : (
            <span className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14.5px] font-medium leading-10 text-[#0b1530]">{o.branches[0]?.name ?? "All branches"}</span>
          )}
          <Link href={url({ date: addDays(o.date, -step) })} className="flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50" aria-label={isDay ? "Previous day" : "Previous week"}><CaretLeft size={18} aria-hidden /></Link>
          <AutoSubmitForm label="Date" className="flex items-center">
            <input type="hidden" name="period" value={o.period} />
            {o.branch ? <input type="hidden" name="branch" value={o.branch} /> : null}
            <label className="flex h-10 items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#0b1530]">
              <CalendarBlank size={17} aria-hidden />
              <span className="sr-only">Date</span>
              <span aria-hidden className="hidden whitespace-nowrap md:inline">{rangeText}</span>
              <input type="date" name="date" defaultValue={o.date} className="w-[22px] bg-transparent text-[14px] md:w-[22px] [&::-webkit-datetime-edit]:hidden" aria-label={`Date, ${ordinalDate(o.date)}`} />
            </label>
          </AutoSubmitForm>
          <Link href={url({ date: addDays(o.date, step) })} className="flex h-10 w-11 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#0b1530] hover:bg-slate-50" aria-label={isDay ? "Next day" : "Next week"}><CaretRight size={18} aria-hidden /></Link>
          <nav aria-label="Period" className="flex rounded-[10px] border border-[#d0d5dd] bg-white p-1">
            {PERIODS.map(([key, label]) => {
              const active = o.period === key && (key !== "day" || o.date === o.today);
              return (
                <Link key={key} href={url({ period: key, date: o.today })} aria-current={active ? "page" : undefined} className={`rounded-[7px] px-4 py-1.5 text-[14.5px] font-medium no-underline ${active ? "bg-[#6b3fd0] text-white" : "text-[#0b1530] hover:bg-slate-50"}`}>{label}</Link>
              );
            })}
          </nav>
        </div>
      </header>
      <Flash searchParams={sp} />
      {notBuilt ? <NotBuiltNotice date={o.range.from} canBuild={hasOrgPermission(ctx, "rota.build")} /> : null}

      <section aria-label="Key figures" className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard testId="kpi-scheduled" label="Scheduled Visits" value={k.scheduled.value} tone="lavender" icon={<CalendarBlank size={26} aria-hidden />} href={listFor("")} extra={k.scheduled.previous ? <span className="text-slate-600">{k.scheduled.value - k.scheduled.previous >= 0 ? "+" : ""}{k.scheduled.value - k.scheduled.previous} vs {isDay ? "last week" : "week before"}</span> : null} title="Planned visits, not counting cancelled ones" />
        <KpiCard testId="kpi-completed" label="Completed" value={k.completed.value} extra={`${k.completed.percent.toFixed(1)}%`} tone="green" icon={<CheckCircle size={28} aria-hidden />} href={listFor("&status=COMPLETED")} />
        <KpiCard testId="kpi-unassigned" label="Unassigned" value={k.unassigned.value} extra={`${k.unassigned.percent.toFixed(1)}%`} tone="amber" icon={<UsersThree size={28} aria-hidden />} href={listFor("&view=unassigned")} title="Visits with at least one carer slot not filled" />
        <KpiCard testId="kpi-missed" label="Missed" value={k.missed.value} extra={`${k.missed.percent.toFixed(1)}%`} tone="red" icon={<XCircle size={28} aria-hidden />} href={listFor("&status=MISSED")} />
        <KpiCard testId="kpi-late" label="Late" value={k.late.value} extra={`${k.late.percent.toFixed(1)}%`} tone="orange" icon={<Clock size={28} aria-hidden />} href={listFor("&view=late")} title={`Started, or still not started, more than ${k.late.thresholdMin} minutes after the scheduled time`} />
      </section>

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[1.2fr_1fr_0.97fr]">
        <DashPanel title={isDay && o.date === o.today ? "Today's Performance" : `${periodLabel === "Today" ? "Today" : isDay ? "Day" : periodLabel}'s Performance`.replace("This week's", "This Week's").replace("Next week's", "Next Week's")} id="dash-perf" icon={<ChartBar size={26} weight="bold" aria-hidden />}>
          {p.total ? (
            <>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                <StateDonut total={p.total} centre={p.future ? "—" : `${p.completedPercent.toFixed(1)}%`} centreLabel={p.future ? "Not started yet" : "Completed"} rows={perfRows} />
                <div className="w-full min-w-0 flex-1"><StateBars total={p.total} rows={perfRows} /></div>
              </div>
              <p className="mt-1.5 border-t border-[#eef0f3] pt-1.5 text-[12.5px] text-slate-600">
                Each visit is counted once, by its status. Also: <Link href={listFor("&view=unassigned")} className="font-medium text-[#8a5a00]">{p.unassigned} unassigned</Link> · <Link href={listFor("&view=late")} className="font-medium text-[#a14b0f]">{p.late} late</Link>
                {p.future ? " · nothing can be completed yet on future dates" : ""}
              </p>
            </>
          ) : (
            <p className="py-6 text-[14px] text-slate-600">No visits are scheduled for {isDay ? "this day" : "this week"}{o.branch ? " in this branch" : ""}.{canBuild ? <> <Link href={`/rota/build?week=${mondayOf(o.range.from)}`} className="underline">Build the rota</Link> if it is missing.</> : null}</p>
          )}
        </DashPanel>

        <DashPanel title="Needs Attention" id="dash-attn" icon={<Warning size={26} weight="bold" aria-hidden />} aside={<span className="rounded-full bg-[#e5484d] px-2.5 py-0.5 text-[14px] font-semibold tabular-nums text-white" title="Distinct visits needing action plus staff with readiness problems">{o.attention.total}</span>}>
          <ul className="-mx-2 space-y-0.5">
            <AttentionRow icon={<XCircle size={22} aria-hidden />} tone="red" title="Missed visits" text={`${o.attention.missed} visit${o.attention.missed === 1 ? "" : "s"} not completed`} count={o.attention.missed} href={o.attentionHrefs.missed} />
            <AttentionRow icon={<UsersThree size={22} aria-hidden />} tone="amber" title="Unassigned visits" text={`${o.attention.unassigned} upcoming visit${o.attention.unassigned === 1 ? "" : "s"} without a carer`} count={o.attention.unassigned} href={o.attentionHrefs.unassigned} />
            <AttentionRow icon={<Users size={22} aria-hidden />} tone="lavender" title="Partial double-ups" text={`${o.attention.partial} visit${o.attention.partial === 1 ? "" : "s"} need a second carer`} count={o.attention.partial} href={o.attentionHrefs.partial} />
            <AttentionRow icon={<Clock size={22} aria-hidden />} tone="orange" title="Late visits" text={`${o.attention.late} not started, over ${k.late.thresholdMin} minutes late`} count={o.attention.late} href={o.attentionHrefs.late} />
            <AttentionRow icon={<WarningCircle size={22} aria-hidden />} tone="amber" title="Staff readiness" text={`${o.attention.readiness} carer${o.attention.readiness === 1 ? "" : "s"} with restrictions or checks to act on`} count={o.attention.readiness} href={o.attentionHrefs.readiness} />
          </ul>
        </DashPanel>

        <DashPanel title="Staffing & Availability" id="dash-staff" icon={<UsersThree size={26} weight="bold" aria-hidden />} aside={<span className="text-[14px] text-slate-600">({o.staffing.carers} carers)</span>} className="lg:col-span-2 xl:col-span-1">
          <ul>
            <StaffRow icon={<CalendarCheck size={22} aria-hidden />} tone="green" label={isDay && o.date === o.today ? "Available today" : `Available ${ordinalDate(o.date).split(" ").slice(0, 2).join(" ")}`} value={o.staffing.available} href="/rota/staff" />
            <StaffRow icon={<CalendarBlank size={22} aria-hidden />} tone="blue" label="On annual leave" value={o.staffing.onLeave} href={`/rota/cover?from=${o.date}&days=1&kind=HOLIDAY`} />
            <StaffRow icon={<FirstAidKit size={22} aria-hidden />} tone="red" label="Off sick" value={o.staffing.sick} href={`/rota/cover?from=${o.date}&days=1&kind=SICKNESS`} />
            <StaffRow icon={<Warning size={22} aria-hidden />} tone="amber" label="Readiness restrictions" value={o.staffing.restrictions} href="/rota/readiness" />
          </ul>
          {o.staffing.otherLeave || o.staffing.unavailable ? <p className="mt-1 text-[12.5px] text-slate-500">Also not available: {[o.staffing.otherLeave && `${o.staffing.otherLeave} on other leave`, o.staffing.unavailable && `${o.staffing.unavailable} unavailable all day by their pattern`].filter(Boolean).join(", ")}.</p> : null}
        </DashPanel>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.17fr_1fr]">
        <DashPanel title="7-Day Visit Coverage" id="dash-cov" icon={<ChartBar size={26} weight="bold" aria-hidden />} aside={<span className="text-[13px] text-slate-500">from {ordinalDate(o.date).split(" ").slice(0, 3).join(" ")}</span>}>
          <CoverageChart days={o.coverage} hrefFor={(d) => `/rota/visits?date=${d}${b}`} />
        </DashPanel>
        <DashPanel title="Key Operational Insights" id="dash-ins" icon={<Target size={26} weight="bold" aria-hidden />}>
          {o.insights.length ? (
            <ul>
              {o.insights.map((i) => (
                <li key={i.text} className="border-b border-[#eef0f3] last:border-b-0">
                  <Link href={i.href} className="flex items-center gap-3 px-1 py-[3px] text-[14.5px] text-[#0b1530] no-underline hover:bg-[#f7f7fb]">
                    <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ${i.tone === "ok" ? "bg-[#ebf7ef] text-[#1c8a4a]" : i.tone === "bad" ? "bg-[#fdeeee] text-[#c8323a]" : i.tone === "warn" ? "bg-[#fdf4e3] text-[#c27a06]" : "bg-[#e8f0fc] text-[#1d5fd0]"}`}>
                      {i.tone === "ok" ? <CheckCircle size={18} /> : i.tone === "info" ? <Info size={18} /> : <Warning size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">{i.text}{i.detail ? <span className="ml-2 text-[13px] text-slate-600">{i.detail}</span> : null}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="py-6 text-[14px] text-slate-600">Nothing needs attention: the next weeks are built and published, and no staffing gaps were found.</p>}
        </DashPanel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.45fr_1fr]">
        <DashPanel title="Recent Rota Activity" id="dash-act" icon={<ClockCounterClockwise size={26} weight="bold" aria-hidden />} aside={<Link href={`/rota/activity${o.branch ? `?branch=${o.branch}` : ""}`} className="ml-auto text-[14px] font-medium text-[#5a3aa8] no-underline hover:underline">View all activity →</Link>}>
          {activity.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[14px]">
                <thead><tr className="bg-[#f2f4f7] text-[13.5px] font-semibold text-[#0b1530]"><th scope="col" className="px-2.5 py-1 font-semibold">Time</th><th scope="col" className="px-2.5 py-1 font-semibold">Activity</th><th scope="col" className="px-2.5 py-1 font-semibold">Details</th><th scope="col" className="px-2.5 py-1 font-semibold">By</th></tr></thead>
                <tbody>
                  {activity.rows.map((r) => (
                    <tr key={r.id} className="border-b border-[#eef0f3] last:border-b-0 hover:bg-[#f7f7fb]">
                      <td className="whitespace-nowrap px-2.5 py-1 tabular-nums">{londonDate(r.at) === o.today ? hhmm(r.at) : `${r.at.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" })} ${hhmm(r.at)}`}</td>
                      <td className="px-2.5 py-1">{r.activity}</td>
                      <td className="px-2.5 py-1"><Link href={r.href} className="text-[#0b1530] no-underline hover:underline">{r.details}</Link></td>
                      <td className="px-2.5 py-1">{r.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="py-6 text-[14px] text-slate-600">No rota activity has been recorded yet.</p>}
        </DashPanel>
        <section aria-labelledby="dash-quick" className="rounded-[10px] border border-[#e4e7ec] bg-[#f6f3fd] px-5 py-3">
          <div className="mb-2 flex items-center gap-2.5">
            <Lightning size={26} weight="bold" className="text-[#6b3fd0]" aria-hidden />
            <h2 id="dash-quick" className="text-[19px] font-bold text-[#0b1530]">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {canBuild ? <Link href="/rota/build?new=1" className="flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[#6b3fd0] text-[15.5px] font-semibold text-white no-underline hover:bg-[#5a33b5]"><CalendarPlus size={22} aria-hidden />Build Rota</Link> : null}
            {canBuild ? <Link href={`/rota/build?roll=1&from=${mondayOf(o.today)}&to=${nextMonday}&weeks=1`} className="flex h-12 items-center justify-center gap-2.5 rounded-[8px] border border-[#6b3fd0] bg-white text-[15.5px] font-semibold text-[#0b1530] no-underline hover:bg-[#f3f0fc]"><FastForward size={22} className="text-[#6b3fd0]" aria-hidden />Roll Forward</Link> : null}
            {canBuild ? <Link href={`/rota/optimise?from=${o.range.from > o.today ? o.range.from : o.today}`} className="flex h-12 items-center justify-center gap-2.5 rounded-[8px] border border-[#6b3fd0] bg-white text-[15.5px] font-semibold text-[#0b1530] no-underline hover:bg-[#f3f0fc]"><Gauge size={22} className="text-[#6b3fd0]" aria-hidden />Optimise Rota</Link> : null}
            <Link href="/rota/cover" className="flex h-12 items-center justify-center gap-2.5 rounded-[8px] border border-[#6b3fd0] bg-white text-[15.5px] font-semibold text-[#0b1530] no-underline hover:bg-[#f3f0fc]"><UserSwitch size={22} className="text-[#6b3fd0]" aria-hidden />Manage Cover</Link>
            {!canBuild ? <p className="text-[13px] text-slate-600 sm:col-span-2">Building, rolling forward and optimising the rota are open to administrators, care managers and coordinators.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

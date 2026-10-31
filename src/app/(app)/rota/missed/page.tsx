import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { MISSED_REASONS, missedCallRegister, missedLookups, STAGE_LABEL, reasonLabel } from "@/server/rota/missed-calls";
import { missedBulkAction } from "@/app/rota-actions";
import { CallRing } from "@/components/rota-ui";
import { Badge, Empty, Flash, type Tone } from "@/components/ui";
import { VISIT_LABEL } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const STAGE_TONE: Record<string, Tone> = { NEW: "rose", INVESTIGATING: "amber", AWAITING_SIGNOFF: "violet", CLOSED: "green" };
const STATUSES = ["MISSED", "IN_PROGRESS", "COMPLETED", "NOT_DELIVERED", "CANCELLED"] as const;

/**
 * Missed Calls: OnePlan's missed-calls list (the Missed ring opens it) with the investigation register on top. From the
 * top: the four call rings, the title with Back, Home and the exports, the "missed calls only" banner, the date
 * navigator, the management figures, filters and smart filters, Bulk Actions, then one row per missed call.
 */
export default async function MissedCallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.monitor");
  const [reg, lk] = await Promise.all([missedCallRegister(ctx, sp), missedLookups(ctx)]);
  const { f, range, kpis, rings, rows, settings } = reg;
  const canWork = hasOrgPermission(ctx, "rota.edit");
  const canExport = hasOrgPermission(ctx, "report.export");

  const keep: Record<string, string | undefined> = { period: f.period, date: f.date, from: f.period === "custom" ? range.from : undefined, to: f.period === "custom" ? range.to : undefined, q: f.q, carer: f.carer, su: f.su, branch: f.branch, status: f.status, call: f.call, reason: f.reason, stage: f.stage === "all" ? undefined : f.stage, coordinator: f.coordinator, smart: f.smart };
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    return `/rota/missed${p.size ? `?${p}` : ""}`;
  };
  const back = href({});
  const exportHref = (format: string) => `/api/rota/missed/export?${new URLSearchParams(Object.entries({ ...keep, format }).filter((e): e is [string, string] => !!e[1]))}`;
  const anchor = f.date ?? reg.today;
  const step = (n: -1 | 1) => {
    if (f.period === "custom") return null;
    const d = new Date(`${anchor}T12:00:00Z`);
    if (f.period === "day") d.setUTCDate(d.getUTCDate() + n);
    else if (f.period === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
    else d.setUTCMonth(d.getUTCMonth() + n, 1);
    return href({ date: d.toISOString().slice(0, 10) });
  };
  const label = f.period === "day" ? fmtLondonDate(range.from, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : f.period === "month" ? fmtLondonDate(range.from, { month: "long", year: "numeric" }) : `${fmtLondonDate(range.from, { weekday: "short", day: "numeric", month: "short" })} – ${fmtLondonDate(range.to)}`;
  const pct = (n: number | null) => (rings.total && n !== null ? ((n / rings.total) * 100).toFixed(1) : "0.0");
  const hours = rows.reduce((n, r) => n + (r.visit.scheduledEnd.getTime() - r.visit.scheduledStart.getTime()) / 3600000, 0);
  const smart = (key: "repeat" | "highrisk" | "uninvestigated", text: string, n: number) => (
    <Link href={href({ smart: f.smart === key ? undefined : key })} aria-pressed={f.smart === key} className={`rounded-full border px-3 py-1 text-[13px] no-underline ${f.smart === key ? "border-[#3a2470] bg-[#3a2470] text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>
      {text} <b className="ml-0.5">{n}</b>
    </Link>
  );
  const kpi = (n: number, title: string, note: string, to: string, colour = "text-slate-900") => (
    <Link href={to} className="block border-b border-slate-100 px-3 py-2.5 no-underline hover:bg-slate-50 sm:border-b-0 sm:border-r last:border-r-0">
      <b className={`block text-[22px] leading-7 ${colour}`}>{n}</b>
      <span className="block text-[13px] font-medium text-slate-800">{title}</span>
      <span className="block text-[12px] text-slate-500">{note}</span>
    </Link>
  );

  return (
    <>
      <Flash searchParams={sp as Record<string, string | undefined>} />
      <section aria-label="Calls in this period" className="panel mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CallRing label="Complete Calls" value={rings.complete} total={rings.total} colour="#2e7d32" note={`${pct(rings.complete)}% of ${rings.total} visits`} href={`/rota/visits?status=COMPLETED&date=${range.from}`} />
        <CallRing label="Late Calls" value={rings.late} total={rings.total} colour="#b26a00" note={`${pct(rings.late)}% ${rings.lateAfterMin} minutes late`} href={`/rota/visits?view=late&date=${range.from}`} />
        <CallRing label="Missed Calls" value={rings.missed} total={rings.total} colour="#b42a23" note={`${pct(rings.missed)}% not clocked into`} />
        <CallRing label="Calls With Missed Meds" value={rings.missedMeds} total={rings.total} colour="#2a6f97" note={rings.missedMeds === null ? "Medication records are switched off" : `${pct(rings.missedMeds)}% with a dose not recorded`} href={rings.missedMeds === null ? undefined : "/rota/exceptions?kind=MISSED_MEDICATION&state=all"} />
      </section>

      <section className="panel" aria-labelledby="missed-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Link href="/rota/monitor" className="btn-secondary">Back</Link>
          <Link href="/rota" className="btn-secondary">Home</Link>
          <h1 id="missed-title" className="order-first w-full text-center text-[22px] font-semibold text-[#6b46c9] sm:order-none sm:w-auto sm:flex-1 sm:text-[24px]">Missed Calls</h1>
          {canExport ? (
            <>
              <a href={exportHref("xlsx")} className="btn-secondary">Export Excel</a>
              <a href={exportHref("pdf")} className="btn-secondary">Export PDF</a>
            </>
          ) : <span className="text-[12.5px] text-slate-500">Exports are for managers</span>}
        </div>
        <p className="mb-3 rounded bg-[#fde8e8] px-3 py-2 text-[13.5px] text-[#8a1f1a]">You are looking at missed calls only. A call is missed when nobody has clocked in {settings.missedAfterMin} minutes after its start time (Rota Settings). Every missed call opens a case to investigate.</p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <nav aria-label="Period" className="inline-flex overflow-hidden rounded-md border border-slate-300">
            {(["day", "week", "month", "custom"] as const).map((p) => (
              <Link key={p} href={href({ period: p, from: undefined, to: undefined })} aria-current={f.period === p ? "page" : undefined} className={`border-r border-slate-300 px-3 py-1.5 text-[13.5px] no-underline last:border-r-0 ${f.period === p ? "bg-[#6b46c9] text-white" : "bg-white text-slate-800 hover:bg-slate-50"}`}>{p[0]!.toUpperCase() + p.slice(1)}</Link>
            ))}
          </nav>
          {f.period !== "custom" ? (
            <>
              <Link href={step(-1)!} className="btn-secondary px-2.5" aria-label="Previous period">‹</Link>
              <b className="text-[15px]">{label}</b>
              <Link href={step(1)!} className="btn-secondary px-2.5" aria-label="Next period">›</Link>
              <Link href={href({ date: undefined })} className="btn-secondary">{f.period === "day" ? "Today" : f.period === "week" ? "This week" : "This month"}</Link>
            </>
          ) : <b className="text-[15px]">{label}</b>}
        </div>

        <section aria-label="Management figures" className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-3 xl:grid-cols-6">
          {kpi(kpis.total, "Total missed calls", `today ${kpis.today} · this week ${kpis.thisWeek} · this month ${kpis.thisMonth}`, href({ smart: undefined, stage: undefined }))}
          {kpi(kpis.repeatOffenders, "Repeat offenders", `care workers, ${settings.repeatOffenderCount}+ in ${settings.repeatWindowDays} days`, href({ smart: "repeat" }), kpis.repeatOffenders ? "text-[#9b231d]" : undefined)}
          {kpi(kpis.highRisk, "High-risk missed visits", "clients rated high risk", href({ smart: "highrisk" }), kpis.highRisk ? "text-[#9b231d]" : undefined)}
          {kpi(kpis.uninvestigated, "Uninvestigated", `no reason recorded yet${kpis.uninvestigatedOverdue ? ` · ${kpis.uninvestigatedOverdue} past deadline` : ""}`, href({ smart: "uninvestigated" }), kpis.uninvestigated ? "text-[#7a5200]" : undefined)}
          {kpi(kpis.resolved, "Resolved", "investigations signed off", href({ stage: "CLOSED", smart: undefined }), "text-[#22682a]")}
          {kpi(kpis.repeatClients, "Repeat service-user incidents", `clients missed ${settings.repeatClientCount}+ times in ${settings.repeatWindowDays} days`, href({ smart: undefined, stage: undefined }))}
        </section>

        <form method="get" aria-label="Filters" className="mb-2 rounded-lg border border-slate-200 bg-white p-3">
          <input type="hidden" name="period" value={f.period} />
          {f.date ? <input type="hidden" name="date" value={f.date} /> : null}
          {f.smart ? <input type="hidden" name="smart" value={f.smart} /> : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <label><span className="label">Search</span><input name="q" type="search" defaultValue={f.q ?? ""} placeholder="Care worker, service user or ref" className="input w-full" /></label>
            <label><span className="label">Care worker</span><select name="carer" defaultValue={f.carer ?? ""} className="input w-full"><option value="">Any</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
            <label><span className="label">Service user</span><select name="su" defaultValue={f.su ?? ""} className="input w-full"><option value="">Any</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label><span className="label">Branch</span><select name="branch" defaultValue={f.branch ?? ""} className="input w-full"><option value="">All my branches</option>{lk.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label><span className="label">Visit status now</span><select name="status" defaultValue={f.status ?? ""} className="input w-full"><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{VISIT_LABEL[s]}</option>)}</select></label>
            <label><span className="label">Visit type</span><select name="call" defaultValue={f.call ?? ""} className="input w-full"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label><span className="label">Reason</span><select name="reason" defaultValue={f.reason ?? ""} className="input w-full"><option value="">Any reason</option><option value="none">Not recorded yet</option>{Object.entries(MISSED_REASONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label><span className="label">Resolution status</span><select name="stage" defaultValue={f.stage === "all" ? "" : f.stage} className="input w-full"><option value="">Any</option><option value="open">Open (not closed)</option><option value="overdue">Past deadline, not investigated</option><option value="escalated">Escalated, still open</option>{Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label><span className="label">Coordinator</span><select name="coordinator" defaultValue={f.coordinator ?? ""} className="input w-full"><option value="">Anyone</option><option value="none">Nobody yet</option>{lk.workers.map((w) => <option key={w.userId} value={w.userId}>{w.name}</option>)}</select></label>
            {f.period === "custom" ? (
              <>
                <label><span className="label">From</span><input type="date" name="from" defaultValue={range.from} className="input w-full" /></label>
                <label><span className="label">To</span><input type="date" name="to" defaultValue={range.to} className="input w-full" /></label>
              </>
            ) : null}
            <div className="flex items-end gap-2">
              <button className="btn-primary">Apply</button>
              <Link href={`/rota/missed?period=${f.period}`} className="btn-secondary">Clear</Link>
            </div>
          </div>
          {f.period !== "custom" ? <p className="mt-2 text-[12.5px] text-slate-500">For a date range, choose <Link href={href({ period: "custom" })}>Custom</Link>.</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-slate-600">Smart filters:</span>
            {smart("repeat", "Repeat offenders", kpis.repeatOffenders)}
            {smart("highrisk", "High-risk service users", kpis.highRisk)}
            {smart("uninvestigated", "Uninvestigated", kpis.uninvestigated)}
          </div>
        </form>

        <form action={missedBulkAction}>
          <input type="hidden" name="back" value={back} />
          {canWork ? (
            <details className="mb-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <summary className="cursor-pointer text-[14px] font-medium">Bulk Actions <span className="font-normal text-slate-500">(tick missed calls in the list first)</span></summary>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr_1fr_auto] md:items-end">
                <label><span className="label">Action</span><select name="bulk" className="input w-full" required defaultValue=""><option value="" disabled>Choose…</option><option value="assign">Assign coordinator</option><option value="escalate">Escalate to the care managers</option></select></label>
                <label><span className="label">Coordinator (assign)</span><select name="coordinatorId" className="input w-full" defaultValue=""><option value="">Choose…</option>{lk.workers.map((w) => <option key={w.userId} value={w.userId}>{w.name}</option>)}</select></label>
                <label><span className="label">Why a manager is needed (escalate)</span><input name="note" className="input w-full" /></label>
                <button className="btn-primary">Apply to ticked</button>
              </div>
              {canExport ? <p className="mt-2 text-[12.5px] text-slate-600">To export only the ticked calls, use <button formAction={`/api/rota/missed/export`} formMethod="get" name="format" value="xlsx" className="text-[#1d5f9e] underline">Excel</button> or <button formAction={`/api/rota/missed/export`} formMethod="get" name="format" value="pdf" className="text-[#1d5f9e] underline">PDF</button> for the ticked rows.</p> : null}
            </details>
          ) : null}
          {canExport ? Object.entries(keep).map(([k, v]) => (v && k !== "back" ? <input key={k} type="hidden" name={k} value={v} /> : null)) : null}

          <p className="mb-1 text-right text-[13px] text-slate-600">{rows.length} {rows.length === 1 ? "call" : "calls"} · {hours.toFixed(2)} scheduled hours</p>
          {rows.length ? (
            <>
              <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
                <table className="w-full bg-white text-[13.5px]">
                  <thead className="bg-slate-50 text-left text-[12.5px] text-slate-600">
                    <tr>
                      {canWork ? <th className="px-2 py-2"><span className="sr-only">Select</span></th> : null}
                      <th className="px-2 py-2">Ref</th><th className="px-2 py-2">Care worker</th><th className="px-2 py-2">Service user</th><th className="px-2 py-2">Branch</th><th className="px-2 py-2">Scheduled</th><th className="px-2 py-2">Visit type</th><th className="px-2 py-2">Reason</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Coordinator</th><th className="px-2 py-2">Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`border-t border-slate-100 align-top ${r.stage === "CLOSED" ? "" : "[&>td]:bg-[#fdf1f1]"}`}>
                        {canWork ? <td className="px-2 py-2"><input type="checkbox" name="ids" value={r.id} className="h-4 w-4" aria-label={`Select ${r.visit.reference}`} /></td> : null}
                        <td className="px-2 py-2"><Link href={`/rota/missed/${r.id}`} className="font-medium">{r.visit.reference}</Link><span className="block text-[12px] text-slate-500">{fmtLondonDate(londonDate(r.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}</span></td>
                        <td className="px-2 py-2">{r.staffId ? <Link href={`/rota/staff/${r.staffId}#missed`}>{r.carerName}</Link> : <span className="text-slate-500">Unassigned</span>}{r.repeatCount >= settings.repeatOffenderCount ? <span className="ml-1"><Badge tone="rose" title={`${r.repeatCount} missed calls in ${settings.repeatWindowDays} days`}>Repeat · {r.repeatCount}</Badge></span> : null}</td>
                        <td className="px-2 py-2"><Link href={`/rota/service-users/${r.serviceUserId}?tab=missed`}>{r.serviceUserName}</Link>{r.highRisk ? <span className="ml-1"><Badge tone="rose">High risk</Badge></span> : null}{r.clientRepeatCount >= settings.repeatClientCount ? <span className="ml-1"><Badge tone="amber" title={`${r.clientRepeatCount} missed calls in ${settings.repeatWindowDays} days`}>{r.clientRepeatCount} in {settings.repeatWindowDays} days</Badge></span> : null}</td>
                        <td className="px-2 py-2">{r.visit.area ? `${r.visit.area.branch?.name ?? r.visit.area.name}` : "—"}<span className="block text-[12px] text-slate-500">{r.visit.area?.branch ? r.visit.area.name : ""}</span></td>
                        <td className="px-2 py-2 whitespace-nowrap">{londonTime(r.visit.scheduledStart)}–{londonTime(r.visit.scheduledEnd)}{r.visit.status !== "MISSED" ? <span className="block text-[12px] text-slate-500">now {VISIT_LABEL[r.visit.status].toLowerCase()}</span> : null}</td>
                        <td className="px-2 py-2">{r.visit.callType.name}</td>
                        <td className="px-2 py-2">{r.reasonCode ? reasonLabel(r.reasonCode) : <Badge tone="slate">Not recorded</Badge>}</td>
                        <td className="px-2 py-2"><Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>{r.escalatedAt && r.stage !== "CLOSED" ? <span className="ml-1"><Badge tone="violet">Escalated</Badge></span> : null}</td>
                        <td className="px-2 py-2">{r.coordinatorName ?? <span className="text-slate-500">Nobody yet</span>}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.stage === "CLOSED" ? "—" : r.deadline ? `${londonTime(r.deadline)}${londonDate(r.deadline) !== reg.today ? ` ${fmtLondonDate(londonDate(r.deadline), { day: "numeric", month: "short" })}` : ""}` : "—"}{r.overdue ? <span className="ml-1"><Badge tone="rose">Overdue</Badge></span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-2 md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className={`rounded-lg border p-3 ${r.stage === "CLOSED" ? "border-slate-200 bg-white" : "border-[#f1d4d2] bg-[#fdf1f1]"}`}>
                    <div className="flex items-center justify-between gap-2 text-[12.5px] text-slate-600">
                      <span className="flex items-center gap-2">{canWork ? <input type="checkbox" name="ids" value={r.id} className="h-4 w-4" aria-label={`Select ${r.visit.reference}`} /> : null}{fmtLondonDate(londonDate(r.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} · {londonTime(r.scheduledStart)}</span>
                      <Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}{r.overdue ? " · overdue" : ""}</Badge>
                    </div>
                    <Link href={`/rota/missed/${r.id}`} className="mt-1 block text-[15px] font-semibold">{r.serviceUserName}</Link>
                    {r.highRisk ? <Badge tone="rose">High risk</Badge> : null}
                    <p className="text-[13.5px]">{r.carerName ?? "Unassigned"}{r.repeatCount >= settings.repeatOffenderCount ? ` · repeat ${r.repeatCount}` : ""} · {r.visit.callType.name} · {r.visit.area?.name ?? "No area"}</p>
                    <p className="text-[12.5px] text-slate-600">{reasonLabel(r.reasonCode) ?? "Reason not recorded"} · {r.coordinatorName ?? "no coordinator"}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : <div className="rounded-lg border border-slate-200 bg-white"><Empty>{kpis.total ? "No missed calls match these filters." : "No missed calls in this period."}</Empty></div>}
        </form>
        <p className="mt-2 text-[12.5px] text-slate-500">Rows stay pale red until the case is closed; the status is always written out too. A row opens its case. Repeat counts look back {settings.repeatWindowDays} days from {fmtLondonDate(reg.repeatWindow.to)} and leave out calls the investigation found were delivered or were not the care worker&apos;s doing.</p>
      </section>
    </>
  );
}

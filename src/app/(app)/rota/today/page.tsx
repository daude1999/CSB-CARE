import { redirect } from "next/navigation";
import { uninvestigatedCount } from "@/server/rota/missed-calls";
import { CaretLeft, CaretRight, Check, Clock, FirstAidKit, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { addDays, fmtLondonDate, isIsoDate, londonDate } from "@/lib/london";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaDashboard } from "@/server/rota/dashboard";
import { rotaLookups } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { SearchTable } from "@/components/search-table";
import { NotBuiltNotice, longDate } from "@/components/rota-ui";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(2)}%` : "0.00%");

function CallBox({ href, colour, icon, label, value, note }: { href: string | null; colour: string; icon: React.ReactNode; label: string; value: React.ReactNode; note: string }) {
  const body = (
    <>
      <span className="flex w-[84px] shrink-0 items-center justify-center bg-black/15" aria-hidden>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="px-3 pt-2 text-[13px] font-semibold uppercase tracking-wide">{label}</span>
        <span className="px-3 text-[26px] font-semibold leading-tight tabular-nums">{value}</span>
        <span className="mt-auto truncate border-t border-white/40 px-3 py-1.5 text-[13px]">{note}</span>
      </span>
    </>
  );
  const cls = "flex min-h-[96px] overflow-hidden rounded text-white no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  return href ? <Link href={href} className={`${cls} hover:brightness-110`} style={{ background: colour }}>{body}</Link> : <div className={cls} style={{ background: colour }}>{body}</div>;
}

/** One figure in the call-status strip; links to the visits it counts. */
function Status({ href, label, value, alert }: { href: string; label: string; value: number; alert?: boolean }) {
  return (
    <li className="min-w-0">
      <Link href={href} className="flex h-full flex-col rounded px-3 py-2 no-underline hover:bg-slate-50" data-testid={`status-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
        <span className={`text-[22px] font-semibold leading-tight tabular-nums ${alert && value ? "text-[#a3242c]" : "text-navy-900"}`}>{value}</span>
        <span className="text-[13px] text-slate-600">{label}</span>
      </Link>
    </li>
  );
}

function Widget({ title, accent, actions, children }: { title: string; accent: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel min-w-0 border-t-[3px]" style={{ borderTopColor: accent }} aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[18px]">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Counter({ href, label, value, note }: { href: string; label: string; value: number; note: string }) {
  return (
    <Link href={href} className="panel flex items-center gap-4 no-underline hover:bg-slate-50">
      <span className={`min-w-[48px] text-center text-[28px] font-semibold tabular-nums ${value ? "text-[#a3242c]" : "text-navy-900"}`}>{value}</span>
      <span className="flex flex-col"><span className="text-[15px] font-semibold text-navy-900">{label}</span><span className="text-[12.5px] text-slate-600">{note}</span></span>
    </Link>
  );
}

export default async function TodayAtAGlance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view")) redirect(rotaHome(ctx));
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const [d, lk, uninvestigated] = await Promise.all([rotaDashboard(ctx, { date, areaId: sp.area || undefined }), rotaLookups(ctx), uninvestigatedCount(ctx)]);
  const q = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ date, area: sp.area, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const c = d.calls;
  const iconProps = { size: 40, weight: "bold" as const };

  return (
    <>
      <PageHeader title="Today at a Glance" back="/rota" subtitle="Everything on this page is for the date shown. Each figure opens the visits behind it." />
      <Flash searchParams={sp} />

      <section aria-label="Date" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex-1 text-center text-[30px] font-normal leading-tight text-[#2f6b3a]">{longDate(date)}</h2>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <Link href={`/rota/today?${q({ date: addDays(date, -1) })}`} className="btn-secondary px-2.5" aria-label="Previous day"><CaretLeft size={18} weight="bold" /></Link>
          <label className="sr-only" htmlFor="dash-date">Date</label>
          <input id="dash-date" type="date" name="date" defaultValue={date} className="input w-[160px]" />
          <Link href={`/rota/today?${q({ date: addDays(date, 1) })}`} className="btn-secondary px-2.5" aria-label="Next day"><CaretRight size={18} weight="bold" /></Link>
          <label className="sr-only" htmlFor="dash-area">Area</label>
          <select id="dash-area" name="area" defaultValue={sp.area ?? ""} className="input w-[170px]">
            <option value="">{lk.scope.areaIds ? "All my areas" : "All areas"}</option>
            {lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn-primary">Go</button>
          {date !== d.today ? <Link href={`/rota/today?${q({ date: undefined })}`} className="text-[14px]">Today</Link> : null}
        </form>
      </section>

      {d.notBuilt ? <NotBuiltNotice date={date} canBuild={hasOrgPermission(ctx, "rota.build")} /> : null}
      {date === d.today ? <AutoRefresh seconds={60} /> : null}

      <section aria-label="Calls on this date" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CallBox href={`/rota/visits?${q({ status: "COMPLETED" })}`} colour="#13703c" icon={<Check {...iconProps} />} label="Complete calls" value={c.complete} note={`${pct(c.complete, c.total)} of ${c.total} visits`} />
        <CallBox href={`/rota/visits?${q({ view: "late" })}`} colour="#a85b0a" icon={<Clock {...iconProps} />} label="Late calls" value={c.late} note={`${pct(c.late, c.total)} · ${c.lateAfterMin} minutes or more late`} />
        <CallBox href={`/rota/missed?period=day&date=${date}`} colour="#b42a23" icon={<X {...iconProps} />} label="Missed calls" value={c.missed} note={`${pct(c.missed, c.total)} not clocked into${uninvestigated ? ` · ${uninvestigated} uninvestigated` : ""}`} />
        {d.calls.missedMeds === null ? (
          <CallBox href={null} colour="#4b5a6b" icon={<FirstAidKit {...iconProps} />} label="Calls with missed meds" value={<span className="text-[17px] font-medium">Switched off</span>} note="Medication records are switched off in Rota Settings" />
        ) : (
          <CallBox href="/rota/exceptions?kind=MISSED_MEDICATION&state=all" colour="#4b5a6b" icon={<FirstAidKit {...iconProps} />} label="Calls with missed meds" value={d.calls.missedMeds} note={`${pct(d.calls.missedMeds, c.total)} with a dose not recorded`} />
        )}
      </section>

      <section aria-label="Call status" className="panel mb-4 p-1">
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8">
          <Status href={`/rota/visits?${q({})}`} label="Scheduled visits" value={c.total} />
          <Status href={`/rota/visits?${q({ status: "SCHEDULED" })}`} label="Still to start" value={c.due} />
          <Status href={`/rota/visits?${q({ status: "IN_PROGRESS" })}`} label="In progress" value={c.inProgress} />
          <Status href={`/rota/visits?${q({ status: "CANCELLED", cancelled: "1" })}`} label="Cancelled" value={c.cancelled} />
          <Status href={`/rota/visits?${q({ view: "unassigned" })}`} label="Unassigned" value={c.unassigned} alert />
          <Status href="/rota/unassigned" label="Double-ups short of a carer" value={c.partDoubleUps} alert />
          <Status href={`/rota/advanced?${q({ view: "staff-day" })}`} label="Staff on duty" value={c.staffOnDuty} />
          {d.exceptions ? <Status href="/rota/exceptions" label={d.exceptions.overdue ? `Open exceptions (${d.exceptions.overdue} overdue)` : "Open exceptions"} value={d.exceptions.open} alert /> : null}
        </ul>
      </section>

      <section aria-label="People and reminders" className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Widget title="All Service Users" accent="#1aa3c9">
          {d.canPeople ? (
            <SearchTable
              label="service users"
              columns={["Actions", "Forename", "Surname", "Area", "Postcode"]}
              empty="No service users yet."
              rows={d.serviceUsers.map((s) => ({
                key: s.id,
                text: `${s.preferredName ?? s.firstName} ${s.lastName} ${s.postcode ?? ""} ${s.area?.name ?? ""}`,
                cells: [
                  <span key="a" className="flex gap-2 whitespace-nowrap"><Link href={`/rota/visits?date=${date}&su=${s.id}`}>Rota</Link><Link href={`/rota/templates?su=${s.id}`}>Template</Link><Link href={`/rota/service-users/${s.id}`}>Info</Link></span>,
                  s.preferredName ?? s.firstName,
                  s.lastName,
                  s.area?.name ?? "No area",
                  s.postcode ?? "—",
                ],
              }))}
            />
          ) : <p className="text-[14px] text-slate-600">You do not have access to service-user records.</p>}
        </Widget>

        <Widget title="All Team Members" accent="#7b61c9" actions={<Link href="/rota/staff" className="btn-secondary py-1 text-[13.5px]">Staff & eligibility</Link>}>
          {d.canStaff ? (
            <SearchTable
              label="team members"
              columns={["Actions", "Name", "Role", "Status", "App sign-in"]}
              empty="No team members yet."
              rows={d.team.map((s) => ({
                key: s.id,
                text: `${s.displayName} ${s.jobTitle}`,
                cells: [
                  <span key="a" className="flex gap-2 whitespace-nowrap"><Link href={`/rota/advanced?${new URLSearchParams({ date, view: "staff-week", carer: s.id })}`}>Rota</Link><Link href={`/rota/staff/${s.id}`}>Info</Link></span>,
                  s.displayName,
                  s.jobTitle,
                  s.employmentStatus === "ACTIVE" ? "Active" : "Onboarding",
                  s.userId ? "Linked" : <span key="l" className="text-[#8a5a00]">Not linked</span>,
                ],
              }))}
            />
          ) : <p className="text-[14px] text-slate-600">You do not have access to the staff directory.</p>}
        </Widget>

        <Widget title="All Active Reminders" accent="#d9473f" actions={<span className="text-[12.5px] text-slate-500">Due within 14 days, most urgent first</span>}>
          <SearchTable
            label="reminders"
            columns={["Reminder", "Due", "Account", "Type", "Overdue"]}
            empty="Nothing due in the next 14 days."
            rows={d.reminders.map((r, n) => ({
              key: `${n}`,
              text: `${r.text} ${r.account} ${r.type}`,
              cells: [<Link key="r" href={r.href}>{r.text}</Link>, fmtLondonDate(r.due, { day: "numeric", month: "short", year: "numeric" }), r.account, r.type, r.overdueDays ? <span key="o" className="font-medium text-[#a3242c]">{r.overdueDays} days</span> : "—"],
            }))}
          />
        </Widget>
      </section>

      <section aria-label="Counters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Counter href={`/rota/visits?${q({ view: "review" })}`} label="Rota Conflicts" value={d.counters.rotaConflicts} note="Visits on this date with an allocation to review" />
        <Counter href="/rota/templates/planner" label="Template Conflicts" value={d.counters.templateConflicts} note="Template slots with no carer, or a carer who has left" />
        <Counter href="/workforce/absences" label="Holidays Due" value={d.counters.holidaysDue} note="Approved absences starting in the next 14 days" />
        <Counter href={`/rota/notes?from=${date}&to=${date}`} label="Visit Notes" value={d.counters.notes} note="Notes carers wrote on this date" />
      </section>
    </>
  );
}

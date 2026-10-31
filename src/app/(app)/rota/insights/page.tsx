import type { ReactNode } from "react";
import Link from "@/components/link";
import { addDays, fmtLondonDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { pounds } from "@/server/finance/pricing";
import type { EstimateTotals } from "@/server/finance/estimates";
import { rotaInsights, type Breakdown } from "@/server/rota/insights";
import { rotaLookups } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { Stepper } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const ISSUE = { NO_FUNDER: "Visits with no funded package", NO_CHARGE_RATE: "Funders with no charge rate on the date", NO_PAY_RATE: "Carers or open slots with no pay rate", NO_BAND: "Rate cards with no band for the visit time" } as const;

/** One figure: label, value, optional link to the matching records, optional note. */
function Row({ label, value, href, note, tone }: { label: string; value: ReactNode; href?: string; note?: ReactNode; tone?: "warn" | "bad" }) {
  const v = <span className={`tabular-nums ${tone === "bad" ? "text-[#a3242c]" : tone === "warn" ? "text-[#8a5a00]" : "text-navy-900"}`}>{value}</span>;
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 py-2 first:border-t-0">
      <dt className="text-[14px] text-slate-700">{label}{note ? <span className="block text-[12.5px] text-slate-500">{note}</span> : null}</dt>
      <dd className="text-right text-[15px] font-medium">{href ? <Link href={href} className="no-underline hover:underline">{v}</Link> : v}</dd>
    </div>
  );
}

function Panel({ title, id, children, className = "" }: { title: string; id: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`panel ${className}`}>
      <h2 id={id} className="mb-1 text-[16px] font-medium text-navy-900">{title}</h2>
      {children}
    </section>
  );
}

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
const money = (p: number | null) => (p === null ? "—" : pounds(p));

function MarginTable({ caption, rows }: { caption: string; rows: Breakdown[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[640px] text-[13.5px]">
        <caption className="pb-1 text-left text-[14px] font-medium text-navy-900">{caption}</caption>
        <thead><tr><th scope="col">Name</th><th scope="col" className="!text-right">Visits</th><th scope="col" className="!text-right">Care hours</th><th scope="col" className="!text-right">Est. revenue</th><th scope="col" className="!text-right">Est. cost</th><th scope="col" className="!text-right">Est. margin</th><th scope="col" className="!text-right">Not priced</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="font-normal">{r.label}</th>
              <td className="text-right tabular-nums">{r.t.visits}</td>
              <td className="text-right tabular-nums">{(r.t.minutes / 60).toFixed(1)}</td>
              <td className="text-right tabular-nums">{pounds(r.t.pricedRevenuePence)}</td>
              <td className="text-right tabular-nums">{pounds(r.t.pricedCostPence)}</td>
              <td className={`text-right tabular-nums ${r.t.marginPence < 0 ? "text-[#a3242c]" : ""}`}>{pounds(r.t.marginPence)} <span className="text-slate-500">{pct(r.t.marginPercent)}</span></td>
              <td className="text-right tabular-nums">{r.t.visits - r.t.pricedVisits || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function marginNote(t: EstimateTotals) {
  return `${t.pricedVisits} of ${t.visits} visits have both a charge and a pay rate; the margin uses only those.`;
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const [r, lk] = await Promise.all([rotaInsights(ctx, { week: sp.week, areaId: sp.area }), rotaLookups(ctx)]);
  const v = r.visits;
  const w = r.workforce;
  const f = r.finance;
  const keep = { area: sp.area };
  const unassignedHref = `/rota/unassigned?from=${r.week > r.today ? r.week : r.today}&days=7${sp.area ? `&area=${sp.area}` : ""}`;
  const weekHref = `/rota/planner?week=${r.week}${sp.area ? `&area=${sp.area}` : ""}`;

  return (
    <>
      <PageHeader
        title="Rota Insights"
        back="/rota"
        subtitle="The week's visits, workforce, care hours and money, worked out from the rota as it stands. Every figure links to the records behind it. Money figures are estimates from your rate cards, not payroll or invoices."
      />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3 flex flex-wrap items-end gap-3">
        <Stepper base="/rota/insights" params={keep} param="week" prev={addDays(r.week, -7)} next={addDays(r.week, 7)} label={`w/c ${fmtLondonDate(r.week, { day: "numeric", month: "short", year: "numeric" })}`} />
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="week" value={r.week} />
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className="btn-secondary">Show</button>
        </form>
        <p className="ml-auto text-[12.5px] text-slate-500">Worked out at {new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}. Reload for the latest.{r.truncated ? " Only the first 6,000 visits are counted." : ""}</p>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Visits" id="ins-visits">
          <dl>
            <Row label="Scheduled visits" value={v.scheduled} href={weekHref} note={`${v.cancelled} cancelled, not counted`} />
            <Row label="Fully allocated" value={`${v.allocated} · ${pct(v.completionPercent)}`} href={weekHref} note="Rota completion: visits with every carer slot filled" />
            <Row label="Unallocated" value={v.unallocated} href={unassignedHref} tone={v.unallocated ? "bad" : undefined} />
            <Row label="Double-ups with one carer" value={v.partDoubleUps} href={unassignedHref} tone={v.partDoubleUps ? "warn" : undefined} />
            <Row label="Completed" value={v.completed} />
            <Row label="In progress" value={v.inProgress} href="/rota/monitor" />
            <Row label="Still to come" value={v.due} />
            <Row label="Late" value={v.late} href="/rota/monitor" tone={v.late ? "warn" : undefined} />
            <Row label="Missed" value={v.missed} href="/rota/missed" tone={v.missed ? "bad" : undefined} />
            <Row label="Not delivered" value={v.notDelivered} />
          </dl>
        </Panel>

        <Panel title="Workforce" id="ins-workforce">
          <dl>
            <Row label="Active carers and staff" value={w.active} href="/rota/staff" />
            <Row label="Available today" value={w.availableToday} note="Active and not on approved leave or sick today" />
            <Row label="Booked today" value={w.allocatedToday} href={`/rota/visits?date=${r.today}`} />
            <Row label="On approved leave today" value={w.onLeaveToday} href="/rota/cover" />
            <Row label="Off sick today" value={w.sickToday} href="/rota/cover" tone={w.sickToday ? "warn" : undefined} />
            <Row label="Absences starting in the next 14 days" value={w.upcomingAbsences} href="/rota/cover" note="Approved and requested" />
            <Row label="Open carer slots this week" value={w.shortage} href={unassignedHref} tone={w.shortage ? "bad" : undefined} note="Staffing shortage" />
            <Row label="Bookings allowed with warnings" value={w.reviewBookings} note="Readiness or other warnings a coordinator accepted" tone={w.reviewBookings ? "warn" : undefined} />
            <Row label="Hours booked this week" value={`${w.weekAllocatedHours} h`} />
            <Row label="Utilisation against weekly limits" value={w.utilisationPercent === null ? "No limits set" : `${pct(w.utilisationPercent)} of ${w.capacityHours} h`} note={`${w.carersWithLimit} carers have a weekly limit in their rota profile`} />
            <Row label="Over their weekly limit" value={w.overtime.length} tone={w.overtime.length ? "bad" : undefined} note={w.overtime.length ? w.overtime.slice(0, 4).map((o) => `${o.name} ${o.hours} of ${o.limit} h`).join(" · ") + (w.overtime.length > 4 ? " …" : "") : "Potential overtime"} />
          </dl>
        </Panel>

        <Panel title="Care hours" id="ins-hours">
          <dl>
            <Row label="Scheduled care hours" value={`${r.hours.scheduledCare} h`} note="Visit length, once per visit" />
            <Row label="Scheduled carer hours" value={`${r.hours.scheduledCarer} h`} note="Double-ups count twice" />
            <Row label="Completed care hours" value={`${r.hours.completedCare} h`} note="Clocked time where recorded, otherwise planned" />
          </dl>
        </Panel>

        <Panel title="Needs action" id="ins-ops">
          <dl>
            <Row label="Open exceptions" value={r.operational.exceptions ? `${r.operational.exceptions.open}${r.operational.exceptions.overdue ? ` · ${r.operational.exceptions.overdue} overdue` : ""}` : "—"} href="/rota/exceptions" tone={r.operational.exceptions?.overdue ? "bad" : undefined} />
            <Row label="Uncovered visits still to come" value={r.operational.upcomingOpen} href={unassignedHref} tone={r.operational.upcomingOpen ? "bad" : undefined} />
            <Row label="Visits flagged after an HR or absence change" value={r.operational.review} href="/rota/cover" tone={r.operational.review ? "warn" : undefined} />
            <Row label="Changes waiting to be published" value={r.operational.unpublished} href="/rota/build" tone={r.operational.unpublished ? "warn" : undefined} note="Draft visits carers cannot see yet" />
            <Row label="Fill open slots" value="Generate & Optimise" href={`/rota/optimise?from=${r.week > r.today ? r.week : r.today}`} />
          </dl>
        </Panel>
      </div>

      {f ? (
        <Panel title="Money this week (estimate)" id="ins-money" className="mt-3">
          <p className="mb-2 text-[13px] text-slate-600">
            Priced from your rate cards: charge from each person&rsquo;s funded package, pay from each carer&rsquo;s pay card (open slots at the default card){f.onCostPercent ? `, plus ${f.onCostPercent}% employer on-costs` : ", with no employer on-costs added"} (<Link href="/rota/finance/rates?tab=settings" className="underline">change</Link>). Planned times are used. These are projections, not payroll or invoices.
          </p>
          <div className="grid gap-x-8 lg:grid-cols-2">
            <dl>
              <Row label="Estimated revenue" value={money(f.total.revenuePence)} note={f.total.missingRevenue ? `${f.total.missingRevenue} visits could not be priced` : undefined} />
              <Row label="Estimated staffing cost" value={money(f.total.costPence)} note={f.total.openSlotsPriced ? `Includes ${f.total.openSlotsPriced} open slots at the default pay rate` : undefined} />
              <Row label="Estimated gross margin" value={`${money(f.total.marginPence)} · ${pct(f.total.marginPercent)}`} note={marginNote(f.total)} tone={f.total.marginPence < 0 ? "bad" : undefined} />
            </dl>
            <dl>
              <Row label="Cost per visit" value={money(f.costPerVisitPence)} />
              <Row label="Cost per care hour" value={money(f.costPerCareHourPence)} />
              <Row label="Revenue per care hour" value={money(f.revenuePerCareHourPence)} />
            </dl>
          </div>
          {f.issues.length ? (
            <div className="mt-2 rounded-[3px] border-l-4 border-[#e2b65b] bg-[#fdf6e7] px-3 py-2 text-[13.5px]">
              <p className="font-medium text-[#8a5a00]">Missing rates and finance exceptions</p>
              <ul className="mt-1 list-disc pl-5">{f.issues.map((i) => <li key={i.kind}><Link href="/rota/finance/rates" className="underline">{ISSUE[i.kind as keyof typeof ISSUE] ?? i.kind}</Link>: {i.count} visit{i.count === 1 ? "" : "s"}</li>)}</ul>
            </div>
          ) : null}
          <div className="mt-3 space-y-4">
            <MarginTable caption="By branch" rows={f.byBranch} />
            <MarginTable caption="By funder (commissioner or private)" rows={f.byFunder} />
            <MarginTable caption="Lowest margin by service user" rows={f.lowestByServiceUser} />
          </div>
          <p className="mt-3 text-[13px] text-slate-600">
            <strong className="font-medium">Verified figures</strong>, kept separate: {f.verified.invoiceRuns ? `${f.verified.invoiceRuns} approved invoice run${f.verified.invoiceRuns === 1 ? "" : "s"} for this week, ${pounds(f.verified.invoiceRunsPence)}` : "no approved invoice run for this week"}; {f.verified.payRuns ? `${f.verified.payRuns} approved pay run${f.verified.payRuns === 1 ? "" : "s"}, ${pounds(f.verified.payRunsPence)}` : "no approved pay run"}. <Link href="/rota/finance" className="underline">Finance</Link>
          </p>
        </Panel>
      ) : (
        <p className="mt-3 text-[13px] text-slate-600">Cost, revenue and margin estimates are shown to roles that can see finance.</p>
      )}
    </>
  );
}

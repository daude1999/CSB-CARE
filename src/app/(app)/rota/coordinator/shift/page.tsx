import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { shiftCheck } from "@/server/care/coordinator/shift";
import { addDays, fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const PRIORITY_TONE = { URGENT: "rose", HIGH: "amber", NORMAL: "slate" } as const;
const STATE_LABEL: Record<string, string> = { ELIGIBLE: "Suitable", REQUIRES_REVIEW: "Check first", NOT_ELIGIBLE: "Not allowed" };

/**
 * The whole-shift check for a day (tomorrow by default): open places with suggested carers, double bookings and tight
 * travel, carers whose booking the rules now question, approvals that block care, and a handover to print. It reads
 * the rota and changes nothing: the office assigns and publishes on the Daily Rota.
 */
export default async function ShiftCheckPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.edit");
  const s = await orNotFound(shiftCheck(ctx, sp.date));
  const today = londonDate();
  const visitHref = (id: string) => `/rota/visits?date=${s.date}&visit=${id}`;
  return (
    <>
      <PageHeader
        tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
        title={`Shift check · ${fmtLondonDate(s.date)}`}
        back="/rota/coordinator"
        subtitle="Reads the rota for the day and lists what needs a person before the shift. It does not assign, publish or message anyone. Statements marked Fact come from the records; Recommendation is a suggestion for the office to decide."
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          <form method="get" className="flex items-center gap-2"><label htmlFor="d" className="sr-only">Day to check</label><input id="d" type="date" name="date" defaultValue={s.date} min={addDays(today, -7)} max={addDays(today, 60)} className="input w-auto" /><button className="btn-secondary">Check</button></form>
          <PrintButton className="btn-secondary">Print handover</PrintButton>
        </div>}
      />
      <Flash searchParams={sp} />
      <p className="mb-3 px-1 text-[14px] text-slate-700">{s.visits} visit{s.visits === 1 ? "" : "s"} on the rota, {s.staffed} fully staffed, {s.open.length} with an open place. Checked {fmtDate(s.generatedAt, true)}.</p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <Card title={`Open places (${s.open.length})`}>
            {s.open.length ? (
              <table className="table">
                <thead><tr><th scope="col">Visit</th><th scope="col">Person</th><th scope="col">Priority</th><th scope="col">Suggested carers (regular carers first among equals)</th></tr></thead>
                <tbody>
                  {s.open.map((o) => (
                    <tr key={o.visitId}>
                      <td><Link href={visitHref(o.visitId)}>{o.time}</Link><span className="block text-[13px] text-slate-600">{o.callType} · {o.missing} needed{o.published ? "" : " · not published"}</span></td>
                      <td><Link href={`/rota/service-users/${o.serviceUserId}`}>{o.person}</Link></td>
                      <td><Badge tone={PRIORITY_TONE[o.priority as keyof typeof PRIORITY_TONE] ?? "slate"}>{o.priority.toLowerCase()}</Badge><span className="block text-[12.5px] text-slate-600">{o.why}</span></td>
                      <td>{o.options.length ? <ul className="space-y-1">{o.options.map((c) => <li key={c.staffId}><span className="font-medium">{c.name}</span> <span className="text-[13px] text-slate-600">{STATE_LABEL[c.state] ?? c.state}{c.continuity ? " · already visits" : ""}{c.notes.length ? ` · ${c.notes.join("; ")}` : ""}</span></li>)}</ul> : <span className="text-[13.5px] text-slate-600">Nobody suitable is free. Try Find Replacement Cover.</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>Every visit has its carers.</Empty>}
          </Card>
          <Card title={`Double bookings and travel (${s.clashes.length})`}>
            {s.clashes.length ? (
              <ul className="rows text-[14px]">{s.clashes.map((c, i) => <li key={i} className="py-2"><Badge tone={c.kind === "OVERLAP" ? "rose" : "amber"}>{c.kind === "OVERLAP" ? "Double booked" : "Tight travel"}</Badge> {c.text} {c.visitIds.map((v, n) => <Link key={v} href={visitHref(v)} className="ml-1 print:hidden">Visit {n + 1}</Link>)}</li>)}</ul>
            ) : <Empty>No carer is booked twice or left without travel time.</Empty>}
          </Card>
          <Card title={`Bookings the rules question (${s.compliance.length})`}>
            {s.compliance.length ? (
              <ul className="rows text-[14px]">{s.compliance.map((c, i) => <li key={i} className="py-2"><span className="font-medium">{c.name}</span> on <Link href={visitHref(c.visitId)}>{c.reference}</Link> for {c.person}: <span className="text-slate-700">{STATE_LABEL[c.state] ?? c.state}. {c.reasons.join("; ")}</span></li>)}</ul>
            ) : <Empty>Every booked carer still passes the checks (training, DBS, right to work, absence, availability, restrictions).</Empty>}
          </Card>
        </div>
        <aside className="space-y-3">
          <Card title="Needs action first">
            {s.urgent.length ? <ul className="space-y-2 text-[14px]">{s.urgent.map((u, i) => <li key={i}><Badge tone={u.kind === "FACT" ? "slate" : "teal"}>{u.kind === "FACT" ? "Fact" : "Recommendation"}</Badge> {u.href ? <Link href={u.href}>{u.text}</Link> : u.text}</li>)}</ul> : <Empty>Nothing urgent.</Empty>}
          </Card>
          <Card title="Handover">
            {s.handover.length ? <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">{s.handover.map((h, i) => <li key={i}><span className="text-[12px] uppercase tracking-wide text-slate-500">{h.kind === "FACT" ? "Fact" : "Recommendation"}</span> {h.text}</li>)}</ol> : <Empty>Nothing to hand over.</Empty>}
            <p className="mt-2 text-[12.5px] text-slate-600">Generated from the rota at {londonTime(s.generatedAt)}. Written by the system, not by a person.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

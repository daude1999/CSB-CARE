import Link from "@/components/link";
import { addDays, isIsoDate, londonDate, londonDayBounds, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { listVisitNotes, NOTE_LABEL } from "@/server/care/visit-record";
import { suName } from "@/server/rota/queries";
import { Badge, Card, Empty, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Visit Notes: what carers and the office wrote on visits, by the day it was written. Notes are permanent. */
export default async function VisitNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  const today = londonDate();
  const from = sp.from && isIsoDate(sp.from) ? sp.from : addDays(today, -6);
  const to = sp.to && isIsoDate(sp.to) && sp.to >= from ? sp.to : from > today ? from : today;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const notes = await listVisitNotes(ctx, { from: londonDayBounds(from).start, to: londonDayBounds(to).end, category: sp.category, q });

  return (
    <>
      <PageHeader title="Visit Notes" back="/rota" subtitle="Notes written on visits by carers and the office, newest first. Notes cannot be edited or deleted; concerns also appear on the Exceptions register." actions={<Link href="/rota/exceptions" className="btn-secondary">Exceptions</Link>} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
          <label><span className="label">Kind</span><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Any</option>{Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label><span className="label">Contains</span><input name="q" defaultValue={q ?? ""} className="input" /></label>
          <button className="btn-primary">Apply</button>
          <Link href="/rota/notes" className="btn-secondary">Clear</Link>
        </form>
      </section>
      <Card>
        {notes.length ? (
          <ul className="rows">
            {notes.map((n) => (
              <li key={n.id} className="py-3 text-[14.5px]">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                  <Badge tone={n.category === "CONCERN" ? "rose" : n.category === "HANDOVER" ? "violet" : "slate"}>{NOTE_LABEL[n.category] ?? n.category}</Badge>
                  <Link href={`/rota/visits/${n.visit.id}`} className="row-title">{suName(n.visit.serviceUser)} · {fmtDate(n.visit.scheduledStart)} {londonTime(n.visit.scheduledStart)}</Link>
                  {n.visit.area ? <span>{n.visit.area.name}</span> : null}
                  <span className="ml-auto">written {fmtDate(n.createdAt, true)}</span>
                </div>
                <p className="mt-1 whitespace-pre-line">{n.text}</p>
              </li>
            ))}
          </ul>
        ) : <Empty>No notes written in these dates.</Empty>}
        {notes.length === 500 ? <p className="mt-2 text-[13px] text-slate-600">Showing the newest 500. Narrow the dates to see older notes.</p> : null}
      </Card>
    </>
  );
}

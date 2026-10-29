import { ForbiddenError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { myVisits } from "@/server/rota/carer";
import { suName } from "@/server/rota/queries";
import { randomUUID } from "node:crypto";
import { acknowledgeMyVisitsAction, clockMineAction, notDeliveredMineAction } from "@/app/rota-actions";
import { effectiveClocks } from "@/server/rota/attendance";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { VisitStatusBadge } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

export default async function MyVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  let data;
  try {
    data = await myVisits(ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <><PageHeader title="My Visits" back="/overview" /><Card><Empty>{e.message}</Empty></Card></>;
    throw e;
  }
  const { staff, settings, visits } = data;
  const now = Date.now();
  const today = londonDate();
  const days = [...new Set(visits.map((v) => fromDbDate(v.date)))];
  const unseen = visits.filter((v) => v.assignments.some((a) => a.staffId === staff.id && !a.acknowledgedAt) && v.date >= new Date(`${today}T00:00:00Z`)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Visits" back="/overview" subtitle={`${staff.displayName}. Your published visits. Clock in when you arrive and out when you leave; the time is taken from our server when you press the button. Location and NFC checks are not used, and the page needs a signal (there is no offline mode). Task recording from the phone is not built yet.`} />
      <Flash searchParams={sp} />
      {unseen ? (
        <form action={acknowledgeMyVisitsAction} className="panel mb-3 flex flex-wrap items-center justify-between gap-2">
          <input type="hidden" name="back" value="/carer" />
          <p className="text-[14px]"><span className="font-medium">{unseen} new or changed visit{unseen === 1 ? "" : "s"}.</span> Let the office know you have seen them.</p>
          <button className="btn-primary">I have seen my visits</button>
        </form>
      ) : null}
      {days.length ? (
        days.map((d) => (
          <Card key={d} title={d === today ? `Today · ${fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })}` : fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })} className="mb-3">
            <ul className="rows">
              {visits.filter((v) => fromDbDate(v.date) === d).map((v) => {
                const mine = v.assignments.find((a) => a.staffId === staff.id);
                const partner = v.assignments.find((a) => a.staffId !== staff.id && a.slot !== "SHADOW");
                return (
                  <li key={v.id} className="py-3 text-[14.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
                      <span className="font-medium text-navy-900">{suName(v.serviceUser)}</span>
                      <span className="text-slate-600">{v.callType.name}</span>
                      <span className="ml-auto flex gap-1"><VisitStatusBadge status={v.status} />{mine && !mine.acknowledgedAt ? <Badge tone="amber">New</Badge> : null}</span>
                    </div>
                    <p className="text-slate-600">{[v.serviceUser.addressLine1, v.serviceUser.town, v.serviceUser.postcode].filter(Boolean).join(", ")}</p>
                    {partner ? <p className="text-[13.5px]">With {partner.staff.displayName}</p> : null}
                    {mine?.slot === "SHADOW" ? <p className="text-[13.5px]">You are shadowing on this visit.</p> : null}
                    {v.serviceUser.accessNotes ? <p className="mt-1 text-[13.5px] text-slate-700">Getting in: {v.serviceUser.accessNotes}</p> : null}
                    {v.tasks.length ? <p className="mt-1 text-[13.5px] text-slate-700">Tasks: {v.tasks.map((t) => t.name).join(", ")}</p> : null}
                    {v.medicationRequired ? <p className="text-[13px] text-slate-500">Medication prompt only. Follow the paper MAR chart; eMAR is not in use.</p> : null}
                    {mine ? <ClockControls v={v} now={now} doorstep={settings.doorstepCancel} /> : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      ) : (
        <Card><Empty>No published visits for you in this period.</Empty></Card>
      )}
    </div>
  );
}

type MyVisit = Awaited<ReturnType<typeof myVisits>>["visits"][number];

/** Clock in or out, or report a visit that could not be delivered. Shown only while the visit is open for clocking. */
function ClockControls({ v, now, doorstep }: { v: MyVisit; now: number; doorstep: boolean }) {
  const clocks = effectiveClocks(v.clocks);
  const inAt = clocks.find((c) => c.kind === "IN");
  const outAt = clocks.find((c) => c.kind === "OUT");
  const open = now >= v.scheduledStart.getTime() - 3 * 3600_000 && now <= v.scheduledEnd.getTime() + 6 * 3600_000;
  const closed = ["CANCELLED", "NOT_DELIVERED"].includes(v.status);
  const back = "/carer";
  if (outAt) return <p className="mt-2 text-[13.5px] text-slate-700">You clocked in at {londonTime(inAt?.at ?? outAt.at)} and out at {londonTime(outAt.at)}.</p>;
  if (closed || !open) return null;
  if (inAt) {
    return (
      <form action={clockMineAction} className="mt-2 space-y-2 rounded-md border border-slate-200 p-2.5">
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="visitId" value={v.id} />
        <input type="hidden" name="kind" value="OUT" />
        <input type="hidden" name="nonce" value={randomUUID()} />
        <p className="text-[13.5px]">Clocked in at {londonTime(inAt.at)}.</p>
        <label className="block"><span className="label">Note for the office (needed if the visit was short)</span><textarea name="note" rows={2} className="input" /></label>
        <button className="btn-primary w-full sm:w-auto">Clock out</button>
      </form>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <form action={clockMineAction}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="visitId" value={v.id} />
        <input type="hidden" name="kind" value="IN" />
        <input type="hidden" name="nonce" value={randomUUID()} />
        <button className="btn-primary">Clock in</button>
      </form>
      {doorstep && v.status === "SCHEDULED" ? (
        <details className="min-w-0 flex-1">
          <summary className="btn-secondary inline-block cursor-pointer">Could not deliver</summary>
          <form action={notDeliveredMineAction} className="mt-2 space-y-2">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="visitId" value={v.id} />
            <label className="block"><span className="label">What happened? The office is told straight away.</span><input name="reason" required minLength={3} placeholder="e.g. no answer at the door, care refused" className="input" /></label>
            <button className="btn-danger">Send to the office</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

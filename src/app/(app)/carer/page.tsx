import Link from "@/components/link";
import { ForbiddenError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { myVisits } from "@/server/rota/carer";
import { suName } from "@/server/rota/queries";
import { randomUUID } from "node:crypto";
import { acknowledgeMyVisitsAction, requestClockCorrectionAction, addVisitNoteAction, clockMineAction, notDeliveredMineAction, recordTasksMineAction } from "@/app/rota-actions";
import { NOTE_CATEGORIES, NOTE_LABEL, OUTCOME_LABEL } from "@/server/care/visit-record";
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
  const { staff, settings, visits, lastHandover } = data;
  const now = Date.now();
  const today = londonDate();
  const days = [...new Set(visits.map((v) => fromDbDate(v.date)))];
  const unseen = visits.filter((v) => v.assignments.some((a) => a.staffId === staff.id && !a.acknowledgedAt) && v.date >= new Date(`${today}T00:00:00Z`)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Visits" back="/overview" subtitle={`${staff.displayName}. Your published visits. Clock in when you arrive and out when you leave; the time is taken from our server when you press the button. Location and NFC checks are not used, and the page needs a signal (there is no offline mode). Record each task after you clock in; task records and notes cannot be changed once saved.`} />
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
                    {lastHandover.get(v.serviceUserId) && lastHandover.get(v.serviceUserId)!.visitId !== v.id ? <p className="mt-1 rounded-md bg-violet-50 px-2 py-1 text-[13.5px] text-slate-800">Handover from the last visit: {lastHandover.get(v.serviceUserId)!.text}</p> : null}
                    {v.tasks.length ? <p className="mt-1 text-[13.5px] text-slate-700">Tasks: {v.tasks.map((t) => t.name).join(", ")}</p> : null}
                    {v.medicationRequired ? <p className="text-[13px] text-slate-500">Medication prompt only. Follow the paper MAR chart; eMAR is not in use.</p> : null}
                    <p className="mt-1 flex flex-wrap gap-x-4 text-[13.5px]"><Link href={`/carer/care-plan/${v.serviceUserId}`}>Care plan and risks</Link><Link href={`/rota/incidents/new?su=${v.serviceUserId}&visit=${v.id}`}>Report an incident</Link></p>
                    {mine ? <ClockControls v={v} now={now} doorstep={settings.doorstepCancel} /> : null}
                    {mine ? <TaskControls v={v} /> : null}
                    {mine ? <CorrectionControls v={v} now={now} /> : null}
                    {mine ? <NoteControls v={v} staffId={staff.id} /> : null}
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

/** After clocking in, the carer records each task once: done, not done or refused (with a reason). */
function TaskControls({ v }: { v: MyVisit }) {
  if (!v.tasks.length || ["CANCELLED", "NOT_DELIVERED"].includes(v.status)) return null;
  const clockedIn = effectiveClocks(v.clocks).some((c) => c.kind === "IN");
  const open = v.tasks.filter((t) => !t.outcomes.length);
  const done = v.tasks.filter((t) => t.outcomes.length);
  return (
    <div className="mt-2">
      {done.length ? (
        <ul className="text-[13.5px] text-slate-700">
          {done.map((t) => <li key={t.id}>{t.name}: <span className="font-medium">{OUTCOME_LABEL[t.outcomes[0]!.outcome]}</span>{t.outcomes[0]!.note ? ` (${t.outcomes[0]!.note})` : ""}</li>)}
        </ul>
      ) : null}
      {clockedIn && open.length ? (
        <form action={recordTasksMineAction} className="mt-2 space-y-2 rounded-md border border-slate-200 p-2.5" aria-label="Record tasks">
          <input type="hidden" name="back" value="/carer" />
          <input type="hidden" name="visitId" value={v.id} />
          {open.map((t) => (
            <fieldset key={t.id} className="space-y-1">
              <legend className="text-[14px] font-medium">{t.name}</legend>
              <div className="flex flex-wrap gap-3 text-[14px]">
                {(["DONE", "NOT_DONE", "REFUSED"] as const).map((o) => <label key={o} className="flex items-center gap-1.5"><input type="radio" name={`outcome_${t.id}`} value={o} />{OUTCOME_LABEL[o]}</label>)}
              </div>
              <input name={`note_${t.id}`} className="input py-1.5 text-[14px]" placeholder="Reason if not done or refused" aria-label={`Note for ${t.name}`} />
            </fieldset>
          ))}
          <button className="btn-primary w-full sm:w-auto">Save tasks</button>
        </form>
      ) : null}
    </div>
  );
}

/** Notes on the visit: the carer's own and the office's. Concerns go straight to the office. */
function NoteControls({ v, staffId }: { v: MyVisit; staffId: string }) {
  if (["CANCELLED"].includes(v.status)) return null;
  return (
    <div className="mt-2">
      {v.visitNotes.length ? (
        <ul className="space-y-1 text-[13.5px]">
          {v.visitNotes.map((n) => <li key={n.id}><span className="text-slate-500">{NOTE_LABEL[n.category] ?? n.category}{n.staffId === staffId ? " (you)" : ""} · {londonTime(n.createdAt)}:</span> {n.text}</li>)}
        </ul>
      ) : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-[13.5px] text-navy-700 underline">Add a note</summary>
        <form action={addVisitNoteAction} className="mt-2 space-y-2">
          <input type="hidden" name="back" value="/carer" />
          <input type="hidden" name="visitId" value={v.id} />
          <label className="block"><span className="label">Kind of note</span><select name="category" className="input">{Object.entries(NOTE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="block"><span className="label">Note</span><textarea name="text" required minLength={3} rows={3} className="input" /></label>
          <button className="btn-secondary">Save note</button>
        </form>
      </details>
    </div>
  );
}

/** A carer who forgot to clock, or clocked at the wrong time, asks the office to put it right. The office decides. */
function CorrectionControls({ v, now }: { v: MyVisit; now: number }) {
  if (["CANCELLED", "NOT_DELIVERED"].includes(v.status) || v.scheduledStart.getTime() > now) return null;
  const date = fromDbDate(v.date);
  return (
    <div className="mt-2">
      {v.correctionRequests.map((r) => (
        <p key={r.id} className="text-[13.5px] text-slate-700">You asked to change your {r.kind === "IN" ? "clock-in" : "clock-out"} to {londonTime(r.requestedTime)}: {r.status === "PENDING" ? "waiting for the office" : r.status === "APPROVED" ? "approved" : `rejected${r.decisionNote ? ` (${r.decisionNote})` : ""}`}.</p>
      ))}
      <details className="mt-1">
        <summary className="cursor-pointer text-[13.5px] text-navy-700 underline">Ask the office to correct a time</summary>
        <form action={requestClockCorrectionAction} className="mt-2 space-y-2">
          <input type="hidden" name="back" value="/carer" />
          <input type="hidden" name="visitId" value={v.id} />
          <div className="grid grid-cols-3 gap-2">
            <label><span className="label">Which</span><select name="kind" className="input"><option value="IN">Clock in</option><option value="OUT">Clock out</option></select></label>
            <label><span className="label">Date</span><input type="date" name="date" defaultValue={date} required className="input" /></label>
            <label><span className="label">Time</span><input type="time" name="time" required className="input" /></label>
          </div>
          <label className="block"><span className="label">What happened</span><input name="reason" required minLength={5} className="input" placeholder="e.g. phone had no signal when I arrived" /></label>
          <button className="btn-secondary">Send to the office</button>
        </form>
      </details>
    </div>
  );
}

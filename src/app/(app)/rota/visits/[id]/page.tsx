import type { AssignmentSlot } from "@prisma/client";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getVisit } from "@/server/rota/visits";
import { effectiveClocks } from "@/server/rota/attendance";
import { deriveFlags, memberNames, rotaLookups, suName, visitCandidates } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { db } from "@/lib/db";
import { fmtLondonDate, fromDbDate, hhmm, londonDate, londonMinute, londonTime } from "@/lib/london";
import { officeClockAction, assignCarerAction, cancelVisitAction, doubleUpAction, reinstateVisitAction, unassignCarerAction, updateVisitAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader } from "@/components/ui";
import { AreaDot, FlagBadges, TimeSpan, VisitStatusBadge } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<AssignmentSlot, string> = { PRIMARY: "First carer", SECOND: "Second carer", SHADOW: "Shadowing" };
const STATE_LABEL = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;
const EVENT_LABEL: Record<string, string> = {
  CREATED: "Visit created", ASSIGNED: "Carer assigned", REASSIGNED: "Carer replaced", EDITED: "Visit changed", UNASSIGNED: "Carer removed", UPDATED: "Visit changed", CANCELLED: "Visit cancelled", REINSTATED: "Visit reinstated",
  PUBLISHED: "Published to carers", ALLOCATION_FLAGGED: "Allocation needs review", ALLOCATION_CLEARED: "Review cleared", STATUS: "Status changed", CLOCK: "Clock recorded",
};

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage();
  const v = await orNotFound(getVisit(ctx, id));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const settings = await rotaSettings(db, v.organisationId);
  const live = v.assignments.filter((a) => !a.removedAt);
  const flags = deriveFlags(v, settings);
  const editable = canEdit && v.status === "SCHEDULED";
  const assignable = canEdit && ["SCHEDULED", "MISSED"].includes(v.status);
  const slots: AssignmentSlot[] = ["PRIMARY", ...(v.carersRequired > 1 ? (["SECOND"] as const) : []), "SHADOW"];
  const [candidates, lk, names] = await Promise.all([
    assignable ? Promise.all(slots.map(async (s) => [s, await visitCandidates(ctx, v, s)] as const)) : Promise.resolve([]),
    editable ? rotaLookups(ctx) : Promise.resolve(null),
    memberNames(ctx, [...v.events.map((e) => e.actorId), ...v.assignments.map((a) => a.assignedById), ...v.clocks.map((c) => c.recordedById), ...v.visitNotes.map((n) => n.authorUserId)]),
  ]);
  const date = fromDbDate(v.date);
  const back = `/rota/visits/${v.id}`;
  const who = (u: string | null | undefined) => (u ? names.get(u) ?? "Former member" : "System");
  const inForce = new Set(effectiveClocks(v.clocks).map((c) => c.id));
  const carerName = (staffId: string | null) => v.assignments.find((a) => a.staffId === staffId)?.staff.displayName ?? "Carer";
  const canClock = hasOrgPermission(ctx, "rota.clockCorrect") && !["CANCELLED", "NOT_DELIVERED"].includes(v.status) && live.length > 0;
  const nowMinute = date === londonDate() ? londonMinute(new Date()) : londonMinute(v.scheduledStart);

  return (
    <>
      <PageHeader
        title={`${suName(v.serviceUser)} · ${v.callType.name}`}
        back={`/rota/visits?date=${date}`}
        subtitle={`Visit ${v.reference} on ${fmtLondonDate(date)}. Changing the time re-checks every carer on it; a carer who cannot do the new time stops the change.`}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <Card title="Visit">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <VisitStatusBadge status={v.status} />
              <FlagBadges flags={flags} />
              {v.timeLocked ? <Badge>Time locked</Badge> : null}
              {v.carersRequired > 1 ? <Badge tone="violet">Double-up</Badge> : null}
              {v.publishedAt ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Not published</Badge>}
              {v.manuallyChanged ? <Badge>Changed by hand</Badge> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
              <Field label="Planned"><TimeSpan start={v.scheduledStart} end={v.scheduledEnd} /></Field>
              <Field label="Actual">{v.actualStart ? <>{londonTime(v.actualStart)}–{v.actualEnd ? londonTime(v.actualEnd) : "in progress"}</> : "Not started"}</Field>
              <Field label="Area"><AreaDot area={v.area} /></Field>
              <Field label="Service user"><Link href={`/rota/service-users/${v.serviceUser.id}`}>{suName(v.serviceUser)}</Link> <span className="text-slate-500">{v.serviceUser.reference}</span></Field>
              <Field label="Postcode">{v.serviceUser.postcode ?? "—"}</Field>
              <Field label="Carer preference">{v.serviceUser.carerGenderPreference === "ANY" ? "No preference" : `${v.serviceUser.carerGenderPreference.toLowerCase()} carers`}</Field>
              <Field label="Medication">{v.medicationRequired ? "Prompt on this visit (eMAR not in use)" : "None"}</Field>
              <Field label="Source">{v.templateId ? <Link href={`/rota/templates/${v.templateId}`}>Rota template</Link> : "One-off visit"}</Field>
              <Field label="Run route">{v.runRoute?.name ?? "—"}</Field>
            </dl>
            {v.notes ? <p className="mt-3 rounded-[3px] bg-[#f5f9fc] px-3 py-2 text-[14px]">{v.notes}</p> : null}
            {v.cancelReason ? <p className="mt-3 text-[14px] text-[#a3242c]">Cancelled: {v.cancelReason}</p> : null}
          </Card>

          <Card title="Carers">
            <ul className="rows">
              {slots.map((s) => {
                const a = live.find((x) => x.slot === s);
                const list = candidates.find((c) => c[0] === s)?.[1] ?? [];
                return (
                  <li key={s} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[12.5px] text-slate-500">{SLOT_LABEL[s]}</div>
                        {a ? (
                          <div className="text-[15px] font-medium text-[#1d4f91]">{a.staff.displayName} <span className="font-normal text-slate-500">· {a.staff.jobTitle}</span></div>
                        ) : (
                          <div className={s === "SHADOW" ? "text-slate-500" : "font-medium text-[#a3242c]"}>{s === "SHADOW" ? "No one shadowing" : "Unassigned"}</div>
                        )}
                        {a?.reviewReason ? <p className="mt-1 text-[13px] text-[#a3242c]">Needs review: {a.reviewReason}</p> : null}
                        {a?.warningsAccepted.length ? <p className="mt-1 text-[13px] text-[#8a5a00]">Allocated with warnings accepted: {a.warningsAccepted.join("; ")}</p> : null}
                        {a ? <p className="text-[12.5px] text-slate-500">Assigned by {who(a.assignedById)} {fmtDate(a.assignedAt, true)}{a.acknowledgedAt ? ` · seen by carer ${fmtDate(a.acknowledgedAt, true)}` : ""}</p> : null}
                      </div>
                      {a && assignable ? (
                        <form action={unassignCarerAction} className="flex items-center gap-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="visitId" value={v.id} />
                          <input type="hidden" name="slot" value={s} />
                          <input type="hidden" name="lockVersion" value={v.lockVersion} />
                          <input name="reason" className="input w-44 py-1.5 text-[14px]" placeholder="Reason" aria-label={`Reason for removing ${a.staff.displayName}`} />
                          <button className="btn-secondary py-1">Remove</button>
                        </form>
                      ) : null}
                    </div>
                    {assignable ? (
                      <form action={assignCarerAction} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="visitId" value={v.id} />
                        <input type="hidden" name="slot" value={s} />
                        <input type="hidden" name="lockVersion" value={v.lockVersion} />
                        <select name="staffId" required className="input max-w-md flex-1 py-1.5 text-[14px]" aria-label={`${a ? "Replace" : "Choose"} ${SLOT_LABEL[s].toLowerCase()}`}>
                          <option value="">{a ? "Replace with…" : "Choose a carer…"}</option>
                          {list.map((c) => (
                            <option key={c.id} value={c.id} disabled={c.state === "NOT_ELIGIBLE"}>
                              {c.name} — {STATE_LABEL[c.state]}{c.reasons.length ? `: ${c.reasons.slice(0, 2).join("; ")}` : ""}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> I have read the warnings</label>
                        <button className="btn-primary py-1">{a ? "Replace" : "Assign"}</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[12.5px] text-slate-500">Carers are ranked by the shared eligibility check: HR checks on the visit date, holidays and sickness, availability, clashes, weekly hours and the service user’s preferences. People who are not eligible cannot be chosen.</p>
          </Card>

          <Card title="Tasks">
            {v.tasks.length ? (
              <ul className="rows">
                {v.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2 text-[14px]">
                    <span>{t.name}</span>
                    <span className="text-slate-500">{t.outcomes[0] ? `${t.outcomes[0].outcome.toLowerCase().replace("_", " ")} · ${fmtDate(t.outcomes[0].at, true)}` : "Not recorded"}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No tasks on this visit.</Empty>}
          </Card>

          <section id="attendance" aria-label="Attendance">
          <Card title="Attendance and notes">
            {v.clocks.length || v.visitNotes.length ? (
              <ul className="rows">
                {v.clocks.map((c) => (
                  <li key={c.id} className={`py-2 text-[14px] ${inForce.has(c.id) ? "" : "text-slate-500 line-through decoration-slate-400"}`}>
                    <span className="font-medium">{carerName(c.staffId)} {c.kind === "IN" ? "clocked in" : "clocked out"}</span> at {londonTime(c.at)} · {c.method === "OFFICE" ? "entered by the office" : "from the carer's phone"} · recorded by {who(c.recordedById)}
                    {inForce.has(c.id) ? null : <span className="ml-1 no-underline">(replaced)</span>}
                    {c.reason ? <span className="block text-[13px] text-slate-600">Reason: {c.reason}</span> : null}
                  </li>
                ))}
                {v.visitNotes.map((n) => (
                  <li key={n.id} className="py-2 text-[14px]">
                    <span className="text-[12.5px] text-slate-500">{n.category.toLowerCase()} note · {who(n.authorUserId)} · {fmtDate(n.createdAt, true)}</span>
                    <p>{n.text}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing recorded yet. Clock records and notes are kept permanently once made.</Empty>}
            {canClock ? (
              <form action={officeClockAction} className="mt-3 border-t border-slate-200 pt-3" aria-label="Record a clock time">
                <input type="hidden" name="back" value={`${back}#attendance`} />
                <input type="hidden" name="visitId" value={v.id} />
                <h3 className="mb-2 text-[14px] font-semibold">Record a clock time for a carer</h3>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="col-span-2 md:col-span-1"><span className="label">Carer</span><select name="staffId" required className="input">{live.map((a) => <option key={a.id} value={a.staffId}>{a.staff.displayName}</option>)}</select></label>
                  <label><span className="label">Clock</span><select name="kind" className="input"><option value="IN">In</option><option value="OUT">Out</option></select></label>
                  <label><span className="label">Date</span><input type="date" name="date" defaultValue={date} required className="input" /></label>
                  <label><span className="label">Time</span><input type="time" name="time" defaultValue={hhmm(nowMinute)} required className="input" /></label>
                  {v.clocks.some((c) => inForce.has(c.id)) ? (
                    <label className="col-span-2"><span className="label">Replaces (optional)</span>
                      <select name="supersedesId" className="input"><option value="">Nothing, this is a new record</option>{v.clocks.filter((c) => inForce.has(c.id)).map((c) => <option key={c.id} value={c.id}>{carerName(c.staffId)} {c.kind === "IN" ? "in" : "out"} at {londonTime(c.at)}</option>)}</select>
                    </label>
                  ) : null}
                  <label className="col-span-2"><span className="label">Reason</span><input name="reason" required minLength={3} placeholder="e.g. carer phoned in, phone battery flat" className="input" /></label>
                  <label className="col-span-2 md:col-span-4"><span className="label">Clock-out note (needed when the visit was shorter than planned)</span><input name="note" maxLength={2000} placeholder="What the carer said about the visit" className="input" /></label>
                </div>
                <button className="btn-secondary mt-2">Record clock time</button>
                <p className="mt-1 text-[12.5px] text-slate-500">Entries are permanent. A wrong entry is fixed by recording a replacement, and both stay on the visit.</p>
              </form>
            ) : null}
          </Card>
          </section>
        </div>

        <div className="space-y-3">
          {editable && lk ? (
            <Card title="Change visit">
              <form action={updateVisitAction} className="space-y-2.5">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="visitId" value={v.id} />
                <input type="hidden" name="lockVersion" value={v.lockVersion} />
                <input type="hidden" name="date" value={date} />
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Start</span><input type="time" name="start" required defaultValue={hhmm(londonMinute(v.scheduledStart))} className="input" /></label>
                  <label><span className="label">Minutes</span><input type="number" name="durationMin" min={5} max={1440} required defaultValue={Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000)} className="input" /></label>
                </div>
                <label className="block"><span className="label">Call type</span><select name="callTypeId" defaultValue={v.callTypeId} className="input">{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="timeLocked" defaultChecked={v.timeLocked} className="h-4 w-4" /> Lock the time</label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="medicationRequired" defaultChecked={v.medicationRequired} className="h-4 w-4" /> Medication prompt</label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="alertOnLate" defaultChecked={v.alertOnLate} className="h-4 w-4" /> Alert the office if late</label>
                <label className="block"><span className="label">Office notes</span><textarea name="notes" defaultValue={v.notes ?? ""} rows={2} className="input" /></label>
                <button className="btn-primary">Save visit</button>
              </form>
              <form action={doubleUpAction} className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="visitId" value={v.id} />
                <input type="hidden" name="lockVersion" value={v.lockVersion} />
                <input type="hidden" name="carersRequired" value={v.carersRequired > 1 ? 1 : 2} />
                <button className="btn-secondary">{v.carersRequired > 1 ? "Make single-handed" : "Make a double-up"}</button>
                <span className="text-[12.5px] text-slate-500">{v.carersRequired > 1 ? "Remove the second carer first." : "Adds a second carer slot."}</span>
              </form>
            </Card>
          ) : null}

          {canEdit && v.status === "SCHEDULED" ? (
            <Card title="Cancel visit">
              <form action={cancelVisitAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="visitId" value={v.id} />
                <input type="hidden" name="lockVersion" value={v.lockVersion} />
                <label className="block"><span className="label">Reason</span><input name="reason" required minLength={3} className="input" placeholder="e.g. In hospital" /></label>
                <button className="btn-danger">Cancel visit</button>
              </form>
            </Card>
          ) : null}
          {canEdit && ["CANCELLED", "NOT_DELIVERED"].includes(v.status) && v.scheduledStart > new Date() ? (
            <Card title="Reinstate visit">
              <form action={reinstateVisitAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="visitId" value={v.id} />
                <input type="hidden" name="lockVersion" value={v.lockVersion} />
                <label className="block"><span className="label">Reason</span><input name="reason" className="input" /></label>
                <button className="btn-secondary">Reinstate</button>
              </form>
            </Card>
          ) : null}

          <Card title="History">
            {v.events.length ? (
              <ol className="space-y-2.5 text-[13.5px]">
                {v.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="font-medium text-slate-800">{EVENT_LABEL[e.type] ?? e.type.toLowerCase().replace(/_/g, " ")}{e.toStatus ? ` → ${e.toStatus.toLowerCase().replace("_", " ")}` : ""}</div>
                    <div className="text-slate-500">{who(e.actorId)} · {fmtDate(e.createdAt, true)}</div>
                    {e.reason ? <div className="text-slate-700">{e.reason}</div> : null}
                  </li>
                ))}
              </ol>
            ) : <Empty>No history yet.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}

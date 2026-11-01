import type { AssignmentSlot } from "@prisma/client";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getVisit } from "@/server/rota/visits";
import { swapCandidates } from "@/server/rota/swap";
import { CLOCK_KIND_LABEL, listCorrectionRequests } from "@/server/rota/corrections";
import { visitMedication } from "@/server/care/medication";
import { VisitMedication } from "@/components/medication-ui";
import { NOTE_CATEGORIES, NOTE_LABEL, OUTCOME_LABEL } from "@/server/care/visit-record";
import { effectiveClocks } from "@/server/rota/attendance";
import { deriveFlags, memberNames, rotaLookups, suName, visitCandidates } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { READINESS_LABEL } from "@/server/readiness";
import { db } from "@/lib/db";
import { fmtLondonDate, fromDbDate, hhmm, londonDate, londonMinute, londonTime } from "@/lib/london";
import { addVisitNoteAction, decideClockCorrectionAction, officeClockAction, assignCarerAction, cancelVisitAction, doubleUpAction, reinstateVisitAction, swapCarersAction, unassignCarerAction, updateVisitAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader } from "@/components/ui";
import { AreaDot, CancelChargeChoice, cancellationChargeLabel, FlagBadges, TimeSpan, VisitStatusBadge } from "@/components/rota-ui";
import { CarerRecommendations, SCORE_NOTE } from "@/components/rota-match";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<AssignmentSlot, string> = { PRIMARY: "First carer", SECOND: "Second carer", SHADOW: "Shadowing" };
const STATE_LABEL = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;
const EVENT_LABEL: Record<string, string> = {
  CREATED: "Visit created", ASSIGNED: "Carer assigned", REASSIGNED: "Carer replaced", EDITED: "Visit changed", UNASSIGNED: "Carer removed", UPDATED: "Visit changed", CANCELLED: "Visit cancelled", REINSTATED: "Visit reinstated",
  SWAPPED: "Carers swapped", PUBLISHED: "Published to carers", ALLOCATION_FLAGGED: "Allocation needs review", ALLOCATION_CLEARED: "Review cleared", STATUS: "Status changed", CLOCK: "Clock recorded",
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
  const requests = await listCorrectionRequests(ctx, { visitId: v.id, status: "ALL" });
  const medication = await visitMedication(ctx, v.id);
  const swappable = editable ? live.filter((a) => a.slot !== "SHADOW").map((a) => a.slot) : [];
  const [candidates, lk, names, swaps] = await Promise.all([
    assignable ? Promise.all(slots.map(async (s) => [s, await visitCandidates(ctx, v, s)] as const)) : Promise.resolve([]),
    editable ? rotaLookups(ctx) : Promise.resolve(null),
    memberNames(ctx, [...v.events.map((e) => e.actorId), ...v.assignments.map((a) => a.assignedById), ...v.clocks.map((c) => c.recordedById), ...v.visitNotes.map((n) => n.authorUserId), ...requests.flatMap((r) => [r.requestedById, r.decidedById])]),
    Promise.all(swappable.map(async (s) => [s, await swapCandidates(ctx, v.id, s)] as const)),
  ]);
  const date = fromDbDate(v.date);
  const back = `/rota/visits/${v.id}`;
  const who = (u: string | null | undefined) => (u ? names.get(u) ?? "Former member" : "System");
  const inForce = new Set(effectiveClocks(v.clocks).map((c) => c.id));
  const carerName = (staffId: string | null) => v.assignments.find((a) => a.staffId === staffId)?.staff.displayName ?? "Carer";
  const canNote = hasOrgPermission(ctx, "rota.edit");
  const canDecideRequests = hasOrgPermission(ctx, "rota.clockCorrect");
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
              <Field label="Medication">{medication ? (medication.due.length ? `${medication.due.length} due (see Medication)` : "None due") : v.medicationRequired ? "Prompt on this visit (medication records switched off)" : "None"}</Field>
              <Field label="Source">{v.templateId ? <Link href={`/rota/templates/${v.templateId}`}>Rota template</Link> : "One-off visit"}</Field>
              <Field label="Run route">{v.runRoute?.name ?? "—"}</Field>
            </dl>
            {v.notes ? <p className="mt-3 rounded-[3px] bg-[#f5f9fc] px-3 py-2 text-[14px]">{v.notes}</p> : null}
            {v.cancelReason ? <p className="mt-3 text-[14px] text-[#a3242c]">Cancelled: {v.cancelReason} · <strong>{cancellationChargeLabel(v.cancellationCharge)}</strong></p> : null}
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
                    {assignable && s !== "SHADOW" && list.some((c) => c.score !== null) ? (
                      <details className="mt-2" open={!a}>
                        <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Recommended carers</summary>
                        <CarerRecommendations list={list} visitId={v.id} slot={s} lockVersion={v.lockVersion} back={back} replacing={!!a} />
                        <p className="mt-1 text-[12px] text-slate-500">{SCORE_NOTE}</p>
                      </details>
                    ) : null}
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
                              {c.score !== null ? `${c.score} · ` : ""}{c.name} — {STATE_LABEL[c.state]}{c.readiness && c.readiness !== "READY" ? ` (${READINESS_LABEL[c.readiness].toLowerCase()})` : ""}{c.reasons.length ? `: ${c.reasons.slice(0, 2).join("; ")}` : ""}{c.advice.length ? ` · check: ${c.advice.join("; ")}` : ""}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> I have read the warnings</label>
                        <button className="btn-primary py-1">{a ? "Replace" : "Assign"}</button>
                      </form>
                    ) : null}
                    {a && swappable.includes(s) ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Swap with another carer’s visit</summary>
                        {(swaps.find((x) => x[0] === s)?.[1] ?? []).length ? (
                          <form action={swapCarersAction} className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="visitId" value={v.id} />
                            <input type="hidden" name="slot" value={s} />
                            <input type="hidden" name="lockVersion" value={v.lockVersion} />
                            <select name="with" required className="input max-w-md flex-1 py-1.5 text-[14px]" aria-label={`Visit to swap ${a.staff.displayName} with`}>
                              <option value="">Choose a visit…</option>
                              {(swaps.find((x) => x[0] === s)?.[1] ?? []).map((c) => (
                                <option key={`${c.visitId}-${c.slot}`} value={`${c.visitId}|${c.slot}|${c.lockVersion}`}>
                                  {londonTime(c.start)}–{londonTime(c.end)} {c.serviceUser} · {c.carer} ({c.reference})
                                </option>
                              ))}
                            </select>
                            <input name="reason" required minLength={3} className="input w-48 py-1.5 text-[14px]" placeholder="Reason" aria-label="Reason for the swap" />
                            <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> I have read the warnings</label>
                            <button className="btn-secondary py-1">Swap</button>
                          </form>
                        ) : (
                          <p className="mt-2 text-[13px] text-slate-500">No other scheduled visit with a carer within 12 hours of this one.</p>
                        )}
                        <p className="mt-1 text-[12.5px] text-slate-500">Both carers are checked for each other’s visit. If either cannot take it, nothing changes.</p>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[12.5px] text-slate-500">Carers are ranked by the shared eligibility check: HR checks on the visit date, staff readiness for this visit’s tasks (training, competency, policy acknowledgement, restrictions), holidays and sickness, availability, clashes, weekly hours and the service user’s preferences. People who are not eligible cannot be chosen.</p>
          </Card>

          <Card title="Tasks">
            {v.tasks.length ? (
              <ul className="rows">
                {v.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2 text-[14px]">
                    <span>{t.name}</span>
                    <span className="text-right text-slate-500">{t.outcomes.length ? t.outcomes.map((o) => <span key={o.id} className="block">{OUTCOME_LABEL[o.outcome]} · {carerName(o.staffId)} · {fmtDate(o.at, true)}{o.note ? <span className="block text-[13px] text-slate-600">{o.note}</span> : null}</span>) : "Not recorded"}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No tasks on this visit.</Empty>}
          </Card>

          {requests.length ? (
            <section id="corrections" aria-label="Clock correction requests">
              <Card title="Clock correction requests">
                <ul className="rows">
                  {requests.map((r) => (
                    <li key={r.id} className="py-2 text-[14px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{carerName(r.staffId)}: {CLOCK_KIND_LABEL[r.kind]} at {londonTime(r.requestedTime)} {fmtDate(r.requestedTime)}</span>
                        <Badge tone={r.status === "PENDING" ? "amber" : r.status === "APPROVED" ? "green" : "slate"}>{r.status === "PENDING" ? "Waiting" : r.status === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                        {r.origin === "OFFICE" ? <span className="text-[12.5px] text-slate-500">entered by the office</span> : null}
                      </div>
                      <p className="text-[13.5px] text-slate-700">{r.reason} · asked by {who(r.requestedById)} {fmtDate(r.createdAt, true)}</p>
                      {r.decidedById && r.origin !== "OFFICE" ? <p className="text-[13px] text-slate-600">Decided by {who(r.decidedById)}{r.decisionNote ? `: ${r.decisionNote}` : ""}</p> : null}
                      {r.status === "PENDING" && canDecideRequests ? (
                        r.requestedById === ctx.userId ? <p className="text-[13px] text-slate-600">You asked for this, so someone else must decide it.</p> : (
                          <form action={decideClockCorrectionAction} className="mt-1 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="back" value={`${back}#corrections`} />
                            <input type="hidden" name="requestId" value={r.id} />
                            <input name="note" className="input w-56 py-1" placeholder="Note (needed to reject)" aria-label="Decision note" />
                            <button className="btn-primary py-1" name="decision" value="APPROVED">Approve</button>
                            <button className="btn-secondary py-1" name="decision" value="REJECTED">Reject</button>
                          </form>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}

          {medication ? <VisitMedication data={medication} back={back} canManage={hasOrgPermission(ctx, "medication.manage")} /> : null}

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
                    <span className="text-[12.5px] text-slate-500">{NOTE_LABEL[n.category] ?? `${n.category.toLowerCase().replace("_", " ")} note`} · {who(n.authorUserId)} · {fmtDate(n.createdAt, true)}</span>
                    <p>{n.text}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing recorded yet. Clock records and notes are kept permanently once made.</Empty>}
            {canNote ? (
              <form action={addVisitNoteAction} className="mt-3 border-t border-slate-200 pt-3" aria-label="Add a note">
                <input type="hidden" name="back" value={`${back}#attendance`} />
                <input type="hidden" name="visitId" value={v.id} />
                <div className="grid gap-2 md:grid-cols-[12rem_1fr_auto] md:items-end">
                  <label><span className="label">Kind of note</span><select name="category" className="input">{Object.entries(NOTE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  <label><span className="label">Note</span><textarea name="text" required minLength={3} rows={2} className="input" /></label>
                  <button className="btn-secondary">Add note</button>
                </div>
                <p className="mt-1 text-[12.5px] text-slate-600">Notes cannot be edited or deleted once saved. A concern alerts the coordinators inside the platform.</p>
              </form>
            ) : null}
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
                {/* The keyboard way to move a visit to another day, alongside dragging it in the Weekly Planner. */}
                <label className="block"><span className="label">Date</span><input type="date" name="date" required defaultValue={date} className="input" /></label>
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
                <CancelChargeChoice />
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

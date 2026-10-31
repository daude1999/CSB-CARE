import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { getMissedCase, MISSED_REASONS, OUTCOMES, REPLACEMENT_TYPES, replacementCandidates, STAGE_LABEL, VISIT_STATUS_NOW, outcomeLabel, reasonLabel } from "@/server/rota/missed-calls";
import { suName } from "@/server/rota/queries";
import { missedAddActionAction, missedAssignAction, missedCommentAction, missedCompleteActionAction, missedEscalateAction, missedEvidenceAction, missedReasonAction, missedReopenAction, missedReplacementAction, missedSignOffAction, missedSubmitAction } from "@/app/rota-actions";
import { Badge, Flash, fmtDate, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const STAGE_TONE: Record<string, Tone> = { NEW: "rose", INVESTIGATING: "amber", AWAITING_SIGNOFF: "violet", CLOSED: "green" };

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="panel mb-3" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-2 flex items-center gap-2 text-[16px] font-semibold">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] text-white ${done ? "bg-[#2e7d32]" : "bg-[#6b46c9]"}`} aria-hidden>{done ? "✓" : n}</span>
        {title}
        {done ? <span className="sr-only">(done)</span> : null}
      </h2>
      {children}
    </section>
  );
}

/**
 * One missed call: the visit, then the investigation in the order it is worked (reason, replacement care, follow-up
 * actions, comments, evidence and outcome, manager sign-off), with both people's missed-call history alongside.
 */
export default async function MissedCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("rota.monitor");
  const d = await orNotFound(getMissedCase(ctx, id));
  const { c, names } = d;
  const candidates = d.canWork ? await replacementCandidates(ctx, c.id) : [];
  const back = `/rota/missed/${c.id}`;
  const editable = d.canWork && (c.stage === "NEW" || c.stage === "INVESTIGATING");
  const open = c.stage !== "CLOSED";
  const who = (uid: string | null | undefined) => (uid ? names.get(uid) ?? "A member" : "—");
  const hidden = (extra?: Record<string, string | number>) => (
    <>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="caseId" value={c.id} />
      {extra ? Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />) : null}
    </>
  );
  const timeline = [
    { at: c.detectedAt, text: "Missed call detected: nobody clocked in", by: "System" },
    ...d.auditTrail.map((a) => ({ at: a.createdAt, text: AUDIT_TEXT[a.action] ?? a.action, by: who(a.actorId) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const steps = [
    ["Detected", true],
    ["Reason", !!c.reasonCode],
    ["Replacement care", !!c.replacementType],
    ["Follow-up actions", c.actions.length > 0 && c.actions.every((a) => a.doneAt)],
    ["Outcome", !!c.submittedAt || c.stage === "CLOSED"],
    ["Manager sign-off", c.stage === "CLOSED"],
  ] as const;

  return (
    <>
      <Flash searchParams={sp} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/rota/missed" className="btn-secondary">Back to Missed Calls</Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-[22px] font-semibold text-[#6b46c9]">Missed call {c.visit.reference}</h1>
          <p className="text-[13.5px] text-slate-600">{fmtLondonDate(londonDate(c.scheduledStart), { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {c.visit.callType.name} {londonTime(c.visit.scheduledStart)}–{londonTime(c.visit.scheduledEnd)}{c.visit.area ? ` · ${c.visit.area.name}` : ""}</p>
        </div>
        <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}{d.overdue ? " · past deadline" : ""}</Badge>
        {c.escalatedAt ? <Badge tone="violet">Escalated {fmtDate(c.escalatedAt, true)}</Badge> : null}
      </div>

      <ol aria-label="Investigation progress" className="mb-3 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {steps.map(([label, done], i) => (
          <li key={label} className={`border-b border-r border-slate-100 px-3 py-2 ${done ? "font-medium text-[#22682a]" : "text-slate-600"}`}>{done ? "✓ " : `${i} `}{label}</li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.55fr_1fr]">
        <div>
          <Step n={1} title="Investigate and record the reason" done={!!c.reasonCode}>
            {c.reasonCode ? (
              <dl className="mb-2 grid grid-cols-[150px_1fr] gap-x-2 gap-y-1 text-[14px]">
                <dt className="text-slate-600">Reason</dt><dd>{reasonLabel(c.reasonCode)}{c.reasonDetail ? `: ${c.reasonDetail}` : ""}</dd>
                <dt className="text-slate-600">Findings</dt><dd className="whitespace-pre-wrap">{c.findings}</dd>
                <dt className="text-slate-600">Recorded</dt><dd>{who(c.reasonRecordedById)}, {fmtDate(c.reasonRecordedAt, true)}</dd>
              </dl>
            ) : <p className="mb-2 text-[14px] text-slate-600">No reason recorded yet.{d.overdue ? " The deadline has passed, so the care managers have been told." : ""}</p>}
            {d.canWork && open ? (
              <form action={missedAssignAction} className="mb-3 flex flex-wrap items-end gap-2">
                {hidden({ lockVersion: c.lockVersion })}
                <label className="min-w-[220px] flex-1"><span className="label">Responsible coordinator</span><select name="coordinatorId" defaultValue={c.coordinatorId ?? ""} required className="input w-full"><option value="">Choose…</option>{d.workers.map((w) => <option key={w.userId} value={w.userId}>{w.name}</option>)}</select></label>
                <button className="btn-secondary">{c.coordinatorId ? "Change" : "Assign"}</button>
              </form>
            ) : <p className="mb-2 text-[14px]">Responsible coordinator: {c.coordinatorId ? who(c.coordinatorId) : "nobody yet"}</p>}
            {editable ? (
              <form action={missedReasonAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hidden({ lockVersion: c.lockVersion })}
                <label><span className="label">Reason for the missed call</span><select name="reasonCode" required defaultValue={c.reasonCode ?? ""} className="input w-full"><option value="">Choose a reason…</option>{Object.entries(MISSED_REASONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
                <label><span className="label">More detail (needed for “Other”)</span><input name="reasonDetail" defaultValue={c.reasonDetail ?? ""} maxLength={500} className="input w-full" /></label>
                <label className="sm:col-span-2"><span className="label">What happened (findings)</span><textarea name="findings" required minLength={10} maxLength={4000} rows={3} defaultValue={c.findings ?? ""} className="input w-full" placeholder="Who you spoke to and what they said" /></label>
                <div><button className="btn-primary">{c.reasonCode ? "Update reason" : "Save reason"}</button></div>
              </form>
            ) : null}
          </Step>

          <Step n={2} title="Replacement care arrangements" done={!!c.replacementType}>
            {c.replacementType ? (
              <dl className="mb-2 grid grid-cols-[150px_1fr] gap-x-2 gap-y-1 text-[14px]">
                <dt className="text-slate-600">Arrangement</dt><dd>{REPLACEMENT_TYPES[c.replacementType] ?? c.replacementType}</dd>
                {d.replacement ? <><dt className="text-slate-600">Replacement carer</dt><dd><Link href={`/rota/staff/${d.replacement.id}`}>{d.replacement.displayName}</Link> (eligibility checked{c.replacementWarnings.length ? `; accepted warnings: ${c.replacementWarnings.join("; ")}` : ""})</dd></> : null}
                {c.replacementArrivedAt ? <><dt className="text-slate-600">Arrived</dt><dd>{londonTime(c.replacementArrivedAt)}</dd></> : null}
                <dt className="text-slate-600">Client or family told</dt><dd>{c.clientInformed}</dd>
                {c.replacementNote ? <><dt className="text-slate-600">Note</dt><dd className="whitespace-pre-wrap">{c.replacementNote}</dd></> : null}
                <dt className="text-slate-600">Recorded</dt><dd>{who(c.replacementById)}, {fmtDate(c.replacementAt, true)}</dd>
              </dl>
            ) : <p className="mb-2 text-[14px] text-slate-600">Not recorded yet. Record how the client&apos;s care was covered, even if it was not.</p>}
            {editable ? (
              <form action={missedReplacementAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hidden({ lockVersion: c.lockVersion })}
                <label><span className="label">Arrangement</span><select name="replacementType" required defaultValue={c.replacementType ?? ""} className="input w-full"><option value="">Choose…</option>{Object.entries(REPLACEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label><span className="label">Replacement carer (replacement visit)</span><select name="replacementStaffId" defaultValue={c.replacementStaffId ?? ""} className="input w-full"><option value="">Choose…</option>{candidates.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                <label><span className="label">Arrived at (replacement or late carer)</span><input type="time" name="arrivedAt" defaultValue={c.replacementArrivedAt ? londonTime(c.replacementArrivedAt) : ""} className="input w-full" /></label>
                <label><span className="label">Client or family told (who, how, when)</span><input name="clientInformed" required minLength={2} maxLength={300} defaultValue={c.clientInformed ?? ""} className="input w-full" placeholder="Daughter by phone at 08:25" /></label>
                <label className="sm:col-span-2"><span className="label">Note (optional)</span><input name="note" maxLength={2000} defaultValue={c.replacementNote ?? ""} className="input w-full" /></label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept eligibility warnings</label>
                <div><button className="btn-primary">Record arrangement</button></div>
                <p className="text-[12.5px] text-slate-500 sm:col-span-2">A replacement carer is checked by the same eligibility rules as any booking (DBS, right to work, training, restrictions, the client&apos;s preferences). Nothing on the rota is changed or reassigned.</p>
              </form>
            ) : null}
          </Step>

          <Step n={3} title="Follow-up actions" done={c.actions.length > 0 && c.actions.every((a) => a.doneAt)}>
            {c.actions.length ? (
              <ul className="mb-2 divide-y divide-slate-100 text-[14px]">
                {c.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className={a.doneAt ? "text-slate-500 line-through" : ""}>{a.text}</span>
                    <span className="ml-auto text-[13px] text-slate-600">{who(a.ownerId)} · due {fmtLondonDate(londonDate(a.dueAt), { day: "numeric", month: "short" })}</span>
                    {a.doneAt ? <Badge tone="green">Done</Badge> : a.dueAt < new Date() ? <Badge tone="rose">Overdue</Badge> : <Badge tone="amber">Open</Badge>}
                    {!a.doneAt && d.canWork ? <form action={missedCompleteActionAction}>{hidden({ actionId: a.id })}<button className="btn-secondary py-0.5 text-[13px]">Mark done</button></form> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mb-2 text-[14px] text-slate-600">No follow-up actions yet.</p>}
            {d.canWork && open ? (
              <form action={missedAddActionAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                {hidden()}
                <label><span className="label">New action</span><input name="text" required minLength={3} maxLength={500} className="input w-full" placeholder="Welfare call to the client this evening" /></label>
                <label><span className="label">Give to</span><select name="ownerId" required defaultValue="" className="input w-full"><option value="">Choose…</option>{d.workers.map((w) => <option key={w.userId} value={w.userId}>{w.name}</option>)}</select></label>
                <label><span className="label">Due</span><input type="date" name="due" required min={londonDate()} className="input w-full" /></label>
                <button className="btn-secondary">Add</button>
              </form>
            ) : null}
          </Step>

          <Step n={4} title="Comments, evidence and outcome" done={!!c.submittedAt || c.stage === "CLOSED"}>
            <ul className="mb-3 space-y-2 border-l-2 border-[#e3dff0] pl-3 text-[14px]">
              {c.comments.map((m) => {
                const file = m.evidenceId ? d.evidence.find((e) => e.id === m.evidenceId) : null;
                return (
                  <li key={m.id}>
                    <b>{who(m.authorId)}</b> <span className="text-[12.5px] text-slate-500">{fmtDate(m.createdAt, true)}</span>
                    <p className="whitespace-pre-wrap">{file ? <a href={`/api/rota/missed/evidence/${file.id}`}>📎 {file.filename}</a> : m.body}{file ? <span className="text-[12.5px] text-slate-500"> · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB{file.scanStatus === "NOT_SCANNED" ? " · not virus-scanned (no scanner configured)" : ""}{m.body !== file.filename ? ` · ${m.body}` : ""}</span> : null}</p>
                  </li>
                );
              })}
            </ul>
            {d.canWork ? (
              <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <form action={missedCommentAction} className="flex flex-col gap-2">
                  {hidden()}
                  <label><span className="label">Management comment</span><textarea name="body" required minLength={2} maxLength={4000} rows={2} className="input w-full" /></label>
                  <div><button className="btn-secondary">Add comment</button></div>
                </form>
                <form action={missedEvidenceAction} encType="multipart/form-data" className="flex flex-col gap-2">
                  {hidden()}
                  <label><span className="label">Supporting evidence (PDF, Word, image, text; up to 10 MB)</span><input type="file" name="file" required accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" className="input w-full" /></label>
                  <label><span className="label">What it shows</span><input name="description" maxLength={300} className="input w-full" /></label>
                  <div><button className="btn-secondary">Attach evidence</button></div>
                </form>
              </div>
            ) : null}
            {c.outcome ? (
              <dl className="mb-2 grid grid-cols-[150px_1fr] gap-x-2 gap-y-1 rounded bg-slate-50 p-2 text-[14px]">
                <dt className="text-slate-600">Outcome</dt><dd>{outcomeLabel(c.outcome)}</dd>
                <dt className="text-slate-600">Preventable</dt><dd>{c.preventable ? "Yes" : "No"}</dd>
                <dt className="text-slate-600">Summary</dt><dd className="whitespace-pre-wrap">{c.outcomeNote}</dd>
                <dt className="text-slate-600">Sent for sign-off</dt><dd>{c.submittedAt ? `${who(c.submittedById)}, ${fmtDate(c.submittedAt, true)}` : "Not yet"}</dd>
              </dl>
            ) : null}
            {editable ? (
              <form action={missedSubmitAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {hidden({ lockVersion: c.lockVersion })}
                <label><span className="label">Investigation outcome</span><select name="outcome" required defaultValue={c.outcome ?? ""} className="input w-full"><option value="">Choose…</option>{Object.entries(OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
                <label><span className="label">Preventable?</span><select name="preventable" required defaultValue={c.preventable === null ? "" : c.preventable ? "yes" : "no"} className="input w-full"><option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                <label className="sm:col-span-2"><span className="label">Outcome summary and what will stop it happening again</span><textarea name="outcomeNote" required minLength={10} maxLength={4000} rows={3} defaultValue={c.outcomeNote ?? ""} className="input w-full" /></label>
                <div><button className="btn-primary" disabled={!c.reasonCode || !c.replacementType}>Send for manager sign-off</button></div>
                {!c.reasonCode || !c.replacementType ? <p className="text-[12.5px] text-slate-500">Record the reason and the replacement care first.</p> : null}
              </form>
            ) : null}
          </Step>

          <Step n={5} title="Manager sign-off" done={c.stage === "CLOSED"}>
            {c.stage === "CLOSED" ? (
              <>
                <p className="text-[14px]">Signed off by <b>{who(c.signedOffById)}</b> on {fmtDate(c.signedOffAt, true)}{c.signOffNote ? `: ${c.signOffNote}` : "."}</p>
                {d.canSignOff ? (
                  <form action={missedReopenAction} className="mt-2 flex flex-wrap items-end gap-2">
                    {hidden()}
                    <label className="min-w-[240px] flex-1"><span className="label">Reason to reopen</span><input name="reason" required minLength={5} className="input w-full" /></label>
                    <button className="btn-secondary">Reopen case</button>
                  </form>
                ) : null}
              </>
            ) : c.stage === "AWAITING_SIGNOFF" ? (
              d.canSignOff && !d.ownCase ? (
                <form action={missedSignOffAction} className="grid grid-cols-1 gap-2">
                  {hidden({ lockVersion: c.lockVersion })}
                  <label><span className="label">Sign-off note (needed when sending back)</span><textarea name="note" rows={2} maxLength={2000} className="input w-full" /></label>
                  <div className="flex gap-2">
                    <button name="decision" value="approve" className="btn-primary">Sign off and close</button>
                    <button name="decision" value="return" className="btn-secondary">Send back for more investigation</button>
                  </div>
                </form>
              ) : <p className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-[14px] text-slate-600">{d.ownCase ? "You investigated this missed call, so another care manager must sign it off." : "Waiting for a care manager to sign off."}</p>
            ) : <p className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-[14px] text-slate-600">Waiting for the outcome. A care manager signs off; the person who investigated cannot sign off their own case. Sign-off closes the case and keeps it on record; it can be reopened with a reason.</p>}
          </Step>
        </div>

        <aside className="space-y-3">
          <section className="panel" aria-label="The visit">
            <h2 className="mb-2 text-[16px] font-semibold">The visit</h2>
            <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-[14px]">
              <dt className="text-slate-600">Service user</dt><dd><Link href={`/rota/service-users/${c.visit.serviceUser.id}`}>{suName(c.visit.serviceUser)}</Link> {d.highRisk ? <Badge tone="rose">High risk</Badge> : null}</dd>
              <dt className="text-slate-600">Care worker</dt><dd>{d.carer ? <Link href={`/rota/staff/${d.carer.id}`}>{d.carer.displayName}</Link> : "Nobody was assigned"} {d.carerRepeat >= d.settings.repeatOffenderCount ? <Badge tone="rose">Repeat · {d.carerRepeat} in {d.settings.repeatWindowDays} days</Badge> : null}</dd>
              <dt className="text-slate-600">Visit</dt><dd><Link href={`/rota/visits/${c.visit.id}`}>{c.visit.reference}</Link> · {c.visit.carersRequired} {c.visit.carersRequired === 1 ? "carer" : "carers"}</dd>
              <dt className="text-slate-600">Status now</dt><dd>{VISIT_STATUS_NOW[c.visit.status]}{c.visit.actualStart ? ` (arrived ${londonTime(c.visit.actualStart)})` : ""}</dd>
              <dt className="text-slate-600">Missed after</dt><dd>{d.settings.missedAfterMin} min with no clock-in ({londonTime(c.detectedAt)})</dd>
              <dt className="text-slate-600">Deadline</dt><dd>{c.deadline ? `${londonTime(c.deadline)} ${fmtLondonDate(londonDate(c.deadline), { day: "numeric", month: "short" })}` : "—"} {d.overdue ? <Badge tone="rose">Overdue</Badge> : null}</dd>
              {c.escalationNote ? <><dt className="text-slate-600">Escalation</dt><dd>{c.escalationNote}</dd></> : null}
            </dl>
            {d.canWork && open && !c.escalatedAt ? (
              <form action={missedEscalateAction} className="mt-2 flex gap-2">
                {hidden()}
                <input name="note" required minLength={5} className="input min-w-0 flex-1" placeholder="Why a manager is needed" aria-label="Why a manager is needed" />
                <button className="btn-secondary border-[#b42a23] text-[#b42a23]">Escalate</button>
              </form>
            ) : null}
          </section>

          <section className="panel" aria-label="Care worker's missed calls">
            <h2 className="mb-1 text-[16px] font-semibold">Care worker&apos;s missed calls (90 days)</h2>
            {d.carer ? (
              d.carerHistory.length ? (
                <ul className="divide-y divide-slate-100 text-[13.5px]">{d.carerHistory.map((h) => <li key={h.id} className="flex gap-2 py-1"><Link href={`/rota/missed/${h.id}`}>{fmtLondonDate(londonDate(h.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}</Link><span>{suName(h.visit.serviceUser)} · {h.visit.callType.name}</span><span className="ml-auto"><Badge tone={STAGE_TONE[h.stage]}>{h.reasonCode ? reasonLabel(h.reasonCode) : STAGE_LABEL[h.stage]}</Badge></span></li>)}</ul>
              ) : <p className="text-[13.5px] text-slate-600">No other missed calls.</p>
            ) : <p className="text-[13.5px] text-slate-600">Nobody was assigned to this call.</p>}
            {d.carer ? <Link href={`/rota/staff/${d.carer.id}#missed`} className="text-[13px]">Full history →</Link> : null}
          </section>

          <section className="panel" aria-label="Service user's missed calls">
            <h2 className="mb-1 text-[16px] font-semibold">Service user&apos;s missed calls (90 days)</h2>
            {d.clientHistory.length ? (
              <ul className="divide-y divide-slate-100 text-[13.5px]">{d.clientHistory.map((h) => <li key={h.id} className="flex gap-2 py-1"><Link href={`/rota/missed/${h.id}`}>{fmtLondonDate(londonDate(h.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}</Link><span>{h.staffId ? d.historyStaff.get(h.staffId) ?? "Former staff member" : "Unassigned"} · {h.visit.callType.name}</span><span className="ml-auto"><Badge tone={STAGE_TONE[h.stage]}>{h.reasonCode ? reasonLabel(h.reasonCode) : STAGE_LABEL[h.stage]}</Badge></span></li>)}</ul>
            ) : <p className="text-[13.5px] text-slate-600">No other missed calls.</p>}
            <Link href={`/rota/service-users/${c.serviceUserId}?tab=missed`} className="text-[13px]">Full history →</Link>
          </section>

          <section className="panel" aria-label="Case history">
            <h2 className="mb-1 text-[16px] font-semibold">Case history</h2>
            <ul className="space-y-1.5 border-l-2 border-[#e3dff0] pl-3 text-[13.5px]">
              {timeline.map((t, i) => <li key={i}>{fmtDate(t.at, true)} · {t.text}<span className="block text-[12px] text-slate-500">{t.by}</span></li>)}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

const AUDIT_TEXT: Record<string, string> = {
  "rota.missed.coordinator": "Coordinator assigned",
  "rota.missed.reason": "Reason recorded",
  "rota.missed.replacement": "Replacement care recorded",
  "rota.missed.action.added": "Follow-up action added",
  "rota.missed.action.done": "Follow-up action done",
  "rota.missed.comment": "Comment added",
  "rota.missed.evidence": "Evidence attached",
  "rota.missed.escalated": "Escalated to the care managers",
  "rota.missed.submitted": "Outcome recorded and sent for sign-off",
  "rota.missed.signedoff": "Signed off and closed",
  "rota.missed.returned": "Sent back for more investigation",
  "rota.missed.reopened": "Reopened",
};

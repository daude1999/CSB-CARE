import Link from "@/components/link";
import type { ReadinessRequirement } from "@prisma/client";
import { londonDate } from "@/lib/london";
import { READINESS_LABEL, type ReadinessStatus } from "@/server/readiness";
import type { ComponentState } from "@/server/readiness/evaluate";
import type { staffReadiness } from "@/server/readiness";
import { addRestrictionAction, clearReviewAction, grantExceptionAction, liftRestrictionAction, raiseReviewAction, recordAssessmentAction, recordTrainingAction, revokeExceptionAction, verifyTrainingAction } from "@/app/readiness-actions";
import { Badge, Card, Empty, fmtDate, type Tone } from "@/components/ui";

export const READINESS_TONE: Record<ReadinessStatus, Tone> = { READY: "green", READY_WITH_RESTRICTIONS: "teal", NOT_READY: "rose", PENDING_VERIFICATION: "amber", REVIEW_REQUIRED: "violet" };

const isStatus = (s: string): s is ReadinessStatus => s in READINESS_LABEL;

/** Takes a string because snapshots store the status as text; anything unknown is shown as it is. */
export function ReadinessBadge({ status }: { status: string }) {
  return isStatus(status) ? <Badge tone={READINESS_TONE[status]}>{READINESS_LABEL[status]}</Badge> : <Badge>{status}</Badge>;
}

const STATE: Record<ComponentState, [string, Tone]> = {
  MET: ["Met", "green"],
  DUE_SOON: ["Due soon", "amber"],
  EXPIRED: ["Expired", "rose"],
  MISSING: ["Missing", "rose"],
  PENDING_VERIFICATION: ["Awaiting verification", "amber"],
  COMPETENCY_DUE: ["Competency due", "rose"],
  NOT_COMPETENT: ["Not yet competent", "rose"],
  EXCEPTION: ["Exception", "violet"],
  RESTRICTED: ["Restricted", "teal"],
};

const dateIso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

type Profile = Awaited<ReturnType<typeof staffReadiness>>;

/**
 * The readiness section of a staff member's rota page: the overall status worked out from evidence, each component
 * with its evidence, and the actions a manager can take. Every action is checked again on the server.
 */
export function ReadinessPanel({ profile, back, requirements, careTasks, serviceUsers, can, me }: {
  profile: Profile;
  back: string;
  requirements: ReadinessRequirement[];
  careTasks: { id: string; name: string }[];
  serviceUsers: { id: string; name: string }[];
  /** hrEvidence: may enter, verify or assess training and competency (an HR account covering this person). */
  can: { record: boolean; verify: boolean; exception: boolean; evidence: boolean; hrEvidence: boolean };
  me: string;
}) {
  const { staff, result, records, assessments, restrictions, exceptions, flags, history, names } = profile;
  const who = (id: string | null | undefined) => (id ? names.get(id) ?? "a member" : "—");
  const today = londonDate();
  const recordable = requirements.filter((r) => r.category !== "POLICY");
  const assessable = requirements.filter((r) => r.requiresPractical || r.category === "COMPETENCY");
  const exceptionable = requirements.filter((r) => r.exceptionAllowed);
  const pending = records.filter((r) => r.verificationStatus === "SUBMITTED");
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const common = <>{hidden("back", back)}{hidden("staffId", staff.id)}</>;

  return (
    <Card title="Staff readiness" actions={<span className="flex items-center gap-2"><ReadinessBadge status={result.status} />{can.evidence ? <a href={`/api/readiness/${staff.id}`} className="btn-secondary py-1 text-[13px]">Evidence pack (CSV)</a> : null}</span>}>
      <p className="mb-3 text-[13px] text-slate-600">Worked out now from the evidence below: HR checks, verified training, observed competency, policy acknowledgement, restrictions, exceptions and open reviews. Unverified evidence never counts as complete, and a policy acknowledgement is not training.</p>
      {result.reasons.length ? (
        <ul className="mb-3 list-disc space-y-0.5 pl-5 text-[13.5px] text-[#8a5a00]">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      ) : <p className="mb-3 text-[13.5px] text-[#1c7a43]">Every applicable requirement is met, in date and verified.</p>}

      <table className="table">
        <thead><tr><th>Requirement</th><th>Applies</th><th>State</th><th>Due</th><th>Evidence</th></tr></thead>
        <tbody>
          {result.components.map((c) => (
            <tr key={c.key}>
              <td>{c.name}{c.hardStop ? "" : <span className="text-slate-500"> (advisory)</span>}</td>
              <td className="text-[13px] text-slate-600">{c.category === "CHECK" ? "HR check" : c.taskLevel ? "For some tasks or people" : "Always"}</td>
              <td><Badge tone={STATE[c.state][1]} title={c.message}>{STATE[c.state][0]}</Badge></td>
              <td className="tabular-nums">{c.dueDate ? fmtDate(new Date(`${c.dueDate}T12:00:00Z`)) : "—"}</td>
              <td className="text-[13px]">
                {!can.evidence ? <span className="text-slate-500">Restricted</span> : c.evidence.length ? (
                  <details>
                    <summary className="cursor-pointer text-[#0646b1]">{c.evidence.length} item{c.evidence.length === 1 ? "" : "s"}</summary>
                    <ul className="mt-1 space-y-1 text-slate-700">{c.evidence.map((e) => <li key={e.kind + e.id}>{e.summary}</li>)}</ul>
                  </details>
                ) : <span className="text-slate-500">None</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pending.length && can.verify && can.hrEvidence ? (
        <section className="mt-4" aria-label="Evidence awaiting verification">
          <h3 className="mb-1.5 text-[15px]">Awaiting verification</h3>
          <ul className="rows">
            {pending.map((r) => (
              <li key={r.id} className="py-2 text-[14px]">
                <div>{r.requirement.name}: completed {fmtDate(r.completedAt)}{r.provider ? ` with ${r.provider}` : ""}{r.evidenceNote ? ` · ${r.evidenceNote}` : ""} <span className="text-slate-500">· entered by {who(r.enteredById)}</span></div>
                {r.enteredById === me ? <p className="text-[13px] text-slate-500">You entered this record, so someone else must verify it.</p> : (
                  <form action={verifyTrainingAction} className="mt-1 flex flex-wrap items-center gap-2">
                    {hidden("back", back)}{hidden("recordId", r.id)}
                    <input name="note" className="input w-64 py-1.5 text-[14px]" placeholder="Note (required to reject)" aria-label={`Verification note for ${r.requirement.name}`} />
                    <button name="decision" value="VERIFIED" className="btn-primary py-1">Verify</button>
                    <button name="decision" value="REJECTED" className="btn-secondary py-1">Reject</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2">
        {(can.record || can.verify) && !can.hrEvidence ? <p className="text-[13px] text-slate-500" data-testid="readiness-hr-only">Training and competency evidence is recorded and verified in HR & Workforce, by people with an HR account for this person.</p> : null}
        {can.record && can.hrEvidence ? (
          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-[14.5px] font-medium">Record training or a qualification</summary>
            <form action={recordTrainingAction} className="mt-2 grid grid-cols-2 gap-2">
              {common}
              <label className="col-span-2"><span className="label">Requirement</span><select name="requirementId" required className="input"><option value="">Choose…</option>{recordable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label><span className="label">Completed</span><input type="date" name="completedAt" required max={today} className="input" /></label>
              <label><span className="label">Expires (if the certificate says)</span><input type="date" name="expiresAt" className="input" /></label>
              <label><span className="label">Provider</span><input name="provider" className="input" /></label>
              <label><span className="label">Result</span><input name="result" className="input" placeholder="e.g. Pass" /></label>
              <label className="col-span-2"><span className="label">Evidence held</span><input name="evidenceNote" className="input" placeholder="e.g. certificate seen and filed in HR" /></label>
              <div className="col-span-2"><button className="btn-primary">Record</button> <span className="text-[13px] text-slate-500">It stays “awaiting verification” until someone else checks it.</span></div>
            </form>
          </details>
        ) : null}

        {can.verify && can.hrEvidence && assessable.length ? (
          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-[14.5px] font-medium">Record a competency assessment</summary>
            <form action={recordAssessmentAction} className="mt-2 grid grid-cols-2 gap-2">
              {common}
              <label className="col-span-2"><span className="label">Requirement</span><select name="requirementId" required className="input"><option value="">Choose…</option>{assessable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label><span className="label">Method</span><select name="method" className="input"><option value="OBSERVED">Observed in practice</option><option value="SIMULATED">Simulated</option><option value="DISCUSSION">Professional discussion</option><option value="WRITTEN">Written</option></select></label>
              <label><span className="label">Outcome</span><select name="outcome" className="input"><option value="COMPETENT">Competent</option><option value="COMPETENT_WITH_RESTRICTIONS">Competent with restrictions</option><option value="NOT_YET_COMPETENT">Not yet competent</option></select></label>
              <label><span className="label">Assessed on</span><input type="date" name="assessedAt" required max={today} defaultValue={today} className="input" /></label>
              <label><span className="label">Review due</span><input type="date" name="reviewDue" className="input" /></label>
              <label className="col-span-2"><span className="label">What was observed or discussed</span><textarea name="observedEvidence" required minLength={10} rows={2} className="input" /></label>
              <label><span className="label">Restrictions (if any)</span><input name="restrictions" className="input" /></label>
              <label><span className="label">Next steps (if not yet competent)</span><input name="remedialAction" className="input" /></label>
              <div className="col-span-2"><button className="btn-primary">Record assessment</button> <span className="text-[13px] text-slate-500">Recorded with you as the assessor. Nobody assesses their own competence.</span></div>
            </form>
          </details>
        ) : null}

        {can.verify ? (
          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-[14.5px] font-medium">Add a restriction</summary>
            <form action={addRestrictionAction} className="mt-2 grid grid-cols-2 gap-2">
              {common}
              <label><span className="label">Applies to</span><select name="kind" className="input"><option value="TASK">One care task</option><option value="SERVICE_USER">One service user</option><option value="GENERAL">All work</option></select></label>
              <label><span className="label">Care task</span><select name="careTaskId" className="input"><option value="">—</option>{careTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label className="col-span-2"><span className="label">Service user</span><select name="serviceUserId" className="input"><option value="">—</option>{serviceUsers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label><span className="label">From</span><input type="date" name="startsAt" required defaultValue={today} className="input" /></label>
              <label><span className="label">Until (optional)</span><input type="date" name="endsAt" className="input" /></label>
              <label className="col-span-2"><span className="label">Reason</span><input name="reason" required minLength={5} className="input" /></label>
              <div className="col-span-2"><button className="btn-primary">Add restriction</button></div>
            </form>
          </details>
        ) : null}

        {can.exception && exceptionable.length ? (
          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-[14.5px] font-medium">Grant a time-limited exception</summary>
            <form action={grantExceptionAction} className="mt-2 grid grid-cols-2 gap-2">
              {common}
              <label className="col-span-2"><span className="label">Requirement</span><select name="requirementId" required className="input"><option value="">Choose…</option>{exceptionable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label className="col-span-2"><span className="label">Operational reason</span><input name="reason" required minLength={10} className="input" /></label>
              <label className="col-span-2"><span className="label">Compensating controls</span><input name="compensatingControls" required minLength={10} className="input" placeholder="e.g. double-up visits only until assessed" /></label>
              <label><span className="label">Expires (at most 90 days)</span><input type="date" name="expiresAt" required min={today} className="input" /></label>
              <div className="col-span-2"><button className="btn-primary">Grant exception</button> <span className="text-[13px] text-slate-500">Legal requirements do not allow exceptions and are not listed.</span></div>
            </form>
          </details>
        ) : null}

        {can.verify ? (
          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-[14.5px] font-medium">Raise a review</summary>
            <form action={raiseReviewAction} className="mt-2 flex flex-wrap gap-2">
              {common}
              <input name="reason" required minLength={5} className="input min-w-0 flex-1" placeholder="What needs a manager to look again" aria-label="Review reason" />
              <button className="btn-secondary">Raise review</button>
            </form>
          </details>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Open reviews">
          <h3 className="mb-1.5 text-[15px]">Reviews</h3>
          {flags.length ? (
            <ul className="rows">{flags.map((f) => (
              <li key={f.id} className="py-2 text-[14px]">
                <div>{f.reason} <span className="text-slate-500">· raised {fmtDate(f.raisedAt, true)} by {f.raisedById ? who(f.raisedById) : "the system"}</span></div>
                {f.clearedAt ? <p className="text-[13px] text-slate-600">Cleared by {who(f.clearedById)} {fmtDate(f.clearedAt, true)}: {f.outcome}</p> : can.verify ? (
                  <form action={clearReviewAction} className="mt-1 flex flex-wrap gap-2">{hidden("back", back)}{hidden("flagId", f.id)}<input name="outcome" required minLength={5} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Outcome of the review" aria-label="Outcome of the review" /><button className="btn-secondary py-1">Clear</button></form>
                ) : <Badge tone="violet">Open</Badge>}
              </li>
            ))}</ul>
          ) : <Empty>No reviews raised.</Empty>}
        </section>
        <section aria-label="Restrictions and exceptions">
          <h3 className="mb-1.5 text-[15px]">Restrictions and exceptions</h3>
          {restrictions.length || exceptions.length ? (
            <ul className="rows">
              {restrictions.map((r) => (
                <li key={r.id} className="py-2 text-[14px]">
                  <div>Restriction ({r.kind.toLowerCase().replace("_", " ")}): {r.reason} <span className="text-slate-500">· from {fmtDate(r.startsAt)}{r.endsAt ? ` to ${fmtDate(r.endsAt)}` : ""}</span></div>
                  {r.liftedAt ? <p className="text-[13px] text-slate-600">Lifted by {who(r.liftedById)} {fmtDate(r.liftedAt, true)}: {r.liftedReason}</p> : can.verify ? (
                    <form action={liftRestrictionAction} className="mt-1 flex flex-wrap gap-2">{hidden("back", back)}{hidden("restrictionId", r.id)}<input name="reason" required minLength={3} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Why it is lifted" aria-label="Why the restriction is lifted" /><button className="btn-secondary py-1">Lift</button></form>
                  ) : null}
                </li>
              ))}
              {exceptions.map((e) => (
                <li key={e.id} className="py-2 text-[14px]">
                  <div>Exception for {e.requirement.name} until {fmtDate(e.expiresAt)}: {e.reason} <span className="text-slate-500">· controls: {e.compensatingControls} · approved by {who(e.approvedById)}</span></div>
                  {e.revokedAt ? <p className="text-[13px] text-slate-600">Revoked by {who(e.revokedById)} {fmtDate(e.revokedAt, true)}: {e.revokedReason}</p> : dateIso(e.expiresAt) < today ? <p className="text-[13px] text-slate-600">Expired.</p> : can.exception ? (
                    <form action={revokeExceptionAction} className="mt-1 flex flex-wrap gap-2">{hidden("back", back)}{hidden("exceptionId", e.id)}<input name="reason" required minLength={3} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Why it is revoked" aria-label="Why the exception is revoked" /><button className="btn-secondary py-1">Revoke</button></form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <Empty>None recorded.</Empty>}
        </section>
      </div>

      {can.evidence && (records.length || assessments.length) ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-[14.5px] font-medium">All training records and assessments ({records.length + assessments.length})</summary>
          <ul className="rows mt-1 text-[13.5px]">
            {records.map((r) => <li key={r.id} className="py-1.5">{r.requirement.name}: completed {fmtDate(r.completedAt)}{r.expiresAt ? `, expires ${fmtDate(r.expiresAt)}` : ""} · {r.verificationStatus.toLowerCase()}{r.verifiedById ? ` by ${who(r.verifiedById)}` : ""} · entered by {who(r.enteredById)}</li>)}
            {assessments.map((a) => <li key={a.id} className="py-1.5">{a.requirement.name}: {a.method.toLowerCase()} assessment {fmtDate(a.assessedAt)}, {a.outcome.replace(/_/g, " ").toLowerCase()} · assessor {who(a.assessorId)}{a.reviewDue ? ` · review ${fmtDate(a.reviewDue)}` : ""}</li>)}
          </ul>
        </details>
      ) : null}

      {history.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14.5px] font-medium">Status history</summary>
          <ul className="rows mt-1 text-[13.5px]">{history.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="tabular-nums text-slate-600">{fmtDate(h.evaluatedAt, true)}</span><ReadinessBadge status={h.status} /><span className="text-slate-600">{h.trigger}</span></li>)}</ul>
        </details>
      ) : null}
      <p className="mt-3 text-[12.5px] text-slate-500"><Link href="/rota/readiness">All staff readiness</Link></p>
    </Card>
  );
}

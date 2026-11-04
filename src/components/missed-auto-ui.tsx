import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { Badge, fmtDate, type Tone } from "@/components/ui";
import type { AutoStatus, AutomationDetail } from "@/server/rota/missed-auto/runs";
import type { EvidenceItem, TimelineEntry } from "@/server/rota/missed-auto/evidence";
import { ANSWER_LABEL } from "@/server/rota/missed-auto/evidence";
import { CONFIRMATION_LABEL } from "@/server/rota/missed-auto/confirmations";
import { CLASSIFICATION_LABEL, SUPPORT_LABEL } from "@/server/rota/missed-auto/suggest";
import { MISSED_REASONS } from "@/server/rota/missed-calls";
import { missedAcceptSuggestionAction, missedDismissSuggestionAction, missedRefreshEvidenceAction } from "@/app/missed-auto-actions";

/** The automated investigation on a missed-call case: what the system found, what the carers said and what it suggests. */

export const AUTO_TONE: Record<AutoStatus, Tone> = { off: "slate", collecting: "teal", failed: "rose", awaiting: "amber", urgent: "rose", ready: "violet", reviewed: "green", closed: "slate" };

export function AutoStatusBadge({ status, label }: { status: AutoStatus; label: string }) {
  return <Badge tone={AUTO_TONE[status]}>{label}</Badge>;
}

const KIND_LABEL: Record<TimelineEntry["kind"], string> = { SYSTEM: "System recorded", OFFICE: "Office recorded", CARER_REPORTED: "Reported by carer" };
const KIND_CLASS: Record<TimelineEntry["kind"], string> = { SYSTEM: "bg-[#eef2f6] text-[#344054]", OFFICE: "bg-[#e3effb] text-[#1d4f91]", CARER_REPORTED: "bg-[#fdf0d8] text-[#7a5200]" };

function KindTag({ kind }: { kind: TimelineEntry["kind"] }) {
  return <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-px text-[11.5px] font-semibold ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>;
}

const hm = (iso: string) => londonTime(new Date(iso));
const dayOf = (iso: string) => fmtLondonDate(londonDate(new Date(iso)), { day: "numeric", month: "short" });

export function EvidenceTimeline({ entries, names }: { entries: TimelineEntry[]; names?: Map<string, string> }) {
  if (!entries.length) return <p className="text-[14px] text-slate-600">No events recorded yet.</p>;
  let lastDay = "";
  return (
    <ol className="relative space-y-0 border-l-2 border-[#e3dff0] pl-4" aria-label="Investigation timeline">
      {entries.map((e, i) => {
        const day = dayOf(e.at);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <li key={`${e.sourceId ?? e.source}-${i}`} className="py-1.5">
            <span aria-hidden className="absolute -left-[5px] mt-[7px] h-2 w-2 rounded-full bg-[#5b2bb5]" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[14px]">
              <time dateTime={e.at} className="w-[3.2rem] shrink-0 font-semibold tabular-nums text-[#1b1340]">{hm(e.at)}</time>
              <span className="min-w-0 flex-1 text-[#101828]">{e.href ? <Link href={e.href} className="text-[#101828] underline decoration-[#d0d5dd] underline-offset-2 hover:decoration-[#5b2bb5]">{e.text}</Link> : e.text}{e.staffId && names?.get(e.staffId) && !e.text.includes(names.get(e.staffId)!) ? ` · ${names.get(e.staffId)}` : ""}</span>
              <KindTag kind={e.kind} />
            </div>
            <p className="ml-[3.7rem] text-[12.5px] text-[#475467]">{showDay ? `${day}. ` : ""}{e.recordedAt ? `Entered at ${hm(e.recordedAt)}${dayOf(e.recordedAt) !== day ? ` on ${dayOf(e.recordedAt)}` : ""}.` : ""}</p>
          </li>
        );
      })}
    </ol>
  );
}

const GROUP_LABEL: Record<EvidenceItem["group"], string> = { visit: "Scheduled visit", booking: "Carer booking", attendance: "Attendance", record: "Visit record", office: "Office activity", risk: "Service-user risk", carer: "Carer statements" };
const AVAIL: Record<EvidenceItem["availability"], { text: string; cls: string }> = {
  PRESENT: { text: "Found", cls: "text-[#1c7a43]" },
  ABSENT: { text: "Not found", cls: "text-[#a3242c]" },
  NOT_APPLICABLE: { text: "Not available", cls: "text-[#475467]" },
};

export function EvidenceTable({ items }: { items: EvidenceItem[] }) {
  const groups = (Object.keys(GROUP_LABEL) as EvidenceItem["group"][]).map((g) => [g, items.filter((i) => i.group === g)] as const).filter(([, xs]) => xs.length);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13.5px]">
        <caption className="sr-only">Evidence collected for this missed call</caption>
        <thead className="text-[12px] uppercase tracking-wide text-[#475467]">
          <tr className="border-b border-slate-200"><th scope="col" className="py-1.5 pr-3 font-semibold">Check</th><th scope="col" className="py-1.5 pr-3 font-semibold">What the record says</th><th scope="col" className="py-1.5 pr-3 font-semibold">Result</th><th scope="col" className="py-1.5 font-semibold">Source</th></tr>
        </thead>
        {groups.map(([g, xs]) => (
          <tbody key={g}>
            <tr><th scope="rowgroup" colSpan={4} className="bg-[#f9fafb] px-1 pb-1 pt-2 text-[12.5px] font-bold text-[#1b1340]">{GROUP_LABEL[g]}</th></tr>
            {xs.map((i) => (
              <tr key={i.key} className="border-b border-slate-100 align-top">
                <td className="py-1.5 pr-3 text-[#344054]">{i.label}</td>
                <td className="py-1.5 pr-3 text-[#101828]">{i.href ? <Link href={i.href}>{i.value}</Link> : i.value}{i.recordedAt ? <span className="block text-[12px] text-[#475467]">Entered at {hm(i.recordedAt)}</span> : null}</td>
                <td className={`py-1.5 pr-3 font-semibold ${AVAIL[i.availability].cls}`}>{AVAIL[i.availability].text}{i.kind === "CARER_REPORTED" && i.availability === "PRESENT" ? <span className="block text-[12px] font-normal text-[#7a5200]">Not verified</span> : null}</td>
                <td className="py-1.5"><KindTag kind={i.kind} /></td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function List({ title, items, tone = "default" }: { title: string; items: string[]; tone?: "default" | "warn" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-[13.5px] font-bold text-[#1b1340]">{title}</h4>
      <ul className={`list-disc space-y-0.5 pl-5 text-[14px] ${tone === "warn" ? "text-[#912018]" : "text-[#344054]"}`}>{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

/**
 * The "Automated investigation" section at the top of the missed-call case. It sits above the five investigation steps
 * and never replaces them: the reason, replacement care, outcome and sign-off are still recorded there by people.
 */
export function AutomatedInvestigation({ d, caseId, back, lockVersion, reasonRecorded, open }: { d: AutomationDetail; caseId: string; back: string; lockVersion: number; reasonRecorded: boolean; open: boolean }) {
  const hidden = (extra?: Record<string, string>) => (
    <>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="caseId" value={caseId} />
      {extra ? Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
    </>
  );
  const names = new Map(d.confirmations.map((c) => [c.staffId, c.staff.displayName]));
  const s = d.summary;
  const pending = d.draft?.reviewStatus === "PENDING";
  if (d.status === "off" && !d.runCount) {
    return (
      <section className="panel mb-3" aria-labelledby="auto-heading">
        <h2 id="auto-heading" className="text-[16px] font-semibold text-[#1b1340]">Automated investigation</h2>
        <p className="mt-1 text-[14px] text-slate-600">Switched off. An organisation admin can switch on evidence collection, carer confirmation and suggested reasons in {d.canConfigure ? <Link href="/rota/settings#missed-automation">Rostering settings</Link> : "Rostering settings"}. The investigation steps below work the same either way.</p>
      </section>
    );
  }
  return (
    <section className="panel mb-3" aria-labelledby="auto-heading" data-testid="automated-investigation">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="auto-heading" className="mr-auto text-[16px] font-semibold text-[#1b1340]">Automated investigation</h2>
        <AutoStatusBadge status={d.status} label={d.label} />
        {d.canRefresh ? <form action={missedRefreshEvidenceAction}>{hidden()}<button className="btn-secondary py-1 text-[13.5px]">Refresh evidence</button></form> : null}
      </div>
      <p className="mb-3 text-[13px] text-[#475467]">
        Gathered automatically from the system&apos;s own records{d.lastChecked?.finishedAt ? `; last checked ${fmtDate(d.lastChecked.finishedAt, true)}` : ""}{d.snapshotRun?.finishedAt && d.lastChecked && d.snapshotRun.id !== d.lastChecked.id ? `, no change since ${fmtDate(d.snapshotRun.finishedAt, true)}` : ""}. Nothing here changes the visit, its clock times or this case: the steps below are still recorded and signed off by people.
      </p>
      {d.failedRun ? <p role="alert" className="mb-3 rounded-[8px] border border-[#f3c1bd] bg-[#fef3f2] px-3 py-2 text-[14px] text-[#912018]">The last evidence check failed at {fmtDate(d.failedRun.startedAt, true)}. It is retried automatically{d.canRefresh ? ", or use Refresh evidence" : ""}. The case and its alert are not affected.</p> : null}

      {s ? (
        <div className="mb-3 rounded-[10px] border border-[#e3dff0] bg-[#faf8ff] p-3" data-testid="auto-suggestion">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-[#1b1340]">{CLASSIFICATION_LABEL[s.classification]}</h3>
            <Badge tone={s.support === "SUPPORTED" ? "green" : s.support === "WEAK" ? "amber" : "slate"}>{SUPPORT_LABEL[s.support]}</Badge>
            {s.urgent ? <Badge tone="rose">Urgent review</Badge> : null}
          </div>
          <p className="mb-2 text-[14px] text-[#344054]">Suggested reason: <b className="text-[#101828]">{s.suggestedReason ? MISSED_REASONS[s.suggestedReason]?.label ?? s.suggestedReason : "none: the evidence does not support one yet"}</b>. This is a suggestion made by fixed rules, not a finding.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <List title="What the system found" items={s.found} />
            <List title="What the carer reported" items={s.reported.length ? s.reported : ["No carer statement yet."]} />
            <List title="Conflicting information" items={s.conflicts} tone="warn" />
            <List title="What remains unverified or missing" items={[...s.unverified, ...s.missing]} />
            <List title="Recommended next action" items={s.nextActions} />
          </div>
          {pending && d.canReview && open && !reasonRecorded ? (
            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[#e3dff0] pt-3 md:grid-cols-2">
              {s.suggestedReason ? (
                <form action={missedAcceptSuggestionAction} className="flex flex-col gap-2">
                  {hidden({ draftId: d.draft!.id, lockVersion: String(lockVersion) })}
                  <label><span className="label">Your findings (needed to accept)</span><textarea name="findings" required minLength={10} maxLength={4000} rows={2} className="input w-full" placeholder="What you checked and who you spoke to" /></label>
                  <div><button className="btn-primary">Accept suggested reason</button></div>
                </form>
              ) : null}
              <div className="flex flex-col gap-2">
                <a href="#step-1" className="btn-secondary self-start">Choose another reason</a>
                <form action={missedDismissSuggestionAction} className="flex flex-col gap-2">
                  {hidden({ draftId: d.draft!.id })}
                  <label><span className="label">Or dismiss it: why it does not fit</span><input name="note" required minLength={5} maxLength={1000} className="input w-full" /></label>
                  <div><button className="btn-secondary">Dismiss suggestion</button></div>
                </form>
              </div>
            </div>
          ) : d.draft && d.draft.reviewStatus !== "PENDING" ? (
            <p className="mt-2 text-[13px] text-[#475467]">{d.draft.reviewStatus === "ACCEPTED" ? "Accepted" : d.draft.reviewStatus === "DIFFERENT_REASON" ? "A different reason was recorded" : d.draft.reviewStatus === "DISMISSED" ? `Dismissed${d.draft.reviewNote ? `: ${d.draft.reviewNote}` : ""}` : "Replaced by a newer check"}{d.reviewerName ? ` by ${d.reviewerName}` : ""}{d.draft.reviewedAt ? `, ${fmtDate(d.draft.reviewedAt, true)}` : ""}.</p>
          ) : reasonRecorded ? <p className="mt-2 text-[13px] text-[#475467]">A reason is already recorded in step 1.</p> : null}
        </div>
      ) : d.switches.summary ? null : <p className="mb-3 text-[13.5px] text-[#475467]">Suggested reasons are switched off, so only the evidence is shown.</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h3 className="mb-1 text-[14.5px] font-bold text-[#1b1340]">Carer confirmation</h3>
          {d.confirmations.length ? (
            <ul className="space-y-2" aria-label="Carer confirmation">
              {d.confirmations.map((c) => (
                <li key={c.id} className="rounded-[8px] border border-slate-200 p-2.5 text-[14px]">
                  <div className="flex flex-wrap items-center gap-2"><b className="mr-auto">{c.staff.displayName}</b><Badge tone={c.status === "RESPONDED" ? "green" : c.status === "REQUESTED" ? "amber" : c.status === "NO_RESPONSE" || c.status === "NO_LOGIN" ? "rose" : "slate"}>{CONFIRMATION_LABEL[c.status] ?? c.status}</Badge></div>
                  <p className="text-[12.5px] text-[#475467]">{c.requestedAt ? `Asked ${fmtDate(c.requestedAt, true)}` : "Not asked in the app"}{c.responseDueAt && c.status === "REQUESTED" ? ` · answer due ${londonTime(c.responseDueAt)}` : ""}{c.remindersSent ? ` · ${c.remindersSent} reminder${c.remindersSent === 1 ? "" : "s"}` : ""}{c.notificationOpenedAt ? ` · notification opened ${londonTime(c.notificationOpenedAt)}` : c.requestedAt ? " · notification not opened yet" : ""}</p>
                  {c.responses.map((r) => (
                    <div key={r.id} className="mt-1.5 border-l-2 border-[#fdf0d8] pl-2">
                      <p><span className="text-[12px] font-semibold uppercase tracking-wide text-[#7a5200]">{r.supplementsId ? "Further statement" : "Statement"} · {fmtDate(r.submittedAt, true)}</span></p>
                      <p className="font-semibold">“{ANSWER_LABEL[r.answer] ?? r.answer}”</p>
                      <p className="text-[13.5px] text-[#344054]">{[r.reportedArrival ? `Arrived ${londonTime(r.reportedArrival)}` : null, r.reportedDeparture ? `left ${londonTime(r.reportedDeparture)}` : null, r.careDelivered ? `care delivered: ${r.careDelivered.toLowerCase()}` : null, r.unableReason ? `reason: ${r.unableReason.toLowerCase()}` : null, r.notifiedSomeone !== null ? (r.notifiedSomeone ? `told ${r.notifiedWho ?? "someone"}${r.notifiedAt ? ` at ${londonTime(r.notifiedAt)}` : ""}` : "told nobody") : null, r.attemptedAt ? `tried to get in at ${londonTime(r.attemptedAt)}` : null, r.contacted ? `contacted ${r.contacted}` : null].filter(Boolean).join(", ")}</p>
                      {r.explanation ? <p className="whitespace-pre-wrap text-[13.5px] text-[#101828]">{r.explanation}</p> : null}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-slate-600">Nobody was booked on the visit, so there is no carer to ask.</p>}
          {!d.switches.confirm ? <p className="mt-2 text-[12.5px] text-[#475467]">Carer confirmation in the app is switched off.</p> : null}
          <p className="mt-2 text-[12.5px] text-[#475467]">A carer&apos;s statement is their own account. It does not record attendance or change any clock time; a missing clock time still needs a clock correction, decided by someone else.</p>
        </div>
        <div>
          <h3 className="mb-1 text-[14.5px] font-bold text-[#1b1340]">Timeline</h3>
          <EvidenceTimeline entries={d.timeline} names={names} />
        </div>
      </div>

      {d.items.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14px] font-semibold text-[#5b2bb5]">View all evidence checked ({d.items.length})</summary>
          <div className="mt-2"><EvidenceTable items={d.items} /></div>
        </details>
      ) : null}
    </section>
  );
}

import { notFound } from "next/navigation";
import { HrPageHeader } from "@/components/module-header";
import type { ReactNode } from "react";
import { ArrowSquareOut, CheckCircle, PencilSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { addDays, fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getCandidate } from "@/server/recruitment/candidates";
import { staffChoices } from "@/server/recruitment/access";
import { onboardingStatus, possibleMatches, suggestStaffId } from "@/server/recruitment/onboarding";
import { canClose, CHANNEL_LABEL, COMMON_DOCUMENTS, DRIVING_LABEL, INTERVIEW_LABEL, isOpen, manualMoves, readyBlockers, SCREENING_QUESTIONS, STAGE_LABEL } from "@/server/recruitment/model";
import { read as readHr } from "@/hr/lib/workspace-tx";
import { employeeRoute } from "@/hr/lib/routes";
import { candidateNoteAction, closeCandidateAction, eraseCandidateAction, giveScreeningAction, interviewAction, makeOfferAction, markReadyAction, moveStageAction, offerResponseAction, reopenCandidateAction, scheduleInterviewAction, screeningAnswersAction, screeningReviewAction, startOnboardingAction, updateCandidateAction } from "@/app/recruitment-actions";
import { Empty, Flash } from "@/components/ui";
import { CandidateFields, DL, EligibilityPill, R_PANEL, R_PRIMARY, R_SECONDARY, RtwBadge, Section, StageBadge, StageSteps } from "@/components/recruitment-ui";

export const dynamic = "force-dynamic";

const INPUT = "h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px]";
const AREA = "w-full rounded-[8px] border border-[#d0d5dd] bg-white px-3 py-2 text-[14px]";
const LABEL = "mb-1 block text-[13.5px] font-semibold text-[#344054]";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Application recorded",
  UPDATED: "Details changed",
  NOTE: "Note added",
  STAGE: "Stage changed",
  CLOSED: "Application closed",
  REOPENED: "Application reopened",
  ERASED: "Personal details removed",
  SCREENING_GIVEN: "Screening questions given",
  SCREENING_ANSWERED: "Screening answers recorded",
  SCREENING_REVIEWED: "Screening reviewed",
  INTERVIEW_BOOKED: "Interview booked",
  INTERVIEW_CONFIRM: "Interview confirmed by the candidate",
  INTERVIEW_DECLINE: "Candidate declined the interview",
  INTERVIEW_CANCEL: "Interview cancelled",
  INTERVIEW_NO_SHOW: "Candidate did not attend",
  INTERVIEW_OUTCOME: "Interview outcome recorded",
  OFFER_MADE: "Offer made",
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  ONBOARDING_STARTED: "Onboarding started: employee created in HR",
  ONBOARDING_LINKED: "Onboarding started: linked to an existing HR record",
  READY: "Recorded as Ready for Work",
};

function Hidden({ back, candidateId, lockVersion }: { back: string; candidateId: string; lockVersion?: number }) {
  return (
    <>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="candidateId" value={candidateId} />
      {lockVersion !== undefined ? <input type="hidden" name="lockVersion" value={lockVersion} /> : null}
    </>
  );
}

function Callout({ tone, children }: { tone: "info" | "warn" | "good"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-[#fedf89] bg-[#fffaeb] text-[#7a2e0e]" : tone === "good" ? "border-[#abefc6] bg-[#ecfdf3] text-[#054f31]" : "border-[#d0d5dd] bg-[#f9fafb] text-[#344054]";
  return <div role="note" className={`rounded-[8px] border px-3 py-2 text-[13.5px] ${cls}`}>{children}</div>;
}

/**
 * One candidate: where they are, the one obvious next step, their application, screening, interviews, notes and history,
 * and — once onboarding starts — the HR checks and the rota's own readiness verdict for the linked employee.
 */
export default async function CandidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePortal("hr");
  const r = await getCandidate(ctx, id).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!r) notFound();
  const { candidate: c, access: a, next } = r;
  const base = `/hr/recruitment/${c.id}`;
  const people = await staffChoices(a.organisationId);
  const who = (uid: string | null | undefined) => (uid ? people.find((p) => p.id === uid)?.name ?? "Former member" : "—");
  const branch = a.branches.find((b) => b.id === c.branchId);
  const editing = sp.edit === "1" && a.canEdit && isOpen(c.stage) && !c.anonymisedAt;
  const now = new Date();
  const open = isOpen(c.stage);
  const screening = c.screenings[0] ?? null;
  const live = c.interviews.filter((i) => i.status === "AWAITING_CONFIRMATION" || i.status === "CONFIRMED");
  const passed = c.interviews.some((i) => i.outcome === "PASSED");
  const hrState = c.stage === "OFFER" && c.offerResponse === "ACCEPTED" ? await readHr(a.organisationId) : null;
  const matches = hrState ? possibleMatches(hrState, a.hrUser.org, a.hrUser.branches, c.email, `${c.firstName} ${c.lastName}`) : [];
  const onboard = c.hrEmployeeId ? await onboardingStatus(a.organisationId, c.hrEmployeeId) : null;
  const blockers = onboard ? readyBlockers({ employeeStatus: onboard.employee?.status ?? null, outstandingDocuments: c.outstandingDocuments, rightToWork: c.rightToWork }) : [];
  const canRota = hasOrgPermission(ctx, "readiness.view");
  const today = londonDate();
  const erasable = !open && !c.anonymisedAt && c.retainUntil && fromDbDate(c.retainUntil) < today;

  // The one obvious next step for this stage.
  let step: ReactNode = null;
  if (a.canEdit && !c.anonymisedAt) {
    if (c.stage === "APPLIED" || (c.stage === "SCREENING" && !screening)) {
      step = (
        <div className="flex flex-wrap items-end gap-2">
          <form action={giveScreeningAction} className="flex flex-wrap items-end gap-2">
            <Hidden back={base} candidateId={c.id} />
            <label><span className={LABEL}>Ask the screening questions</span><select name="channel" defaultValue="PHONE" className={INPUT}><option value="PHONE">By phone</option><option value="IN_PERSON">In person</option><option value="PAPER">On a paper form</option></select></label>
            <button className={R_PRIMARY}>Ask Screening Questions</button>
          </form>
          <a href="#book" className={R_SECONDARY}>Book Interview instead</a>
        </div>
      );
    } else if (c.stage === "SCREENING" && screening && !screening.answeredAt) {
      step = <a href="#screening" className={R_PRIMARY}>Record Screening Answers</a>;
    } else if (c.stage === "SCREENING" && screening && !screening.reviewOutcome) {
      step = <a href="#screening" className={R_PRIMARY}>Review Screening Answers</a>;
    } else if (c.stage === "SCREENING" || (c.stage === "INTERVIEW" && !live.length && !passed && !c.interviews.some((i) => i.status === "COMPLETED" && !i.outcome))) {
      step = <a href="#book" className={R_PRIMARY}>Book Interview</a>;
    } else if (c.stage === "INTERVIEW" && passed) {
      step = (
        <form action={makeOfferAction}>
          <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
          <button className={R_PRIMARY}>Record Offer Made</button>
          <p className="mt-1.5 text-[12.5px] text-[#667085]">Records that you have offered the job. The platform does not send the offer.</p>
        </form>
      );
    } else if (c.stage === "INTERVIEW") {
      step = <a href="#interviews" className={R_PRIMARY}>Open Interviews</a>;
    } else if (c.stage === "OFFER" && c.offerResponse === "PENDING") {
      step = (
        <form action={offerResponseAction} className="flex flex-wrap gap-2">
          <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
          <button name="response" value="ACCEPTED" className={R_PRIMARY}>Offer Accepted</button>
          <button name="response" value="DECLINED" className={R_SECONDARY}>Offer Declined</button>
        </form>
      );
    } else if (c.stage === "OFFER" && c.offerResponse === "ACCEPTED" && a.canAuthorise && hrState) {
      step = (
        <div className="space-y-3">
          {matches.length ? (
            <form action={startOnboardingAction} className="space-y-2">
              <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
              <input type="hidden" name="mode" value="link" />
              <Callout tone="warn">HR already has a record that may be this person. Link to it rather than creating a second employee.</Callout>
              <label><span className={LABEL}>Existing HR record</span><select name="linkEmployeeId" className={INPUT}>{matches.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.staffId} · {m.job} ({m.status === "Onboarding" ? "New starter" : m.status})</option>)}</select></label>
              <button className={R_PRIMARY}>Start Onboarding with This Record</button>
            </form>
          ) : (
            <form action={startOnboardingAction} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
              <input type="hidden" name="mode" value="create" />
              <label><span className={LABEL}>Staff ID in HR</span><input name="staffId" required pattern="[A-Za-z0-9_-]{2,40}" defaultValue={suggestStaffId(hrState, a.hrUser.org)} className={INPUT} /></label>
              <label><span className={LABEL}>Start date</span><input name="start" type="date" required defaultValue={addDays(today, 14)} className={INPUT} /></label>
              <button className={R_PRIMARY}>Start Onboarding</button>
            </form>
          )}
          <p className="text-[12.5px] text-[#667085]">Creates {matches.length ? "the link to" : ""} the employee in HR &amp; Workforce as a New starter, with the standard checks (DBS, right to work, safeguarding training), your onboarding requirements and an HR task for each outstanding document. A new starter can only shadow on the rota until HR makes them Active and their checks are verified.</p>
        </div>
      );
    } else if (c.stage === "OFFER" && c.offerResponse === "DECLINED") {
      step = <a href="#close" className={R_PRIMARY}>Close the Application</a>;
    } else if (c.stage === "ONBOARDING") {
      step = blockers.length ? (
        <div className="space-y-2">
          <Callout tone="warn"><strong>Not ready to record as Ready for Work:</strong><ul className="mt-1 list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Callout>
          {c.hrEmployeeId && branch ? <a href={`/hr${employeeRoute(c.hrEmployeeId, branch.hrBranchKey, base)}`} className={R_PRIMARY}>Open Employee Record in HR<ArrowSquareOut size={16} aria-hidden /></a> : null}
        </div>
      ) : (
        <form action={markReadyAction}>
          <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
          <button className={R_PRIMARY}>Record Ready for Work</button>
          <p className="mt-1.5 text-[12.5px] text-[#667085]">This records HR&apos;s decision. It does not make anyone bookable: the rota checks readiness itself at every booking.</p>
        </form>
      );
    } else if (!open && !c.anonymisedAt) {
      step = (
        <form action={reopenCandidateAction}>
          <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
          <button className={R_SECONDARY}>Reopen Application</button>
        </form>
      );
    }
  }

  return (
    <div className="-mt-1">
      <HrPageHeader
        title={c.anonymisedAt ? `Application ${c.reference}` : `${c.firstName} ${c.lastName}`}
        back="/hr/recruitment"
        subtitle={<>{c.reference} · {c.roleApplied} · {branch?.name ?? "—"} · recruiter {who(c.recruiterId)}</>}
        actions={a.canEdit && open && !c.anonymisedAt && !editing ? <Link href={`${base}?edit=1`} className={R_SECONDARY}><PencilSimple size={16} aria-hidden />Edit Details</Link> : null}
      />
      <Flash searchParams={sp} />

      <section aria-label="Stage" className={`${R_PANEL} mb-3 flex flex-wrap items-center gap-3 px-4 py-3`}>
        {open ? <StageSteps stage={c.stage} /> : <><StageBadge stage={c.stage} /><span className="text-[14px] text-[#475467]">Closed {c.closedAt ? fmtLondonDate(londonDate(c.closedAt)) : ""}{c.closedReason ? `: ${c.closedReason}` : ""}. {c.anonymisedAt ? "Personal details removed." : c.retainUntil ? `Kept until ${fmtLondonDate(fromDbDate(c.retainUntil))}.` : ""}</span></>}
      </section>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <section aria-labelledby="next-h" className={`${R_PANEL} border-l-4 border-l-[#c2410c] px-4 py-3`}>
            <h2 id="next-h" className="text-[13px] font-semibold uppercase tracking-[0.03em] text-[#9a3412]">Next step</h2>
            <p className="mb-2.5 text-[17px] font-bold text-[#101828]" data-testid="next-step">{next}</p>
            {step}
            {a.canEdit && manualMoves(c.stage).length ? (
              <form action={moveStageAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#f2f4f7] pt-2.5 text-[13.5px]">
                <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
                <span className="text-[#475467]">Move to another stage:</span>
                {manualMoves(c.stage).map((s) => <button key={s} name="to" value={s} className="rounded-[6px] border border-[#d0d5dd] px-2.5 py-1 font-semibold text-[#344054] hover:bg-slate-50">{STAGE_LABEL[s]}</button>)}
              </form>
            ) : null}
          </section>

          {editing ? (
            <form action={updateCandidateAction} className={`${R_PANEL} p-4`} aria-label="Edit candidate">
              <Hidden back={`${base}?edit=1`} candidateId={c.id} lockVersion={c.lockVersion} />
              <CandidateFields branches={a.branches} recruiters={people.filter((p) => p.hr)} documents={COMMON_DOCUMENTS} v={{ ...c, nextActionDue: c.nextActionDue ? fromDbDate(c.nextActionDue) : null }} />
              <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eaecf0] pt-4">
                <button className={R_PRIMARY}>Save Details</button>
                <Link href={base} className={R_SECONDARY}>Cancel</Link>
              </div>
            </form>
          ) : (
            <Section id="details-h" title="Application">
              <DL
                items={[
                  ["Email", c.email ?? "—"],
                  ["Phone", c.phone ?? "—"],
                  ["Contact consent", c.contactConsent ? `Agreed ${c.consentRecordedAt ? fmtLondonDate(londonDate(c.consentRecordedAt)) : ""}` : <span className="text-[#b54708]">Not recorded</span>],
                  ["Availability", c.availability ?? "—"],
                  ["Relevant experience", c.experience ?? "—"],
                  ["Driving", DRIVING_LABEL[c.driving] ?? c.driving],
                  ["Right to work", <RtwBadge key="r" status={c.rightToWork} />],
                  ["Application", c.applicationComplete ? "Complete" : <span key="i" className="font-semibold text-[#b54708]">Missing details</span>],
                  ["Came from", c.source ?? "—"],
                ]}
              />
            </Section>
          )}

          <Section id="screening-h" title="Screening">
            <div id="screening" className="space-y-3">
              {!screening ? <p className="text-[14px] text-[#667085]">The screening questions have not been asked yet.</p> : (
                <>
                  <p className="text-[13.5px] text-[#475467]">Asked {CHANNEL_LABEL[screening.channel]?.toLowerCase()} on {fmtLondonDate(londonDate(screening.sentAt))} by {who(screening.sentById)}.{screening.answeredAt ? ` Answers recorded by ${who(screening.recordedById)}.` : ""}</p>
                  {screening.answeredAt ? (
                    <dl className="space-y-2">
                      {(screening.answers as { key: string; answer: string }[] | null ?? []).map((x) => (
                        <div key={x.key}><dt className="text-[13.5px] font-semibold text-[#344054]">{SCREENING_QUESTIONS.find((q) => q.key === x.key)?.question ?? x.key}</dt><dd className="whitespace-pre-line text-[14px]">{x.answer || <span className="text-[#98a2b3]">No answer</span>}</dd></div>
                      ))}
                    </dl>
                  ) : a.canEdit ? (
                    <form action={screeningAnswersAction} className="space-y-2">
                      <input type="hidden" name="back" value={`${base}#screening`} />
                      <input type="hidden" name="screeningId" value={screening.id} />
                      {SCREENING_QUESTIONS.map((q) => <label key={q.key} className="block"><span className={LABEL}>{q.question}</span><textarea name={`answer.${q.key}`} rows={2} maxLength={2000} className={AREA} /></label>)}
                      <button className={R_PRIMARY}>Save Answers</button>
                    </form>
                  ) : <p className="text-[14px] text-[#667085]">Answers not recorded yet.</p>}
                  {screening.answeredAt && screening.reviewOutcome ? (
                    <Callout tone={screening.reviewOutcome === "PROCEED" ? "good" : "warn"}><strong>{screening.reviewOutcome === "PROCEED" ? "Continue to interview" : "On hold"}</strong>, decided by {who(screening.reviewedById)}{screening.reviewedAt ? ` on ${fmtLondonDate(londonDate(screening.reviewedAt))}` : ""}.{screening.reviewNote ? ` ${screening.reviewNote}` : ""}</Callout>
                  ) : screening.answeredAt && a.canEdit ? (
                    <form action={screeningReviewAction} className="space-y-2 rounded-[8px] bg-[#f9fafb] p-3">
                      <input type="hidden" name="back" value={`${base}#screening`} />
                      <input type="hidden" name="screeningId" value={screening.id} />
                      <label className="block"><span className={LABEL}>Your decision note (optional)</span><input name="note" maxLength={1000} className={INPUT} /></label>
                      <div className="flex flex-wrap gap-2"><button name="outcome" value="PROCEED" className={R_PRIMARY}>Continue to Interview</button><button name="outcome" value="HOLD" className={R_SECONDARY}>Put on Hold</button></div>
                      <p className="text-[12.5px] text-[#667085]">A person decides. The platform does not score, rank or reject applicants.</p>
                    </form>
                  ) : null}
                </>
              )}
            </div>
          </Section>

          <Section id="interviews-h" title="Interviews">
            <div id="interviews" className="space-y-3">
              {c.interviews.length ? (
                <ul className="divide-y divide-[#f2f4f7]">
                  {c.interviews.map((i) => {
                    const past = i.startsAt <= now;
                    const isLive = i.status === "AWAITING_CONFIRMATION" || i.status === "CONFIRMED";
                    return (
                      <li key={i.id} className="py-2.5">
                        <div className="flex flex-wrap items-center gap-2 text-[14px]">
                          <span className="font-semibold tabular-nums">{fmtLondonDate(londonDate(i.startsAt), { weekday: "short", day: "numeric", month: "short", year: "numeric" })} at {londonTime(i.startsAt)}</span>
                          <span className="text-[#475467]">· {i.durationMin} min · {who(i.interviewerId)}{i.location ? ` · ${i.location}` : ""}</span>
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${i.status === "CONFIRMED" || i.outcome === "PASSED" ? "bg-[#ecfdf3] text-[#067647]" : i.status === "AWAITING_CONFIRMATION" ? "bg-[#fffaeb] text-[#b54708]" : "bg-[#f2f4f7] text-[#475467]"}`}>{i.outcome ? (i.outcome === "PASSED" ? "Passed" : "Not passed") : INTERVIEW_LABEL[i.status]}</span>
                        </div>
                        {i.notes ? <p className="mt-1 whitespace-pre-line text-[13.5px] text-[#344054]">{i.notes}</p> : null}
                        {a.canEdit && isLive ? (
                          <form action={interviewAction} className="mt-2 flex flex-wrap gap-2">
                            <input type="hidden" name="back" value={`${base}#interviews`} />
                            <input type="hidden" name="interviewId" value={i.id} />
                            {i.status === "AWAITING_CONFIRMATION" && !past ? <button name="action" value="confirm" className={R_SECONDARY}>Candidate Confirmed</button> : null}
                            {!past ? <button name="action" value="decline" className={R_SECONDARY}>Candidate Declined</button> : null}
                            {!past ? <button name="action" value="cancel" className={R_SECONDARY}>Cancel Interview</button> : null}
                            {past ? <button name="action" value="no_show" className={R_SECONDARY}>Did Not Attend</button> : null}
                          </form>
                        ) : null}
                        {a.canEdit && past && (isLive || (i.status === "COMPLETED" && !i.outcome)) ? (
                          <form action={interviewAction} className="mt-2 space-y-2 rounded-[8px] bg-[#f9fafb] p-3">
                            <input type="hidden" name="back" value={`${base}#interviews`} />
                            <input type="hidden" name="interviewId" value={i.id} />
                            <input type="hidden" name="action" value="outcome" />
                            <label className="block"><span className={LABEL}>Interview notes</span><textarea name="notes" rows={3} required minLength={3} maxLength={4000} className={AREA} /></label>
                            <fieldset className="flex flex-wrap gap-4 text-[14px]"><legend className={LABEL}>Outcome, decided by the interviewer</legend><label className="flex items-center gap-2"><input type="radio" name="outcome" value="PASSED" required />Passed</label><label className="flex items-center gap-2"><input type="radio" name="outcome" value="NOT_PASSED" />Not passed</label></fieldset>
                            <button className={R_PRIMARY}>Save Outcome</button>
                          </form>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[14px] text-[#667085]">No interviews yet.</p>}
              {a.canEdit && ["APPLIED", "SCREENING", "INTERVIEW"].includes(c.stage) && !c.anonymisedAt ? (
                <form id="book" action={scheduleInterviewAction} className="grid grid-cols-1 items-end gap-2 rounded-[8px] border border-dashed border-[#d0d5dd] p-3 sm:grid-cols-2 lg:grid-cols-[1fr_120px_110px_1.3fr_1.3fr_auto]">
                  <Hidden back={`${base}#interviews`} candidateId={c.id} />
                  <label><span className={LABEL}>Date</span><input type="date" name="date" required min={today} defaultValue={addDays(today, 2)} className={INPUT} /></label>
                  <label><span className={LABEL}>Time</span><input type="time" name="time" required defaultValue="10:00" className={INPUT} /></label>
                  <label><span className={LABEL}>Minutes</span><input type="number" name="durationMin" min={10} max={480} step={5} defaultValue={45} className={INPUT} /></label>
                  <label><span className={LABEL}>Interviewer</span><select name="interviewerId" required defaultValue={c.recruiterId ?? ctx.userId} className={INPUT}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label><span className={LABEL}>Where</span><input name="location" maxLength={160} placeholder="Office, video call…" className={INPUT} /></label>
                  <button className={R_PRIMARY}>Book Interview</button>
                  <p className="text-[12.5px] text-[#667085] sm:col-span-2 lg:col-span-6">Booked in the platform only. No external calendar is connected, so tell the candidate yourself and record their confirmation here.</p>
                </form>
              ) : null}
            </div>
          </Section>

          <Section id="notes-h" title="Notes">
            {a.canEdit && !c.anonymisedAt ? (
              <form action={candidateNoteAction} className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <Hidden back={base} candidateId={c.id} />
                <label className="flex-1"><span className="sr-only">New note</span><textarea name="note" rows={2} required minLength={2} maxLength={4000} placeholder="Add a recruitment note…" className={AREA} /></label>
                <button className={R_SECONDARY}>Add Note</button>
              </form>
            ) : null}
            {c.notes.length ? (
              <ul className="divide-y divide-[#f2f4f7]">
                {c.notes.map((n) => <li key={n.id} className="py-2 text-[14px]"><p className="whitespace-pre-line">{n.text}</p><span className="text-[12.5px] text-[#667085]">{who(n.authorId)} · {fmtLondonDate(londonDate(n.createdAt))} {londonTime(n.createdAt)}</span></li>)}
              </ul>
            ) : <Empty>No notes yet.</Empty>}
          </Section>

          <Section id="history-h" title="History">
            <ol className="space-y-1.5 text-[13.5px]">
              {c.events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2">
                  <span className="w-[150px] shrink-0 tabular-nums text-[#667085]">{fmtLondonDate(londonDate(e.at), { day: "numeric", month: "short", year: "numeric" })} {londonTime(e.at)}</span>
                  <span className="font-medium text-[#101828]">{EVENT_LABEL[e.type] ?? e.type}{e.toStage && e.type === "STAGE" ? `: ${STAGE_LABEL[e.toStage]}` : ""}</span>
                  <span className="text-[#475467]">by {who(e.actorId)}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="space-y-3" aria-label="Onboarding and readiness">
          {onboard ? (
            <Section id="ready-h" title="Onboarding and staff readiness">
              <div className="space-y-3 text-[14px]" data-testid="onboarding-panel">
                <p className="text-[13.5px] text-[#475467]">From the employee&apos;s HR record and the rota&apos;s own rules. Nothing here is copied or set by recruitment.</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">HR status</span>
                  <span>{onboard.employee ? (onboard.employee.status === "Onboarding" ? "New starter" : onboard.employee.status) : <span className="text-[#b42318]">HR record missing</span>}</span>
                </div>
                <div>
                  <h3 className="mb-1 text-[14.5px] font-semibold">HR checks</h3>
                  <ul className="divide-y divide-[#f2f4f7] rounded-[8px] border border-[#eaecf0]">
                    {onboard.checks.filter((x) => x.required).map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="min-w-0 truncate">{x.name}</span>
                        <span className={`shrink-0 text-[12.5px] font-semibold ${x.status === "Up to date" ? "text-[#067647]" : x.status === "Due soon" ? "text-[#b54708]" : "text-[#b42318]"}`}>{x.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {onboard.tasks.length ? (
                  <div>
                    <h3 className="mb-1 text-[14.5px] font-semibold">HR onboarding tasks</h3>
                    <ul className="space-y-1">{onboard.tasks.map((t) => <li key={t.id} className="flex items-start gap-2">{t.status === "Complete" ? <CheckCircle size={17} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-[#067647]" /> : <WarningCircle size={17} aria-hidden className="mt-0.5 shrink-0 text-[#b54708]" />}<span>{t.type}<span className="block text-[12.5px] text-[#667085]">{t.status} · due {fmtLondonDate(t.due, { day: "numeric", month: "short" })}</span></span></li>)}</ul>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">Policy sign-offs outstanding</span><span className={onboard.signOffs ? "font-semibold text-[#b54708]" : "text-[#067647]"}>{onboard.signOffs}</span></div>
                {onboard.readiness ? <div className="flex items-center justify-between gap-2"><span className="font-semibold">Staff readiness</span><span>{onboard.readiness.label}</span></div> : null}
                {onboard.check ? (
                  <div className="rounded-[8px] bg-[#f9fafb] p-3" data-testid="staff-check">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[14.5px] font-semibold">Check Staff Readiness</h3>
                      <EligibilityPill state={onboard.check.state} label={onboard.check.label} />
                    </div>
                    <p className="mt-1 text-[12.5px] text-[#667085]">The rota&apos;s rules for an ordinary visit on {fmtLondonDate(onboard.check.date)}. The rota decides again at every booking.</p>
                    {onboard.check.blocking.length || onboard.check.warnings.length ? (
                      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13.5px]">
                        {onboard.check.blocking.map((x, n) => <li key={`b${n}`} className="text-[#b42318]">{x.message}</li>)}
                        {onboard.check.warnings.map((x, n) => <li key={`w${n}`} className="text-[#b54708]">{x.message}</li>)}
                      </ul>
                    ) : <p className="mt-2 text-[13.5px] text-[#067647]">No person-level reason stops them being booked.</p>}
                  </div>
                ) : <Callout tone="warn">The rota has not received this employee yet.</Callout>}
                <div className="flex flex-wrap gap-2">
                  {c.hrEmployeeId && branch ? <a href={`/hr${employeeRoute(c.hrEmployeeId, branch.hrBranchKey, base)}`} className={R_SECONDARY}>Employee Record<ArrowSquareOut size={15} aria-hidden /></a> : null}
                  {onboard.staff && canRota ? <a href={`/rota/staff/${onboard.staff.id}`} className={R_SECONDARY}>Rota Readiness<ArrowSquareOut size={15} aria-hidden /></a> : null}
                </div>
              </div>
            </Section>
          ) : null}

          <Section id="docs-h" title="Outstanding documents">
            {c.outstandingDocuments.length ? <ul className="list-disc space-y-0.5 pl-5 text-[14px]">{c.outstandingDocuments.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-[14px] text-[#067647]">Nothing outstanding.</p>}
            {a.canEdit && open && !editing ? <Link href={`${base}?edit=1`} className="mt-2 inline-block text-[13.5px] font-semibold text-[#9a3412]">Update the list</Link> : null}
          </Section>

          {a.canEdit && canClose(c.stage) ? (
            <Section id="close-h" title="Close the application">
              <form id="close" action={closeCandidateAction} className="space-y-2">
                <Hidden back={base} candidateId={c.id} lockVersion={c.lockVersion} />
                <fieldset className="flex flex-wrap gap-4 text-[14px]"><legend className="sr-only">Outcome</legend><label className="flex items-center gap-2"><input type="radio" name="outcome" value="WITHDRAWN" required />Withdrawn by the candidate</label><label className="flex items-center gap-2"><input type="radio" name="outcome" value="UNSUCCESSFUL" />Unsuccessful</label></fieldset>
                <label className="block"><span className={LABEL}>Reason</span><input name="reason" required minLength={3} maxLength={300} className={INPUT} /></label>
                <button className={R_SECONDARY}>Close Application</button>
                <p className="text-[12.5px] text-[#667085]">Kept for the retention period set under Reminders &amp; retention, then personal details can be removed.</p>
              </form>
            </Section>
          ) : null}

          {erasable && a.canErase ? (
            <Section id="erase-h" title="Remove personal details">
              <form action={eraseCandidateAction} className="space-y-2">
                <Hidden back={base} candidateId={c.id} />
                <p className="text-[13.5px] text-[#475467]">The retention date has passed. Names, contact details, notes, answers and interview notes are removed. The reference, role, branch and dates stay for reporting.</p>
                <label className="block"><span className={LABEL}>Type REMOVE to confirm</span><input name="confirm" required pattern="REMOVE" className={INPUT} /></label>
                <button className={R_SECONDARY}>Remove Personal Details</button>
              </form>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

import { randomUUID } from "node:crypto";
import Link from "@/components/link";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { ANSWERS, carerFacingName, getMyConfirmation } from "@/server/rota/missed-auto/confirmations";
import { ANSWER_LABEL } from "@/server/rota/missed-auto/evidence";
import { carerMissedResponseAction } from "@/app/missed-auto-actions";
import { requestClockCorrectionAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const CHOICE = "flex min-h-[48px] items-center rounded-[10px] border border-[#d0d5dd] bg-white px-3.5 py-2.5 text-[15px] font-medium text-[#101828] no-underline hover:border-[#5b2bb5] hover:bg-[#f6f2fd] hover:text-[#101828] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";

/**
 * Missed Visit Confirmation, inside My Visits. The carer picks what happened, then sees only the questions that answer
 * needs. Their statement is their own account: it does not record attendance or change a clock time.
 */
export default async function MissedConfirmationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePortal("rota");
  let data;
  try {
    data = await getMyConfirmation(ctx, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <><PageHeader title="Missed visit" back="/carer" /><Card><Empty>{e.message}</Empty></Card></>;
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { c, canAnswer, correctionOpen, pendingKinds } = data;
  const v = c.case.visit;
  const answer = sp.answer && (ANSWERS as readonly string[]).includes(sp.answer) ? sp.answer : null;
  const back = `/carer/missed/${c.id}`;
  const last = c.responses.at(-1);
  const visitDate = londonDate(v.scheduledStart);
  const reported = last && ["ATTENDED_NO_CLOCK", "ARRIVED_LATE"].includes(last.answer);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Missed visit" back="/carer" />
      <Flash searchParams={sp} />
      <Card className="mb-3">
        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 text-[15px]">
          <dt className="text-slate-600">Visit</dt><dd className="font-semibold tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)} · {v.callType.name}</dd>
          <dt className="text-slate-600">Date</dt><dd>{fmtLondonDate(visitDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</dd>
          <dt className="text-slate-600">For</dt><dd>{carerFacingName(v.serviceUser)}</dd>
          <dt className="text-slate-600">Status</dt><dd>{c.status === "RESPONDED" ? <Badge tone="green">Answer sent</Badge> : c.status === "WITHDRAWN" || c.case.stage === "CLOSED" ? <Badge tone="slate">Closed by the office</Badge> : <Badge tone="amber">Confirmation requested</Badge>}{c.responseDueAt && c.status === "REQUESTED" ? <span className="ml-2 text-[13.5px] text-slate-600">Please answer by {londonTime(c.responseDueAt)}</span> : null}</dd>
        </dl>
        <p className="mt-2 text-[13.5px] text-slate-600">No clock-in was recorded for this visit. Tell us what happened. Your answer goes to the office as your statement; it does not change your clock times or your pay.</p>
      </Card>

      {c.responses.length ? (
        <Card title="What you have told us" className="mb-3">
          <ul className="space-y-2 text-[14.5px]">
            {c.responses.map((r) => (
              <li key={r.id} className="border-l-2 border-[#e3dff0] pl-2">
                <p className="text-[12.5px] text-slate-600">{r.supplementsId ? "Further statement" : "Statement"} sent {fmtDate(r.submittedAt, true)}</p>
                <p className="font-semibold">{ANSWER_LABEL[r.answer]}</p>
                <p className="text-slate-700">{[r.reportedArrival ? `Arrived ${londonTime(r.reportedArrival)}` : null, r.reportedDeparture ? `left ${londonTime(r.reportedDeparture)}` : null].filter(Boolean).join(", ")}</p>
                {r.explanation ? <p className="whitespace-pre-wrap text-slate-800">{r.explanation}</p> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-slate-600">Statements cannot be changed once sent. If something is wrong or missing, add a further statement below.</p>
        </Card>
      ) : null}

      {reported && last ? (
        <Card title="Your clock times" className="mb-3">
          {pendingKinds.length ? <p className="mb-2 text-[14px]">You have asked the office to correct your {pendingKinds.map((k) => (k === "IN" ? "clock-in" : "clock-out")).join(" and ")}. They will decide it.</p> : null}
          {correctionOpen ? (
            <div className="space-y-3">
              <p className="text-[14px] text-slate-700">Your statement does not record your attendance. If you were there, ask the office to correct your times. Someone else checks and decides every correction.</p>
              {(["IN", "OUT"] as const).filter((k) => !pendingKinds.includes(k)).map((k) => {
                const at = k === "IN" ? last.reportedArrival : last.reportedDeparture;
                return (
                  <form key={k} action={requestClockCorrectionAction} className="space-y-2 rounded-[8px] border border-slate-200 p-2.5">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="visitId" value={v.id} />
                    <input type="hidden" name="kind" value={k} />
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="label">{k === "IN" ? "Clock-in" : "Clock-out"} date</span><input type="date" name="date" defaultValue={at ? londonDate(at) : visitDate} required className="input" /></label>
                      <label><span className="label">Time</span><input type="time" name="time" defaultValue={at ? londonTime(at) : ""} required className="input" /></label>
                    </div>
                    <label className="block"><span className="label">What happened</span><input name="reason" required minLength={5} className="input" defaultValue={last.answer === "ATTENDED_NO_CLOCK" ? "I attended but forgot to clock" : "I arrived late"} /></label>
                    <button className="btn-secondary">Ask the office to correct my {k === "IN" ? "clock-in" : "clock-out"}</button>
                  </form>
                );
              })}
            </div>
          ) : <p className="text-[14px] text-slate-700">You can no longer ask for a correction here (you are not on this visit now, or it was more than a day ago). Ask your office to enter the times.</p>}
        </Card>
      ) : null}

      {canAnswer ? (
        <Card title={c.responses.length ? "Add a further statement" : "What happened with this visit?"}>
          {!answer ? (
            <ul className="grid gap-2" aria-label="Choose what happened">
              {ANSWERS.map((a, i) => <li key={a}><Link href={`${back}?answer=${a}`} className={CHOICE}><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f2f4f7] text-[13px] font-bold text-[#344054]" aria-hidden>{i + 1}</span>{ANSWER_LABEL[a]}</Link></li>)}
            </ul>
          ) : (
            <form action={carerMissedResponseAction} className="space-y-3">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="confirmationId" value={c.id} />
              <input type="hidden" name="answer" value={answer} />
              <input type="hidden" name="submissionKey" value={randomUUID()} />
              <p className="flex flex-wrap items-center gap-2 text-[15px]"><b>{ANSWER_LABEL[answer]}</b><Link href={back} className="text-[13.5px]">Change</Link></p>
              {answer === "ATTENDED_NO_CLOCK" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className="label">Time you arrived</span><input type="time" name="arrival" required className="input" /></label>
                    <label><span className="label">Time you left</span><input type="time" name="departure" required className="input" /></label>
                  </div>
                  <CareDelivered label="What care did you provide?" />
                </>
              ) : null}
              {answer === "ARRIVED_LATE" ? (
                <>
                  <label className="block"><span className="label">Time you arrived</span><input type="time" name="arrival" required className="input" /></label>
                  <CareDelivered label="Was the care delivered?" />
                </>
              ) : null}
              {answer === "UNABLE_TO_ATTEND" ? (
                <>
                  <fieldset><legend className="label">Why could you not attend?</legend><Radios name="unableReason" options={[["SICKNESS", "Sickness or emergency"], ["TRAVEL", "Travel, traffic or vehicle problem"], ["OTHER", "Another reason"]]} /></fieldset>
                  <fieldset><legend className="label">Did you tell anyone?</legend><Radios name="notifiedSomeone" options={[["yes", "Yes"], ["no", "No"]]} /></fieldset>
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className="label">Who did you tell?</span><input name="notifiedWho" maxLength={200} className="input" /></label>
                    <label><span className="label">When?</span><input type="time" name="notifiedAt" className="input" /></label>
                  </div>
                </>
              ) : null}
              {answer === "ACCESS_PROBLEM" ? (
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Time you tried to get in</span><input type="time" name="attemptedAt" className="input" /></label>
                  <label><span className="label">Who did you contact?</span><input name="contacted" maxLength={200} className="input" /></label>
                </div>
              ) : null}
              <label className="block"><span className="label">{answer === "ACCESS_PROBLEM" ? "Describe the access problem" : ["OTHER", "ROTA_WRONG", "PHONE_SYSTEM", "SU_CANCELLED"].includes(answer) ? "Tell us what happened" : "Anything else the office should know (optional)"}</span><textarea name="explanation" rows={3} maxLength={2000} required={["ACCESS_PROBLEM", "OTHER", "ROTA_WRONG", "PHONE_SYSTEM", "SU_CANCELLED"].includes(answer)} minLength={["ACCESS_PROBLEM", "OTHER", "ROTA_WRONG", "PHONE_SYSTEM", "SU_CANCELLED"].includes(answer) ? 5 : undefined} className="input w-full" /></label>
              <button className="btn-primary w-full sm:w-auto">Submit confirmation</button>
            </form>
          )}
        </Card>
      ) : c.case.stage === "CLOSED" || c.status === "WITHDRAWN" ? <Card><Empty>The office has closed this request. Speak to your office if something is missing.</Empty></Card> : null}
    </div>
  );
}

function CareDelivered({ label }: { label: string }) {
  return <fieldset><legend className="label">{label}</legend><Radios name="careDelivered" options={[["YES", "All the planned care"], ["PARTLY", "Some of the planned care"], ["NO", "None"]]} /></fieldset>;
}

function Radios({ name, options }: { name: string; options: [string, string][] }) {
  return (
    <div className="grid gap-1.5">
      {options.map(([value, label], i) => (
        <label key={value} className="flex min-h-[44px] items-center gap-2.5 rounded-[8px] border border-[#d0d5dd] px-3 text-[15px] has-[:checked]:border-[#5b2bb5] has-[:checked]:bg-[#f6f2fd]">
          <input type="radio" name={name} value={value} required={i === 0} className="h-4 w-4 accent-[#5b2bb5]" />{label}
        </label>
      ))}
    </div>
  );
}

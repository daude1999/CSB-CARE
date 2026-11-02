import { randomUUID } from "node:crypto";
import Link from "@/components/link";
import { CopyButton } from "@/components/copy-button";
import { CoverContactForm, type RecipientOption } from "@/components/cover-contact-form";
import { AppError } from "@/lib/errors";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { communicationView, describeArrangement, METHOD_LABEL, OUTCOME_LABEL, PREFERRED_LABEL, telHref, type Arrangement, type AttemptRow, type CommunicationView, type CoverContact } from "@/server/rota/cover-communication";
import { coverContactAction, coverContactCorrectAction, coverFollowUpCloseAction } from "@/app/rota-actions";

/**
 * Contact & Communication inside Find Replacement Cover: the service user's current details (separately from their
 * other contacts), a form to record each attempt, and the history. Click-to-call opens the phone's dialler only; it
 * never records a call. Only what staff record here is kept, and nothing is sent from the platform.
 */

const STATE_TONE: Record<string, string> = {
  NOT_CONTACTED: "border-[#e8b4b0] bg-[#fdf1f1] text-[#8a1f1a]",
  ATTEMPTED: "border-[#ecd29a] bg-[#fffaf0] text-[#7a5200]",
  UPDATE_NEEDED: "border-[#ecd29a] bg-[#fffaf0] text-[#7a5200]",
  INFORMED: "border-[#b7dfc0] bg-[#f1faf3] text-[#1e6b2c]",
  NOT_APPLICABLE: "border-slate-200 bg-slate-50 text-slate-700",
};
const OUTCOME_TONE: Record<string, string> = { INFORMED: "bg-[#e6f4ea] text-[#1e6b2c]", NO_ANSWER: "bg-[#fdf3dc] text-[#7a5200]", MESSAGE_LEFT: "bg-[#fdf3dc] text-[#7a5200]", UNSUCCESSFUL: "bg-[#fde8e8] text-[#8a1f1a]", NOT_APPLICABLE: "bg-slate-100 text-slate-700" };
const when = (d: Date) => `${fmtLondonDate(londonDate(d), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(d)}`;

function Phone({ label, value, who }: { label: string; value: string | null; who: string }) {
  if (!value) return null;
  const href = telHref(value);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
      <span className="w-[86px] shrink-0 text-slate-500">{label}</span>
      {href ? <a href={href} className="font-semibold tabular-nums" aria-label={`Call ${who} on ${value} (opens your phone; nothing is recorded)`}>{value}</a> : <span className="tabular-nums">{value}</span>}
      <CopyButton value={value} label={`${who}'s ${label.toLowerCase()}`} />
      {!href ? <span className="text-[12.5px] text-[#8a5a00]">Not a number the phone can dial: check the profile</span> : null}
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 rounded-[6px] bg-[#fdf3dc] px-2 py-1 text-[12.5px] font-medium text-[#7a5200]" role="note">{children}</p>;
}

function ContactCard({ c }: { c: CoverContact }) {
  return (
    <li className="rounded-[8px] border border-slate-200 p-3" data-testid="contact-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="text-[14.5px] text-slate-900">{c.name}</b>
        <span className="text-[13px] text-slate-600">{c.relationship ?? c.kind.replace(/_/g, " ").toLowerCase()}</span>
        {c.isPrimary ? <span className="rounded-full bg-[#ede7fb] px-2 py-0.5 text-[12px] font-semibold text-[#4b2f9a]">Primary contact</span> : null}
        {c.isEmergency ? <span className="rounded-full bg-[#fde8e8] px-2 py-0.5 text-[12px] font-semibold text-[#8a1f1a]">Emergency contact</span> : null}
      </div>
      <div className="mt-1.5 space-y-1">
        <Phone label="Telephone" value={c.phone} who={c.name} />
        <Phone label="Alternative" value={c.altPhone} who={c.name} />
        {c.email ? <div className="flex flex-wrap items-center gap-2 text-[13.5px]"><span className="w-[86px] shrink-0 text-slate-500">Email</span><span className="break-all">{c.email}</span><CopyButton value={c.email} label={`${c.name}'s email address`} /></div> : null}
      </div>
      {!c.phone && !c.altPhone ? <Missing>No telephone number recorded for {c.name}.</Missing> : null}
      <dl className="mt-1.5 grid grid-cols-[150px_1fr] gap-x-2 gap-y-0.5 text-[12.5px]">
        <dt className="text-slate-500">Prefers</dt><dd>{c.preferredContactMethod ? PREFERRED_LABEL[c.preferredContactMethod] ?? c.preferredContactMethod : "Not recorded"}</dd>
        <dt className="text-slate-500">Receives updates</dt><dd className={c.canReceiveUpdates ? "text-[#1e6b2c]" : "text-[#8a1f1a]"}>{c.canReceiveUpdates ? "Yes, recorded permission" : "No permission recorded"}</dd>
        <dt className="text-slate-500">Authority to act</dt><dd>{c.authority ? `${c.authority.label}${c.authority.scope ? `: ${c.authority.scope}` : ""}` : "None recorded"}</dd>
      </dl>
    </li>
  );
}

function arrangementText(a: unknown) {
  const x = a as Arrangement | null;
  return x && typeof x === "object" && "start" in x ? describeArrangement(x) : "Not recorded";
}

function HistoryItem({ a, view, back, today }: { a: AttemptRow; view: CommunicationView; back: string; today: string }) {
  const corrected = view.correctedBy.get(a.id);
  const name = (id: string | null) => (id ? view.names.get(id) ?? "Former member" : "");
  const late = a.createdAt.getTime() - a.contactedAt.getTime() > 5 * 60_000;
  return (
    <li className={`px-3 py-2.5 text-[13.5px] ${corrected ? "bg-slate-50 text-slate-500" : ""}`} data-testid="contact-history-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${corrected ? "bg-slate-200 text-slate-600 line-through" : OUTCOME_TONE[a.outcome]}`}>{OUTCOME_LABEL[a.outcome as keyof typeof OUTCOME_LABEL] ?? a.outcome}</span>
        <b className="font-semibold text-slate-900">{a.recipientName}</b>
        {a.recipientRelationship ? <span>({a.recipientRelationship})</span> : null}
        {a.correctsId ? <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[12px] font-semibold text-[#1d4f91]">Correction</span> : null}
        {corrected ? <span className="text-[12px] font-semibold">Corrected — see the later entry</span> : null}
      </div>
      <p className="mt-0.5">{METHOD_LABEL[a.method as keyof typeof METHOD_LABEL] ?? a.method}{a.recipientAddress ? ` · ${a.recipientAddress}` : ""} · contacted {when(a.contactedAt)}</p>
      <p className="text-[12.5px] text-slate-500">Recorded by {name(a.createdById)}{late ? ` at ${when(a.createdAt)}` : ""}{a.recipientAuthority ? ` · authority shown: ${a.recipientAuthority}` : ""}</p>
      {a.correctionReason ? <p className="mt-0.5 text-[12.5px]">Reason for correction: {a.correctionReason}</p> : null}
      {a.notApplicableReason ? <p className="mt-0.5">Not applicable: {a.notApplicableReason}</p> : null}
      {a.notes ? <p className="mt-0.5 whitespace-pre-line">{a.notes}</p> : null}
      <p className="mt-0.5 text-[12.5px] text-slate-500">Arrangements at the time: {arrangementText(a.arrangement)}</p>
      {a.followUpRequired ? (
        <p className={`mt-0.5 text-[12.5px] ${a.followUpDoneAt ? "text-slate-500" : a.followUpDueAt && a.followUpDueAt < new Date() ? "font-semibold text-[#8a1f1a]" : "font-medium text-[#7a5200]"}`}>
          Follow-up: {name(a.followUpOwnerId)}{a.followUpDueAt ? `, due ${when(a.followUpDueAt)}` : ""} · {a.followUpDoneAt ? `closed ${when(a.followUpDoneAt)} by ${name(a.followUpDoneById)}${a.followUpDoneNote ? ` (${a.followUpDoneNote})` : ""}` : a.followUpDueAt && a.followUpDueAt < new Date() ? "overdue" : "open"}
        </p>
      ) : null}
      {!corrected ? (
        <div className="mt-1 flex flex-wrap gap-3">
          {a.followUpRequired && !a.followUpDoneAt ? (
            <details>
              <summary className="cursor-pointer text-[12.5px] font-semibold text-[#4b2f9a]">Close follow-up</summary>
              <form action={coverFollowUpCloseAction} className="mt-1.5 flex flex-wrap gap-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="attemptId" value={a.id} />
                <input name="note" required minLength={3} maxLength={500} aria-label="How the follow-up was dealt with" placeholder="For example: daughter phoned back" className="input min-w-0 flex-1 py-1.5 text-[13.5px]" />
                <button className={`${"inline-flex h-9 items-center rounded-[6px] border border-slate-300 bg-white px-3 text-[13.5px] font-medium"}`}>Close</button>
              </form>
            </details>
          ) : null}
          <details>
            <summary className="cursor-pointer text-[12.5px] font-semibold text-[#4b2f9a]">Correct this entry</summary>
            <div className="mt-2 rounded-[8px] border border-slate-200 p-2.5">
              <CoverContactForm
                action={coverContactCorrectAction} back={back} visitId={a.visitId} caseId={a.missedCallCaseId} recipients={recipientsOf(view)} owners={view.owners} me={view.me}
                token={randomUUID()} savedToken={undefined} storageKey={`fc-correct-${a.id}`} today={today}
                correction={{ attemptId: a.id, defaults: { recipient: a.recipientKind === "SERVICE_USER" ? "su" : a.contactId ?? "other", via: "other", otherAddress: a.recipientAddress ?? "", otherName: a.recipientKind === "OTHER" ? a.recipientName : "", otherRelationship: a.recipientKind === "OTHER" ? a.recipientRelationship ?? "" : "", method: a.method, outcome: a.outcome, notApplicableReason: a.notApplicableReason ?? "", notes: a.notes ?? "" } }}
              />
            </div>
          </details>
        </div>
      ) : null}
    </li>
  );
}

function recipientsOf(view: CommunicationView): RecipientOption[] {
  if (!view.contacts) return [];
  const su = view.contacts.serviceUser;
  const vias = (x: { phone: string | null; altPhone: string | null; email: string | null }) => [
    ...(x.phone ? [{ value: "phone" as const, label: `Telephone: ${x.phone}` }] : []),
    ...(x.altPhone ? [{ value: "altPhone" as const, label: `Alternative: ${x.altPhone}` }] : []),
    ...(x.email ? [{ value: "email" as const, label: `Email: ${x.email}` }] : []),
  ];
  return [
    { value: "su", label: `${su.fullName} (service user)`, detail: su.phone ?? su.altPhone ?? "No telephone number recorded", vias: vias(su) },
    ...view.contacts.contacts.map((c) => ({ value: c.id, label: `${c.name}${c.relationship ? ` (${c.relationship})` : ""}`, detail: [c.isPrimary ? "Primary contact" : null, c.canReceiveUpdates ? "Can receive updates" : "No permission to receive updates recorded", c.authority?.label ?? null].filter(Boolean).join(" · "), vias: vias(c) })),
  ];
}

export async function CommunicationSection({ ctx, target, back, savedToken, token }: { ctx: Ctx; target: { visitId: string; caseId: string | null }; back: string; savedToken?: string; token: string }) {
  let view: CommunicationView;
  try {
    view = await communicationView(ctx, target);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return <p role="alert" className="mt-4 rounded-[6px] bg-[#fde8e8] px-3 py-2 text-[14px] text-[#8a1f1a]">{e.message}</p>;
  }
  const st = view.state;
  const name = (id: string | null) => (id ? view.names.get(id) ?? "Former member" : "Not assigned");
  const today = londonDate();
  const su = view.contacts?.serviceUser;
  return (
    <div className="mt-4 space-y-4" data-testid="contact-communication">
      <section aria-labelledby="cc-state" className={`rounded-[8px] border p-3 ${STATE_TONE[st.kind]}`}>
        <h3 id="cc-state" className="text-[15px] font-semibold" data-testid="comms-state">{st.label}{st.kind === "NOT_APPLICABLE" && st.reason ? `: ${st.reason}` : ""}</h3>
        <p className="mt-0.5 text-[13px] text-slate-800">Arrangements now: {view.arrangementText}</p>
        {st.kind === "UPDATE_NEEDED" ? <p className="mt-0.5 text-[13px]">The carer, time or visit changed after the service user was told. The earlier record is kept below.</p> : null}
        {st.kind === "ATTEMPTED" ? <p className="mt-0.5 text-[13px]">A message left or a missed call is not confirmation. Record a successful contact when someone has been told.</p> : null}
        {st.followUp ? <p className="mt-0.5 text-[13px] font-medium">Follow-up: {name(st.followUp.ownerId)}{st.followUp.dueAt ? `, due ${when(st.followUp.dueAt)}` : ""}{st.followUp.overdue ? " (overdue)" : ""}</p> : null}
        <p className="mt-1 text-[12px] text-slate-600">Communication never stops cover being booked, and only covers this visit.</p>
      </section>

      {view.contacts && su ? (
        <>
          <section aria-labelledby="cc-su">
            <div className="flex items-center gap-2">
              <h3 id="cc-su" className="text-[15px] font-semibold text-slate-900">Service user</h3>
              {view.contacts.canEdit ? <Link href={`/rota/service-users/${su.id}?tab=people`} className="ml-auto text-[13px] font-semibold">Edit contact details</Link> : null}
            </div>
            <div className="mt-1.5 rounded-[8px] border border-slate-200 p-3" data-testid="su-contact-card">
              <b className="text-[14.5px] text-slate-900">{su.fullName}</b>
              <div className="mt-1.5 space-y-1">
                <Phone label="Telephone" value={su.phone} who={su.fullName} />
                <Phone label="Alternative" value={su.altPhone} who={su.fullName} />
                {su.email ? <div className="flex flex-wrap items-center gap-2 text-[13.5px]"><span className="w-[86px] shrink-0 text-slate-500">Email</span><span className="break-all">{su.email}</span><CopyButton value={su.email} label={`${su.fullName}'s email address`} /></div> : null}
              </div>
              {!su.phone && !su.altPhone ? <Missing>No telephone number recorded for {su.fullName}. Contact someone below, or add a number to the profile.</Missing> : null}
              <dl className="mt-1.5 grid grid-cols-[150px_1fr] gap-x-2 gap-y-0.5 text-[12.5px]">
                <dt className="text-slate-500">Prefers</dt><dd>{su.preferredContactMethod ? PREFERRED_LABEL[su.preferredContactMethod] ?? su.preferredContactMethod : "Not recorded"}</dd>
                {su.firstLanguage ? <><dt className="text-slate-500">First language</dt><dd>{su.firstLanguage}</dd></> : null}
                <dt className="text-slate-500">Communication needs</dt><dd className="whitespace-pre-line">{su.communicationNeeds ?? "None recorded"}</dd>
              </dl>
            </div>
          </section>

          <section aria-labelledby="cc-others">
            <h3 id="cc-others" className="text-[15px] font-semibold text-slate-900">Next of kin and other contacts</h3>
            {view.contacts.contacts.length ? <ul className="mt-1.5 space-y-2">{view.contacts.contacts.map((c) => <ContactCard key={c.id} c={c} />)}</ul> : <Missing>No other contacts are recorded for this service user.</Missing>}
            <p className="mt-1.5 text-[12px] text-slate-500">Emergency contact, permission to receive updates and authority to act are recorded separately. Being next of kin does not give authority.</p>
          </section>
        </>
      ) : <p className="rounded-[8px] border border-slate-200 p-3 text-[13.5px] text-slate-600">Your role cannot see this service user&apos;s contact details. You can still record a contact you made.</p>}

      <section aria-labelledby="cc-record" className="rounded-[8px] border border-slate-200 p-3">
        <h3 id="cc-record" className="mb-2 text-[15px] font-semibold text-slate-900">Record a communication attempt</h3>
        <CoverContactForm action={coverContactAction} back={back} visitId={view.visit.id} caseId={view.caseId} recipients={recipientsOf(view)} owners={view.owners} me={view.me} token={token} savedToken={savedToken} storageKey={`fc-attempt-${view.visit.id}`} today={today} />
      </section>

      <section aria-labelledby="cc-history">
        <h3 id="cc-history" className="text-[15px] font-semibold text-slate-900">Communication history <span className="text-[13px] font-normal text-slate-500">({view.attempts.length})</span></h3>
        {view.attempts.length ? (
          <ol className="mt-1.5 divide-y divide-slate-100 rounded-[8px] border border-slate-200" aria-label="Communication history, oldest first">
            {view.attempts.map((a) => <HistoryItem key={a.id} a={a} view={view} back={back} today={today} />)}
          </ol>
        ) : <p className="mt-1 text-[13.5px] text-slate-600">Nothing recorded yet. &ldquo;Not yet contacted&rdquo; is shown until an attempt is saved.</p>}
      </section>
    </div>
  );
}

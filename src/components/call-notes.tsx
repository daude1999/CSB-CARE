import { randomUUID } from "node:crypto";
import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { DECISIONS, DESTINATIONS, DESTINATION_KEYS, DUPLICATES, KINDS, KIND_KEYS, METHODS, METHOD_KEYS, METHOD_TITLE, NOT_VERIFIED, PRIORITIES, STATUS, URGENT_KINDS, displayStatus, type Destination, type DuplicateKind, type Kind, type Method, type UrgentKind } from "@/lib/call-note-rules";
import type { Ctx } from "@/server/auth/rbac";
import { callNoteFormOptions, draftForReview, linkOptions, listCallNotes, parseFilters, type CallNoteList, type CallNoteView } from "@/server/care/call-notes";
import { closeFollowUpAction, correctCallNoteAction, createCallNoteAction, createFollowUpAction, linkRecordAction, recordEscalationAction, resolveRoutedItemAction, reviewCallNoteAction, submitOrganisedAction, supersedeCallNoteAction, withdrawDraftAction } from "@/app/call-note-actions";
import { Badge, Empty, Pagination, fmtDate } from "@/components/ui";

/**
 * Service User profile → Call Notes. A communication history for one person: newest first, each note an expandable
 * card. Add Call Note opens an inline form (no modal); Organise turns the typed notes into a proposal the coordinator
 * checks line by line before anything is saved. Visit Notes stay in Visits and are not shown here.
 */

type Sp = Record<string, string | undefined>;
const DUP_TONE: Record<DuplicateKind, "slate" | "amber" | "rose" | "teal" | "violet"> = { NEW: "teal", EXACT: "slate", POSSIBLE: "amber", UPDATE: "violet", CONFLICT: "rose" };
const PRI_TONE = { LOW: "slate", MEDIUM: "teal", HIGH: "amber", URGENT: "rose" } as const;

export async function CallNotesSection({ ctx, serviceUserId, personName, base, sp }: { ctx: Ctx; serviceUserId: string; personName: string; base: string; sp: Sp }) {
  const filters = parseFilters(sp);
  const list = await listCallNotes(ctx, serviceUserId, filters);
  const back = `${base}?tab=call-notes`;
  const adding = sp.new === "1" && list.access.record;
  const draft = sp.draft ? await draftForReview(ctx, sp.draft).catch(() => null) : null;
  const [form, links] = await Promise.all([adding || draft || list.notes.length ? callNoteFormOptions(ctx, serviceUserId) : Promise.resolve(null), list.notes.some((n) => n.can.followUp) ? linkOptions(ctx, serviceUserId) : Promise.resolve([])]);
  const filtered = Object.entries(filters).some(([k, v]) => k !== "page" && v !== undefined && v !== "");
  return (
    <section className="card" aria-labelledby="call-notes-h" data-testid="call-notes">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="call-notes-h" className="text-[17px]">Call Notes</h2>
          <p className="mt-0.5 text-[13.5px] text-slate-600">Record conversations, communications and follow-up information relating to this service user.</p>
        </div>
        {list.access.record && !adding ? <Link href={`${back}&new=1`} className="btn-primary">Add Call Note</Link> : null}
      </div>

      {adding && form ? <NewNoteForm serviceUserId={serviceUserId} back={back} form={form} /> : null}
      {draft ? <DraftReview serviceUserId={serviceUserId} back={back} draft={draft} /> : null}

      <form method="get" action={base} role="search" aria-label="Search and filter Call Notes" className="mb-3 grid grid-cols-2 gap-2 border-y border-slate-200 bg-[#f7f9fb] px-3 py-2.5 md:grid-cols-4 xl:grid-cols-[minmax(220px,1.6fr)_repeat(3,minmax(0,1fr))_auto]">
        <input type="hidden" name="tab" value="call-notes" />
        <label className="col-span-2 md:col-span-4 xl:col-span-1"><span className="label">Search notes</span><input name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Summary, notes, person or CALL- reference" className="input" /></label>
        <label><span className="label">Type</span><select name="method" defaultValue={filters.method ?? ""} className="input"><option value="">Any</option>{METHOD_KEYS.map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select></label>
        <label><span className="label">Status</span><select name="status" defaultValue={filters.status ?? ""} className="input"><option value="">Current notes</option>{(["AWAITING_REVIEW", "APPROVED", "FOLLOW_UP", "COMPLETED", "CLARIFICATION_REQUESTED", "DRAFT", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const).map((k) => <option key={k} value={k}>{k === "FOLLOW_UP" ? "Follow-up Required" : k === "COMPLETED" ? "Completed" : STATUS[k]}</option>)}</select></label>
        <label><span className="label">Follow-up</span><select name="followUp" defaultValue={filters.followUp ?? ""} className="input"><option value="">Any</option><option value="yes">Open follow-up</option><option value="no">No open follow-up</option></select></label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-1">
          <button className="btn-primary">Apply</button>
          {filtered ? <Link href={back} className="btn-secondary">Clear</Link> : null}
        </div>
        <details className="col-span-2 md:col-span-4 xl:col-span-5" open={!!(filters.from || filters.to || filters.contact || filters.by)}>
          <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">More filters</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <label><span className="label">From</span><input type="date" name="from" defaultValue={filters.from ?? ""} className="input" /></label>
            <label><span className="label">To</span><input type="date" name="to" defaultValue={filters.to ?? ""} className="input" /></label>
            <label><span className="label">Person contacted</span><input name="contact" defaultValue={filters.contact ?? ""} className="input" /></label>
            <label><span className="label">Recorded by</span><select name="by" defaultValue={filters.by ?? ""} className="input"><option value="">Anyone</option>{list.recorders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          </div>
        </details>
      </form>

      {list.hidden ? <p className="mb-2 text-[13px] text-slate-600">{list.hidden} restricted {list.hidden === 1 ? "note is" : "notes are"} hidden. A registered manager can open {list.hidden === 1 ? "it" : "them"}.</p> : null}

      {list.notes.length ? (
        <ol className="space-y-2.5" aria-label="Call Notes, newest first">
          {list.notes.map((n) => <li key={n.id}><NoteCard n={n} open={sp.note === n.id || (!!sp.item && n.items.some((i) => i.review?.id === sp.item))} serviceUserId={serviceUserId} back={`${back}&note=${n.id}`} list={list} people={form?.people ?? []} documents={form?.documents ?? []} links={links} /></li>)}
        </ol>
      ) : (
        <Empty>{filtered ? "No Call Notes match these filters." : `No Call Notes have been recorded for ${personName}.`}</Empty>
      )}
      <Pagination page={list.page} pageSize={20} total={list.total} base={base} params={{ tab: "call-notes", q: filters.q, method: filters.method, status: filters.status, followUp: filters.followUp, from: filters.from, to: filters.to, contact: filters.contact, by: filters.by }} />
      <p className="mt-2 text-[12.5px] text-slate-500">Call Notes keep general communication only. Care needs, risks, medication, rota requests, incidents, contacts and documents are sent to their own records for review. Visit Notes are under Visits.</p>
    </section>
  );
}

type FormOptions = NonNullable<Awaited<ReturnType<typeof callNoteFormOptions>>>;

function NewNoteForm({ serviceUserId, back, form }: { serviceUserId: string; back: string; form: FormOptions }) {
  const now = new Date();
  return (
    <form action={createCallNoteAction} className="mb-4 rounded-[6px] border border-[#c9d6e6] bg-[#f5f9fc] p-3" aria-labelledby="new-note-h" data-testid="new-call-note">
      <h3 id="new-note-h" className="mb-2 text-[15px] font-semibold">Add Call Note</h3>
      <input type="hidden" name="back" value={`${back}&new=1`} />
      <input type="hidden" name="serviceUserId" value={serviceUserId} />
      <input type="hidden" name="submissionKey" value={randomUUID()} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label><span className="label">Date</span><input type="date" name="date" required defaultValue={londonDate(now)} max={londonDate(now)} className="input" /></label>
        <label><span className="label">Time</span><input type="time" name="time" required defaultValue={londonTime(now)} className="input" /></label>
        <label><span className="label">Method</span><select name="method" defaultValue="TELEPHONE" className="input">{METHOD_KEYS.map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select></label>
        <label><span className="label">Contact on record (optional)</span><select name="contactId" defaultValue="" className="input"><option value="">Not one of the contacts</option>{form.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.relationship ? ` (${c.relationship})` : ""}</option>)}</select></label>
        <label className="col-span-2"><span className="label">Person contacted</span><input name="contactName" required maxLength={200} className="input" placeholder="Name, or e.g. 'Daughter'" /></label>
        <label className="col-span-2"><span className="label">Relationship or professional role</span><input name="contactRole" maxLength={200} className="input" placeholder="e.g. Daughter, District nurse, Social worker" /></label>
        <label className="col-span-2 md:col-span-4"><span className="label">Communication summary</span><input name="summary" maxLength={2000} className="input" placeholder="One line. Left empty, Organise proposes one." /></label>
        <label className="col-span-2 md:col-span-4"><span className="label">Detailed notes</span><textarea name="details" rows={5} maxLength={8000} className="input" placeholder="What was said, in your own words. Kept exactly as written as the original source." /></label>
        <label className="col-span-2"><span className="label">Information requiring clarification</span><textarea name="clarification" rows={2} maxLength={2000} className="input" /></label>
        <label className="col-span-2"><span className="label">Related source / document (optional)</span><select name="sourceDocumentId" defaultValue="" className="input"><option value="">None</option>{form.documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      </div>
      <fieldset className="mt-2 rounded-[4px] border border-slate-200 bg-white p-2">
        <legend className="px-1 text-[13px] font-medium">Follow-up</legend>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="followUpRequired" className="h-4 w-4" /> Follow-up required</label>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="col-span-2"><span className="label">What needs doing</span><input name="followUpText" maxLength={500} className="input" /></label>
          <label><span className="label">Follow-up owner</span><select name="followUpOwnerId" defaultValue="" className="input"><option value="">Choose</option>{form.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span className="label">Due date</span><input type="date" name="followUpDueOn" min={londonDate(now)} className="input" /></label>
        </div>
      </fieldset>
      <label className="mt-2 flex items-center gap-2 text-[14px]"><input type="checkbox" name="restricted" className="h-4 w-4" /> Restricted: only a registered manager (and you) can open this note</label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button name="intent" value="organise" className="btn-primary">{form.ai ? "Organise with AI" : "Organise into bullet points"}</button>
        <button name="intent" value="save" className="btn-secondary">Save note as written</button>
        <Link href={back} className="btn-secondary">Cancel</Link>
      </div>
      <p className="mt-2 text-[12.5px] text-slate-600">
        {form.ai ? "Organise sends only the notes, the method and the relationship to the AI service (no names). " : "AI is switched off for this organisation, so notes are organised on CSB's own server by keyword rules (no AI). "}
        You check every bullet point before anything is saved. Your original text is kept unchanged.
      </p>
    </form>
  );
}

type Draft = NonNullable<Awaited<ReturnType<typeof draftForReview>>>;

function DraftReview({ serviceUserId, back, draft }: { serviceUserId: string; back: string; draft: Draft }) {
  const { note, items } = draft;
  const ai = note.origin === "AI_ASSISTED";
  return (
    <section className="mb-4 rounded-[6px] border border-[#c9d6e6] bg-[#f5f9fc] p-3" aria-labelledby="draft-h" data-testid="call-note-draft">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 id="draft-h" className="text-[15px] font-semibold">Check the organised note · {note.reference}</h3>
        <Badge tone={ai ? "violet" : "slate"}>{ai ? `Proposed by AI (${note.reader})` : "Organised by keyword rules, no AI"}</Badge>
        <Badge>Draft</Badge>
      </div>
      {draft.urgent.length ? <UrgentBanner kinds={draft.urgent.map((u) => u.kind)} lines={draft.urgent.map((u) => u.text)} serviceUserId={serviceUserId} /> : null}
      <details className="mb-2 rounded-[4px] border border-slate-200 bg-white p-2" open>
        <summary className="cursor-pointer text-[13.5px] font-medium">Original text (kept as the source, never changed)</summary>
        <blockquote className="mt-1 whitespace-pre-line border-l-2 border-slate-300 pl-3 text-[14px] text-slate-800">{note.originalText}</blockquote>
      </details>
      <form action={submitOrganisedAction} className="space-y-3">
        <input type="hidden" name="back" value={`${back}&draft=${note.id}`} />
        <input type="hidden" name="serviceUserId" value={serviceUserId} />
        <input type="hidden" name="noteId" value={note.id} />
        <input type="hidden" name="lockVersion" value={note.lockVersion} />
        <label className="block"><span className="label">Communication summary</span><input name="summary" required defaultValue={note.summary} maxLength={2000} className="input" /></label>
        <div>
          <h4 className="mb-1 text-[14px] font-semibold">Information received</h4>
          {items.length ? (
            <ol className="space-y-2">
              {items.map((i) => (
                <li key={i.id} className="rounded-[4px] border border-slate-200 bg-white p-2" data-testid="draft-item">
                  <input type="hidden" name="itemId" value={i.id} />
                  <label className="block"><span className="sr-only">Bullet point</span><input name={`text_${i.id}`} defaultValue={i.text} maxLength={1000} className="input" /></label>
                  <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label><span className="label">Kind of statement</span><select name={`kind_${i.id}`} defaultValue={i.kind} className="input">{KIND_KEYS.map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}</select></label>
                    <label><span className="label">Belongs in</span><select name={`dest_${i.id}`} defaultValue={i.destination} className="input">{DESTINATION_KEYS.map((d) => <option key={d} value={d}>{DESTINATIONS[d].label}</option>)}</select></label>
                    <label><span className="label">Decision</span><select name={`decision_${i.id}`} defaultValue={i.decision} className="input">{(Object.keys(DECISIONS) as (keyof typeof DECISIONS)[]).filter((k) => k !== "LINK" || i.duplicateRef).map((k) => <option key={k} value={k}>{DECISIONS[k]}</option>)}</select></label>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-600">
                    <Badge tone={DUP_TONE[i.duplicate as DuplicateKind] ?? "slate"}>{DUPLICATES[i.duplicate as DuplicateKind] ?? i.duplicate}</Badge>
                    {i.duplicateLabel ? (i.dupHref ? <Link href={i.dupHref} target="_blank">{i.duplicateLabel}</Link> : <span>{i.duplicateLabel}</span>) : null}
                    {i.destination === "MEDICATION" ? <span className="font-medium text-[#8a5a00]">Needs authorised verification. No medication change is made from a Call Note.</span> : null}
                    {NOT_VERIFIED.has(i.kind as Kind) && i.destination !== "CALL_NOTE" ? <span>Not verified: a request or report, not an instruction.</span> : null}
                    {i.quoteFound ? <span className="truncate" title={i.quote ?? ""}>From: “{i.quote}”</span> : <span className="font-medium text-[#a3242c]">These words are not in your original text. Left out unless you choose otherwise.</span>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty>Nothing was found to organise. Save the note as written instead.</Empty>}
        </div>
        <div>
          <h4 className="mb-1 text-[14px] font-semibold">Follow-up required</h4>
          {draft.followUps.length ? (
            <ul className="space-y-1.5">
              {draft.followUps.map((f, n) => (
                <li key={n} className="grid grid-cols-1 items-end gap-2 rounded-[4px] border border-slate-200 bg-white p-2 md:grid-cols-[auto_minmax(0,1fr)_180px_150px_120px]">
                  <input type="hidden" name="fu" value={n} />
                  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name={`fu_on_${n}`} className="h-4 w-4" /> Create task</label>
                  <label><span className="sr-only">Follow-up</span><input name={`fu_text_${n}`} defaultValue={f} maxLength={500} className="input" /></label>
                  <label><span className="label">Assign to</span><select name={`fu_who_${n}`} defaultValue="" className="input"><option value="">Choose</option>{draft.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label><span className="label">Due</span><input type="date" name={`fu_due_${n}`} defaultValue={draft.defaultDue} min={londonDate()} className="input" /></label>
                  <label><span className="label">Priority</span><select name={`fu_pri_${n}`} defaultValue="MEDIUM" className="input">{Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13.5px] text-slate-600">No follow-up was suggested. You can add one after saving.</p>}
        </div>
        <label className="block"><span className="label">Information requiring clarification</span><textarea name="clarification" rows={2} maxLength={2000} defaultValue={[note.clarification, ...draft.clarifications].filter(Boolean).join("\n")} className="input" /></label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="restricted" defaultChecked={note.restricted} className="h-4 w-4" /> Restricted note</label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary">Save and send for review</button>
        </div>
        <p className="text-[12.5px] text-slate-600">A manager who did not write this note reviews it. Items sent to another record become review items there; nothing in the care plan, risks, medication or rota changes until someone does it through that record.</p>
      </form>
      <form action={withdrawDraftAction} className="mt-2">
        <input type="hidden" name="back" value={`${back}&draft=${note.id}`} />
        <input type="hidden" name="serviceUserId" value={serviceUserId} />
        <input type="hidden" name="noteId" value={note.id} />
        <button className="btn-secondary">Withdraw draft</button>
      </form>
    </section>
  );
}

function UrgentBanner({ kinds, lines, serviceUserId }: { kinds: string[]; lines?: string[]; serviceUserId: string }) {
  const unique = [...new Set(kinds)];
  return (
    <div role="alert" className="mb-2 rounded-[4px] border border-[#e4a7ab] bg-[#fdf1f2] p-2.5 text-[14px] text-[#7c1d23]" data-testid="urgent-banner">
      <p className="font-semibold">Urgent: {unique.map((k) => URGENT_KINDS[k as UrgentKind] ?? k).join(", ")} flagged. Reported, not verified.</p>
      {lines?.length ? <ul className="ml-5 mt-1 list-disc">{lines.map((l, n) => <li key={n}>{l}</li>)}</ul> : null}
      <p className="mt-1">Use the existing workflow now: <Link href={`/rota/incidents/new?su=${serviceUserId}`} className="font-medium text-[#7c1d23] underline">report an incident or safeguarding concern</Link>{unique.includes("MEDICATION") ? <>, and check medication with an authorised professional before anything changes</> : null}. Managers are notified when the note is saved.</p>
    </div>
  );
}

function NoteCard({ n, open, serviceUserId, back, list, people, documents, links }: { n: CallNoteView; open: boolean; serviceUserId: string; back: string; list: CallNoteList; people: { id: string; name: string }[]; documents: { id: string; name: string }[]; links: { ref: string; label: string }[] }) {
  const st = displayStatus(n.status, n.tasks);
  const kept = n.items.filter((i) => i.decision === "KEEP");
  const routed = n.items.filter((i) => i.decision === "ROUTE");
  const linked = n.items.filter((i) => i.decision === "LINK");
  const hidden = { serviceUserId, noteId: n.id, back };
  const date = fmtLondonDate(londonDate(n.communicationAt), { day: "numeric", month: "long", year: "numeric" });
  return (
    <details open={open} className="group rounded-[6px] border border-slate-200 bg-white open:shadow-[0_1px_2px_rgba(16,24,40,0.06)]" data-testid="call-note" id={`note-${n.id}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mt-[3px] text-slate-400 transition-transform group-open:rotate-90">›</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-[#1d2939]">{METHOD_TITLE[n.method as Method] ?? n.method} – {date}<span className="ml-2 text-[13px] font-normal tabular-nums text-slate-500">{londonTime(n.communicationAt)}</span></span>
          <span className="mt-0.5 block text-[13.5px] text-slate-600"><span className="font-medium text-slate-700">Spoke with:</span> {n.contactName}{n.contactRole ? ` (${n.contactRole})` : ""} · <span className="font-medium text-slate-700">Recorded by:</span> {n.recordedBy}</span>
          <span className="mt-0.5 block truncate text-[14px] text-slate-800">{n.summary}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {n.urgentKinds.length ? <Badge tone="rose">Urgent</Badge> : null}
          {n.restricted ? <Badge tone="violet">Restricted</Badge> : null}
          <Badge tone={st.tone === "blue" ? "teal" : st.tone}>{st.label}</Badge>
          <span className="text-[12.5px] tabular-nums text-slate-500">{n.reference}</span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2.5 text-[14px]">
        {n.urgentKinds.length ? <UrgentBanner kinds={n.urgentKinds} lines={n.items.filter((i) => i.urgent).map((i) => i.text)} serviceUserId={serviceUserId} /> : null}
        {n.escalationNote ? <p className="rounded-[4px] bg-[#fdf6e7] p-2 text-[13.5px]"><span className="font-medium">Action taken:</span> {n.escalationNote} <span className="text-slate-500">({n.escalatedBy}, {fmtDate(n.escalatedAt, true)})</span></p> : null}
        <Block title="Summary"><p>{n.summary}</p></Block>
        <Block title="Key information">
          {kept.length ? <ul className="ml-5 list-disc space-y-0.5">{kept.map((i) => <li key={i.id}>{i.text} <span className="text-[12.5px] text-slate-500">({KINDS[i.kind as Kind] ?? i.kind})</span></li>)}</ul>
            : n.details ? <p className="whitespace-pre-line">{n.details}</p>
            : n.items.length ? <p className="text-slate-600">Everything in this note was sent to its own record (below).</p>
            : <p className="whitespace-pre-line">{n.originalText}</p>}
        </Block>
        {routed.length ? (
          <Block title="Sent to other records">
            <ul className="space-y-1.5">
              {routed.map((i) => (
                <li key={i.id} className="rounded-[4px] border border-slate-200 p-2" id={i.review ? `item-${i.review.id}` : undefined}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="teal">{DESTINATIONS[i.destination as Destination]?.label ?? i.destination}</Badge>
                    <span>{i.text}</span>
                    <span className="text-[12.5px] text-slate-500">{KINDS[i.kind as Kind] ?? i.kind}</span>
                  </div>
                  {i.destination === "MEDICATION" ? <p className="mt-1 text-[12.5px] font-medium text-[#8a5a00]">Information requiring clinical verification; no medication change authorised.</p> : null}
                  {i.review ? (
                    i.review.status === "OPEN" ? (
                      <div className="mt-1.5 flex flex-wrap items-end gap-2">
                        <Badge tone="amber">Waiting in the {DESTINATIONS[i.destination as Destination]?.label ?? ""} review queue</Badge>
                        {DESTINATIONS[i.destination as Destination]?.tab ? <Link href={`/rota/service-users/${serviceUserId}?tab=${DESTINATIONS[i.destination as Destination].tab}`} className="text-[13.5px]">Open {DESTINATIONS[i.destination as Destination].label}</Link> : null}
                        {i.review.canResolve ? (
                          <form action={resolveRoutedItemAction} className="flex flex-wrap items-end gap-2">
                            <Hidden v={{ ...hidden, reviewItemId: i.review.id }} />
                            <label><span className="label">What was done</span><input name="resolution" required minLength={5} maxLength={2000} className="input w-[280px] max-w-full" /></label>
                            <button className="btn-secondary">Close item</button>
                          </form>
                        ) : null}
                      </div>
                    ) : <p className="mt-1 text-[13px] text-slate-600">Closed by {i.review.resolvedBy} on {fmtDate(i.review.resolvedAt)}: {i.review.resolution}</p>
                  ) : n.status === "APPROVED" ? null : <p className="mt-1 text-[12.5px] text-slate-500">Sent for review when the note is approved.</p>}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
        {linked.length ? (
          <Block title="Already recorded (linked, not copied)">
            <ul className="ml-5 list-disc">{linked.map((i) => <li key={i.id}>{i.text} → {i.dupHref ? <Link href={i.dupHref}>{i.duplicateLabel}</Link> : i.duplicateLabel}</li>)}</ul>
          </Block>
        ) : null}
        <Block title="Follow-up">
          {n.tasks.length ? (
            <ul className="space-y-1.5">
              {n.tasks.map((t) => (
                <li key={t.id} className="rounded-[4px] border border-slate-200 p-2" data-testid="call-note-task">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.description}</span>
                    <Badge tone={PRI_TONE[t.priority as keyof typeof PRI_TONE] ?? "slate"}>{PRIORITIES[t.priority as keyof typeof PRIORITIES] ?? t.priority}</Badge>
                    <Badge tone={t.status === "OPEN" ? (t.overdue ? "rose" : "amber") : t.status === "DONE" ? "green" : "slate"}>{t.status === "OPEN" ? (t.overdue ? "Overdue" : "Open") : t.status === "DONE" ? "Done" : "Cancelled"}</Badge>
                    <span className="text-[13px] text-slate-600">Assigned to {t.assignee} · due {fmtDate(t.dueOn)}{t.evidenceRequired ? " · evidence required" : ""}</span>
                  </div>
                  {t.status !== "OPEN" ? <p className="mt-1 text-[13px] text-slate-600">{t.closedBy}, {fmtDate(t.closedAt, true)}: {t.completionNote}</p> : null}
                  {t.canClose ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Complete this follow-up</summary>
                      <form action={closeFollowUpAction} className="mt-1.5 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                        <Hidden v={{ ...hidden, taskId: t.id, version: String(t.version) }} />
                        <label><span className="label">Completion notes</span><input name="completionNote" required minLength={3} maxLength={2000} className="input" /></label>
                        <label><span className="label">Evidence{t.evidenceRequired ? "" : " (optional)"}</span><select name="evidenceDocumentId" required={t.evidenceRequired} defaultValue="" className="input"><option value="">None</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                        <div className="flex items-end gap-2"><button name="outcome" value="done" className="btn-primary">Mark done</button>{list.access.review ? <button name="outcome" value="cancel" className="btn-secondary">Cancel task</button> : null}</div>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-600">No follow-up tasks.</p>}
          {n.clarification ? <p className="mt-1.5 whitespace-pre-line text-[13.5px]"><span className="font-medium">To clarify:</span> {n.clarification}</p> : null}
          {n.can.followUp && people.length ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Add a follow-up task</summary>
              <form action={createFollowUpAction} className="mt-1.5 grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_180px_150px_120px_auto]">
                <Hidden v={hidden} />
                <label className="col-span-2 md:col-span-1"><span className="label">Task</span><input name="description" required minLength={3} maxLength={500} className="input" /></label>
                <label><span className="label">Assign to</span><select name="assigneeId" required defaultValue="" className="input"><option value="">Choose</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label><span className="label">Due</span><input type="date" name="dueOn" required min={londonDate()} className="input" /></label>
                <label><span className="label">Priority</span><select name="priority" defaultValue="MEDIUM" className="input">{Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <div className="col-span-2 flex flex-wrap items-end gap-2 md:col-span-1"><label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="evidenceRequired" className="h-4 w-4" /> Evidence</label><button className="btn-secondary">Create</button></div>
              </form>
            </details>
          ) : null}
        </Block>
        <Block title="Related records">
          {n.links.length ? <ul className="flex flex-wrap gap-x-4 gap-y-1">{n.links.map((l) => <li key={l.id}><Link href={l.href!}>{l.label}</Link></li>)}</ul> : <p className="text-slate-600">No linked records.</p>}
          {n.can.followUp && links.length ? (
            <form action={linkRecordAction} className="mt-1.5 flex flex-wrap items-end gap-2">
              <Hidden v={hidden} />
              <label><span className="label">Link an existing record</span><select name="ref" required defaultValue="" className="input w-[300px] max-w-full"><option value="">Choose a record</option>{links.map((o) => <option key={o.ref} value={`${o.ref}|${o.label}`}>{o.label}</option>)}</select></label>
              <button className="btn-secondary">Link</button>
            </form>
          ) : null}
        </Block>
        <details className="rounded-[4px] border border-slate-200 p-2">
          <summary className="cursor-pointer text-[13.5px] font-medium">Source and original text</summary>
          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-[13.5px] sm:grid-cols-2">
            <div><dt className="inline font-medium">How it was entered: </dt><dd className="inline">{n.origin === "MANUAL" ? "Typed by hand" : n.origin === "INTAKE" ? "From a Care Coordinator intake" : n.origin === "AI_ASSISTED" ? `Organised with AI (${n.reader})` : "Organised by keyword rules (no AI)"}</dd></div>
            <div><dt className="inline font-medium">Entered: </dt><dd className="inline">{fmtDate(n.createdAt, true)}</dd></div>
            {n.sourceLabel ? <div className="sm:col-span-2"><dt className="inline font-medium">Source: </dt><dd className="inline">{n.sourceLabel}</dd></div> : null}
            {n.reviewedBy ? <div className="sm:col-span-2"><dt className="inline font-medium">Reviewed: </dt><dd className="inline">{n.reviewedBy}, {fmtDate(n.reviewedAt, true)}{n.reviewNote ? `: ${n.reviewNote}` : ""}</dd></div> : n.reviewNote ? <div className="sm:col-span-2"><dd>{n.reviewNote}</dd></div> : null}
            {n.supersededByRef ? <div><dt className="inline font-medium">Superseded by: </dt><dd className="inline">{n.supersededByRef}</dd></div> : null}
          </dl>
          <blockquote className="mt-1.5 whitespace-pre-line border-l-2 border-slate-300 pl-3 text-slate-800">{n.originalText}</blockquote>
        </details>
        {n.can.review ? (
          <form action={reviewCallNoteAction} className="rounded-[4px] border border-[#c9d6e6] bg-[#f5f9fc] p-2" aria-label={`Review ${n.reference}`}>
            <Hidden v={{ ...hidden, lockVersion: String(n.lockVersion) }} />
            <p className="mb-1 text-[13.5px] font-medium">Manager review</p>
            <label className="block"><span className="label">Note to the author (needed to return or reject)</span><input name="reviewNote" maxLength={2000} className="input" /></label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button name="decision" value="APPROVE" className="btn-primary">Approve</button>
              <button name="decision" value="CLARIFY" className="btn-secondary">Request clarification</button>
              <button name="decision" value="REJECT" className="btn-secondary">Reject</button>
            </div>
          </form>
        ) : n.status === "AWAITING_REVIEW" ? <p className="text-[13px] text-slate-600">Waiting for a manager who did not write this note.</p> : null}
        {n.status === "CLARIFICATION_REQUESTED" && n.reviewNote ? <p className="rounded-[4px] bg-violet-50 p-2 text-[13.5px] text-violet-800"><span className="font-medium">Clarification requested:</span> {n.reviewNote}</p> : null}
        {n.can.escalate ? (
          <details className="rounded-[4px] border border-slate-200 p-2">
            <summary className="cursor-pointer text-[13.5px] font-medium">Record the action taken on the urgent concern</summary>
            <form action={recordEscalationAction} className="mt-1.5 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_260px_auto]">
              <Hidden v={hidden} />
              <label><span className="label">Action taken</span><input name="action" required minLength={5} maxLength={2000} className="input" /></label>
              <label><span className="label">Incident reported (optional)</span><select name="incidentId" defaultValue="" className="input"><option value="">None</option>{links.filter((l) => l.ref.startsWith("Incident:")).map((l) => <option key={l.ref} value={l.ref.slice(9)}>{l.label}</option>)}</select></label>
              <div className="flex items-end"><button className="btn-secondary">Record</button></div>
            </form>
          </details>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {n.can.correct ? (
            <details className="w-full rounded-[4px] border border-slate-200 p-2">
              <summary className="cursor-pointer text-[13.5px] font-medium">Correct this note</summary>
              <form action={correctCallNoteAction} className="mt-1.5 space-y-2">
                <Hidden v={{ ...hidden, lockVersion: String(n.lockVersion) }} />
                <label className="block"><span className="label">Summary</span><input name="summary" required defaultValue={n.summary} maxLength={2000} className="input" /></label>
                <label className="block"><span className="label">Notes</span><textarea name="details" rows={3} defaultValue={n.details ?? ""} maxLength={8000} className="input" /></label>
                <label className="block"><span className="label">Information requiring clarification</span><textarea name="clarification" rows={2} defaultValue={n.clarification ?? ""} maxLength={2000} className="input" /></label>
                <label className="block"><span className="label">Reason for the correction</span><input name="reason" required minLength={5} maxLength={500} className="input" /></label>
                <button className="btn-secondary">Save correction</button>
                <p className="text-[12.5px] text-slate-600">The previous version is kept in the history and the original text does not change. The corrected note goes back for review.</p>
              </form>
            </details>
          ) : null}
          {n.can.supersede ? (
            <details className="w-full rounded-[4px] border border-slate-200 p-2">
              <summary className="cursor-pointer text-[13.5px] font-medium">Mark as superseded</summary>
              <form action={supersedeCallNoteAction} className="mt-1.5 flex flex-wrap items-end gap-2">
                <Hidden v={hidden} />
                <label><span className="label">Replaced by (reference)</span><input name="byReference" required placeholder="CALL-2026-000002" className="input w-[200px]" /></label>
                <label className="min-w-[220px] flex-1"><span className="label">Reason</span><input name="reason" required minLength={5} maxLength={500} className="input" /></label>
                <button className="btn-secondary">Confirm superseded</button>
              </form>
            </details>
          ) : null}
        </div>
        <details className="rounded-[4px] border border-slate-200 p-2">
          <summary className="cursor-pointer text-[13.5px] font-medium">History ({n.history.length + n.revisions.length})</summary>
          <ol className="mt-1.5 space-y-1 text-[13px]">
            {n.history.map((h) => <li key={h.id} className="border-l-2 border-slate-200 pl-2"><span className="font-medium">{h.action.replace("callNote.", "").replace(/([A-Z])/g, " $1").toLowerCase()}</span> · {h.by} · {fmtDate(h.at, true)}</li>)}
            {n.revisions.map((v) => <li key={v.id} className="border-l-2 border-amber-300 pl-2"><span className="font-medium">Version {v.version} kept</span> · {v.by} · {fmtDate(v.createdAt, true)} · {v.reason}<span className="block text-slate-600">Summary was: {(v.snapshot as { summary?: string }).summary}</span></li>)}
          </ol>
        </details>
      </div>
    </details>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-0.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-slate-600">{title}</h4>
      {children}
    </div>
  );
}

function Hidden({ v }: { v: Record<string, string> }) {
  return <>{Object.entries(v).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}</>;
}

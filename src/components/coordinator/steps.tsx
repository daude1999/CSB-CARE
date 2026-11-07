import Link from "@/components/link";
import { Badge, Empty, fmtDate } from "@/components/ui";
import { categoriesFor } from "@/server/care/su-documents";
import type { IntakeView } from "@/server/care/coordinator/intake";
import type { previewIntakeRota, rotaReadiness, staffingProposals } from "@/server/care/coordinator/rota";
import { APPLY_STATUS, FOLLOW_UP_LABEL, INTAKE_SECTIONS, SECTION_STATUS, inReview, sectionInfo, sectionLabel } from "@/lib/care-coordinator-rules";
import { MANUAL_DESTINATIONS } from "@/lib/care-coordinator-forms";
import { fmtLondonDate, londonTime } from "@/lib/london";
import {
  activateCareAction, addManualFactAction, applySectionAction, approveVerifiedAction, confirmAndSetUpAction, createIntakeRotaAction, fileIntakeDocumentsAction, proposeIntakeRotaAction,
  rereadIntakeDocumentAction, resolveFollowUpAction, updateIntakeDocumentAction, uploadIntakeDocumentsAction,
} from "@/app/coordinator-actions";
import { FactRow } from "./fact-row";
import { ReadProgress } from "./read-progress";
import { ValueFields } from "./value-fields";

type View = IntakeView;
const READ_STATUS = { PENDING: ["Not read yet", "slate"], READ: ["Read", "green"], PARTLY_READ: ["Partly read", "amber"], UNREADABLE: ["Could not be read", "rose"], FAILED: ["Stored, not read yet", "rose"] } as const;
/** How it was read, shown next to the status so "uploaded, AI failed, basic reader used" is never mistaken for a failed upload. */
function readMethodBadge(d: { readMethod: string | null; readFailure: string | null }) {
  if (d.readMethod === "ai") return <Badge tone="teal">Read by AI</Badge>;
  if (d.readMethod === "ai-and-basic") return <Badge tone="amber">AI and basic reader</Badge>;
  if (d.readMethod === "basic-reader" && d.readFailure) return <Badge tone="amber">AI failed, basic reader used</Badge>;
  if (d.readMethod === "basic-reader") return <Badge tone="slate">Basic reader (no AI)</Badge>;
  return null;
}
/** Where a background reading is (read-jobs.ts). DONE shows nothing extra: the read status says it. */
const READ_STAGE = { QUEUED: ["Waiting to be read", "slate"], READING: ["Reading now", "teal"], PREPARING: ["CSB AI setting up records", "teal"], RETRYING: ["Waiting to try again", "amber"], FAILED: ["Reading stopped", "rose"] } as const;
const STAGE_BUSY = new Set(["QUEUED", "READING", "PREPARING", "RETRYING"]);
const SECTION_TONE = { DRAFTED: "teal", OPEN: "amber", APPROVED: "green", RETURNED: "rose", REJECTED: "rose", INFO_REQUESTED: "amber" } as const;
const APPLY_TONE = { NOT_STARTED: "slate", SAVING: "teal", DONE: "green", FAILED: "rose", BLOCKED: "amber" } as const;
const closed = (v: View) => v.intake.status === "COMPLETED" || v.intake.status === "CANCELLED";
/** The coordinator can change facts while the intake is in review, except in a section that was rejected. */
const sectionEditable = (v: View, key: string) => inReview(v.intake.status) && v.sections.find((s) => s.key === key)?.status !== "REJECTED";
const Hidden = ({ back, intakeId }: { back: string; intakeId: string }) => <><input type="hidden" name="back" value={back} /><input type="hidden" name="intakeId" value={intakeId} /></>;

// ── 1. Documents ──────────────────────────────────────────────────────────

export function DocumentsStep({ view, back }: { view: View; back: string }) {
  const { intake } = view;
  return (
    <div className="space-y-4">
      {view.documents.some((d) => d.readStage && STAGE_BUSY.has(d.readStage)) ? <ReadProgress intakeId={intake.id} /> : null}
      <p className="text-[14px] text-slate-700">The original files are kept exactly as uploaded (each has a fingerprint) and filed in the person&apos;s Council or Other Documents once they are saved. Restricted documents, such as hospital letters, are shown only to managers.</p>
      {view.documents.length ? (
        <ul className="space-y-3" aria-label="Uploaded documents">
          {view.documents.map((d) => {
            const [statusLabel, tone] = READ_STATUS[d.readStatus as keyof typeof READ_STATUS] ?? ["Unknown", "slate"];
            const stage = d.readStage ? READ_STAGE[d.readStage as keyof typeof READ_STAGE] : undefined;
            const busy = !!d.readStage && STAGE_BUSY.has(d.readStage);
            return (
              <li key={d.id} className="rounded-[3px] border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">{d.name}</h3>
                    <p className="text-[13px] text-slate-600">{d.filename} · {d.pageCount ?? "?"} page{d.pageCount === 1 ? "" : "s"} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB · uploaded {fmtDate(d.createdAt, true)}</p>
                    <p className="text-[13px] text-slate-700">Filed under: {d.section === "COUNCIL" ? "Council Documents" : "Other Documents"} → {d.categoryLabel}{d.issuer ? ` · from ${d.issuer}` : ""}{d.documentDate ? ` · dated ${fmtLondonDate(d.documentDate.toISOString().slice(0, 10))}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {busy ? null : <Badge tone={tone}>{statusLabel}</Badge>}
                    {stage ? <Badge tone={stage[1]}>{stage[0]}</Badge> : null}
                    {busy ? null : readMethodBadge(d)}
                    {d.sensitive ? <Badge tone="violet">Restricted</Badge> : null}
                    {d.filedDocumentId ? <Badge tone="navy">Filed in profile</Badge> : null}
                  </div>
                </div>
                {d.readStageNote && (busy || d.readStage === "FAILED" || d.readStage === "DONE") ? <p className={`mt-1 text-[13px] ${d.readStage === "FAILED" ? "text-rose-700" : "text-slate-700"}`}>{d.readStageNote}</p> : null}
                {d.readNote && !busy ? <p className="mt-1 text-[13px] text-slate-600">{d.readNote}</p> : null}
                {d.findings.length ? (
                  <ul className="mt-2 space-y-1 text-[13.5px]" aria-label={`Points to check in ${d.name}`}>
                    {d.findings.map((f, i) => <li key={i} className="rounded bg-[#fff8e8] px-2 py-1 text-[#6b4a00]">{f.text}{f.page ? ` (page ${f.page})` : ""}</li>)}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  {d.canOpen ? <a className="btn-secondary" href={`/api/care-coordinator/documents/${d.id}`} target="_blank" rel="noopener">Open original<span className="sr-only"> {d.name} (opens in a new tab)</span></a> : <span className="text-[13px] text-slate-600">A manager opens this document.</span>}
                  {d.canOpen && inReview(intake.status) ? (
                    <form action={rereadIntakeDocumentAction}><Hidden back={back} intakeId={intake.id} /><input type="hidden" name="documentId" value={d.id} /><button className={d.readStatus === "FAILED" || d.readFailure || d.readStage === "FAILED" ? "btn-primary" : "btn-secondary"} disabled={busy} aria-disabled={busy}>{busy ? "Being read" : "Read again"}<span className="sr-only"> {d.name}</span></button></form>
                  ) : null}
                  {d.canOpen && !d.filedDocumentId && !closed(view) ? (
                    <details className="w-full sm:w-auto [&[open]]:w-full">
                      <summary className="btn-secondary cursor-pointer list-none">Change filing</summary>
                      <form action={updateIntakeDocumentAction} className="mt-2 grid grid-cols-1 gap-3 rounded border border-slate-200 p-3 sm:grid-cols-2">
                        <Hidden back={back} intakeId={intake.id} /><input type="hidden" name="documentId" value={d.id} />
                        <label className="block"><span className="label">Document name</span><input name="name" required defaultValue={d.name} className="input" /></label>
                        <label className="block"><span className="label">Folder</span><select name="docSection" defaultValue={d.section} className="input"><option value="COUNCIL">Council Documents</option><option value="OTHER">Other Documents</option></select></label>
                        <label className="block"><span className="label">Category</span>
                          <select name="category" defaultValue={d.category} className="input">
                            <optgroup label="Council Documents">{categoriesFor("COUNCIL").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                            <optgroup label="Other Documents">{categoriesFor("OTHER").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                          </select>
                        </label>
                        <label className="block"><span className="label">From (issuer)</span><input name="issuer" defaultValue={d.issuer ?? ""} className="input" /></label>
                        <label className="block"><span className="label">Document date</span><input type="date" name="documentDate" defaultValue={d.documentDate ? d.documentDate.toISOString().slice(0, 10) : ""} className="input" /></label>
                        <label className="flex items-center gap-2 self-end text-[14px]"><input type="checkbox" name="sensitive" defaultChecked={d.sensitive} /> Restricted (managers only)</label>
                        <div className="sm:col-span-2"><button className="btn-primary">Save filing</button></div>
                      </form>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <Empty>No documents yet. Upload the support plan, hospital letters and anything else the referral came with.</Empty>}
      {inReview(intake.status) ? (
        <form action={uploadIntakeDocumentsAction} className="space-y-2 rounded-[3px] border border-dashed border-slate-300 p-3">
          <Hidden back={back} intakeId={intake.id} />
          <label className="block"><span className="label">Add documents (PDF or photos: 4 MB each, 11 MB in total)</span><input type="file" name="files" multiple required accept="application/pdf,image/jpeg,image/png" className="input" /></label>
          <button className="btn-primary">Upload and read</button>
          <p className="text-[13px] text-slate-600">The upload finishes as soon as the files are stored; reading then carries on in the background, and you can leave this page.</p>
        </form>
      ) : null}
    </div>
  );
}

// ── 2. Coordinator check ──────────────────────────────────────────────────

export function ReviewStep({ view, back, section, show, add }: { view: View; back: string; section?: string; show?: string; add?: string }) {
  const { intake } = view;
  const current = sectionInfo(section ?? "") ? section! : null;
  const base = `/rota/coordinator/${intake.id}?step=review`;
  const docName = new Map(view.documents.map((d) => [d.id, d.name]));
  const facts = view.facts.filter((f) => (!current || f.section === current) && (show !== "open" || f.decision === "PENDING" || f.decision === "CLARIFY"));
  const open = view.facts.filter((f) => f.decision === "PENDING" || f.decision === "CLARIFY");
  const openYours = open.filter((f) => !f.hidden).length;
  // A note a manager left under the retired approval step (before 7 Nov 2026) is still shown, for information.
  const earlierNotes = view.sections.filter((s) => s.reason && s.status === "OPEN");
  const canConfirm = inReview(intake.status);
  const addable = MANUAL_DESTINATIONS.filter(([d]) => !current || sectionOfDestination(d) === current);
  const addDest = add && MANUAL_DESTINATIONS.some(([d]) => d === add) ? add : null;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { section: current ?? undefined, show, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${base}&${s}` : base;
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Profile sections" className="lg:sticky lg:top-20 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
          <li><Link href={q({ section: undefined })} aria-current={!current ? "page" : undefined} className={`flex items-center justify-between gap-2 whitespace-nowrap rounded px-2.5 py-2 text-[14px] no-underline ${!current ? "bg-[#e3effb] font-semibold text-navy-900" : "text-slate-800 hover:bg-slate-100"}`}>All sections<span className="text-[12.5px] tabular-nums text-slate-600">{open.length}/{view.facts.length}</span></Link></li>
          {INTAKE_SECTIONS.map((s) => {
            const row = view.sections.find((x) => x.key === s.key);
            const n = row?.total ?? 0;
            return (
              <li key={s.key}><Link href={q({ section: s.key })} aria-current={current === s.key ? "page" : undefined} className={`flex items-center justify-between gap-2 whitespace-nowrap rounded px-2.5 py-2 text-[14px] no-underline ${current === s.key ? "bg-[#e3effb] font-semibold text-navy-900" : "text-slate-800 hover:bg-slate-100"} ${n ? "" : "text-slate-500"}`}>{s.label}<span className="text-[12.5px] tabular-nums text-slate-600">{row?.open ? `${row.open} to check` : n ? "✓" : "–"}</span></Link></li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[17px]">{current ? sectionLabel(current) : "Every fact read from the documents"}</h2>
            {current ? <p className="text-[13px] text-slate-600">Saved to: {sectionInfo(current)!.profile}</p> : <p className="text-[13px] text-slate-600">{openYours ? `${openYours} fact${openYours === 1 ? "" : "s"} still need${openYours === 1 ? "s" : ""} you.` : "Nothing is waiting for you."}{open.length > openYours ? ` ${open.length - openYours} restricted fact${open.length - openYours === 1 ? "" : "s"} wait${open.length - openYours === 1 ? "s" : ""} for someone allowed to see restricted records.` : ""} Every decision is saved as you make it.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={q({ show: show === "open" ? undefined : "open" })} className="btn-secondary">{show === "open" ? "Show all facts" : "Only facts still to check"}</Link>
            {current && sectionEditable(view, current) ? (
              <form action={approveVerifiedAction}><Hidden back={back} intakeId={intake.id} /><input type="hidden" name="section" value={current} /><button className="btn-secondary" title="Approves facts whose words were found on the page and that have no warning">Approve checked facts</button></form>
            ) : null}
          </div>
        </div>

        {earlierNotes.filter((s) => !current || s.key === current).map((s) => (
          <p key={s.key} role="note" className="rounded border border-slate-200 bg-[#f5f9fc] px-3 py-2 text-[14px] text-slate-800"><span className="font-medium">{sectionLabel(s.key)}: earlier note from {s.decidedBy ?? "a manager"}.</span> {s.reason}</p>
        ))}

        {(!current || current === "VISITS" || current === "PACKAGE") && view.reconciliation ? (
          <div className={`rounded border px-3 py-2 text-[14px] ${view.reconciliation.authorised !== null && !view.reconciliation.matches ? "border-[#f0d9a8] bg-[#fff8e8] text-[#6b4a00]" : "border-slate-200 bg-[#f5f9fc] text-slate-800"}`}>
            <span className="font-medium">Commissioned hours check.</span> {view.reconciliation.message} Approved council visits: {view.reconciliation.COUNCIL} min a week ({(view.reconciliation.COUNCIL / 60).toFixed(2)} h){view.reconciliation.CARERS_SERVICE + view.reconciliation.OTHER ? `. Family or other support, not scheduled: ${view.reconciliation.CARERS_SERVICE + view.reconciliation.OTHER} min` : ""}.
          </div>
        ) : null}

        {facts.length ? (
          current ? (
            <ul className="space-y-2" aria-label={`Facts in ${sectionLabel(current)}`}>
              {facts.map((f) => <FactRow key={f.id} fact={f} docName={f.sourceDocumentId ? docName.get(f.sourceDocumentId) ?? null : null} editable={sectionEditable(view, f.section)} back={back} intakeId={intake.id} members={view.members} callTypes={view.callTypes} />)}
            </ul>
          ) : (
            INTAKE_SECTIONS.filter((s) => facts.some((f) => f.section === s.key)).map((s) => (
              <section key={s.key} aria-labelledby={`h-${s.key}`} className="space-y-2">
                <h3 id={`h-${s.key}`} className="mt-2 text-[15px] font-semibold text-navy-900"><Link href={q({ section: s.key })}>{s.label}</Link> <span className="text-[13px] font-normal text-slate-600">→ {s.profile}</span></h3>
                <ul className="space-y-2">
                  {facts.filter((f) => f.section === s.key).map((f) => <FactRow key={f.id} fact={f} docName={f.sourceDocumentId ? docName.get(f.sourceDocumentId) ?? null : null} editable={sectionEditable(view, f.section)} back={back} intakeId={intake.id} members={view.members} callTypes={view.callTypes} />)}
                </ul>
              </section>
            ))
          )
        ) : <Empty>{show === "open" ? "Nothing left to check here." : view.documents.length ? "Nothing was read for this section. Add a fact by hand if the documents mention it." : "Upload documents first."}</Empty>}

        {canConfirm && (!current || sectionEditable(view, current)) ? (
          <details className="rounded border border-slate-200 p-3" open={!!addDest}>
            <summary className="cursor-pointer text-[14.5px] font-medium">Add a fact by hand</summary>
            <p className="mt-1 text-[13px] text-slate-600">For something on a scanned page, or that the reader missed. It is recorded as added by you and counts as approved by you.</p>
            <form method="get" action={`/rota/coordinator/${intake.id}`} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="step" value="review" />
              {current ? <input type="hidden" name="section" value={current} /> : null}
              <label className="block min-w-[16rem] flex-1"><span className="label">Where it goes in the profile</span>
                <select name="add" defaultValue={addDest ?? ""} className="input"><option value="" disabled>Choose</option>{addable.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
              </label>
              <button className="btn-secondary">Next</button>
            </form>
            {addDest ? (
              <form action={addManualFactAction} className="mt-3 space-y-3">
                <Hidden back={q({ add: undefined })} intakeId={intake.id} />
                <input type="hidden" name="destination" value={addDest} />
                <ValueFields destination={addDest} value={null} callTypes={view.callTypes} idPrefix="add" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">From document</span><select name="sourceDocumentId" className="input" defaultValue=""><option value="">Not from a document</option>{view.documents.filter((d) => d.canOpen).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                  <label className="block"><span className="label">Page</span><input type="number" name="sourcePage" min={1} max={500} className="input" /></label>
                </div>
                <button className="btn-primary">Add fact</button>
              </form>
            ) : null}
          </details>
        ) : null}

        {canConfirm ? <ConfirmPanel view={view} back={back} /> : null}
      </div>
    </div>
  );
}

function sectionOfDestination(d: string) {
  const head = d.split(".")[0];
  return { person: "PERSONAL", contact: "CONTACTS", preference: "CARER_PREFERENCES", careplan: "CARE_PLAN", risk: "RISKS", package: "PACKAGE", visit: "VISITS", medication: "MEDICATION", incident: "INCIDENTS", bodymap: "BODY_MAP", callnote: "CALL_NOTES" }[head ?? ""] ?? null;
}

/** Facts and warnings that still need a person, grouped by section, so nothing unresolved is missed. */
function Unresolved({ view }: { view: View }) {
  const open = view.facts.filter((f) => (f.decision === "PENDING" || f.decision === "CLARIFY") && !f.appliedAt);
  const failed = view.sections.filter((s) => s.applyStatus === "FAILED");
  if (!open.length && !failed.length) return <p className="text-[13.5px] text-[#1c7a43]">Every fact has a decision. Nothing is waiting for you.</p>;
  const base = `/rota/coordinator/${view.intake.id}?step=review`;
  return (
    <div className="space-y-1 text-[13.5px]">
      {failed.map((s) => <p key={s.key} role="alert" className="text-[#a3242c]"><span className="font-medium">{sectionLabel(s.key)} was not saved:</span> {s.applyError ?? "it failed"}. Press Confirm &amp; Set Up Records again to retry it; saved sections are kept.</p>)}
      {open.length ? (
        <>
          <p className="font-medium text-[#6b4a00]">Still needs attention ({open.length}). These are not saved yet; everything else that is ready will be set up.</p>
          <ul className="list-disc pl-5 text-slate-800">
            {INTAKE_SECTIONS.filter((s) => open.some((f) => f.section === s.key)).map((s) => {
              const fs = open.filter((f) => f.section === s.key);
              const warned = fs.filter((f) => f.conflict || f.decision === "CLARIFY").length;
              const hidden = fs.filter((f) => f.hidden).length;
              return <li key={s.key}><Link href={`${base}&section=${s.key}&show=open`}>{s.label}</Link>: {fs.length} to decide{warned ? `, ${warned} with a warning or question` : ""}{hidden ? `, ${hidden} restricted (someone allowed to see restricted records decides ${hidden === 1 ? "it" : "them"})` : ""}</li>;
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Confirm & Set Up Records: the coordinator's one confirmation (owner's brief, 7 Nov 2026). No manager approval is
 * needed. Clinical records it creates stay drafts or review items for their own checks.
 */
export function ConfirmPanel({ view, back }: { view: View; back: string }) {
  const { intake, access } = view;
  const reading = view.documents.some((d) => d.readStatus === "PENDING");
  const saved = view.sections.filter((s) => s.applyStatus === "DONE");
  const confirmed = Boolean(view.approvedBy);
  return (
    <form action={confirmAndSetUpAction} className="space-y-2 rounded-[3px] border border-teal-700/30 bg-[#f1f8f7] p-3" aria-labelledby="confirm-h">
      <Hidden back={back} intakeId={intake.id} />
      <input type="hidden" name="lockVersion" value={intake.lockVersion} />
      <h3 id="confirm-h" className="text-[15px] font-semibold">Confirm &amp; Set Up Records</h3>
      <p className="text-[13.5px] text-slate-700">
        You review and approve this intake; no manager approval is needed. Confirming accepts the checked facts with no warning, then saves everything you have approved into the person&apos;s records: the person (at Assessment), contacts, carer preferences, the care package, the visit templates and call notes, plus the care plan and risk assessments as drafts and medicines as drafts or reconciliation items. Clinical records keep their own reviews. For a new person a draft rota is proposed: its visits are not published, so carers are not told. Your name and the time are recorded on each section.
      </p>
      <Unresolved view={view} />
      {saved.length ? <p className="text-[13.5px] text-slate-700">{confirmed ? "Already saved" : "Already saved as drafts by the AI CSB Coordinator"}: {saved.map((s) => sectionLabel(s.key)).join(", ")}. Confirming {confirmed ? "again " : ""}approves them and saves only what is new; nothing is repeated.</p> : null}
      {intake.mode === "NEW" && !intake.serviceUserId && !intake.areaId && view.areas.length ? (
        <label className="block max-w-sm"><span className="label">Area for the new person</span><select name="areaId" className="input" defaultValue=""><option value="">Choose later</option>{view.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      ) : null}
      {intake.mode === "NEW" && !intake.serviceUserId ? <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="notADuplicate" className="mt-1" /> If a similar person is found, I have checked and this is a different person</label> : null}
      {reading ? <p role="note" className="text-[13.5px] text-slate-700">A document is still being read. Wait for it to finish and check its facts, then confirm.</p> : null}
      {!access.approve ? <p role="note" className="text-[13.5px] text-slate-700">Your role cannot confirm intakes. A Care Coordinator, care manager or administrator confirms it.</p> : null}
      <button className="btn-primary" disabled={reading || !access.approve}>{confirmed ? "Confirm & Set Up Records again" : "Confirm & Set Up Records"}</button>
    </form>
  );
}

// ── 3. Confirm & set up: what was saved ───────────────────────────────────

export function SaveStep({ view, back }: { view: View; back: string }) {
  const { intake, access } = view;
  const rows = view.sections.filter((s) => s.accepted > 0 || s.applyStatus !== "NOT_STARTED" || s.total > 0);
  const unfiled = view.documents.filter((d) => !d.filedDocumentId).length;
  return (
    <div className="space-y-3">
      <p className="text-[14px] text-slate-700">The coordinator confirms the intake and it is saved into the person&apos;s profile in order: Personal details first, the visits last. Each section is read back after saving. A section that fails is named here and can be saved again; anything already saved is never repeated. Care plans and risk assessments are saved as drafts, medicines go to drafts or a reconciliation list, and history stays history.</p>
      {intake.status === "COMPLETED" ? <p role="status" className="rounded border border-[#bfe3cc] bg-[#effaf3] px-3 py-2 text-[14px] text-[#1c5c33]"><span className="font-medium">Completed.</span> Every approved section is saved to the CRM and nothing is left to decide{view.approvedBy ? `. Confirmed by ${view.approvedBy}` : ""}{intake.submittedAt ? `, ${fmtDate(intake.submittedAt, true)}` : ""}.</p> : null}
      {inReview(intake.status) ? <ConfirmPanel view={view} back={back} /> : null}
      <div className="flex flex-wrap gap-2">
        {view.person && unfiled && intake.status !== "CANCELLED" ? <form action={fileIntakeDocumentsAction}><Hidden back={back} intakeId={intake.id} /><button className="btn-secondary">File the original documents ({unfiled})</button></form> : null}
        {view.person ? <Link href={`/rota/service-users/${view.person.id}`} className="btn-secondary">Open {view.person.name}&apos;s profile</Link> : null}
        {view.person ? <Link href={`/rota/coordinator/${intake.id}?step=rota`} className="btn-secondary">Next: draft rota</Link> : null}
      </div>
      {rows.length ? (
        <ul className="space-y-2" aria-label="Sections and what was saved">
          {rows.map((s) => {
            const result = s.applyResult as { created?: string[]; skipped?: string[]; notes?: string[]; verified?: boolean } | null;
            const canRetry = !closed(view) && s.status === "APPROVED" && s.applyStatus === "FAILED" && (!s.restrictedSection || access.sensitive);
            const status = s.status === "APPROVED" && s.decidedBy ? `Approved by ${s.decidedBy}` : SECTION_STATUS[s.status as keyof typeof SECTION_STATUS] ?? s.status;
            return (
              <li key={s.key} className="rounded-[3px] border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold">{sectionLabel(s.key)} <span className="text-[13px] font-normal text-slate-600">→ {sectionInfo(s.key)!.profile}</span></h3>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={SECTION_TONE[s.status as keyof typeof SECTION_TONE] ?? "slate"}>{status}</Badge>
                    <Badge tone={APPLY_TONE[s.applyStatus as keyof typeof APPLY_TONE] ?? "slate"}>{APPLY_STATUS[s.applyStatus as keyof typeof APPLY_STATUS] ?? s.applyStatus}</Badge>
                    {result?.verified ? <Badge tone="green">Read back</Badge> : null}
                  </div>
                </div>
                <p className="mt-1 text-[13px] text-slate-600">{s.accepted} approved, {s.rejected} rejected or duplicate{s.open ? `, ${s.open} still to decide` : ""}{s.hidden ? `, ${s.hidden} restricted` : ""}.</p>
                {s.applyError && s.applyStatus === "FAILED" ? <p role="alert" className="mt-1 text-[14px] text-[#a3242c]">Not saved: {s.applyError}{s.attempts > 1 ? ` (attempt ${s.attempts})` : ""}</p> : null}
                {result ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px] text-slate-800">
                    {result.created?.map((c, i) => <li key={`c${i}`}>{c}</li>)}
                    {result.skipped?.map((c, i) => <li key={`s${i}`} className="text-slate-600">Not saved: {c}</li>)}
                    {result.notes?.map((c, i) => <li key={`n${i}`} className="text-slate-600">{c}</li>)}
                  </ul>
                ) : null}
                {s.appliedBy ? <p className="mt-1 text-[12.5px] text-slate-600">Saved by {s.appliedBy}{s.appliedAt ? `, ${fmtDate(s.appliedAt, true)}` : ""}</p> : null}
                {canRetry ? <form action={applySectionAction} className="mt-2"><Hidden back={back} intakeId={intake.id} /><input type="hidden" name="section" value={s.key} /><button className="btn-secondary">Try {sectionLabel(s.key).toLowerCase()} again</button></form> : null}
                {s.restrictedSection && s.accepted > 0 && !access.sensitive && s.applyStatus !== "DONE" ? <p className="mt-1 text-[13px] text-slate-600">Someone allowed to see restricted records saves this section.</p> : null}
              </li>
            );
          })}
        </ul>
      ) : <Empty>No facts yet.</Empty>}
      <FollowUps view={view} back={back} />
    </div>
  );
}

function FollowUps({ view, back }: { view: View; back: string }) {
  if (!view.followUps.length && !view.hiddenFollowUps) return null;
  return (
    <section aria-labelledby="fu-h" className="space-y-2">
      <h3 id="fu-h" className="mt-3 text-[15px] font-semibold">Follow-ups left by this intake</h3>
      {view.hiddenFollowUps ? <p className="text-[13px] text-slate-600">{view.hiddenFollowUps} restricted follow-up{view.hiddenFollowUps === 1 ? "" : "s"} for someone allowed to see restricted records.</p> : null}
      <ul className="space-y-2">
        {view.followUps.map((f) => (
          <li key={f.id} className="rounded-[3px] border border-slate-200 p-3 text-[14px]">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={f.status === "OPEN" ? "amber" : "green"}>{f.status === "OPEN" ? "Open" : "Closed"}</Badge><span className="font-medium">{FOLLOW_UP_LABEL[f.category] ?? f.category}</span>{f.restricted ? <Badge tone="violet">Restricted</Badge> : null}</div>
            <p className="mt-1 whitespace-pre-line">{f.description}</p>
            {f.sourceRef ? <p className="text-[12.5px] text-slate-600">Source: {f.sourceRef}</p> : null}
            {f.resolution ? <p className="text-[13px] text-slate-700">Closed: {f.resolution}</p> : null}
            {f.status === "OPEN" ? (
              <details className="mt-1"><summary className="cursor-pointer text-[13.5px] text-[#1d4f91]">Close this follow-up</summary>
                <form action={resolveFollowUpAction} className="mt-1 flex flex-wrap items-end gap-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={f.id} /><label className="block min-w-[16rem] flex-1"><span className="label">What was done</span><input name="resolution" required minLength={5} className="input" /></label><button className="btn-secondary">Close</button></form>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 5. Rota and carers ────────────────────────────────────────────────────

type RotaData = { readiness: Awaited<ReturnType<typeof rotaReadiness>>; preview: Awaited<ReturnType<typeof previewIntakeRota>> | null; previewError: string | null; proposals: Awaited<ReturnType<typeof staffingProposals>> };
const STATE_LABEL: Record<string, string> = { ELIGIBLE: "Suitable", REQUIRES_REVIEW: "Check first" };

export function RotaStep({ view, back, rota, week, weeks, lastWeek }: { view: View; back: string; rota: RotaData; week: string; weeks: string; lastWeek: string }) {
  const { intake } = view;
  const r = rota.readiness;
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-slate-700">The draft rota is built by Build Rota from the saved repeating visits, with the same checks on absences and carers. Visits are created unpublished: carers see nothing until the office publishes. Carer suggestions are suggestions only; assign on the Daily Rota, where every choice is checked again.</p>
      <section aria-labelledby="gates-h">
        <h3 id="gates-h" className="text-[15px] font-semibold">Before the rota</h3>
        <ul className="mt-1 space-y-1">
          {r.gates.map((g) => (
            <li key={g.key} className="flex flex-wrap items-baseline gap-2 text-[14px]"><span aria-hidden="true" className={g.ok ? "text-[#1c7a43]" : "text-[#b35e14]"}>{g.ok ? "✓" : "○"}</span><span className="font-medium">{g.label}</span><span className="text-slate-600">{g.detail}</span><span className="sr-only">{g.ok ? "done" : "not done"}</span></li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          {r.serviceUser && r.carePlanId ? <Link href={`/rota/care-plans/${r.serviceUser.id}`} className="btn-secondary">Open the care plan</Link> : null}
        </div>
        {r.riskDrafts.length ? (
          <div className="mt-2">
            <p className="text-[14px]">Risk drafts waiting for a different manager to check and approve:</p>
            <ul className="mt-1 list-disc pl-5 text-[14px]">{r.riskDrafts.map((d) => <li key={d.id}><Link href={`/rota/risks/${d.id}`}>{d.title}</Link> <span className="text-slate-600">({d.level.toLowerCase()}, provisional{d.mine ? "; you drafted it, so someone else approves" : ""})</span></li>)}</ul>
          </div>
        ) : null}
      </section>
      {r.serviceUser && !r.active && view.access.build && view.intake.mode === "NEW" ? (
        <form action={proposeIntakeRotaAction} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-3">
          <Hidden back={back} intakeId={intake.id} />
          <div className="min-w-[16rem] flex-1">
            <h3 className="text-[15px] font-semibold">Draft rota</h3>
            <p className="text-[13.5px] text-slate-700">Proposes unpublished visits from the saved repeating visits, with Build Rota&apos;s usual checks. Carers are not told: the visits can be published only after care is made Active. Visits already proposed are not added again.</p>
          </div>
          <label className="block"><span className="label">Weeks</span><select name="weeks" defaultValue="2" className="input">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <button className="btn-primary">Prepare the draft rota</button>
        </form>
      ) : null}
      {r.ready && !r.active && r.canBuild ? (
        <form action={activateCareAction} className="rounded border border-slate-200 p-3"><Hidden back={back} intakeId={intake.id} /><p className="mb-2 text-[14px]">Everything is approved. Making care Active lets Build Rota schedule {r.serviceUser?.firstName}&apos;s visits.</p><button className="btn-primary">Make care Active</button></form>
      ) : null}
      {r.ready && !r.canBuild ? <p className="text-[14px] text-slate-600">A care manager or administrator activates care and creates the rota.</p> : null}
      {r.active && r.canBuild ? (
        <section aria-labelledby="preview-h" className="space-y-2 rounded border border-slate-200 p-3">
          <h3 id="preview-h" className="text-[15px] font-semibold">Draft rota</h3>
          <form method="get" action={`/rota/coordinator/${intake.id}`} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="step" value="rota" /><input type="hidden" name="preview" value="1" />
            <label className="block"><span className="label">From the week of</span><input type="date" name="week" defaultValue={week} max={lastWeek} className="input" /></label>
            <label className="block"><span className="label">Weeks</span><select name="weeks" defaultValue={weeks} className="input">{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button className="btn-secondary">Preview</button>
          </form>
          {rota.previewError ? <p role="alert" className="text-[14px] text-[#a3242c]">{rota.previewError}</p> : null}
          {rota.preview ? (
            <>
              <p className="text-[14px]">{rota.preview.totals.create} visit{rota.preview.totals.create === 1 ? "" : "s"} would be created ({rota.preview.totals.alreadyBuilt} already on the rota, {rota.preview.totals.skipped} skipped). {rota.preview.totals.unassignedSlots} place{rota.preview.totals.unassignedSlots === 1 ? "" : "s"} would still need a carer.</p>
              <ul className="text-[13.5px] text-slate-700">{rota.preview.plans.map((p) => <li key={p.weekStart}>Week of {fmtLondonDate(p.weekStart)}: {p.visits.length} new, {p.alreadyBuilt} already built{p.skipped.length ? `, ${p.skipped.length} skipped (${p.skipped.slice(0, 2).map((s) => s.reason).join("; ")})` : ""}</li>)}</ul>
              {rota.preview.totals.create ? (
                <form action={createIntakeRotaAction}><Hidden back={back} intakeId={intake.id} /><input type="hidden" name="weekStart" value={rota.preview.weekStart} /><input type="hidden" name="weeks" value={rota.preview.weeks} /><input type="hidden" name="fingerprint" value={rota.preview.fingerprint} /><button className="btn-primary">Create these visits, unpublished</button></form>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {rota.proposals.length ? (
        <section aria-labelledby="prop-h">
          <h3 id="prop-h" className="text-[15px] font-semibold">Suggested carers for the open places (next 14 days)</h3>
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th scope="col">Visit</th><th scope="col">Open</th><th scope="col">Suggestions (best first; regular carers first among equals)</th></tr></thead>
              <tbody>
                {rota.proposals.map((p) => (
                  <tr key={p.visitId}>
                    <td><Link href={`/rota/visits?date=${p.start.toISOString().slice(0, 10)}&visit=${p.visitId}`}>{fmtLondonDate(p.start.toISOString().slice(0, 10))} {londonTime(p.start)}–{londonTime(p.end)}</Link><span className="block text-[13px] text-slate-600">{p.callType} · {p.reference}{p.published ? "" : " · not published"}</span></td>
                    <td className="tabular-nums">{p.open}</td>
                    <td>{p.options.length ? <ul className="space-y-1">{p.options.map((o) => <li key={o.staffId}><span className="font-medium">{o.name}</span> <span className="text-[13px] text-slate-600">{STATE_LABEL[o.state] ?? o.state}{o.continuity ? " · already visits" : ""}{o.warnings.length ? ` · ${o.warnings.join("; ")}` : ""}</span></li>)}</ul> : <span className="text-slate-600">Nobody suitable is free. Look on the Daily Rota or Find Replacement Cover.</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : r.active ? <p className="text-[14px] text-slate-600">No open places in the next 14 days.</p> : null}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  "coordinator.setup.triaged": "CSB AI sorted the facts", "coordinator.setup.finished": "Automatic setup finished", "coordinator.setup.failed": "Automatic setup stopped", "coordinator.setup.identity-question": "CSB AI asked an identity question",
  "coordinator.identity.chosen": "Identity value chosen", "coordinator.identity.new-person-confirmed": "Confirmed as a new person", "coordinator.exception.raised": "Exception raised", "coordinator.exception.resolved": "Exception resolved",
  "coordinator.intake.created": "Intake started", "coordinator.document.uploaded": "Document uploaded", "coordinator.document.read": "Document read", "coordinator.document.opened": "Original document opened", "coordinator.document.classified": "Filing details changed",
  "coordinator.fact.decided": "Fact decided", "coordinator.fact.added": "Fact added by hand", "coordinator.fact.bulk-approved": "Checked facts approved", "coordinator.intake.submitted": "Sent for approval (earlier process)", "coordinator.intake.resubmitted": "Corrected sections sent back (earlier process)", "coordinator.section.decided": "Section decided by a manager (earlier process)",
  "coordinator.intake.confirmed": "Confirmed and set up by the coordinator", "coordinator.intake.approved": "Approved by the coordinator", "coordinator.section.approved": "Section approved by the coordinator", "coordinator.intake.saved": "Save to the CRM finished", "coordinator.drafts.accepted": "Checked facts accepted for drafting", "coordinator.drafts.prepared": "Draft records prepared", "coordinator.section.drafted": "Section saved as drafts", "coordinator.rota.proposed": "Draft rota prepared (unpublished)",
  "coordinator.section.applied": "Section saved to the CRM", "coordinator.section.failed": "Section failed to save", "coordinator.documents.filed": "Original documents filed", "coordinator.intake.cancelled": "Intake cancelled", "coordinator.care.activated": "Care made Active",
  "coordinator.medication.reconciliation": "Medicines put on the reconciliation list", "coordinator.rota.created": "Draft rota created (unpublished)", "coordinator.followup.resolved": "Follow-up closed",
};

export function HistoryStep({ view }: { view: View }) {
  return view.history.length ? (
    <ol className="rows text-[14px]" aria-label="Intake history, newest first">
      {view.history.map((h) => {
        const d = h.data ?? {};
        const bits = [d.section ? sectionLabel(String(d.section)) : null, d.decision ? String(d.decision).toLowerCase().replace(/_/g, " ") : null, typeof d.facts === "number" ? `${d.facts} facts` : null, typeof d.approved === "number" ? `${d.approved} approved` : null, typeof d.visits === "number" ? `${d.visits} visits` : null, d.reader ? `reader: ${d.reader === "basic-reader" ? "CSB's own reader" : String(d.provider ?? d.reader)}` : null, d.error ? String(d.error) : null].filter(Boolean);
        return <li key={h.id} className="py-2"><span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>{bits.length ? ` · ${bits.join(" · ")}` : ""}<span className="block text-[12.5px] text-slate-600">{h.actor} · {fmtDate(h.at, true)}</span></li>;
      })}
    </ol>
  ) : <Empty>No history yet.</Empty>;
}

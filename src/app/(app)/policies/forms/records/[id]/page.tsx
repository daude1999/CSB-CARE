import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, type PcTone } from "@/components/compliance-ui";
import { ActionDialog } from "@/components/dialog";
import { PrintButton } from "@/components/print-button";
import { Flash, fmtDate } from "@/components/ui";
import { FormConditions } from "@/components/forms/form-conditions";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getFormRecord, STATUS_LABELS, type RecordStatus } from "@/server/forms/records";
import { answerText, isAnswerable, type AnswerValue, type FormField } from "@/lib/forms/schema";
import { reviewFormAction, saveFormAction, voidFormAction } from "../../../../../actions";

export const dynamic = "force-dynamic";

const TONE: Record<RecordStatus, PcTone> = { DRAFT: "grey", SUBMITTED: "blue", RETURNED: "amber", APPROVED: "green", VOIDED: "red" };
const EVENT_LABEL: Record<string, string> = {
  CREATED: "Started", SAVED: "Draft saved", SUBMITTED: "Submitted for review", RESUBMITTED: "Resubmitted after correction",
  RETURNED: "Returned for correction", APPROVED: "Approved", VOIDED: "Voided", PRINTED: "Printed",
};
const showAttrs = (f: FormField) => (f.showIf ? { "data-show-field": f.showIf.field, "data-show-equals": f.showIf.equals === true ? "yes" : f.showIf.equals === false ? "no" : f.showIf.equals } : {});

/**
 * One on-screen form record: the form to fill in while it is a draft or returned, otherwise the submitted answers,
 * with its version, review and full history. Only the person who started it and the form's reviewers can open it.
 */
export default async function FormRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const data = await orNotFound(getFormRecord(ctx, id));
  const { record, form, version, schema, events, names, can } = data;
  const here = `/policies/forms/records/${record.id}`;
  const who = (uid: string | null) => (uid ? names.get(uid) ?? "Unknown" : "");

  return (
    <div className="min-w-0" data-testid="form-record">
      <CompliancePageHeader
        crumbs={[{ label: "Policy & Compliance", href: "/" }, { label: "Forms & Resources", href: "/policies/forms" }, { label: "My forms & reviews", href: "/policies/forms/records" }]}
        title={`${form.title}`}
        subtitle={`${record.reference} · ${form.ref} · form version ${version.number}${version.isCurrent ? "" : " (an older version, kept for this record)"}`}
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="forms" />}
        actions={<PrintButton className="btn-secondary">Print</PrintButton>}
      />
      <Flash searchParams={sp} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section className="pc-panel p-4" aria-label="Status">
            <div className="flex flex-wrap items-center gap-2">
              <PcBadge tone={TONE[record.status]}>{STATUS_LABELS[record.status]}</PcBadge>
              <span className="text-[13px] text-slate-600">Started {fmtDate(record.createdAt, true)} by {who(record.createdById)}</span>
            </div>
            {record.status === "RETURNED" && record.returnReason ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-900" data-testid="return-reason"><strong>Returned for correction:</strong> {record.returnReason}</p>
            ) : null}
            {record.status === "VOIDED" && record.voidReason ? <p className="mt-3 text-[14px] text-slate-700"><strong>Voided:</strong> {record.voidReason}</p> : null}
            {can.ownRecordReview ? <p className="mt-3 text-[13px] text-slate-600">You filled this in, so another reviewer must approve it.</p> : null}
            <p className="mt-3 text-[14px] leading-6 text-slate-700">{version.instructions}</p>
          </section>

          {can.edit ? (
            <form action={saveFormAction} className="pc-panel p-4" data-testid="form-fill" noValidate>
              <input type="hidden" name="recordId" value={record.id} />
              <input type="hidden" name="lockVersion" value={record.lockVersion} />
              <input type="hidden" name="back" value={here} />
              <FormConditions>
                <div className="space-y-5">
                  {schema.map((f) => <FieldInput key={f.key} f={f} value={record.answers[f.key]} />)}
                </div>
              </FormConditions>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                <button type="submit" name="intent" value="save" className="btn-secondary">Save draft</button>
                <button type="submit" name="intent" value="submit" className="btn-primary">Submit for review</button>
                <span className="text-[12.5px] text-slate-600">Drafts are not saved automatically. Once submitted, answers are locked.</span>
              </div>
            </form>
          ) : (
            <section className="pc-panel p-4" aria-label="Answers" data-testid="form-answers">
              <dl className="space-y-4">
                {schema.map((f) => {
                  if (f.type === "heading") return <h2 key={f.key} className="border-b border-slate-200 pb-1 pt-2 text-[15px] font-semibold">{f.label}</h2>;
                  if (!isAnswerable(f)) return <p key={f.key} className="text-[13px] text-slate-600">{f.label}</p>;
                  if (f.showIf && record.answers[f.key] === undefined) return null;
                  return (
                    <div key={f.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4">
                      <dt className="text-[13.5px] text-slate-600">{f.label}</dt>
                      <dd className="whitespace-pre-wrap text-[14px] text-slate-900">{answerText(f, record.answers[f.key])}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          )}
        </div>

        <aside className="space-y-4" aria-label="Record details">
          {can.review ? (
            <section className="pc-panel p-4" data-testid="review-actions">
              <h2 className="font-semibold">Review</h2>
              <p className="mt-1 text-[13px] text-slate-600">Approve it, or send it back with what needs correcting.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={reviewFormAction}>
                  <input type="hidden" name="recordId" value={record.id} />
                  <input type="hidden" name="lockVersion" value={record.lockVersion} />
                  <input type="hidden" name="decision" value="approve" />
                  <input type="hidden" name="back" value={here} />
                  <button type="submit" className="btn-primary">Approve</button>
                </form>
                <ActionDialog trigger="Return for correction" triggerClassName="btn-secondary" title="Return for correction" description="The person who filled it in can change their answers and resubmit. Your reason is shown to them.">
                  <form action={reviewFormAction} className="space-y-3">
                    <input type="hidden" name="recordId" value={record.id} />
                    <input type="hidden" name="lockVersion" value={record.lockVersion} />
                    <input type="hidden" name="decision" value="return" />
                    <input type="hidden" name="back" value={here} />
                    <label className="block"><span className="label">What needs correcting</span><textarea name="reason" required minLength={5} maxLength={1000} rows={3} className="input" /></label>
                    <button type="submit" className="btn-primary">Return</button>
                  </form>
                </ActionDialog>
              </div>
            </section>
          ) : null}

          <section className="pc-panel p-4 text-[13px]">
            <h2 className="font-semibold">Details</h2>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Reference</dt><dd>{record.reference}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Form</dt><dd className="text-right">{form.ref}, version {version.number}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Version published</dt><dd>{fmtDate(version.publishedAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Submitted</dt><dd>{record.submittedAt ? fmtDate(record.submittedAt, true) : "Not yet"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-600">Reviewed</dt><dd className="text-right">{record.reviewedAt ? `${fmtDate(record.reviewedAt, true)} · ${who(record.reviewerId)}` : "Not yet"}</dd></div>
            </dl>
          </section>

          <section className="pc-panel p-4" data-testid="form-history">
            <h2 className="font-semibold">History</h2>
            <ol className="mt-2 space-y-2.5 text-[13px]">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                  <div className="font-medium text-slate-900">{EVENT_LABEL[e.type] ?? e.type}</div>
                  <div className="text-slate-600">{fmtDate(e.createdAt, true)} · {who(e.actorId)}</div>
                  {e.note ? <div className="mt-0.5 text-slate-700">{e.note}</div> : null}
                </li>
              ))}
            </ol>
          </section>

          {can.voidIt ? (
            <section className="pc-panel p-4">
              <ActionDialog trigger="Void this form" triggerClassName="pc-btn-secondary pc-btn-sm" title="Void this form?" description="Use this when the form was started by mistake or is no longer valid. It stays on record, marked void, with your reason.">
                <form action={voidFormAction} className="space-y-3">
                  <input type="hidden" name="recordId" value={record.id} />
                  <input type="hidden" name="back" value={here} />
                  <label className="block"><span className="label">Reason</span><textarea name="reason" required minLength={5} maxLength={1000} rows={3} className="input" /></label>
                  <button type="submit" className="btn-primary">Void</button>
                </form>
              </ActionDialog>
            </section>
          ) : null}
          <p className="text-[12.5px] text-slate-600"><Link href="/policies/forms/records">Back to my forms &amp; reviews</Link></p>
        </aside>
      </div>
    </div>
  );
}

function FieldInput({ f, value }: { f: FormField; value: AnswerValue | undefined }) {
  const id = `f_${f.key}`;
  if (f.type === "heading") return <h2 className="border-b border-slate-200 pb-1 pt-2 text-[15px] font-semibold" {...showAttrs(f)}>{f.label}</h2>;
  if (f.type === "instructions") return <p className="text-[13.5px] text-slate-700" {...showAttrs(f)}>{f.label}</p>;
  const label = (
    <span className="label">
      {f.label}
      {f.required ? <span className="ml-1 text-[12px] font-normal text-slate-500">(required)</span> : null}
    </span>
  );
  const help = f.help ? <span id={`${id}_help`} className="mt-1 block text-[12.5px] text-slate-600">{f.help}</span> : null;
  const described = f.help ? { "aria-describedby": `${id}_help` } : {};
  const str = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  let control: React.ReactNode;
  switch (f.type) {
    case "text": control = <input id={id} name={id} defaultValue={str} maxLength={f.maxLength} className="input" {...described} />; break;
    case "longtext": control = <textarea id={id} name={id} defaultValue={str} maxLength={f.maxLength} rows={4} className="input" {...described} />; break;
    case "date": control = <input id={id} name={id} type="date" defaultValue={str} className="input max-w-[14rem]" {...described} />; break;
    case "time": control = <input id={id} name={id} type="time" defaultValue={str} className="input max-w-[10rem]" {...described} />; break;
    case "number": control = <input id={id} name={id} type="number" defaultValue={str} min={f.min} max={f.max} className="input max-w-[10rem]" {...described} />; break;
    case "select":
      control = (
        <select id={id} name={id} defaultValue={str} className="input max-w-md" {...described}>
          <option value="">Choose</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case "yesno":
      return (
        <fieldset data-field={f.key} {...showAttrs(f)}>
          <legend className="label">{f.label}{f.required ? <span className="ml-1 text-[12px] font-normal text-slate-500">(required)</span> : null}</legend>
          <div className="mt-1 flex gap-5">
            {(["yes", "no"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 text-[14px]"><input type="radio" name={id} value={o} defaultChecked={value === (o === "yes")} className="h-4 w-4" />{o === "yes" ? "Yes" : "No"}</label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    case "multiselect":
      return (
        <fieldset data-field={f.key} {...showAttrs(f)}>
          <legend className="label">{f.label}</legend>
          <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
            {f.options.map((o) => <label key={o} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name={id} value={o} defaultChecked={Array.isArray(value) && value.includes(o)} className="h-4 w-4" />{o}</label>)}
          </div>
          {help}
        </fieldset>
      );
    case "attestation":
      return (
        <div data-field={f.key} {...showAttrs(f)} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-start gap-2.5 text-[14px]"><input type="checkbox" name={id} defaultChecked={value === true} className="mt-0.5 h-4 w-4" />{f.label}</label>
          <span className="mt-1 block text-[12.5px] text-slate-600">Your name and the time you submit are recorded with this confirmation.</span>
        </div>
      );
  }
  return (
    <label htmlFor={id} className="block" data-field={f.key} {...showAttrs(f)}>
      {label}
      {control}
      {help}
    </label>
  );
}

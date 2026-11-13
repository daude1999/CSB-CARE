import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { intakeStartOptions, listIntakes, MAX_INTAKE_DOCUMENTS } from "@/server/care/coordinator/intake";
import { INTAKE_STATUS } from "@/lib/care-coordinator-rules";
import { reportOf } from "@/server/care/coordinator/auto-setup";
import { createIntakeAction } from "@/app/coordinator-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const QUEUE_TONE = { PROCESSING: "teal", READY: "green", NEEDS_ATTENTION: "amber", FAILED: "rose", CLOSED: "slate" } as const;
const QUEUE_LABEL = { PROCESSING: "Processing", READY: "Ready", NEEDS_ATTENTION: "Needs attention", FAILED: "Failed", CLOSED: "Closed" } as const;
/** The three ways in (owner's brief, 6 Nov 2026): every upload of care documents starts here. */
const START_MODES = [
  { value: "NEW", label: "A. New service user", hint: "A council support plan or referral for someone not yet on the system. CSB AI creates the profile and drafts the records." },
  { value: "EXISTING", label: "B. Updated or revised plan", hint: "For someone already on the system. CSB AI updates routine details and proposes package and visit changes for review." },
  { value: "DOCUMENT", label: "C. Supporting document", hint: "A letter, assessment or report for someone already on the system. It is filed and changes no records, except a risk assessment: its risks are added to the Risk Assessments tab." },
] as const;
/** The dashboard's queues (owner's brief, 7 Nov 2026). History lists every intake, including finished and cancelled. */
const FILTERS = [["", "Needs attention"], ["processing", "Processing"], ["ready", "Ready"], ["failed", "Failed"], ["history", "History"]] as const;
const QUEUE_OF = { "": "NEEDS_ATTENTION", processing: "PROCESSING", ready: "READY", failed: "FAILED" } as const;

/** AI Care Coordinator: start an intake from a referral's documents, and every intake with where it has got to. */
export default async function CoordinatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.documents");
  const [opts, rows] = await Promise.all([orNotFound(intakeStartOptions(ctx)), listIntakes(ctx)]);
  const mode = START_MODES.some((m) => m.value === sp.mode) ? sp.mode! : "NEW";
  const person = sp.person && opts.people.some((p) => p.id === sp.person) ? sp.person : "";
  const filter = FILTERS.some(([k]) => k === sp.status) ? (sp.status as (typeof FILTERS)[number][0]) : "";
  const count = (q: string) => rows.filter((r) => r.queue === q).length;
  const shown = filter === "history" ? rows : rows.filter((r) => r.queue === QUEUE_OF[filter]);
  // Arriving from "Update Existing Service User": the person is already chosen. A hospital discharge is an update to
  // that person; the letter is recognised when it is read (or set under Documents) and filing it opens the
  // post-discharge review. Nothing about the intake itself changes.
  const personLabel = person ? opts.people.find((p) => p.id === person)!.label : null;
  const discharge = sp.doc === "discharge" && mode === "EXISTING" && !!person;
  const suggestedTitle = personLabel ? `${discharge ? "Hospital discharge" : mode === "EXISTING" ? "Revised support plan" : "Supporting document"}: ${personLabel.replace(/ \([^)]*\)$/, "")}` : "";
  return (
    <>
      <PageHeader
        tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
        title="Care Coordinator"
        back="/rota/service-users"
        subtitle="Upload a support plan. CSB AI reads it, creates or updates the person's profile, imports the care plan and risk assessments (labelled with where each came from), sets up the care package, visits and a proposed rota, files the documents and lists only what needs a person. Nothing needs approving. Visits stay unpublished and medication is never activated automatically."
        actions={hasOrgPermission(ctx,"rota.edit")?<Link href="/rota/coordinator/shift" className="btn-secondary">Tomorrow&apos;s shift check</Link>:null}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="intakes-h" className="min-w-0">
          <h2 id="intakes-h" className="sr-only">Intakes</h2>
          <SegmentNav label="Intake queues" alert items={FILTERS.map(([k, l]) => ({ href: k ? `/rota/coordinator?status=${k}` : "/rota/coordinator", label: l, active: filter === k, count: k === "" ? count("NEEDS_ATTENTION") : k === "failed" ? count("FAILED") : undefined }))} />
          <Card className="rounded-tl-none">
            {shown.length ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th scope="col">Intake</th><th scope="col">Service user</th><th scope="col">Document</th><th scope="col">Status</th><th scope="col">Records</th><th scope="col">Exceptions</th><th scope="col">Started / finished</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                  <tbody>
                    {shown.map((r) => {
                      const rep = reportOf(r.setupReport);
                      const created = rep ? [rep.records.personal && r.mode === "NEW" ? 1 : 0, rep.records.contacts, rep.records.package ? 1 : 0, rep.records.carePlan ? 1 : 0, rep.records.risks, rep.records.templates, rep.records.callNotes, rep.records.references].reduce((a, b) => a + b, 0) : null;
                      return (
                        <tr key={r.id}>
                          <td><Link href={`/rota/coordinator/${r.id}`}>{r.reference}</Link><span className="block text-meta text-slate-600">{r.title}</span></td>
                          <td>{r.person ? <><Link href={`/rota/service-users/${r.person.id}`}>{r.person.name}</Link><span className="block text-meta text-slate-600">{r.person.reference}</span></> : <span className="text-slate-600">{r.mode === "NEW" ? "Not created yet" : "Not chosen"}</span>}</td>
                          <td className="max-w-[14rem]">{r.documents[0]?.name ?? <span className="text-slate-600">None yet</span>}{r.documents.length > 1 ? <span className="block text-meta text-slate-600">and {r.documents.length - 1} more</span> : null}</td>
                          <td><Badge tone={QUEUE_TONE[r.queue]}>{r.queue === "CLOSED" ? (INTAKE_STATUS[r.status as keyof typeof INTAKE_STATUS] ?? r.status) : QUEUE_LABEL[r.queue]}</Badge>{!r.setupStatus && r.queue === "NEEDS_ATTENTION" ? <span className="block text-meta text-slate-600">Set up before automatic setup: run it</span> : null}</td>
                          <td className="tabular-nums">{created === null ? <span className="text-slate-600">–</span> : created}</td>
                          <td className="tabular-nums">{r.openExceptions ? <Link href={`/rota/coordinator/${r.id}?step=setup`}>{r.openExceptions} open</Link> : rep ? "None" : <span className="text-slate-600">–</span>}</td>
                          <td>{fmtDate(r.createdAt)}<span className="block text-meta text-slate-600">{r.setupFinishedAt ? `Finished ${fmtDate(r.setupFinishedAt)}` : r.createdBy}</span></td>
                          <td>{r.person ? <Link href={`/rota/service-users/${r.person.id}`} className="btn-secondary whitespace-nowrap py-1">Open profile</Link> : <Link href={`/rota/coordinator/${r.id}`} className="btn-secondary whitespace-nowrap py-1">Open intake</Link>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{filter === "" ? "Nothing needs attention. Upload a support plan to start." : filter === "processing" ? "Nothing is being processed right now." : filter === "failed" ? "No failed intakes." : filter === "ready" ? "No intakes here yet." : "No intakes yet."}</Empty>}
          </Card>
        </section>
        <Card title="Upload Support Plan">
          <form id="start" action={createIntakeAction} className="space-y-3">
            <input type="hidden" name="back" value="/rota/coordinator" />
            {personLabel ? (
              <p className="rounded-[4px] border-l-4 border-module bg-[#f8f5fe] px-3 py-2 text-body text-slate-800" data-testid="intake-person-chosen">
                Updating <strong>{personLabel}</strong>. Their existing profile, plans and history are kept; no new person is created.
                {discharge ? " Upload the hospital discharge summary or new medical document. When it is filed, a post-discharge review is opened for mobility, personal care, medicines, skin, equipment, follow-up, risks and visits. Medicines are reconciled with the GP or pharmacy, never changed from the letter." : null}
              </p>
            ) : null}
            <label className="block"><span className="label">Name for this intake</span><input name="title" required minLength={3} maxLength={120} className="input" defaultValue={suggestedTitle} placeholder="e.g. New referral from the council, Stepney" /></label>
            <fieldset>
              <legend className="label">What these documents are</legend>
              {START_MODES.map((m) => (
                <label key={m.value} className="mt-1 flex items-start gap-2 text-body"><input type="radio" name="mode" value={m.value} defaultChecked={mode === m.value} className="mt-1" /><span><span className="font-medium">{m.label}</span><span className="block text-meta text-slate-600">{m.hint}</span></span></label>
              ))}
            </fieldset>
            <label className="block"><span className="label">Person already on the system (for B and C)</span>
              <select name="serviceUserId" className="input" defaultValue={person}><option value="">Choose a person</option>{opts.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </label>
            <label className="block"><span className="label">Area</span>
              <select name="areaId" className="input" defaultValue=""><option value="">Choose later</option>{opts.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label className="block"><span className="label">Documents (PDF or photos: up to {MAX_INTAKE_DOCUMENTS} files, 4 MB each, 11 MB in total)</span><input type="file" name="files" multiple accept="application/pdf,image/jpeg,image/png" className="input" /></label>
            <p className="text-meta text-slate-600">{opts.reading.label}</p>
            <button className="btn-primary">Upload and process</button>
          </form>
        </Card>
      </div>
    </>
  );
}

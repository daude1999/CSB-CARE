import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { intakeStartOptions, listIntakes, MAX_INTAKE_DOCUMENTS } from "@/server/care/coordinator/intake";
import { INTAKE_STATUS } from "@/lib/care-coordinator-rules";
import { createIntakeAction } from "@/app/coordinator-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const STATUS_TONE = { DRAFT: "teal", SUBMITTED: "teal", APPROVED: "teal", APPLYING: "amber", COMPLETED: "slate", CANCELLED: "slate" } as const;
/** The three ways in (owner's brief, 6 Nov 2026): every upload of care documents starts here. */
const START_MODES = [
  { value: "NEW", label: "A. New service user", hint: "A referral or support plan for someone not yet on the system. Their records are drafted for you to check." },
  { value: "EXISTING", label: "B. Updated or revised plan", hint: "New or revised documents for someone already on the system. Changes are shown for you to accept; package and visit changes are saved when you confirm them." },
  { value: "DOCUMENT", label: "C. Supporting document", hint: "A letter, assessment or report for someone already on the system. It is filed in their documents and changes no records." },
] as const;
const FILTERS = [["", "Open"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]] as const;

/** AI Care Coordinator: start an intake from a referral's documents, and every intake with where it has got to. */
export default async function CoordinatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.documents");
  const [opts, rows] = await Promise.all([orNotFound(intakeStartOptions(ctx)), listIntakes(ctx, { status: sp.status })]);
  const mode = START_MODES.some((m) => m.value === sp.mode) ? sp.mode! : "NEW";
  const person = sp.person && opts.people.some((p) => p.id === sp.person) ? sp.person : "";
  // Arriving from "Update Existing Service User": the person is already chosen. A hospital discharge is an update to
  // that person; the letter is recognised when it is read (or set under Documents) and filing it opens the
  // post-discharge review. Nothing about the intake itself changes.
  const personLabel = person ? opts.people.find((p) => p.id === person)!.label : null;
  const discharge = sp.doc === "discharge" && mode === "EXISTING" && !!person;
  const suggestedTitle = personLabel ? `${discharge ? "Hospital discharge" : mode === "EXISTING" ? "Revised support plan" : "Supporting document"}: ${personLabel.replace(/ \([^)]*\)$/, "")}` : "";
  const shown = sp.status ? rows : rows.filter((r) => r.status !== "COMPLETED" && r.status !== "CANCELLED");
  return (
    <>
      <PageHeader
        tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
        title="Care Coordinator"
        back="/rota/service-users"
        subtitle="Upload a referral's documents. Each fact is read with its page and checked by the Care Coordinator, who reviews and approves the intake and sets up the person's records with one confirmation. Nothing is saved, published or sent to carers without a person deciding."
        actions={hasOrgPermission(ctx,"rota.edit")?<Link href="/rota/coordinator/shift" className="btn-secondary">Tomorrow&apos;s shift check</Link>:null}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="intakes-h" className="min-w-0">
          <h2 id="intakes-h" className="sr-only">Intakes</h2>
          <SegmentNav label="Filter intakes" items={FILTERS.map(([k, l]) => ({ href: k ? `/rota/coordinator?status=${k}` : "/rota/coordinator", label: l, active: (sp.status ?? "") === k }))} />
          <Card className="rounded-tl-none">
            {shown.length ? (
              <table className="table">
                <thead><tr><th scope="col">Intake</th><th scope="col">Person</th><th scope="col">Stage</th><th scope="col">Documents</th><th scope="col">Still to check</th><th scope="col">Started</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/rota/coordinator/${r.id}`}>{r.reference}</Link><span className="block text-[13px] text-slate-600">{r.title}</span></td>
                      <td>{r.person ? <Link href={`/rota/service-users/${r.person.id}`}>{r.person.name}</Link> : <span className="text-slate-600">{r.mode === "NEW" ? "New person, not saved yet" : "Not chosen"}</span>}</td>
                      <td><Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "slate"}>{INTAKE_STATUS[r.status as keyof typeof INTAKE_STATUS] ?? r.status}</Badge></td>
                      <td className="tabular-nums">{r._count.documents}</td>
                      <td className="tabular-nums">{r.openFacts ? `${r.openFacts} of ${r._count.facts}` : r._count.facts ? "None" : "No facts yet"}</td>
                      <td>{fmtDate(r.createdAt)}<span className="block text-[13px] text-slate-600">{r.createdBy}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>{sp.status ? "No intakes here." : "No open intakes. Start one with the referral's documents."}</Empty>}
          </Card>
        </section>
        <Card title="Start an intake">
          <form id="start" action={createIntakeAction} className="space-y-3">
            <input type="hidden" name="back" value="/rota/coordinator" />
            {personLabel ? (
              <p className="rounded-[4px] border-l-4 border-[#5b2bb5] bg-[#f8f5fe] px-3 py-2 text-[13.5px] text-slate-800" data-testid="intake-person-chosen">
                Updating <strong>{personLabel}</strong>. Their existing profile, plans and history are kept; no new person is created.
                {discharge ? " Upload the hospital discharge summary or new medical document. When it is filed, a post-discharge review is opened for mobility, personal care, medicines, skin, equipment, follow-up, risks and visits. Medicines are reconciled with the GP or pharmacy, never changed from the letter." : null}
              </p>
            ) : null}
            <label className="block"><span className="label">Name for this intake</span><input name="title" required minLength={3} maxLength={120} className="input" defaultValue={suggestedTitle} placeholder="e.g. New referral from the council, Stepney" /></label>
            <fieldset>
              <legend className="label">What these documents are</legend>
              {START_MODES.map((m) => (
                <label key={m.value} className="mt-1 flex items-start gap-2 text-[14px]"><input type="radio" name="mode" value={m.value} defaultChecked={mode === m.value} className="mt-1" /><span><span className="font-medium">{m.label}</span><span className="block text-[13px] text-slate-600">{m.hint}</span></span></label>
              ))}
            </fieldset>
            <label className="block"><span className="label">Person already on the system (for B and C)</span>
              <select name="serviceUserId" className="input" defaultValue={person}><option value="">Choose a person</option>{opts.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
            </label>
            <label className="block"><span className="label">Area</span>
              <select name="areaId" className="input" defaultValue=""><option value="">Choose later</option>{opts.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </label>
            <label className="block"><span className="label">Documents (PDF or photos: up to {MAX_INTAKE_DOCUMENTS} files, 4 MB each, 11 MB in total)</span><input type="file" name="files" multiple accept="application/pdf,image/jpeg,image/png" className="input" /></label>
            <p className="text-[13px] text-slate-600">{opts.reading.label}</p>
            <button className="btn-primary">Start and read the documents</button>
          </form>
        </Card>
      </div>
    </>
  );
}

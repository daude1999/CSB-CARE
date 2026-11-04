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

const STATUS_TONE = { DRAFT: "teal", SUBMITTED: "amber", APPROVED: "green", APPLYING: "amber", COMPLETED: "slate", CANCELLED: "slate" } as const;
const FILTERS = [["", "Open"], ["SUBMITTED", "Waiting for manager"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]] as const;

/** AI Care Coordinator: start an intake from a referral's documents, and every intake with where it has got to. */
export default async function CoordinatorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.documents");
  const [opts, rows] = await Promise.all([orNotFound(intakeStartOptions(ctx)), listIntakes(ctx, { status: sp.status })]);
  const shown = sp.status ? rows : rows.filter((r) => r.status !== "COMPLETED" && r.status !== "CANCELLED");
  return (
    <>
      <PageHeader
        tabs={<RotaTabs ctx={ctx} ws="people" active="coordinator" />}
        title="Care Coordinator"
        back="/rota/service-users"
        subtitle="Upload a referral's documents. Each fact is read with its page, checked by a coordinator, approved section by section by a manager, then saved into the person's profile. Nothing is saved, published or sent to carers without a person deciding."
        actions={<div className="flex flex-wrap gap-2"><Link href="/rota/coordinator/assistant" className="btn-primary">✦ Open AI CSB Coordinator</Link>{hasOrgPermission(ctx,"rota.edit")?<Link href="/rota/coordinator/shift" className="btn-secondary">Tomorrow&apos;s shift check</Link>:null}</div>}
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
          <form action={createIntakeAction} className="space-y-3">
            <input type="hidden" name="back" value="/rota/coordinator" />
            <label className="block"><span className="label">Name for this intake</span><input name="title" required minLength={3} maxLength={120} className="input" placeholder="e.g. New referral from the council, Stepney" /></label>
            <fieldset>
              <legend className="label">Who it is for</legend>
              <label className="flex items-center gap-2 text-[14px]"><input type="radio" name="mode" value="NEW" defaultChecked /> A new person</label>
              <label className="mt-1 flex items-center gap-2 text-[14px]"><input type="radio" name="mode" value="EXISTING" /> Someone already on the system (updated documents)</label>
            </fieldset>
            <label className="block"><span className="label">Existing person (only if updating someone)</span>
              <select name="serviceUserId" className="input" defaultValue=""><option value="">Choose a person</option>{opts.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
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

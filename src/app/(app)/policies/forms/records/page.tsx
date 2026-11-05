import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, type PcTone } from "@/components/compliance-ui";
import { Empty, Flash, fmtDate } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { digitalForms, formRecordLists, STATUS_LABELS, type RecordStatus } from "@/server/forms/records";
import { startFormAction } from "../../../../actions";

export const dynamic = "force-dynamic";

const TONE: Record<RecordStatus, PcTone> = { DRAFT: "grey", SUBMITTED: "blue", RETURNED: "amber", APPROVED: "green", VOIDED: "red" };
const label = (s: string) => STATUS_LABELS[s as RecordStatus] ?? s;
const tone = (s: string) => TONE[s as RecordStatus] ?? "grey";

/**
 * My forms & reviews: forms the person can fill in on screen, their own drafts and submissions, the review queue for
 * forms they review, and recently finished forms. Lives inside the Policy Library's Forms & Resources tab.
 */
export default async function FormRecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!ctx.organisationId) {
    return <Empty>On-screen forms are kept per organisation. Choose an organisation first.</Empty>;
  }
  const [forms, lists] = await Promise.all([digitalForms(ctx), formRecordLists(ctx)]);
  const startable = forms.filter((f) => f.canStart);
  type Row = (typeof lists.mine)[number];
  const table = (rows: Row[], opts: { who?: boolean; testId: string; empty: string }) =>
    rows.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]" data-testid={opts.testId}>
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">Form</th>
              {opts.who ? <th scope="col" className="px-4 py-3">Filled in by</th> : null}
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Last change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3"><Link href={`/policies/forms/records/${r.id}`} className="font-semibold">{r.definition.title}</Link><div className="text-slate-600">{r.reference} · version {r.version.versionNumber}</div></td>
                {opts.who ? <td className="px-4 py-3">{lists.names.get(r.createdById) ?? "Unknown"}</td> : null}
                <td className="px-4 py-3"><PcBadge tone={tone(r.status)}>{label(r.status)}</PcBadge></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDate(r.status === "SUBMITTED" ? r.submittedAt : r.updatedAt, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : <p className="px-4 py-6 text-[13px] text-slate-600">{opts.empty}</p>;

  return (
    <div className="min-w-0" data-testid="form-records">
      <CompliancePageHeader
        crumbs={[{ label: "Policy & Compliance", href: "/" }, { label: "Forms & Resources", href: "/policies/forms" }]}
        title="My forms & reviews"
        subtitle="Forms you can fill in on screen, your drafts and submissions, and forms waiting for your review."
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="forms" />}
        actions={<Link className="btn-secondary" href="/policies/forms">All forms & resources</Link>}
      />
      <Flash searchParams={sp} />

      <section className="pc-panel mb-4 p-4" aria-labelledby="start-title" data-testid="start-forms">
        <h2 id="start-title" className="font-semibold">Fill in a form</h2>
        {startable.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {startable.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 basis-[18rem]">
                  <div className="font-medium">{f.title} <span className="font-normal text-slate-600">· {f.ref}</span></div>
                  <p className="text-[13px] text-slate-600">{f.description}</p>
                </div>
                <form action={startFormAction}>
                  <input type="hidden" name="definitionId" value={f.id} />
                  <input type="hidden" name="back" value="/policies/forms/records" />
                  <button type="submit" className="btn-primary">Start</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-[13px] text-slate-600">No on-screen forms are open to your role yet.</p>}
        <p className="mt-2 text-[12.5px] text-slate-600">Only these forms can be filled in on screen so far. Every other form is a document to download from Forms &amp; Resources.</p>
      </section>

      {lists.isReviewer ? (
        <section className="pc-panel mb-4 overflow-hidden" aria-labelledby="queue-title">
          <h2 id="queue-title" className="border-b border-slate-200 px-4 py-3 font-semibold">Waiting for your review <span className="font-normal text-slate-600">({lists.queue.length})</span></h2>
          {table(lists.queue, { who: true, testId: "review-queue", empty: "Nothing is waiting for your review." })}
        </section>
      ) : null}

      <section className="pc-panel mb-4 overflow-hidden" aria-labelledby="mine-title">
        <h2 id="mine-title" className="border-b border-slate-200 px-4 py-3 font-semibold">My open forms</h2>
        {table(lists.mine, { testId: "my-forms", empty: "You have no drafts or forms waiting for review." })}
      </section>

      <section className="pc-panel overflow-hidden" aria-labelledby="done-title">
        <h2 id="done-title" className="border-b border-slate-200 px-4 py-3 font-semibold">Finished</h2>
        {table(lists.finished, { who: lists.isReviewer, testId: "finished-forms", empty: "No approved or voided forms yet." })}
      </section>
    </div>
  );
}

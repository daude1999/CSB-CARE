import Link from "@/components/link";
import { PcBadge, type PcTone } from "@/components/compliance-ui";
import { fmtDate } from "@/components/ui";
import { startFormAction } from "@/app/actions";

const TONE: Record<string, PcTone> = { DRAFT: "grey", SUBMITTED: "blue", RETURNED: "amber", APPROVED: "green", VOIDED: "red" };

type Row = { id: string; reference: string; status: string; statusLabel: string; updatedAt: Date; author: string; definition: { ref: string; title: string }; version: { versionNumber: number } };

/**
 * On-screen forms about one person (a service user or staff member), shown on their record. The rows are only those
 * the viewer may open; starting a form here links it to the person straight away.
 */
export function PersonForms({ rows, startable, about, back, personName, testId }: { rows: Row[]; startable: { id: string; ref: string; title: string }[]; about: string; back: string; personName: string; testId: string }) {
  return (
    <section className="pc-panel overflow-hidden" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h2 id={`${testId}-title`} className="font-semibold">Forms about {personName}</h2>
        {startable.length ? (
          <div className="flex flex-wrap gap-2">
            {startable.map((f) => (
              <form key={f.id} action={startFormAction}>
                <input type="hidden" name="definitionId" value={f.id} />
                <input type="hidden" name="about" value={about} />
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="pc-btn-secondary pc-btn-sm">Start {f.title}</button>
              </form>
            ))}
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-meta">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2.5">Form</th>
                <th scope="col" className="px-4 py-2.5">Filled in by</th>
                <th scope="col" className="px-4 py-2.5">Status</th>
                <th scope="col" className="px-4 py-2.5">Last change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5"><Link href={`/policies/forms/records/${r.id}`} className="font-semibold">{r.definition.title}</Link><div className="text-slate-600">{r.reference} · version {r.version.versionNumber}</div></td>
                  <td className="px-4 py-2.5">{r.author}</td>
                  <td className="px-4 py-2.5"><PcBadge tone={TONE[r.status] ?? "grey"}>{r.statusLabel}</PcBadge></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(r.updatedAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-meta text-slate-600">No on-screen forms you can open are linked to {personName}. Forms are shown only to the person who filled them in and the form&apos;s reviewers.</p>
      )}
    </section>
  );
}

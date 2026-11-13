import Link from "@/components/link";
import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge } from "@/components/compliance-ui";
import { fmtDate } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { monthlyUpdates, parseUpdatesQuery, shiftMonth, ukMonth, UPDATE_GROUPS, type UpdatesQuery } from "@/server/policies/updates";

export const dynamic = "force-dynamic";

function href(q: UpdatesQuery, over: Partial<UpdatesQuery> = {}) {
  const m = { ...q, ...over };
  const params = new URLSearchParams({ month: m.month });
  if (m.group) params.set("type", m.group);
  return `/policies/updates?${params.toString()}`;
}

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Monthly Updates: what was published this month across the organisation's library, with CSB central updates arriving
 * automatically. Each row opens the document in the Policy Reader or compares it with the version it replaced.
 */
export default async function MonthlyUpdatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (!ctx.organisationId) notFound();
  const q = parseUpdatesQuery(await searchParams);
  const data = await monthlyUpdates(ctx, q);
  const thisMonth = ukMonth(new Date());
  const next = shiftMonth(q.month, 1);

  return (
    <div className="min-w-0" data-testid="monthly-updates">
      <CompliancePageHeader
        title="Monthly Updates"
        subtitle="New and updated policies, procedures, forms and templates published for your organisation. CSB central updates appear here as soon as CSB publishes them."
        tabs={<ComplianceTabs ctx={ctx} ws="library" active="updates" />}
      />

      <nav aria-label="Month" className="pc-panel mb-3 flex flex-wrap items-center gap-2 p-3">
        <Link href={href(q, { month: shiftMonth(q.month, -1) })} className="pc-btn-secondary pc-btn-sm">Previous month</Link>
        <h2 className="mx-2 text-lead font-semibold text-[#101828]" data-testid="updates-month">{monthName(q.month)}</h2>
        {next <= thisMonth ? <Link href={href(q, { month: next })} className="pc-btn-secondary pc-btn-sm">Next month</Link> : null}
        <form method="get" action="/policies/updates" className="ml-auto flex items-center gap-2">
          {q.group ? <input type="hidden" name="type" value={q.group} /> : null}
          <label htmlFor="month" className="text-meta text-[#475467]">Go to month</label>
          <input id="month" name="month" type="month" className="input h-9 w-auto" defaultValue={q.month} max={thisMonth} />
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Show</button>
        </form>
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Document type">
        <Link href={href(q, { group: undefined })} aria-current={!q.group ? "page" : undefined} className={`pc-btn-secondary pc-btn-sm ${!q.group ? "ring-2 ring-[#0646b1]" : ""}`}>All ({data.total})</Link>
        {UPDATE_GROUPS.map(([key, label]) => (
          <Link key={key} href={href(q, { group: key })} aria-current={q.group === key ? "page" : undefined} className={`pc-btn-secondary pc-btn-sm ${q.group === key ? "ring-2 ring-[#0646b1]" : ""}`}>{label} ({data.counts[key]})</Link>
        ))}
        <span className="ml-auto text-meta text-[#475467]">{data.newCount} new · {data.updatedCount} updated</span>
      </div>

      <section className="pc-panel overflow-hidden" aria-label={`Updates published in ${monthName(q.month)}`}>
        {data.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-meta" data-testid="updates-table">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Document</th>
                  <th scope="col" className="px-4 py-3">Change</th>
                  <th scope="col" className="px-4 py-3">Version</th>
                  <th scope="col" className="px-4 py-3">Summary of changes</th>
                  <th scope="col" className="px-4 py-3">Published</th>
                  {data.canSeeReading ? <th scope="col" className="px-4 py-3">Staff reading</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.versionId} className="align-top" data-testid={`update-${r.ref}`}>
                    <td className="px-4 py-3">
                      <Link href={`/policies/${r.policyId}`} className="font-semibold">{r.title}</Link>
                      <div className="text-slate-600">{r.ref} · {r.docTypeName} · {r.category}</div>
                      <div className="text-caption text-slate-500">{r.source}</div>
                    </td>
                    <td className="px-4 py-3"><PcBadge tone={r.change === "New" ? "green" : "blue"}>{r.change}</PcBadge>{r.impact ? <div className="mt-1 text-caption text-slate-600">{r.impact}</div> : null}</td>
                    <td className="whitespace-nowrap px-4 py-3">{r.previousLabel ? <>{r.previousLabel} → </> : null}<strong className="font-semibold">{r.label}</strong></td>
                    <td className="px-4 py-3 text-slate-700">
                      {r.summary ?? <span className="text-slate-500">No summary recorded</span>}
                      <div className="mt-1 flex flex-wrap gap-x-3 text-meta">
                        <Link href={`/policies/${r.policyId}/versions/${r.versionId}`}>Open this version</Link>
                        {r.previousLabel ? <Link href={`/policies/${r.policyId}/compare?to=${r.versionId}`}>See what changed</Link> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDate(r.publishedAt)}</td>
                    {data.canSeeReading ? <td className="whitespace-nowrap px-4 py-3">{r.reading ? <>{r.reading.signed} of {r.reading.assigned} signed</> : <span className="text-slate-500">Not assigned</span>}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-body text-slate-600" data-testid="updates-empty">Nothing was published in {monthName(q.month)}{q.group ? " of this type" : ""}.</p>
        )}
      </section>
    </div>
  );
}

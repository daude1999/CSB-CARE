import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { carePlanRegister } from "@/server/care/care-plans";
import { suName } from "@/server/rota/queries";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { Badge, Card, Empty, Flash, PageHeader, SegmentNav } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const FILTERS = [["", "Everyone"], ["none", "No plan in use"], ["overdue", "Review overdue"], ["review", "Awaiting approval"], ["draft", "Draft open"]] as const;

export default async function CarePlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const { rows, totals } = await carePlanRegister(ctx, { q: sp.q?.trim() || undefined, filter: sp.show });
  const href = (show: string) => `/rota/care-plans?${new URLSearchParams({ ...(show ? { show } : {}), ...(sp.q ? { q: sp.q } : {}) })}`;
  const count: Record<string, number> = { "": totals.all, none: totals.none, overdue: totals.overdue, review: totals.review, draft: totals.draft };

  return (
    <>
      <PageHeader title="Care Plans" back="/rota" subtitle="Each person's care plan, the version in use, its review date and who has read it. New versions are drafted, sent for approval and approved by a second person; approved versions are kept unchanged." />
      <Flash searchParams={sp} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full"><SegmentNav label="Filter care plans" items={FILTERS.map(([k, label]) => ({ href: href(k), label, active: (sp.show ?? "") === k, count: count[k] }))} /></div>
        <form method="get" className="flex gap-2">
          {sp.show ? <input type="hidden" name="show" value={sp.show} /> : null}
          <label className="sr-only" htmlFor="cp-q">Search</label>
          <input id="cp-q" name="q" defaultValue={sp.q ?? ""} placeholder="Name or reference" className="input w-56" />
          <button className="btn-secondary">Search</button>
        </form>
      </div>
      <Card>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Person</th><th>Area</th><th>Plan in use</th><th>Review due</th><th>Read by carers</th><th>In progress</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/rota/care-plans/${r.id}`}>{suName(r)}</Link><div className="text-[12.5px] text-slate-500">{r.reference}</div></td>
                    <td><AreaDot area={r.area} /></td>
                    <td>{r.active ? <>Version {r.active.version}<div className="text-[12.5px] text-slate-500">approved {r.active.approvedAt ? fmtLondonDate(r.active.approvedAt.toISOString().slice(0, 10)) : ""}</div></> : <Badge tone="rose">No plan in use</Badge>}</td>
                    <td className="tabular-nums">{r.active?.reviewDue ? <span className={r.overdue ? "font-medium text-[#a3242c]" : ""}>{fmtLondonDate(fromDbDate(r.active.reviewDue))}{r.overdue ? " · overdue" : ""}</span> : "—"}</td>
                    <td className="tabular-nums">{r.active ? r.active._count.acknowledgements : "—"}</td>
                    <td>{r.pending ? <Badge tone={r.pending.status === "IN_REVIEW" ? "amber" : "slate"}>Version {r.pending.version} {r.pending.status === "IN_REVIEW" ? "awaiting approval" : "draft"}</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No one matches. Care plans are kept for people in assessment, active or paused.</Empty>}
      </Card>
    </>
  );
}

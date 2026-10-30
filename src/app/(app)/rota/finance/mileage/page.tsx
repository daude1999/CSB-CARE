import Link from "@/components/link";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { listMileage } from "@/server/finance/mileage";
import { decideMileageAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Mileage claims from carers: approve or reject each one. Approved claims go into the next pay run. */
export default async function MileagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("finance.view");
  const { status, rows, names } = await listMileage(ctx, sp);
  const back = `/rota/finance/mileage?status=${status}`;
  return (
    <>
      <PageHeader title="Mileage" back="/rota/finance" subtitle="Business miles claimed by carers. Distances are what the carer states; they are not worked out from a map. Approved claims are paid through the next pay run at the rate in Tariffs & Funders." actions={<Link href="/rota/finance/payroll" className="btn-secondary">Wages</Link>} />
      <Flash searchParams={sp} />
      <SegmentNav label="Claim status" items={[["SUBMITTED", "Waiting"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["ALL", "All"]].map(([k, l]) => ({ href: `/rota/finance/mileage?status=${k}`, label: l!, active: status === k }))} />
      <Card>
        {rows.length ? (
          <ul className="rows">
            {rows.map((c) => (
              <li key={c.id} className="py-3 text-[14px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{names.get(c.staffId) ?? "Former staff member"}</span>
                  <span className="tabular-nums">{fmtLondonDate(fromDbDate(c.date))}</span>
                  <span className="font-semibold tabular-nums">{c.miles} miles</span>
                  <Badge tone={c.status === "SUBMITTED" ? "amber" : c.status === "APPROVED" ? "green" : "slate"}>{c.status === "SUBMITTED" ? "Waiting" : c.status === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                  {c.visitId ? <Link href={`/rota/visits/${c.visitId}`} className="text-[13px]">Visit</Link> : null}
                  <span className="ml-auto text-[12.5px] text-slate-500">claimed {fmtDate(c.submittedAt, true)}</span>
                </div>
                <p className="text-[13.5px] text-slate-700">{c.reason}{c.decisionNote ? ` · decision: ${c.decisionNote}` : ""}</p>
                {c.status === "SUBMITTED" && c.submittedById !== ctx.userId ? (
                  <form action={decideMileageAction} className="mt-1 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="claimId" value={c.id} />
                    <input name="note" className="input w-56 py-1" placeholder="Note (needed to reject)" aria-label="Decision note" />
                    <button className="btn-primary py-1" name="decision" value="APPROVED">Approve</button>
                    <button className="btn-secondary py-1" name="decision" value="REJECTED">Reject</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <Empty>No claims here.</Empty>}
      </Card>
    </>
  );
}

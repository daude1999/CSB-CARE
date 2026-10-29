import Link from "@/components/link";
import { db } from "@/lib/db";
import { addDays, dbDate, fmtLondonDate, londonDate, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { pounds } from "@/server/finance/pricing";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The finance team's view of recent weeks: where each week's timesheets, payroll and invoices have got to. */
export default async function FinanceHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("finance.view");
  const org = ctx.organisationId!;
  const thisMonday = mondayOf(londonDate());
  const weeks = [1, 2, 3, 4].map((n) => addDays(thisMonday, -7 * n));
  const [sheets, pay, inv, funders, cards] = await Promise.all([
    db.timesheet.groupBy({ by: ["periodStart", "status"], where: { organisationId: org, periodStart: { in: weeks.map(dbDate) } }, _count: true }),
    db.payRun.findMany({ where: { organisationId: org, periodStart: { in: weeks.map(dbDate) }, status: { not: "VOID" } } }),
    db.invoiceRun.findMany({ where: { organisationId: org, periodStart: { in: weeks.map(dbDate) }, status: { not: "VOID" } } }),
    db.funder.count({ where: { organisationId: org, active: true } }),
    db.rateCard.count({ where: { organisationId: org, active: true } }),
  ]);
  const count = (w: string, s: string) => sheets.find((x) => x.periodStart.getTime() === dbDate(w).getTime() && x.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Finance" back="/rota" subtitle="Weekly preparation of timesheets, payroll and invoices from delivered visits. Every run is checked and approved by a second person. The platform never pays staff, submits payroll or sends invoices: approved runs are exported as files for your payroll provider and accounts system." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Recent weeks">
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Week</th><th>Timesheets</th><th>Payroll</th><th>Invoices</th></tr></thead>
              <tbody>
                {weeks.map((w) => {
                  const p = pay.find((r) => r.periodStart.getTime() === dbDate(w).getTime());
                  const i = inv.find((r) => r.periodStart.getTime() === dbDate(w).getTime());
                  const total = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].reduce((n, s) => n + count(w, s), 0);
                  return (
                    <tr key={w}>
                      <td className="whitespace-nowrap">w/c {fmtLondonDate(w, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td>
                        <Link href={`/rota/finance/timesheets?week=${w}`}>{total ? `${count(w, "APPROVED")} of ${total} approved` : "Not prepared"}</Link>
                        {count(w, "SUBMITTED") ? <span className="block text-[12.5px] text-slate-500">{count(w, "SUBMITTED")} waiting for approval</span> : null}
                        {count(w, "REJECTED") ? <span className="block text-[12.5px] text-[#a3242c]">{count(w, "REJECTED")} rejected</span> : null}
                      </td>
                      <td>{p ? <Link href={`/rota/finance/payroll/${p.id}`}>{pounds(p.totalPence)} <Badge tone={p.status === "APPROVED" ? "green" : "amber"}>{p.status === "APPROVED" ? "Approved" : "Draft"}</Badge></Link> : <Link href={`/rota/finance/payroll?week=${w}`}>Not prepared</Link>}</td>
                      <td>{i ? <Link href={`/rota/finance/invoices/${i.id}`}>{pounds(i.totalPence)} <Badge tone={i.status === "APPROVED" ? "green" : "amber"}>{i.status === "APPROVED" ? "Approved" : "Draft"}</Badge></Link> : <Link href={`/rota/finance/invoices?week=${w}`}>Not prepared</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Set-up">
          <ul className="space-y-2 text-[14px]">
            <li><Link href="/rota/finance/rates">Funders and rate cards</Link><span className="block text-[12.5px] text-slate-500">{funders} active funders, {cards} rate cards</span></li>
            <li><Link href="/rota/finance/rates?tab=packages">Who funds each person</Link></li>
            <li><Link href="/rota/finance/rates?tab=staff">Carers’ pay rates</Link></li>
            <li><Link href="/rota/finance/rates?tab=settings">Pay basis, mileage and invoice numbering</Link></li>
          </ul>
        </Card>
      </div>
    </>
  );
}

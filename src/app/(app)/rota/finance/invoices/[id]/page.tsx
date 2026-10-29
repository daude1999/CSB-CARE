import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getInvoiceRun } from "@/server/finance/runs";
import { pounds } from "@/server/finance/pricing";
import { memberNames } from "@/server/rota/queries";
import { Card, Flash, PageHeader } from "@/components/ui";
import { RunBadge } from "@/components/finance-ui";
import { Exceptions, RunActions } from "@/components/run-list";

export const dynamic = "force-dynamic";

export default async function InvoiceRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("finance.view");
  const { run, funders, exceptions } = await orNotFound(getInvoiceRun(ctx, id));
  const names = await memberNames(ctx, [run.createdById, run.approvedById]);
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "—");

  return (
    <>
      <PageHeader title={`Invoice run · w/c ${fmtLondonDate(fromDbDate(run.periodStart))}`} back="/rota/finance/invoices" subtitle={`${run.invoices.length} invoice${run.invoices.length === 1 ? "" : "s"}, ${pounds(run.totalPence)} in total. Invoice numbers are given when the run is approved.`} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {run.invoices.map((inv) => {
            const f = funders.get(inv.funderId);
            return (
              <Card key={inv.id} title={`${f?.name ?? "Funder"}${inv.number ? ` · ${inv.number}` : ""}`} actions={<span className="flex items-center gap-2"><span className="tabular-nums font-semibold">{pounds(inv.totalPence)}</span><RunBadge status={run.status} /></span>}>
                <p className="mb-2 text-[13px] text-slate-600">{inv.lines.length} lines · payment due {inv.dueDays} days after issue{f?.billingEmail ? ` · ${f.billingEmail}` : ""}</p>
                <details>
                  <summary className="cursor-pointer text-[14px]">Show lines</summary>
                  <div className="relative mt-2 min-w-0 overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>Visit</th><th className="text-right">Minutes</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th>Band</th></tr></thead>
                      <tbody>{inv.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="text-right tabular-nums">{l.minutes}</td><td className="text-right tabular-nums">{pounds(l.ratePence)}</td><td className="text-right tabular-nums">{pounds(l.amountPence)}</td><td className="text-[12.5px]">{l.bandLabel}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </Card>
            );
          })}
          {!run.invoices.length ? <Card><p className="text-[14px] text-slate-600">No chargeable visits in this week.</p></Card> : null}
          <Exceptions items={exceptions} />
        </div>
        <aside className="space-y-3">
          <RunActions kind="invoice" run={run} ctxUserId={ctx.userId} canApprove={hasOrgPermission(ctx, "finance.approve")} canManage={hasOrgPermission(ctx, "finance.manage")} back={`/rota/finance/invoices/${run.id}`} who={who} />
        </aside>
      </div>
    </>
  );
}

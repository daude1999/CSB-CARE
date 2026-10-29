import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getPayRun } from "@/server/finance/runs";
import { pounds } from "@/server/finance/pricing";
import { memberNames } from "@/server/rota/queries";
import { Card, Flash, PageHeader } from "@/components/ui";
import { RunBadge, hours } from "@/components/finance-ui";
import { Exceptions, RunActions } from "@/components/run-list";

export const dynamic = "force-dynamic";

export default async function PayRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("finance.view");
  const { run, staff, exceptions } = await orNotFound(getPayRun(ctx, id));
  const names = await memberNames(ctx, [run.createdById, run.approvedById]);
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "—");
  const people = [...new Set(run.lines.map((l) => l.staffId))].map((sid) => ({ id: sid, name: staff.get(sid)?.displayName ?? "Former staff member", lines: run.lines.filter((l) => l.staffId === sid) })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title={`Pay run · w/c ${fmtLondonDate(fromDbDate(run.periodStart))}`} back="/rota/finance/payroll" subtitle={`${people.length} carers, ${pounds(run.totalPence)} gross before deductions. Deductions, tax and National Insurance are worked out by your payroll provider.`} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <Card title="By carer" actions={<RunBadge status={run.status} />}>
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Carer</th><th className="text-right">Visits</th><th className="text-right">Hours</th><th className="text-right">Gross</th></tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <details>
                          <summary className="cursor-pointer">{p.name}</summary>
                          <ul className="mt-1 text-[12.5px] text-slate-600">{p.lines.map((l) => <li key={l.id} className="tabular-nums">{fromDbDate(l.date)} · {l.description} · {l.minutes}m × {pounds(l.ratePence)} ({l.bandLabel}) = {pounds(l.amountPence)}</li>)}</ul>
                        </details>
                      </td>
                      <td className="text-right tabular-nums">{p.lines.filter((l) => l.kind === "VISIT").length}</td>
                      <td className="text-right tabular-nums">{hours(p.lines.reduce((n, l) => n + l.minutes, 0))}</td>
                      <td className="text-right tabular-nums font-medium">{pounds(p.lines.reduce((n, l) => n + l.amountPence, 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3} className="font-medium">Total</td><td className="text-right tabular-nums font-semibold">{pounds(run.totalPence)}</td></tr></tfoot>
              </table>
            </div>
          </Card>
          <Exceptions items={exceptions} />
        </div>
        <aside className="space-y-3">
          <RunActions kind="pay" run={run} ctxUserId={ctx.userId} canApprove={hasOrgPermission(ctx, "finance.approve")} canManage={hasOrgPermission(ctx, "finance.manage")} back={`/rota/finance/payroll/${run.id}`} who={who} />
          {run.status === "VOID" && run.voidReason ? <Card title="Voided"><p className="text-[14px]">{run.voidReason}</p></Card> : null}
        </aside>
      </div>
    </>
  );
}

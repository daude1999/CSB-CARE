import Link from "@/components/link";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { pounds } from "@/server/finance/pricing";
import { approveRunAction, prepareRunAction, voidRunAction } from "@/app/rota-actions";
import { Card, Empty } from "@/components/ui";
import { RunBadge } from "@/components/finance-ui";

interface Row {
  id: string;
  periodStart: Date;
  status: string;
  totalPence: number;
  exceptions: unknown;
  createdAt: Date;
}

/** The list of pay or invoice runs, with the form to prepare a new draft for a finished week. */
export function RunList({ kind, rows, canPrepare, weeks, defaultWeek, back }: { kind: "pay" | "invoice"; rows: Row[]; canPrepare: boolean; weeks: string[]; defaultWeek: string; back: string }) {
  const base = kind === "pay" ? "/rota/finance/payroll" : "/rota/finance/invoices";
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Week</th><th className="text-right">Total</th><th>Exceptions</th><th>Status</th><th>Prepared</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === "VOID" ? "opacity-60" : undefined}>
                    <td><Link href={`${base}/${r.id}`}>w/c {fmtLondonDate(fromDbDate(r.periodStart))}</Link></td>
                    <td className="text-right tabular-nums">{pounds(r.totalPence)}</td>
                    <td className="tabular-nums">{Array.isArray(r.exceptions) ? r.exceptions.length : 0}</td>
                    <td><RunBadge status={r.status} /></td>
                    <td className="tabular-nums">{fmtLondonDate(r.createdAt.toISOString().slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No runs prepared yet.</Empty>}
      </Card>
      {canPrepare ? (
        <Card title="Prepare a draft">
          <form action={prepareRunAction} className="space-y-2">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="kind" value={kind} />
            <label className="block"><span className="label">Week</span><select name="week" defaultValue={defaultWeek} className="input">{weeks.map((w) => <option key={w} value={w}>w/c {fmtLondonDate(w)}</option>)}</select></label>
            <p className="text-[13px] text-slate-600">{kind === "pay" ? "Uses approved timesheets only. Anything not approved is listed as an exception." : "Uses delivered visits and chargeable short-notice cancellations for people with a funded package."}</p>
            <button className="btn-primary">Prepare draft</button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

/** Approve, export or void a run. Approval is hidden from whoever prepared it; the server and database refuse it too. */
export function RunActions({ kind, run, ctxUserId, canApprove, canManage, back, who }: { kind: "pay" | "invoice"; run: { id: string; status: string; createdById: string; approvedById: string | null; approvedAt: Date | null }; ctxUserId: string; canApprove: boolean; canManage: boolean; back: string; who: (id: string | null) => string }) {
  return (
    <Card title="Next step">
      <div className="space-y-3 text-[14px]">
        <p>Prepared by {who(run.createdById)}.{run.approvedAt ? ` Approved by ${who(run.approvedById)} on ${fmtLondonDate(run.approvedAt.toISOString().slice(0, 10))}.` : ""}</p>
        {run.status === "DRAFT" ? (
          canApprove && run.createdById !== ctxUserId ? (
            <form action={approveRunAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="runId" value={run.id} />
              <button className="btn-primary">Approve run</button>
            </form>
          ) : <p className="text-slate-600">{run.createdById === ctxUserId ? "You prepared this run, so someone else must approve it." : "A finance approver approves runs."}</p>
        ) : null}
        {run.status === "APPROVED" ? <a href={`/api/finance/${kind}/${run.id}`} className="btn-primary inline-block">Download CSV</a> : null}
        {run.status !== "VOID" && canManage ? (
          <details>
            <summary className="cursor-pointer font-medium">Void this run</summary>
            <form action={voidRunAction} className="mt-2 space-y-2">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="runId" value={run.id} />
              <label className="block"><span className="label">Reason</span><input name="reason" required minLength={5} className="input" /></label>
              <button className="btn-danger">Void run</button>
              <p className="text-[12.5px] text-slate-500">The run stays on record. Prepare a new one for the same week afterwards.</p>
            </form>
          </details>
        ) : null}
        <p className="text-[12.5px] text-slate-500">Nothing is paid, submitted or sent from here.</p>
      </div>
    </Card>
  );
}

export function Exceptions({ items }: { items: { kind: string; message: string }[] }) {
  return (
    <Card title={`Exceptions (${items.length})`}>
      {items.length ? <ul className="rows text-[13.5px]">{items.map((e, i) => <li key={i} className="py-1.5">{e.message}</li>)}</ul> : <Empty>None. Everything in the period was included.</Empty>}
    </Card>
  );
}

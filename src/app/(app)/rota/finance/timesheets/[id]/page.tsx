import Link from "@/components/link";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getTimesheet } from "@/server/finance/timesheets";
import { memberNames } from "@/server/rota/queries";
import { adjustLineAction, decideTimesheetAction, submitTimesheetAction, verifyLinesAction } from "@/app/rota-actions";
import { Card, Flash, fmtDate, PageHeader } from "@/components/ui";
import { TimesheetBadge, hours } from "@/components/finance-ui";

export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = { "finance.timesheet.verified": "Lines checked", "finance.timesheet.adjusted": "Line adjusted", "finance.timesheet.submitted": "Submitted", "finance.timesheet.approved": "Approved", "finance.timesheet.rejected": "Rejected" };

export default async function TimesheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("finance.view");
  const { timesheet: t, staff, history } = await orNotFound(getTimesheet(ctx, id));
  const canPrepare = (hasOrgPermission(ctx, "rota.edit") || hasOrgPermission(ctx, "finance.manage")) && (t.status === "DRAFT" || t.status === "REJECTED");
  const canDecide = hasOrgPermission(ctx, "finance.approve") && t.status === "SUBMITTED" && t.submittedById !== ctx.userId;
  const names = await memberNames(ctx, [t.generatedById, t.submittedById, t.decidedById, ...history.map((h) => h.actorId), ...t.lines.map((l) => l.verifiedById)]);
  const unchecked = t.lines.filter((l) => l.exception && !l.verifiedAt).length;
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "—");
  const back = `/rota/finance/timesheets/${t.id}`;
  const week = fromDbDate(t.periodStart);

  return (
    <>
      <PageHeader title={`Timesheet · ${staff?.displayName ?? "Former staff member"}`} back={`/rota/finance/timesheets?week=${week}`} subtitle={`Week commencing ${fmtLondonDate(week)}. Prepared by ${who(t.generatedById)} on ${fmtDate(t.generatedAt, true)}.`} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Visits" actions={<TimesheetBadge status={t.status} />}>
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Visit</th><th className="text-right">Planned</th><th className="text-right">Clocked</th><th className="text-right">Payable</th><th>To check</th></tr></thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className={l.exception ? "bg-[#fff8e6]" : undefined}>
                    <td className="whitespace-nowrap tabular-nums">{fmtLondonDate(fromDbDate(l.date), { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td>{l.visitId && hasOrgPermission(ctx, "rota.view") ? <Link href={`/rota/visits/${l.visitId}`}>{l.description}</Link> : l.description}</td>
                    <td className="text-right tabular-nums">{l.scheduledMinutes}m</td>
                    <td className="text-right tabular-nums">{l.deliveredMinutes}m</td>
                    <td className="text-right tabular-nums font-medium">{l.payableMinutes}m</td>
                    <td className="min-w-[200px]">
                      {l.exception ? <span className="text-[13px]">{l.exception}</span> : null}
                      {l.exception ? (l.verifiedAt ? <span className="block text-[12.5px] text-[#1f6b3a]">Checked by {who(l.verifiedById)} {fmtDate(l.verifiedAt, true)}{l.verificationNote ? `: ${l.verificationNote}` : ""}</span> : <span className="block text-[12.5px] font-medium text-[#8a5a00]">Not checked yet</span>) : null}
                      {canPrepare && l.exception && !l.verifiedAt ? (
                        <form action={verifyLinesAction} className="mt-1 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="timesheetId" value={t.id} />
                          <input type="hidden" name="version" value={t.version} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <input name="note" required minLength={3} className="input w-48 py-1" placeholder="How you checked it" aria-label={`How you checked the ${l.description} line`} />
                          <button className="btn-secondary py-1">Mark checked</button>
                        </form>
                      ) : null}
                      {canPrepare ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[13px] text-navy-700">Change payable minutes</summary>
                          <form action={adjustLineAction} className="mt-1 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="timesheetId" value={t.id} />
                            <input type="hidden" name="version" value={t.version} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <label><span className="label">Minutes</span><input name="minutes" type="number" min={0} max={1440} defaultValue={l.payableMinutes} className="input w-24 py-1" /></label>
                            <label><span className="label">Reason</span><input name="reason" required minLength={3} className="input w-48 py-1" /></label>
                            <button className="btn-secondary py-1">Save</button>
                          </form>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2} className="font-medium">Total</td><td className="text-right tabular-nums">{hours(t.scheduledMinutes)}h</td><td className="text-right tabular-nums">{hours(t.deliveredMinutes)}h</td><td className="text-right tabular-nums font-semibold">{hours(t.payableMinutes)}h</td><td /></tr></tfoot>
            </table>
          </div>
        </Card>
        <aside className="space-y-3">
          <Card title="Next step">
            {canPrepare ? (
              <form action={submitTimesheetAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="timesheetId" value={t.id} />
                <input type="hidden" name="version" value={t.version} />
                {t.decisionNote ? <p className="text-[13.5px] text-[#a3242c]">Rejected: {t.decisionNote}</p> : null}
                <p className="text-[14px]">Check the marked lines, change any payable minutes with a reason, then submit.</p>
                {unchecked ? <p className="text-[13.5px] font-medium text-[#8a5a00]">{unchecked} line{unchecked === 1 ? "" : "s"} with exceptions not checked yet. Submitting is refused until they are.</p> : null}
                <button className="btn-primary">Submit for approval</button>
              </form>
            ) : null}
            {canPrepare && unchecked > 1 ? (
              <form action={verifyLinesAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="timesheetId" value={t.id} />
                <input type="hidden" name="version" value={t.version} />
                <label className="block"><span className="label">Check all {unchecked} lines: how you checked them</span><input name="note" required minLength={3} className="input" placeholder="e.g. confirmed with the carer and the call log" /></label>
                <button className="btn-secondary">Mark all checked</button>
              </form>
            ) : null}
            {t.status === "SUBMITTED" ? (
              canDecide ? (
                <form action={decideTimesheetAction} className="space-y-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="timesheetId" value={t.id} />
                  <input type="hidden" name="version" value={t.version} />
                  <p className="text-[14px]">Submitted by {who(t.submittedById)}.</p>
                  <label className="block"><span className="label">Note (needed to reject)</span><input name="note" className="input" /></label>
                  <div className="flex gap-2"><button className="btn-primary" name="decision" value="APPROVED">Approve</button><button className="btn-secondary" name="decision" value="REJECTED">Reject</button></div>
                </form>
              ) : <p className="text-[14px] text-slate-600">Submitted by {who(t.submittedById)}. {t.submittedById === ctx.userId ? "Someone else must approve it." : "A finance approver decides it."}</p>
            ) : null}
            {t.status === "APPROVED" ? <p className="text-[14px]">Approved by {who(t.decidedById)} on {t.decidedAt ? fmtDate(t.decidedAt, true) : ""}. It can now go into payroll preparation and cannot change.</p> : null}
          </Card>
          <Card title="History">
            <ul className="rows text-[13.5px]">
              {history.map((h) => {
                const d = (h.data ?? {}) as { reason?: string; note?: string; from?: number; to?: number };
                return <li key={h.id} className="py-1.5"><span className="font-medium">{ACTION[h.action] ?? h.action}</span> · {who(h.actorId)} · {fmtDate(h.createdAt, true)}{d.reason ? <span className="block text-slate-600">{d.from}m → {d.to}m: {d.reason}</span> : null}{d.note ? <span className="block text-slate-600">{d.note}</span> : null}</li>;
              })}
              {!history.length ? <li className="py-1.5 text-slate-500">Prepared, not yet changed.</li> : null}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

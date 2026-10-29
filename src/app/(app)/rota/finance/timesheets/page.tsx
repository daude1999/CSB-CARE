import Link from "@/components/link";
import { addDays, fmtLondonDate, isIsoDate, isoWeekday, londonDate, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listTimesheets } from "@/server/finance/timesheets";
import { bulkTimesheetsAction, generateTimesheetsAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { TimesheetBadge, hours } from "@/components/finance-ui";
import { Stepper } from "@/components/rota-ui";

export const dynamic = "force-dynamic";


export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("finance.view");
  const lastWeek = addDays(mondayOf(londonDate()), -7);
  const week = sp.week && isIsoDate(sp.week) && isoWeekday(sp.week) === 1 ? sp.week : lastWeek;
  const rows = await listTimesheets(ctx, week, sp.status);
  const canPrepare = hasOrgPermission(ctx, "rota.edit") || hasOrgPermission(ctx, "finance.manage");
  const canApprove = hasOrgPermission(ctx, "finance.approve");
  const ended = addDays(week, 6) < londonDate();
  const back = `/rota/finance/timesheets?week=${week}${sp.status ? `&status=${sp.status}` : ""}`;
  const n = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Timesheets" back="/rota/finance" subtitle="One timesheet per carer per week, worked out from their visits and clock records. Lines that need a person to check them are marked. A coordinator submits; a finance approver who did not submit them approves." />
      <Flash searchParams={sp} />
      <section className="panel mb-3 flex flex-wrap items-center justify-between gap-3" aria-label="Week">
        <Stepper base="/rota/finance/timesheets" params={{ week, status: sp.status }} param="week" prev={addDays(week, -7)} next={addDays(week, 7)} label={`w/c ${fmtLondonDate(week, { day: "numeric", month: "long", year: "numeric" })}`} />
        <div className="flex flex-wrap items-center gap-2">
          {canPrepare && ended ? (
            <form action={generateTimesheetsAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="week" value={week} />
              <button className="btn-primary">{rows.length ? "Refresh drafts" : "Prepare timesheets"}</button>
            </form>
          ) : null}
          {canPrepare && n("DRAFT") ? <form action={bulkTimesheetsAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="week" value={week} /><button className="btn-secondary" name="kind" value="submit">Submit all drafts ({n("DRAFT")})</button></form> : null}
          {canApprove && n("SUBMITTED") ? <form action={bulkTimesheetsAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="week" value={week} /><button className="btn-secondary" name="kind" value="approve">Approve all submitted ({n("SUBMITTED")})</button></form> : null}
        </div>
        {!ended ? <p className="w-full text-[13px] text-slate-600">This week has not finished yet. Timesheets are prepared once it has.</p> : null}
      </section>
      <Card>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Carer</th><th className="text-right">Planned h</th><th className="text-right">Clocked h</th><th className="text-right">Payable h</th><th>To check</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/rota/finance/timesheets/${t.id}`}>{t.staff?.displayName ?? "Former staff member"}</Link><div className="text-[12.5px] text-slate-500">{t.staff?.jobTitle}</div></td>
                    <td className="text-right tabular-nums">{hours(t.scheduledMinutes)}</td>
                    <td className="text-right tabular-nums">{hours(t.deliveredMinutes)}</td>
                    <td className="text-right tabular-nums font-medium">{hours(t.payableMinutes)}</td>
                    <td>{t.exceptions ? <Badge tone="amber">{t.exceptions} line{t.exceptions === 1 ? "" : "s"}</Badge> : <span className="text-slate-500">None</span>}</td>
                    <td><TimesheetBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{ended ? "No timesheets for this week yet." : "No timesheets yet."}</Empty>}
      </Card>
    </>
  );
}

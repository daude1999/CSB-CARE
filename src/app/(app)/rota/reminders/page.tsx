import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { activeReminders } from "@/server/rota/dashboard";
import { authorisedBranches, rotaScope } from "@/server/rota/scope";
import { fmtLondonDate } from "@/lib/london";
import { PageHeader } from "@/components/ui";
import { SearchTable } from "@/components/search-table";

export const dynamic = "force-dynamic";

const WINDOWS = [14, 30, 90] as const;

/** Every outstanding reminder the member may see: the dashboard's "View All". Same records, no 100-row limit. */
export default async function RemindersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const windowDays = WINDOWS.find((w) => String(w) === sp.days) ?? 14;
  const branches = await authorisedBranches(await rotaScope(ctx, "rota.view"));
  const branch = sp.branch && branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const rows = await activeReminders(ctx, { branchId: branch, windowDays });
  const overdue = rows.filter((r) => r.overdueDays > 0).length;
  return (
    <>
      <PageHeader title="Active Reminders" back="/rota" subtitle="Care plan and risk reviews that are due or overdue, and leave requests still to decide. Each one opens the record to act on." />
      <section className="panel" aria-label="Reminders">
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          {branches.length > 1 ? (
            <label><span className="label">Branch</span>
              <select name="branch" defaultValue={branch ?? ""} className="input w-[200px]"><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
          ) : null}
          <label><span className="label">Due within</span>
            <select name="days" defaultValue={String(windowDays)} className="input w-[140px]">{WINDOWS.map((w) => <option key={w} value={w}>{w} days</option>)}</select>
          </label>
          <button className="btn-primary">Show</button>
          <p className="ml-auto text-[13.5px] text-slate-600">{rows.length} reminder{rows.length === 1 ? "" : "s"}{overdue ? `, ${overdue} overdue` : ""}</p>
        </form>
        <SearchTable
          tall
          label="reminders"
          columns={["Reminder", "Due", "Account", "Type", "Overdue"]}
          empty={`Nothing due in the next ${windowDays} days.`}
          rows={rows.map((r, n) => ({
            key: `${n}`,
            text: `${r.text} ${r.account} ${r.type}`,
            cells: [<Link key="r" href={r.href}>{r.text}</Link>, fmtLondonDate(r.due, { day: "2-digit", month: "2-digit", year: "numeric" }), r.account, r.type, r.overdueDays ? <span key="o" className="font-medium text-[#a3242c]">{r.overdueDays} day(s)</span> : "—"],
          }))}
        />
      </section>
    </>
  );
}

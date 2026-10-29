import { addDays, isIsoDate, londonDate, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listRuns } from "@/server/finance/runs";
import { Flash, PageHeader } from "@/components/ui";
import { RunList } from "@/components/run-list";

export const dynamic = "force-dynamic";

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("finance.view");
  const runs = await listRuns(ctx);
  const thisMonday = mondayOf(londonDate());
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => addDays(thisMonday, -7 * n));
  const week = sp.week && isIsoDate(sp.week) && weeks.includes(sp.week) ? sp.week : weeks[0]!;
  return (
    <>
      <PageHeader title="Invoice Preparation" back="/rota/finance" subtitle="Weekly invoices worked out from delivered visits, grouped by funder and priced on each funder's charge rate card. A second person approves the run, which numbers the invoices; it is then exported for your accounts system. The platform never sends invoices." />
      <Flash searchParams={sp} />
      <RunList kind="invoice" rows={runs.invoice} canPrepare={hasOrgPermission(ctx, "finance.manage")} weeks={weeks} defaultWeek={week} back="/rota/finance/invoices" />
    </>
  );
}

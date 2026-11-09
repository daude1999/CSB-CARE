import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { allSubscriptions, recurringRevenue } from "@/server/platform/subscriptions";
import { billingStatus } from "@/server/platform/billing";
import { fmtDate } from "@/components/ui";
import { EmptyRow, fmtMoney, NotConfigured, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscriptions" };

const STATUSES = ["", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [subs, revenue] = await Promise.all([allSubscriptions(ctx, { status: sp.status }), recurringRevenue()]);
  const billing = billingStatus();
  return (
    <>
      <PxHeader title="Subscriptions" description="The current subscription of every client. Change a client's subscription from its profile; every change keeps the previous period in its history." />
      <p className="mb-4 rounded-[8px] border border-[#f3d38a] bg-[#fff8e6] px-4 py-2 text-[13.5px] text-[#6b4a00]">{billing.message}</p>
      <nav aria-label="Status" className="mb-3 flex flex-wrap gap-1.5">{STATUSES.map((s) => <Link key={s} href={s ? `?status=${s}` : "?"} aria-current={(sp.status ?? "") === s ? "page" : undefined} className={`rounded-full px-3 py-1 text-[13px] no-underline ${(sp.status ?? "") === s ? "bg-[#5b21b6] text-white" : "bg-white text-[#26304a] ring-1 ring-[#e4e7ef]"}`}>{s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}</Link>)}</nav>
      <PxPanel title={`${subs.length} subscription(s)`} actions={<span className="text-[13px]">Monthly recurring revenue: {revenue.mrrPence === null ? <NotConfigured>Prices not set</NotConfigured> : <strong>{fmtMoney(revenue.mrrPence)}</strong>}</span>}>
        <Table head={["Client", "Plan", "Status", "Period", "Price", "Trial ends / renews", "Allowances", "Since"]} empty={subs.length ? null : <EmptyRow>No subscriptions.</EmptyRow>}>
          {subs.map((s) => {
            const price = s.billingPeriod === "ANNUAL" ? s.plan.annualPricePence : s.plan.monthlyPricePence;
            return (
              <tr key={s.id}>
                <td><Link href={`/platform-admin/clients/${s.organisation.id}?tab=subscription`} className="font-medium">{s.organisation.name}</Link><span className="block font-mono text-[12px] text-[#5b6478]">{s.organisation.customerAccount?.reference}</span></td>
                <td>{s.plan.name}</td>
                <td><Pill value={s.status} /></td>
                <td>{s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"}</td>
                <td>{fmtMoney(price) ?? <NotConfigured>Not set</NotConfigured>}</td>
                <td className="whitespace-nowrap">{fmtDate(s.status === "TRIAL" ? s.trialEndsAt : s.renewsAt)}</td>
                <td className="text-[12.5px]">{s.userAllowance ?? "∞"} users · {s.storageMb ?? "∞"} MB · {s.aiRequestsPerMonth ?? "—"} AI</td>
                <td className="whitespace-nowrap">{fmtDate(s.startsAt)}</td>
              </tr>
            );
          })}
        </Table>
      </PxPanel>
    </>
  );
}

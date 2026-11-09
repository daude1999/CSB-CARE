import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { allSubscriptions, recurringRevenue } from "@/server/platform/subscriptions";
import { billingStatus } from "@/server/platform/billing";
import { fmtDate } from "@/components/ui";
import { EmptyState, fmtMoney, fmtNumber, Indicator, MetricStrip, NotConfigured, Pill, PxHeader, PxPanel, pxPrimary, Table, Tabs } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscriptions" };

const STATUSES = ["", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"];

/** Every client's current subscription. Changes are made in the client's workspace and keep the previous period. */
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [subs, all, revenue] = await Promise.all([allSubscriptions(ctx, { status: sp.status }), allSubscriptions(ctx), recurringRevenue()]);
  const billing = billingStatus();
  const count = (s: string) => all.filter((x) => x.status === s).length;
  const status = STATUSES.includes(sp.status ?? "") ? (sp.status ?? "") : "";
  return (
    <>
      <PxHeader title="Subscriptions" description="Every client's current subscription. Change one from the client's workspace; the previous period is kept in its history." />
      <MetricStrip label="Subscription figures" cols={4}>
        <Indicator label="Recurring revenue" value={revenue.mrrPence === null ? <NotConfigured>Prices not set</NotConfigured> : fmtMoney(revenue.mrrPence)} note={billing.connected ? "Billing connected" : "Internal records · billing not connected"} />
        <Indicator label="Active" value={fmtNumber(count("ACTIVE"))} note={revenue.unpriced ? `${revenue.unpriced} on unpriced plans` : "All priced"} />
        <Indicator label="On trial" value={fmtNumber(count("TRIAL"))} href="/platform-admin/renewals" note="See Trials & Renewals" />
        <Indicator label="Suspended or cancelled" value={fmtNumber(count("SUSPENDED") + count("CANCELLED"))} />
      </MetricStrip>
      <Tabs label="Subscription status" items={STATUSES.map((s) => ({ href: s ? `?status=${s}` : "/platform-admin/subscriptions", label: s ? s.charAt(0) + s.slice(1).toLowerCase() : "All", active: status === s, count: s ? count(s) : all.length }))} />
      <PxPanel flush>
        {subs.length ? (
          <div className="px-4">
            <Table label="Subscriptions" minWidth={940} head={["Client", "Plan", "Status", "Billing", "Price", "Trial ends / renews", "Allowances", "Since"]}>
              {subs.map((s) => {
                const price = s.billingPeriod === "ANNUAL" ? s.plan.annualPricePence : s.plan.monthlyPricePence;
                return (
                  <tr key={s.id}>
                    <td><Link href={`/platform-admin/clients/${s.organisation.id}?tab=subscription`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{s.organisation.name}</Link><span className="block font-mono text-[11.5px] text-px-subtle">{s.organisation.customerAccount?.reference}</span></td>
                    <td>{s.plan.name}</td>
                    <td><Pill value={s.status} /></td>
                    <td>{s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"}</td>
                    <td className="tabular-nums">{fmtMoney(price) ?? <NotConfigured>Not set</NotConfigured>}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(s.status === "TRIAL" ? s.trialEndsAt : s.renewsAt)}</td>
                    <td className="text-[12.5px] text-px-body">{s.userAllowance ?? "∞"} users · {s.storageMb ?? "∞"} MB · {s.aiRequestsPerMonth ?? "—"} AI</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(s.startsAt)}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        ) : all.length ? <EmptyState title="No subscriptions with this status" /> : (
          <EmptyState title="No subscriptions yet" action={<Link href="/platform-admin/plans?new=1" className={pxPrimary}>Create a plan</Link>}>Create a plan, then open a client and choose Start subscription. Nothing is charged: billing is not connected.</EmptyState>
        )}
      </PxPanel>
    </>
  );
}

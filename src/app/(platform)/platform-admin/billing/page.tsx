import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { billingStatus } from "@/server/platform/billing";
import { subscriptionChanges } from "@/server/platform/subscriptions";
import { requirePlatform } from "@/server/platform/access";
import { fmtDate } from "@/components/ui";
import { EmptyRow, EmptyState, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

/** Billing provider connection, invoices (only once a provider is connected) and the internal subscription record. */
export default async function BillingPage() {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.view");
  const status = billingStatus();
  const changes = await subscriptionChanges(ctx, 60);
  return (
    <>
      <PxHeader title="Invoices" description="Invoices come from a billing provider. Until one is connected, nothing is charged and no invoice is issued or simulated." />
      <div className="mb-4 flex flex-wrap items-start gap-3 rounded-[10px] border border-px-line bg-white px-4 py-3.5">
        <Pill value={status.connected ? "ACTIVE" : "REQUESTED"} label={status.connected ? "Billing connected" : "Billing not connected"} />
        <div className="min-w-0 flex-1 basis-[24rem] text-body">
          <p className="text-px-ink">{status.message}</p>
          {!status.connected ? <p className="mt-0.5 text-meta text-px-muted">Next step: once Evantix chooses a provider, a developer connects it behind the platform&apos;s billing interface and sets BILLING_PROVIDER in the hosting settings.</p> : null}
        </div>
      </div>
      <PxPanel title="Invoices" flush className="mb-4">
        <EmptyState title={status.connected ? "No invoices yet" : "No invoices while billing is not connected"}>{status.connected ? "Invoices from the billing provider appear here." : "Subscriptions below are internal records only. They are not invoices or payments."}</EmptyState>
      </PxPanel>
      <PxPanel title="Subscription periods" description="Internal record of each subscription period, newest first. Not invoices or payments." flush>
        {changes.length ? (
          <div className="px-4">
            <Table label="Subscription periods" minWidth={720} head={["Starts", "Ended", "Client", "Plan", "Status", "Reason"]}>
              {changes.map((c) => <tr key={c.id}><td className="whitespace-nowrap text-meta tabular-nums">{fmtDate(c.startsAt, true)}</td><td className="whitespace-nowrap text-meta tabular-nums">{c.endedAt ? fmtDate(c.endedAt, true) : <span className="text-px-ok">Current</span>}</td><td><Link href={`/platform-admin/clients/${c.organisation.id}?tab=subscription`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{c.organisation.name}</Link></td><td>{c.plan.name}</td><td><Pill value={c.status} /></td><td className="text-meta text-px-body">{c.changeReason ?? "—"}</td></tr>)}
            </Table>
          </div>
        ) : <EmptyRow>No subscription periods yet.</EmptyRow>}
      </PxPanel>
    </>
  );
}

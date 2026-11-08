import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { billingStatus } from "@/server/platform/billing";
import { subscriptionChanges } from "@/server/platform/subscriptions";
import { requirePlatform } from "@/server/platform/access";
import { fmtDate } from "@/components/ui";
import { EmptyRow, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing & Invoices" };

export default async function BillingPage() {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.view");
  const status = billingStatus();
  const changes = await subscriptionChanges(ctx, 60);
  return (
    <>
      <PxHeader title="Billing & Invoices" description="Billing provider connection and the internal record of subscription periods. Invoices appear here only once a billing provider is connected." />
      <PxPanel title="Billing provider">
        <p className="text-[13.5px]"><Pill value={status.connected ? "ACTIVE" : "REQUESTED"} label={status.connected ? "Connected" : "Not connected (not live)"} /> <span className="ml-2">{status.message}</span></p>
        {!status.connected ? <p className="mt-2 text-[12.5px] text-[#5b6478]">Evantix has not chosen a billing provider yet. When it does, a developer adds the integration behind the platform&apos;s billing interface and sets BILLING_PROVIDER in the hosting settings. Until then nothing is charged and no payment is shown as successful.</p> : null}
      </PxPanel>
      <PxPanel title="Invoices" className="mt-4"><EmptyRow>No invoices: billing is not connected.</EmptyRow></PxPanel>
      <PxPanel title="Subscription history (internal records)" className="mt-4" description="Each row is a subscription period. These are not invoices or payments.">
        <Table head={["Starts", "Ended", "Client", "Plan", "Status", "Reason"]} empty={changes.length ? null : <EmptyRow>No subscription records yet.</EmptyRow>}>
          {changes.map((c) => <tr key={c.id}><td className="whitespace-nowrap">{fmtDate(c.startsAt, true)}</td><td className="whitespace-nowrap">{c.endedAt ? fmtDate(c.endedAt, true) : "Current"}</td><td><Link href={`/platform-admin/clients/${c.organisation.id}?tab=subscription`}>{c.organisation.name}</Link></td><td>{c.plan.name}</td><td><Pill value={c.status} /></td><td className="text-[12.5px]">{c.changeReason ?? "—"}</td></tr>)}
        </Table>
      </PxPanel>
    </>
  );
}

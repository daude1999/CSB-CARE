import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { trialsAndRenewals } from "@/server/platform/subscriptions";
import { fmtDate } from "@/components/ui";
import { EmptyRow, Pill, PxHeader, PxPanel, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trials & Renewals" };

const left = (d: number | null) => (d === null ? <Tone tone="slate">No end date</Tone> : d < 0 ? <Tone tone="rose">Ended {-d} day(s) ago</Tone> : d <= 7 ? <Tone tone="amber">{d} day(s) left</Tone> : <Tone tone="slate">{d} days left</Tone>);

/** Trials ending and renewals due. Nothing happens automatically when a date passes: Evantix decides. */
export default async function RenewalsPage() {
  const ctx = await requireCtx();
  const { trials, renewals } = await trialsAndRenewals(ctx);
  return (
    <>
      <PxHeader title="Trials & Renewals" description="Trials and renewals by date. The platform never suspends or charges a client automatically when a date passes; open the client to extend a trial, start a paid plan or change the renewal." />
      <PxPanel title={`Trials (${trials.length})`}>
        <Table head={["Client", "Plan", "Trial ends", "Time left", ""]} empty={trials.length ? null : <EmptyRow>No clients on trial.</EmptyRow>}>
          {trials.map((t) => <tr key={t.id}><td><Link href={`/platform-admin/clients/${t.organisation.id}`} className="font-medium">{t.organisation.name}</Link><span className="block font-mono text-[12px] text-[#5b6478]">{t.organisation.customerAccount?.reference}</span></td><td>{t.plan.name}</td><td>{fmtDate(t.trialEndsAt)}</td><td>{left(t.daysLeft)}</td><td><Link href={`/platform-admin/clients/${t.organisation.id}?tab=subscription`} className="text-[13px]">Extend or convert</Link></td></tr>)}
        </Table>
      </PxPanel>
      <PxPanel title={`Renewals in the next 90 days (${renewals.length})`} className="mt-4">
        <Table head={["Client", "Plan", "Status", "Renews", "Time left"]} empty={renewals.length ? null : <EmptyRow>No renewals due.</EmptyRow>}>
          {renewals.map((r) => <tr key={r.id}><td><Link href={`/platform-admin/clients/${r.organisation.id}?tab=subscription`} className="font-medium">{r.organisation.name}</Link></td><td>{r.plan.name}</td><td><Pill value={r.status} /></td><td>{fmtDate(r.renewsAt)}</td><td>{left(r.daysLeft)}</td></tr>)}
        </Table>
      </PxPanel>
    </>
  );
}

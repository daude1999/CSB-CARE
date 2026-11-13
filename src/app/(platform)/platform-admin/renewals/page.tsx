import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { trialsAndRenewals } from "@/server/platform/subscriptions";
import { fmtDate } from "@/components/ui";
import { EmptyState, Pill, PxHeader, PxPanel, pxSecondary, pxSm, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trials & Renewals" };

const left = (d: number | null) => (d === null ? <Tone tone="slate">No end date</Tone> : d < 0 ? <Tone tone="rose">Ended {-d} day{d === -1 ? "" : "s"} ago</Tone> : d <= 7 ? <Tone tone="amber">{d} day{d === 1 ? "" : "s"} left</Tone> : <Tone tone="slate">{d} days left</Tone>);

/** Trials ending and renewals due. Nothing happens automatically when a date passes: Evantix decides. */
export default async function RenewalsPage() {
  const ctx = await requireCtx();
  const { trials, renewals } = await trialsAndRenewals(ctx);
  return (
    <>
      <PxHeader title="Trials & Renewals" description="Soonest first. The platform never suspends or charges a client automatically when a date passes." />
      <PxPanel title="Trials" description={`${trials.length} client${trials.length === 1 ? "" : "s"} on trial`} flush className="mb-4">
        {trials.length ? (
          <div className="px-4">
            <Table label="Trials" minWidth={640} head={["Client", "Plan", "Trial ends", "Time left", ""]} align={["left", "left", "left", "left", "right"]}>
              {trials.map((t) => <tr key={t.id}><td><Link href={`/platform-admin/clients/${t.organisation.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{t.organisation.name}</Link><span className="block font-mono text-caption text-px-subtle">{t.organisation.customerAccount?.reference}</span></td><td>{t.plan.name}</td><td className="whitespace-nowrap tabular-nums">{fmtDate(t.trialEndsAt)}</td><td>{left(t.daysLeft)}</td><td className="text-right"><span className="inline-flex gap-1.5"><Link href={`/platform-admin/clients/${t.organisation.id}?tab=subscription&edit=trial`} className={`${pxSecondary} ${pxSm}`}>Extend</Link><Link href={`/platform-admin/clients/${t.organisation.id}?tab=subscription&edit=subscription`} className={`${pxSecondary} ${pxSm}`}>Convert to paid</Link></span></td></tr>)}
            </Table>
          </div>
        ) : <EmptyState title="No clients on trial" />}
      </PxPanel>
      <PxPanel title="Renewals in the next 90 days" description={`${renewals.length} due`} flush>
        {renewals.length ? (
          <div className="px-4">
            <Table label="Renewals" minWidth={600} head={["Client", "Plan", "Status", "Renews", "Time left", ""]} align={["left", "left", "left", "left", "left", "right"]}>
              {renewals.map((r) => <tr key={r.id}><td><Link href={`/platform-admin/clients/${r.organisation.id}?tab=subscription`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{r.organisation.name}</Link></td><td>{r.plan.name}</td><td><Pill value={r.status} /></td><td className="whitespace-nowrap tabular-nums">{fmtDate(r.renewsAt)}</td><td>{left(r.daysLeft)}</td><td className="text-right"><Link href={`/platform-admin/clients/${r.organisation.id}?tab=subscription&edit=subscription`} className={`${pxSecondary} ${pxSm}`}>Review</Link></td></tr>)}
            </Table>
          </div>
        ) : <EmptyState title="No renewals due in the next 90 days" />}
      </PxPanel>
    </>
  );
}

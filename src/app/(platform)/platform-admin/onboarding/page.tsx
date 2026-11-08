import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { onboardingStatus } from "@/server/platform/onboarding";
import { fmtDate } from "@/components/ui";
import { EmptyRow, Pill, PxHeader, PxPanel, pxPrimary, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Onboarding" };

export default async function OnboardingPage() {
  const ctx = await requireCtx();
  const rows = await onboardingStatus(ctx);
  const open = rows.filter((r) => !r.complete);
  const tick = (ok: boolean) => (ok ? <Tone tone="green">Done</Tone> : <Tone tone="amber">To do</Tone>);
  return (
    <>
      <PxHeader title="Client Onboarding" description="Where each client is in its set-up. A client is fully onboarded when it has a subscription, at least one branch and an administrator who has accepted their invitation." actions={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add new client</Link>} />
      <PxPanel title={`Still being set up (${open.length})`}>
        <Table head={["Client", "Created", "Subscription", "Branches", "Administrator", "Invitation"]} empty={open.length ? null : <EmptyRow>Every client is fully set up.</EmptyRow>}>
          {open.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/platform-admin/clients/${r.id}`} className="font-medium">{r.name}</Link><span className="block font-mono text-[12px] text-[#5b6478]">{r.reference}</span></td>
              <td>{fmtDate(r.createdAt)}</td>
              <td>{tick(r.steps.subscription)}</td>
              <td>{tick(r.steps.branches)}</td>
              <td>{tick(r.steps.administrator)}</td>
              <td>{r.invite ? <><Pill value={r.invite.state} /><span className="block text-[12px] text-[#5b6478]">{r.invite.email}{r.invite.state === "waiting" ? ` · until ${fmtDate(r.invite.expiresAt)}` : ""}</span></> : <span className="text-[#5b6478]">None</span>}{r.invite && r.invite.state !== "accepted" && r.invite.state !== "waiting" ? <Link href={`/platform-admin/clients/${r.id}?tab=users`} className="mt-1 block text-[12.5px]">Send a new invitation</Link> : null}</td>
            </tr>
          ))}
        </Table>
      </PxPanel>
      <PxPanel title={`Fully set up (${rows.length - open.length})`} className="mt-4">
        <ul className="grid grid-cols-1 gap-1 text-[13.5px] sm:grid-cols-2 lg:grid-cols-3">{rows.filter((r) => r.complete).map((r) => <li key={r.id}><Link href={`/platform-admin/clients/${r.id}`}>{r.name}</Link> <span className="font-mono text-[12px] text-[#5b6478]">{r.reference}</span></li>)}</ul>
      </PxPanel>
    </>
  );
}

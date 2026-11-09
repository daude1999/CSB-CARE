import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { onboardingStatus } from "@/server/platform/onboarding";
import { fmtDate } from "@/components/ui";
import { EmptyState, Pill, PxHeader, PxPanel, pxLink, pxPrimary, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Onboarding" };

const Step = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`inline-flex items-center gap-1.5 text-[13px] ${ok ? "text-px-ok" : "text-px-muted"}`}>
    {ok ? <CheckCircle size={16} weight="fill" aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
    <span className="sr-only">{label}: </span>{ok ? "Done" : "To do"}
  </span>
);

/** Where each client is in its set-up: subscription, branches and an administrator who has accepted their invitation. */
export default async function OnboardingPage() {
  const ctx = await requireCtx();
  const rows = await onboardingStatus(ctx);
  const open = rows.filter((r) => !r.complete);
  const done = rows.filter((r) => r.complete);
  return (
    <>
      <PxHeader title="Onboarding" description="A client is fully set up when it has a subscription, at least one branch and an administrator who has accepted their invitation." actions={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add client</Link>} />
      <PxPanel title="In progress" description={`${open.length} client${open.length === 1 ? "" : "s"} still being set up`} flush className="mb-4">
        {open.length ? (
          <div className="px-4">
            <Table label="Clients being set up" minWidth={820} head={["Client", "Created", "Subscription", "Branches", "Administrator", "Invitation"]}>
              {open.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/platform-admin/clients/${r.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{r.name}</Link><span className="block font-mono text-[11.5px] text-px-subtle">{r.reference}</span></td>
                  <td className="whitespace-nowrap tabular-nums">{fmtDate(r.createdAt)}</td>
                  <td>{r.steps.subscription ? <Step ok label="Subscription" /> : <Link href={`/platform-admin/clients/${r.id}?tab=subscription&edit=subscription`} className={pxLink}>Start subscription</Link>}</td>
                  <td>{r.steps.branches ? <Step ok label="Branches" /> : <Link href={`/platform-admin/clients/${r.id}?tab=overview&edit=branch`} className={pxLink}>Add branch</Link>}</td>
                  <td><Step ok={r.steps.administrator} label="Administrator" /></td>
                  <td>
                    {r.invite ? <><Pill value={r.invite.state} /><span className="mt-0.5 block text-[12px] text-px-muted">{r.invite.email}{r.invite.state === "waiting" ? ` · until ${fmtDate(r.invite.expiresAt)}` : ""}</span></> : <span className="text-px-subtle">None</span>}
                    {!r.steps.administrator && (!r.invite || (r.invite.state !== "accepted" && r.invite.state !== "waiting")) ? <Link href={`/platform-admin/clients/${r.id}?tab=users&edit=invite`} className={`mt-1 block text-[12.5px] ${pxLink}`}>Send a new invitation</Link> : null}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyState title="Every client is fully set up">New clients appear here until their administrator has accepted the invitation.</EmptyState>}
      </PxPanel>
      <PxPanel title="Fully set up" description={`${done.length} client${done.length === 1 ? "" : "s"}`} flush>
        {done.length ? (
          <ul className="grid grid-cols-1 divide-y divide-px-row sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {done.map((r) => <li key={r.id} className="px-4 py-2.5 text-[13.5px]"><Link href={`/platform-admin/clients/${r.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{r.name}</Link> <span className="font-mono text-[11.5px] text-px-subtle">{r.reference}</span></li>)}
          </ul>
        ) : <p className="px-4 py-4 text-[13.5px] text-px-muted">None yet.</p>}
      </PxPanel>
    </>
  );
}

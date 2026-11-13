import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { clientAdministrators } from "@/server/platform/accounts";
import { fmtDate } from "@/components/ui";
import { EmptyState, Pill, PxHeader, PxPanel, pxLink, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administrators" };

/** Each client's organisation administrators and the administrator invitations still waiting. */
export default async function AdministratorsPage() {
  const ctx = await requireCtx();
  const { admins, invites } = await clientAdministrators(ctx);
  return (
    <>
      <PxHeader title="Administrators" description="Each client's organisation administrators run their own users, branches and settings. They cannot see other clients or the Admin Centre. To invite one, open the client's Users & Permissions tab." />
      <PxPanel title="Client administrators" description={`${admins.length} across all clients`} flush className="mb-4">
        {admins.length ? (
          <div className="px-4">
            <Table label="Client administrators" minWidth={760} head={["Administrator", "Client", "Email", "Status", "Last active"]}>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/platform-admin/users/${a.user.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{a.user.name}</Link>{a.jobTitle ? <span className="block text-[12px] text-px-muted">{a.jobTitle}</span> : null}</td>
                  <td><Link href={`/platform-admin/clients/${a.organisation.id}?tab=users`} className="text-px-ink no-underline hover:text-px-accent hover:underline">{a.organisation.name}</Link><span className="block font-mono text-[11.5px] text-px-subtle">{a.organisation.customerAccount?.reference ?? ""}</span></td>
                  <td className="text-px-body">{a.user.email}</td>
                  <td>{a.user.deactivatedAt ? <Pill value="SUSPENDED" label="Account deactivated" /> : a.deactivatedAt ? <Pill value="CLOSED" label="Removed" /> : <Pill value="ACTIVE" />}</td>
                  <td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(a.user.sessions[0]?.lastSeenAt, true)}</td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyState title="No client administrators yet">Each new client gets its first administrator&apos;s invitation when it is added.</EmptyState>}
      </PxPanel>
      <PxPanel title="Invitations waiting" description={`${invites.length} not yet accepted`} flush>
        {invites.length ? (
          <div className="px-4">
            <Table label="Administrator invitations" minWidth={620} head={["Invited", "Client", "Sent", "Valid until"]}>
              {invites.map((i) => <tr key={i.id}><td><span className="font-medium">{i.name ?? i.email}</span><span className="block text-[12px] text-px-muted">{i.email}</span></td><td>{i.organisation ? <Link href={`/platform-admin/clients/${i.organisation.id}?tab=users`} className={pxLink}>{i.organisation.name}</Link> : "—"}</td><td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(i.createdAt, true)}</td><td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(i.expiresAt, true)}</td></tr>)}
            </Table>
          </div>
        ) : <p className="px-4 py-3 text-[13px] text-px-muted">None waiting.</p>}
      </PxPanel>
    </>
  );
}

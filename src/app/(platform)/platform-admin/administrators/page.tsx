import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { clientAdministrators } from "@/server/platform/accounts";
import { fmtDate } from "@/components/ui";
import { EmptyRow, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Administrators" };

export default async function AdministratorsPage() {
  const ctx = await requireCtx();
  const { admins, invites } = await clientAdministrators(ctx);
  return (
    <>
      <PxHeader title="Client Administrators" description="Each client's organisation administrators: the people who run their own users, branches and settings. They cannot see other clients or Evantix administration." />
      <PxPanel title={`Administrators (${admins.length})`}>
        <Table head={["Client", "Administrator", "Email", "Status", "Last active"]} empty={admins.length ? null : <EmptyRow>No client administrators yet.</EmptyRow>}>
          {admins.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/platform-admin/clients/${a.organisation.id}?tab=users`}>{a.organisation.name}</Link><span className="block font-mono text-[12px] text-[#5b6478]">{a.organisation.customerAccount?.reference ?? ""}</span></td>
              <td><Link href={`/platform-admin/users/${a.user.id}`} className="font-medium">{a.user.name}</Link>{a.jobTitle ? <span className="block text-[12px] text-[#5b6478]">{a.jobTitle}</span> : null}</td>
              <td>{a.user.email}</td>
              <td>{a.user.deactivatedAt ? <Pill value="SUSPENDED" label="Account deactivated" /> : a.deactivatedAt ? <Pill value="CLOSED" label="Deactivated" /> : <Pill value="ACTIVE" />}</td>
              <td>{fmtDate(a.user.sessions[0]?.lastSeenAt, true)}</td>
            </tr>
          ))}
        </Table>
      </PxPanel>
      <PxPanel title={`Administrator invitations waiting (${invites.length})`} className="mt-4">
        <Table head={["Client", "Invited", "Sent", "Valid until"]} empty={invites.length ? null : <EmptyRow>None waiting.</EmptyRow>}>
          {invites.map((i) => <tr key={i.id}><td>{i.organisation ? <Link href={`/platform-admin/clients/${i.organisation.id}?tab=users`}>{i.organisation.name}</Link> : "—"}</td><td>{i.name ?? ""} <span className="text-[#5b6478]">{i.email}</span></td><td>{fmtDate(i.createdAt, true)}</td><td>{fmtDate(i.expiresAt, true)}</td></tr>)}
        </Table>
      </PxPanel>
    </>
  );
}

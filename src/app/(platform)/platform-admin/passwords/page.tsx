import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { passwordOverview } from "@/server/platform/accounts";
import { getSetting } from "@/server/platform/settings";
import { Flash, fmtDate } from "@/components/ui";
import { Back, EmptyRow, KeyValues, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { revokeResetLinkAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Password Management" };

export default async function PasswordsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [{ links, required }, minLength, resetHours, perHour, inviteDays] = await Promise.all([passwordOverview(ctx), getSetting("auth.passwordMinLength"), getSetting("auth.resetExpiryHours"), getSetting("auth.resetLinksPerHour"), getSetting("auth.inviteExpiryDays")]);
  return (
    <>
      <PxHeader title="Password Management" description="Reset links created in the last 30 days and people who must choose a new password. To reset someone, open them from All Users. Passwords are stored only as secure hashes and are never visible." />
      <Flash searchParams={sp} />
      <OneTimeLink />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel title="Reset links">
          <Table head={["Created", "For", "Organisation", "Expires", "State", ""]} empty={links.length ? null : <EmptyRow>No reset links in the last 30 days.</EmptyRow>}>
            {links.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{fmtDate(l.createdAt, true)}</td>
                <td>{l.userId ? <Link href={`/platform-admin/users/${l.userId}`}>{l.name ?? l.email}</Link> : l.email}<span className="block text-[12px] text-[#5b6478]">{l.email}</span></td>
                <td>{l.organisation?.name ?? <span className="text-[#5b6478]">Platform recovery</span>}</td>
                <td className="whitespace-nowrap">{fmtDate(l.expiresAt, true)}</td>
                <td><Pill value={l.state} /></td>
                <td>{l.state === "active" ? <form action={revokeResetLinkAction}><Back value="/platform-admin/passwords" /><input type="hidden" name="tokenId" value={l.id} /><button className="text-[13px] text-[#a11d2b] underline">Revoke</button></form> : null}</td>
              </tr>
            ))}
          </Table>
        </PxPanel>
        <div className="space-y-4">
          <PxPanel title="Password policy" actions={<Link href="/platform-admin/settings#authentication" className="text-[13px]">Change</Link>}>
            <KeyValues items={[["Minimum length", `${minLength} characters`], ["Reset link lifetime", `${resetHours} hours`], ["Reset links per person per hour", String(perHour)], ["Invitation lifetime", `${inviteDays} days`], ["Storage", "bcrypt hash only"], ["After a reset", "Every session ends"]]} />
          </PxPanel>
          <PxPanel title={`New password required (${required.length})`}>
            {required.length ? <ul className="space-y-1 text-[13.5px]">{required.map((u) => <li key={u.id}><Link href={`/platform-admin/users/${u.id}`}>{u.name}</Link> <span className="text-[#5b6478]">{u.email}</span></li>)}</ul> : <p className="text-[13.5px] text-[#5b6478]">No one.</p>}
          </PxPanel>
        </div>
      </div>
    </>
  );
}

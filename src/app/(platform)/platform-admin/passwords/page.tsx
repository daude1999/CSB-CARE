import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { passwordOverview } from "@/server/platform/accounts";
import { getSetting } from "@/server/platform/settings";
import { fmtDate } from "@/components/ui";
import { Back, DetailRows, EmptyState, Pill, PxFlash, PxHeader, PxPanel, pxLink, pxPrimary, pxSecondary, pxSm, Table } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { revokeResetLinkAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Passwords" };

/** Password recovery across the platform: find a person to reset, recent reset links, and who must change password. */
export default async function PasswordsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [{ links, required }, minLength, resetHours, perHour, inviteDays] = await Promise.all([passwordOverview(ctx), getSetting("auth.passwordMinLength"), getSetting("auth.resetExpiryHours"), getSetting("auth.resetLinksPerHour"), getSetting("auth.inviteExpiryDays")]);
  return (
    <>
      <PxHeader title="Passwords" description="Reset links and password changes. Passwords are stored only as secure hashes and are never visible to anyone." />
      <PxFlash searchParams={sp} />
      <OneTimeLink />
      <PxPanel title="Reset someone's password" description="Find the person, then choose Create reset link on their account. The link is shown once, or emailed when email is set up." className="mb-4">
        <form method="get" action="/platform-admin/users" role="search" className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 basis-[260px]"><span className="sr-only">Name or email</span><input name="q" type="search" required placeholder="Name or email address" className="input" /></label>
          <button className={pxPrimary}>Find person</button>
        </form>
      </PxPanel>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel title="Reset links" description="Created in the last 30 days." flush>
          {links.length ? (
            <div className="px-4">
              <Table label="Reset links" minWidth={680} head={["Created", "For", "Organisation", "Expires", "State", ""]} align={["left", "left", "left", "left", "left", "right"]}>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-meta tabular-nums">{fmtDate(l.createdAt, true)}</td>
                    <td>{l.userId ? <Link href={`/platform-admin/users/${l.userId}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{l.name ?? l.email}</Link> : l.email}<span className="block text-caption text-px-muted">{l.email}</span></td>
                    <td className="text-meta">{l.organisation?.name ?? <span className="text-px-muted">Platform recovery</span>}</td>
                    <td className="whitespace-nowrap text-meta tabular-nums">{fmtDate(l.expiresAt, true)}</td>
                    <td><Pill value={l.state} /></td>
                    <td className="text-right">{l.state === "active" ? <form action={revokeResetLinkAction}><Back value="/platform-admin/passwords" /><input type="hidden" name="tokenId" value={l.id} /><button className={`${pxSecondary} ${pxSm}`}>Revoke</button></form> : null}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : <EmptyState title="No reset links in the last 30 days">Links you or a client&apos;s administrator create appear here with their state.</EmptyState>}
        </PxPanel>
        <div className="space-y-4">
          <PxPanel title="Password change due" description={`${required.length} ${required.length === 1 ? "person" : "people"}`} flush>
            {required.length ? <ul className="divide-y divide-px-row text-body">{required.map((u) => <li key={u.id} className="px-4 py-2"><Link href={`/platform-admin/users/${u.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{u.name}</Link><span className="block text-meta text-px-muted">{u.email}</span></li>)}</ul> : <p className="px-4 py-3 text-meta text-px-muted">No one.</p>}
          </PxPanel>
          <PxPanel title="Password policy" actions={<Link href="/platform-admin/settings?section=authentication" className={pxLink}>Change</Link>}>
            <DetailRows items={[["Minimum length", `${minLength} characters`], ["Reset link lifetime", `${resetHours} hours`], ["Reset links per hour", `${perHour} per person`], ["Invitation lifetime", `${inviteDays} days`], ["Stored as", "bcrypt hash only"], ["After a reset", "Every session ends"]]} />
          </PxPanel>
        </div>
      </div>
    </>
  );
}

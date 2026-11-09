import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { listAccounts, ORG_ROLE_NAMES, PAGE_SIZE, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { Flash, fmtDate, Pagination } from "@/components/ui";
import { EmptyRow, Pill, PxHeader, PxPanel, pxPrimary, pxSecondary, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "All Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ users, total }, orgs] = await Promise.all([
    listAccounts(ctx, { q: sp.q, org: sp.org, role: sp.role, status: sp.status, page }),
    db.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PxHeader title="All Users" description="Everyone who can sign in, across every client. Open a person to reset their password, change roles or branch access, end sessions or review their security history. Passwords are never shown." />
      <Flash searchParams={sp} />
      <form method="get" role="search" aria-label="Find users" className="mb-4 grid grid-cols-1 gap-2 rounded-[8px] border border-[#e4e7ef] bg-white p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <label><span className="label">Name or email</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label>
        <label><span className="label">Organisation</span><select name="org" defaultValue={sp.org ?? ""} className="input"><option value="">All organisations</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label><span className="label">Role</span><select name="role" defaultValue={sp.role ?? ""} className="input"><option value="">Any role</option><optgroup label="Organisation roles">{Object.entries(ORG_ROLE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup><optgroup label="Evantix platform roles">{Object.entries(PLATFORM_ROLE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup></select></label>
        <label><span className="label">Account status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any</option><option value="active">Active</option><option value="deactivated">Deactivated</option><option value="reset-required">New password required</option></select></label>
        <div className="flex items-end gap-2"><button className={pxPrimary}>Search</button><Link href="/platform-admin/users" className={pxSecondary}>Clear</Link></div>
      </form>
      <PxPanel>
        <Table label="Users" head={["Person", "Organisations and roles", "Status", "Last sign-in", "MFA", "Created"]} empty={users.length ? null : <EmptyRow>No one matches.</EmptyRow>}>
          {users.map((u) => (
            <tr key={u.id}>
              <td><Link href={`/platform-admin/users/${u.id}`} className="font-medium text-[#0f1b3d]">{u.name}</Link><span className="block text-[12.5px] text-[#5b6478]">{u.email}</span></td>
              <td className="text-[12.5px]">
                {u.platformRoles.length ? <span className="mb-0.5 block"><Tone tone="violet">Evantix: {u.platformRoles.map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES]).join(", ")}</Tone></span> : null}
                {u.memberships.map((m) => <span key={m.id} className={`block ${m.deactivatedAt ? "text-[#7a8294] line-through" : ""}`}>{m.organisation.name}: {m.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") || "no roles"}</span>)}
                {!u.memberships.length && !u.platformRoles.length ? <span className="text-[#7a8294]">No memberships</span> : null}
              </td>
              <td>{u.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : u.passwordResetRequired ? <Pill value="REQUESTED" label="New password required" /> : <Pill value="ACTIVE" />}{u.isDemo ? <span className="block text-[12px] text-[#5b6478]">Demo account</span> : null}</td>
              <td className="whitespace-nowrap">{fmtDate(u.lastSignIn, true)}</td>
              <td className="text-[12.5px] text-[#5b6478]">Not available</td>
              <td>{fmtDate(u.createdAt)}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/platform-admin/users" params={{ q: sp.q, org: sp.org, role: sp.role, status: sp.status }} />
        <p className="mt-2 text-[12px] text-[#5b6478]">MFA: the platform does not offer multi-factor sign-in yet, so no MFA status is shown.</p>
      </PxPanel>
    </>
  );
}

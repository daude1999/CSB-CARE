import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { listAccounts, ORG_ROLE_NAMES, PAGE_SIZE, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { fmtDate } from "@/components/ui";
import { EmptyState, Filter, listUrl, Pill, PxFlash, PxHeader, PxPagination, PxPanel, pxSecondary, pxSm, Table, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

/** Everyone who can sign in, across every client. A person opens in their own account workspace. */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ users, total }, orgs] = await Promise.all([
    listAccounts(ctx, { q: sp.q, org: sp.org, role: sp.role, status: sp.status, page }),
    db.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const filters = { q: sp.q, org: sp.org, role: sp.role, status: sp.status };
  const filtered = Boolean(sp.q || sp.org || sp.role || sp.status);
  const back = encodeURIComponent(listUrl("/platform-admin/users", { ...filters, page: page > 1 ? String(page) : undefined }));
  return (
    <>
      <PxHeader title="Users" description="Everyone who can sign in, across every client. Open a person to reset their password, change their access or end their sessions." />
      <PxFlash searchParams={sp} />
      <PxPanel flush>
        <form method="get" role="search" aria-label="Find users" className="flex flex-wrap items-end gap-2 border-b border-px-divider px-4 py-3">
          <Filter label="Search" grow><input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name or email" className="input" /></Filter>
          <Filter label="Organisation"><select name="org" defaultValue={sp.org ?? ""} className="input"><option value="">All organisations</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Filter>
          <Filter label="Role"><select name="role" defaultValue={sp.role ?? ""} className="input"><option value="">Any role</option><optgroup label="Organisation roles">{Object.entries(ORG_ROLE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup><optgroup label="Evantix platform roles">{Object.entries(PLATFORM_ROLE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup></select></Filter>
          <Filter label="Status"><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option><option value="active">Active</option><option value="deactivated">Deactivated</option><option value="reset-required">New password required</option></select></Filter>
          <div className="flex items-center gap-1.5"><button className={`${pxSecondary} ${pxSm}`}>Apply</button>{filtered ? <Link href="/platform-admin/users" className={`${pxSecondary} ${pxSm} !border-transparent !shadow-none`}>Clear</Link> : null}</div>
        </form>
        {users.length ? (
          <div className="px-4">
            <Table label="Users" minWidth={960} head={["User", "Email", "Organisation", "Role", "Status", "Last sign-in", ""]} align={["left", "left", "left", "left", "left", "left", "right"]}>
              {users.map((u) => {
                const live = u.memberships.filter((m) => !m.deactivatedAt);
                const first = live[0] ?? u.memberships[0];
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-px-row text-[11px] font-semibold text-px-body">{u.name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                        <span className="min-w-0">
                          <Link href={`/platform-admin/users/${u.id}?back=${back}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{u.name}</Link>
                          {u.isDemo ? <span className="ml-1.5 rounded-[4px] bg-px-row px-1 text-[11px] text-px-muted">Demo</span> : null}
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate text-px-body">{u.email}</td>
                    <td className="max-w-[220px] text-[13px]">
                      {u.platformRoles.length ? <Tone tone="violet">Evantix</Tone> : first ? <span className={first.deactivatedAt ? "text-px-subtle line-through" : ""}>{first.organisation.name}</span> : <span className="text-px-subtle">None</span>}
                      {live.length > 1 ? <span className="ml-1 text-[12px] text-px-muted">+{live.length - 1} more</span> : null}
                    </td>
                    <td className="max-w-[220px] text-[13px] text-px-body">
                      {u.platformRoles.length ? u.platformRoles.map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES]).join(", ") : first ? (first.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") || <span className="text-px-subtle">No roles</span>) : "—"}
                    </td>
                    <td>{u.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : u.passwordResetRequired ? <Pill value="REQUESTED" label="Password change due" /> : <Pill value="ACTIVE" />}</td>
                    <td className="whitespace-nowrap text-[13px] tabular-nums text-px-body">{u.lastSignIn ? fmtDate(u.lastSignIn, true) : <span className="text-px-subtle">Never</span>}</td>
                    <td className="text-right"><Link href={`/platform-admin/users/${u.id}?back=${back}`} className={`${pxSecondary} ${pxSm}`} aria-label={`Manage ${u.name}`}>Manage</Link></td>
                  </tr>
                );
              })}
            </Table>
          </div>
        ) : <EmptyState title={filtered ? "No one matches these filters" : "No users yet"} action={filtered ? <Link href="/platform-admin/users" className={pxSecondary}>Clear filters</Link> : undefined}>{filtered ? "Search by part of a name or email address." : "People appear here once a client's administrator accepts their invitation."}</EmptyState>}
        <PxPagination page={page} pageSize={PAGE_SIZE} total={total} base="/platform-admin/users" params={filters} noun="user" />
      </PxPanel>
      <p className="mt-3 text-[12px] text-px-subtle">Multi-factor sign-in is not available on the platform yet, so no MFA status is shown.</p>
    </>
  );
}

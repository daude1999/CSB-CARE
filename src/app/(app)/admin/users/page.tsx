import { cookies } from "next/headers";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { listMembers, ROLE_LABEL } from "@/server/admin/users";
import { createResetLinkAction, deactivateMemberAction, inviteMemberAction, reactivateMemberAction, revokeInviteAction, updateMemberAction } from "@/app/admin-actions";
import { ONE_TIME_LINK_COOKIE } from "@/app/admin-link";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";
import { notFound } from "next/navigation";
import type { OrgRole } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Users: who can sign in to this organisation, with what roles and in which branches. Invitations and password
 * resets are one-time links the administrator passes on in person; nothing is emailed.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const status = sp.status === "deactivated" || sp.status === "all" ? sp.status : "active";
  const { members, invites, branches } = await orNotFound(listMembers(ctx, { q: sp.q, status }));
  const link = (await cookies()).get(ONE_TIME_LINK_COOKIE)?.value ?? null;
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const back = `/admin/users?status=${status}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;
  const roles = Object.entries(ROLE_LABEL) as [OrgRole, string][];

  return (
    <>
      <PageHeader title="Users" back="/settings" subtitle="Everyone who can sign in to your organisation, their roles and the branches they work in. A member with no branches ticked can work in every branch." />
      <Flash searchParams={sp} />
      {link ? (
        <section aria-label="One-time link" className="panel mb-3 border-l-4 border-l-teal-500">
          <p className="text-[14px] font-medium">Give this link to the person yourself. It works once and is shown here for two minutes only.</p>
          <p className="mt-1 break-all rounded bg-slate-50 px-2 py-1 font-mono text-[13px]" data-testid="one-time-link">{link}</p>
          <p className="mt-1 text-[12.5px] text-slate-600">Nothing has been emailed. Anyone with the link can use it, so do not post it in a shared channel.</p>
        </section>
      ) : null}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <SegmentNav label="Member status" items={[
            { href: "/admin/users?status=active", label: "Active", active: status === "active" },
            { href: "/admin/users?status=deactivated", label: "Deactivated", active: status === "deactivated" },
            { href: "/admin/users?status=all", label: "All", active: status === "all" },
          ]} />
          <form method="get" className="panel flex flex-wrap items-end gap-2">
            <input type="hidden" name="status" value={status} />
            <label className="min-w-0 flex-1"><span className="label">Name or email</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label>
            <button className="btn-primary">Search</button>
            <Link href="/admin/users" className="btn-secondary">Clear</Link>
          </form>
          <Card>
            {members.length ? (
              <ul className="rows">
                {members.map((m) => (
                  <li key={m.id} className="py-3 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-navy-900">{m.name}</span>
                      <span className="text-slate-600">{m.email}</span>
                      {m.deactivatedAt ? <Badge tone="slate">Deactivated {fmtDate(m.deactivatedAt)}</Badge> : null}
                      {m.userId === ctx.userId ? <Badge tone="violet">You</Badge> : null}
                      <span className="ml-auto text-[12.5px] text-slate-500">{m.lastSeenAt ? `last active ${fmtDate(m.lastSeenAt, true)}` : "not signed in yet"}</span>
                    </div>
                    <p className="text-[13.5px] text-slate-700">{m.roles.length ? m.roles.map((r) => ROLE_LABEL[r]).join(", ") : "No roles"}{m.jobTitle ? ` · ${m.jobTitle}` : ""} · {m.branchIds.length ? m.branchIds.map((b) => branchName.get(b) ?? "Branch").join(", ") : "all branches"}</p>
                    {m.deactivatedAt ? (
                      <form action={reactivateMemberAction} className="mt-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="membershipId" value={m.id} /><button className="btn-secondary py-1">Reactivate</button></form>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <details className="w-full">
                          <summary className="btn-secondary inline-block cursor-pointer py-1">Roles and branches</summary>
                          <form action={updateMemberAction} className="mt-2 space-y-2 rounded-md border border-slate-200 p-3">
                            <input type="hidden" name="back" value={back} /><input type="hidden" name="membershipId" value={m.id} />
                            <MemberFields roles={roles} branches={branches} selectedRoles={m.roles} selectedBranches={m.branchIds} jobTitle={m.jobTitle} />
                            <button className="btn-primary">Save</button>
                          </form>
                        </details>
                        {m.userId !== ctx.userId ? (
                          <>
                            <form action={createResetLinkAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="membershipId" value={m.id} /><button className="btn-secondary py-1">Password reset link</button></form>
                            <details>
                              <summary className="btn-secondary inline-block cursor-pointer py-1">Deactivate</summary>
                              <form action={deactivateMemberAction} className="mt-2 flex flex-wrap gap-2">
                                <input type="hidden" name="back" value={back} /><input type="hidden" name="membershipId" value={m.id} />
                                <input name="reason" required minLength={3} className="input py-1" placeholder="Why" aria-label={`Why ${m.name} is being deactivated`} />
                                <button className="btn-danger py-1">Deactivate</button>
                              </form>
                            </details>
                          </>
                        ) : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty>No members match.</Empty>}
          </Card>
        </div>
        <aside className="space-y-3">
          <Card title="Invite someone">
            <form action={inviteMemberAction} className="space-y-2">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">Name</span><input name="name" required minLength={2} className="input" /></label>
              <label className="block"><span className="label">Email</span><input name="email" type="email" required className="input" /></label>
              <MemberFields roles={roles} branches={branches} selectedRoles={[]} selectedBranches={[]} jobTitle={null} />
              <button className="btn-primary">Create invitation link</button>
              <p className="text-[12.5px] text-slate-600">The link lasts seven days. The person chooses their own password.</p>
            </form>
          </Card>
          <Card title="Open invitations">
            {invites.length ? (
              <ul className="rows text-[14px]">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">{i.name ?? i.email}</span><span className="block text-[12.5px] text-slate-600">{i.email} · until {fmtDate(i.expiresAt)}</span></span>
                    <form action={revokeInviteAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="inviteId" value={i.id} /><button className="btn-secondary py-1">Revoke</button></form>
                  </li>
                ))}
              </ul>
            ) : <Empty>No open invitations.</Empty>}
          </Card>
        </aside>
      </div>
    </>
  );
}

function MemberFields({ roles, branches, selectedRoles, selectedBranches, jobTitle }: { roles: [OrgRole, string][]; branches: { id: string; name: string }[]; selectedRoles: OrgRole[]; selectedBranches: string[]; jobTitle: string | null }) {
  return (
    <>
      <fieldset>
        <legend className="label">Roles</legend>
        <div className="grid grid-cols-2 gap-1 text-[13.5px]">
          {roles.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="roles" value={k} defaultChecked={selectedRoles.includes(k)} />{l}</label>)}
        </div>
      </fieldset>
      {branches.length ? (
        <fieldset>
          <legend className="label">Branches (none ticked means all)</legend>
          <div className="grid grid-cols-2 gap-1 text-[13.5px]">
            {branches.map((b) => <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" name="branchIds" value={b.id} defaultChecked={selectedBranches.includes(b.id)} />{b.name}</label>)}
          </div>
        </fieldset>
      ) : null}
      <label className="block"><span className="label">Job title</span><input name="jobTitle" defaultValue={jobTitle ?? ""} maxLength={120} className="input" /></label>
    </>
  );
}

import type { OrgRole } from "@prisma/client";
import { Key } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getAccount, ORG_PERMISSIONS, ORG_ROLE_NAMES, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { actionLabel, actionTone } from "@/server/platform/activity";
import { effectivePermissions, permissionCatalogue } from "@/server/platform/permissions";
import { emailProvider } from "@/server/notifications/email";
import { fmtDate } from "@/components/ui";
import { Back, Confirm, DetailRows, EmptyRow, PasswordField, Pill, PxDrawer, PxFlash, PxHeader, PxPanel, pxDanger, pxLink, pxPrimary, pxSecondary, pxSm, ReasonField, returnTo, Table, Tone } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { RoleEditor } from "@/components/platform/role-editor";
import {
  deactivateAccountAction, platformDeactivateMemberAction, platformMemberAction, platformReactivateMemberAction, platformResetAction, platformRolesAction, reactivateAccountAction,
  requireResetAction, revokeResetLinksAction, revokeSessionAction, revokeSessionsAction,
} from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

const SECTIONS = [["details", "Account details"], ["access", "Access"], ["security", "Security"], ["administration", "Administration"]] as const;

/**
 * One person's account workspace: details, access (each organisation changed on its own, in a side panel), security
 * (password recovery, sessions, history) and administration (platform roles, deactivation).
 */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const a = await orNotFound(getAccount(ctx, id));
  const listBack = returnTo(sp.back, "/platform-admin/users");
  const keep = sp.back ? `?back=${encodeURIComponent(listBack)}` : "";
  const here = `/platform-admin/users/${id}${keep}`;
  const withEdit = (q: string) => `${here}${keep ? "&" : "?"}${q}`;
  const roles = Object.entries(ORG_ROLE_NAMES) as [OrgRole, string][];
  const map: Record<string, string[]> = {};
  for (const [perm, rs] of Object.entries(ORG_PERMISSIONS)) for (const r of rs as readonly string[]) (map[r] ??= []).push(perm);
  const self = a.id === ctx.userId;
  const canEmail = emailProvider().name === "smtp";
  const canReset = !a.deactivatedAt && !a.isDemo;
  const uid = <input type="hidden" name="userId" value={a.id} />;
  const resets = a.tokens.filter((t) => t.kind === "RESET");
  const editing = sp.edit === "member" ? a.memberships.find((m) => m.id === sp.member) : undefined;
  return (
    <>
      <PxHeader
        crumbs={[{ href: listBack, label: "Users" }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{a.name}{a.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : a.passwordResetRequired ? <Pill value="REQUESTED" label="Password change due" /> : <Pill value="ACTIVE" />}{a.platformRoles.length ? <Tone tone="violet">Evantix staff</Tone> : null}</span>}
        meta={<><span>{a.email}</span><span>{a.memberships.filter((m) => !m.deactivatedAt).length} organisation{a.memberships.length === 1 ? "" : "s"}</span><span>Last sign-in {a.lastSignIn ? fmtDate(a.lastSignIn, true) : "never"}</span>{self ? <span>This is you</span> : null}</>}
        actions={canReset ? (
          <form action={platformResetAction}><Back value={here} />{uid}<input type="hidden" name="delivery" value="show" /><button className={pxPrimary}><Key size={15} aria-hidden="true" />Create reset link</button></form>
        ) : undefined}
      />
      <PxFlash searchParams={sp} />
      <OneTimeLink />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Account sections" className="hidden lg:sticky lg:top-24 lg:block">
          <ul className="space-y-0.5 border-l border-px-line">
            {SECTIONS.map(([k, l]) => <li key={k}><a href={`#${k}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-3 text-body text-px-muted no-underline hover:border-px-faint hover:text-px-ink">{l}</a></li>)}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          <PxPanel id="details" title="Account details">
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              <DetailRows items={[["Name", a.name], ["Email", a.email], ["Created", fmtDate(a.createdAt)], ["Demo account", a.isDemo ? "Yes (keeps the shared demo password)" : "No"]]} />
              <DetailRows items={[["Password", a.hasPassword ? "Set by the person, never visible" : "Not set yet"], ["Last sign-in", fmtDate(a.lastSignIn, true)], ["Signed in now", `${a.sessions.length} session${a.sessions.length === 1 ? "" : "s"}`], ["Multi-factor sign-in", <span key="m" className="text-px-muted">Not available yet</span>]]} />
            </div>
          </PxPanel>

          <PxPanel id="access" title="Access" description="Each organisation is changed on its own. Changing one never alters the person's access to another." flush>
            {a.memberships.length ? (
              <ul className="divide-y divide-px-row">
                {a.memberships.map((m) => {
                  const branches = a.branches.filter((b) => b.organisationId === m.organisation.id);
                  const chosen = branches.filter((b) => m.branches.some((x) => x.branchId === b.id)).map((b) => b.name);
                  return (
                    <li key={m.id} className="px-4 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-body"><Link href={`/platform-admin/clients/${m.organisation.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{m.organisation.name}</Link>{m.organisation.customerAccount ? <span className="font-mono text-caption text-px-subtle">{m.organisation.customerAccount.reference}</span> : null}{m.deactivatedAt ? <Pill value="CLOSED" label="Removed" /> : null}</p>
                          <p className="mt-0.5 text-meta text-px-body">{m.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") || "No roles"}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</p>
                          <p className="text-meta text-px-muted">Branches: {m.branches.length ? chosen.join(", ") : "all"}</p>
                        </div>
                        {m.deactivatedAt ? (
                          <form action={platformReactivateMemberAction}><Back value={here} /><input type="hidden" name="organisationId" value={m.organisation.id} /><input type="hidden" name="membershipId" value={m.id} /><button className={`${pxSecondary} ${pxSm}`}>Reactivate</button></form>
                        ) : <Link href={withEdit(`edit=member&member=${m.id}`)} scroll={false} className={`${pxSecondary} ${pxSm}`}>Change access</Link>}
                      </div>
                      <details className="mt-2 text-meta">
                        <summary className="cursor-pointer text-px-accent">Effective permissions in {m.organisation.name}</summary>
                        <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">{effectivePermissions(m.roles).map((g) => <li key={g.group} className="flex justify-between gap-2 border-b border-px-row pb-1"><span>{g.group}</span><span className={g.level === "No access" ? "text-px-subtle" : "font-medium text-px-ink"}>{g.level}</span></li>)}</ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyRow>No organisation memberships.</EmptyRow>}
          </PxPanel>

          <section id="security" aria-label="Security" className="scroll-mt-24 space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <PxPanel title="Password" description="Platform-level recovery. Works for people in several organisations, whose own administrators cannot reset them.">
                {a.deactivatedAt ? <p className="text-body text-px-muted">Reactivate the account first.</p> : a.isDemo ? <p className="text-body text-px-muted">Demo accounts keep the shared demo password.</p> : (
                  <div className="flex flex-wrap gap-2">
                    <form action={platformResetAction}><Back value={here} />{uid}<input type="hidden" name="delivery" value="show" /><button className={pxPrimary}>Create reset link</button></form>
                    {canEmail ? <form action={platformResetAction}><Back value={here} />{uid}<input type="hidden" name="delivery" value="email" /><button className={pxSecondary}>Email the link</button></form> : null}
                    {!self ? (
                      <Confirm label="Require a new password" tone="danger">
                        <form action={requireResetAction} className="space-y-2"><Back value={here} />{uid}<p className="text-meta text-px-muted">Signs them out everywhere and blocks the old password until they use a new link.</p><ReasonField /><button className={pxDanger}>Require new password</button></form>
                      </Confirm>
                    ) : null}
                  </div>
                )}
                {!canEmail && canReset ? <p className="mt-2 text-meta text-px-muted">Email is not configured, so the link is shown once for you to hand over.</p> : null}
                <h3 className="mb-1 mt-4 text-meta font-medium text-px-muted">Reset links</h3>
                {resets.length ? <ul className="-my-1 divide-y divide-px-row text-meta">{resets.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 py-1.5"><span className="tabular-nums">{fmtDate(t.createdAt, true)}</span><Pill value={t.state} /></li>)}</ul> : <p className="text-meta text-px-muted">None.</p>}
                {resets.some((t) => t.state === "active") ? <form action={revokeResetLinksAction} className="mt-2"><Back value={here} />{uid}<button className={`${pxSecondary} ${pxSm}`}>Revoke unused links</button></form> : null}
              </PxPanel>
              <PxPanel title="Sessions" description={`${a.sessions.length} active`} actions={a.sessions.length ? <Confirm small label="Sign out everywhere"><form action={revokeSessionsAction} className="w-[260px] space-y-2"><Back value={here} />{uid}<ReasonField /><button className={pxDanger}>Sign out of {a.sessions.length}</button></form></Confirm> : null} flush>
                {a.sessions.length ? (
                  <ul className="divide-y divide-px-row">
                    {a.sessions.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-meta">
                        <span className="min-w-0">
                          <span className="block text-px-ink">{a.memberships.find((m) => m.organisation.id === s.activeOrgId)?.organisation.name ?? "Admin Centre"}</span>
                          <span className="block text-caption text-px-muted">Active {fmtDate(s.lastSeenAt, true)} · {s.ip ?? "unknown network"}</span>
                          {s.userAgent ? <span className="block max-w-[320px] truncate text-caption text-px-subtle">{s.userAgent}</span> : null}
                        </span>
                        <form action={revokeSessionAction}><Back value={here} /><input type="hidden" name="sessionId" value={s.id} /><button className={`${pxSecondary} ${pxSm}`}>End</button></form>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyRow>Not signed in anywhere.</EmptyRow>}
              </PxPanel>
            </div>
            <PxPanel title="Security history" flush>
              {a.history.length ? (
                <div className="px-4">
                  <Table label="Security history" minWidth={520} head={["When", "Event", "Details"]}>
                    {a.history.map((h) => {
                      const d = (h.data && typeof h.data === "object" && !Array.isArray(h.data) ? h.data : {}) as Record<string, unknown>;
                      return <tr key={h.id}><td className="whitespace-nowrap text-meta tabular-nums">{fmtDate(h.createdAt, true)}</td><td><Tone tone={actionTone(h.action)}>{actionLabel(h.action)}</Tone></td><td className="text-meta text-px-body">{typeof d.reason === "string" ? `Reason: ${d.reason}` : ""}{d.outcome === "blocked" ? " Blocked" : ""}</td></tr>;
                    })}
                  </Table>
                </div>
              ) : <EmptyRow>Nothing recorded yet.</EmptyRow>}
            </PxPanel>
          </section>

          <PxPanel id="administration" title="Administration">
            <div className="divide-y divide-px-row">
              <div className="grid grid-cols-1 gap-3 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:gap-8">
                <div><p className="text-body font-medium text-px-ink">Evantix platform roles</p><p className="mt-0.5 text-meta leading-[18px] text-px-muted">Only platform administrators change these, with their password. At least one platform administrator always remains. Organisation administrators can never grant them.</p></div>
                <form action={platformRolesAction} className="space-y-2">
                  <Back value={here} />{uid}
                  <div className="space-y-1.5">{Object.entries(PLATFORM_ROLE_NAMES).map(([v, l]) => <label key={v} className="flex items-center gap-2 text-body"><input type="checkbox" name="platformRoles" value={v} defaultChecked={a.platformRoles.includes(v as never)} />{l}</label>)}</div>
                  <ReasonField />
                  <PasswordField />
                  <button className={pxSecondary}>Save platform roles</button>
                </form>
              </div>
              <div className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:gap-8">
                <div><p className="text-body font-medium text-px-ink">{a.deactivatedAt ? "Reactivate account" : "Deactivate account"}</p><p className="mt-0.5 text-meta leading-[18px] text-px-muted">{a.deactivatedAt ? `Deactivated ${fmtDate(a.deactivatedAt, true)}. Reactivating restores sign-in with the same memberships.` : "Stops sign-in to every organisation and ends all sessions and links. Memberships and history are kept."}</p></div>
                <div>
                  {a.deactivatedAt ? (
                    <form action={reactivateAccountAction} className="space-y-2"><Back value={here} />{uid}<ReasonField /><button className={pxPrimary}>Reactivate account</button></form>
                  ) : self ? <p className="text-meta text-px-muted">You cannot deactivate your own account.</p> : (
                    <Confirm label="Deactivate account" tone="danger">
                      <form action={deactivateAccountAction} className="space-y-2"><Back value={here} />{uid}<ReasonField /><PasswordField /><button className={pxDanger}>Deactivate account</button></form>
                    </Confirm>
                  )}
                </div>
              </div>
            </div>
          </PxPanel>
        </div>
      </div>
      {editing ? (
        <PxDrawer closeHref={here} title={`Access to ${editing.organisation.name}`} description={<>{a.name}. Changes apply to this organisation only and take effect at their next click.</>}>
          {editing.deactivatedAt ? <p className="text-body text-px-muted">This membership is removed. Reactivate it first.</p> : (
            <>
              <form action={platformMemberAction} className="space-y-3">
                <Back value={here} /><input type="hidden" name="organisationId" value={editing.organisation.id} /><input type="hidden" name="membershipId" value={editing.id} />
                <RoleEditor idPrefix={editing.id} roles={roles} branches={a.branches.filter((b) => b.organisationId === editing.organisation.id)} selectedRoles={editing.roles} selectedBranches={editing.branches.map((b) => b.branchId)} jobTitle={editing.jobTitle} rolePermissions={map} catalogue={permissionCatalogue()} />
                <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-2 border-t border-px-line bg-white px-5 py-3"><Link href={here} scroll={false} className={pxSecondary}>Cancel</Link><button className={pxPrimary}>Save access</button></div>
              </form>
              <div className="mt-6 border-t border-px-line pt-4">
                <h3 className="text-body font-semibold text-px-ink">Remove from {editing.organisation.name}</h3>
                <p className="mb-2 mt-0.5 text-meta text-px-muted">Their roles are kept so the membership can be reactivated.</p>
                <Confirm label="Remove access" tone="danger">
                  <form action={platformDeactivateMemberAction} className="space-y-2"><Back value={here} /><input type="hidden" name="organisationId" value={editing.organisation.id} /><input type="hidden" name="membershipId" value={editing.id} /><ReasonField /><button className={pxDanger}>Remove access</button></form>
                </Confirm>
              </div>
              <p className="mt-4 text-meta"><Link href={`/platform-admin/clients/${editing.organisation.id}?tab=users`} className={pxLink}>Open {editing.organisation.name}&apos;s people</Link></p>
            </>
          )}
        </PxDrawer>
      ) : null}
    </>
  );
}

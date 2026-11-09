import type { OrgRole } from "@prisma/client";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getAccount, ORG_PERMISSIONS, ORG_ROLE_NAMES, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { actionLabel, actionTone } from "@/server/platform/activity";
import { effectivePermissions } from "@/server/platform/permissions";
import { emailProvider } from "@/server/notifications/email";
import { Flash, fmtDate } from "@/components/ui";
import { Back, Confirm, EmptyRow, KeyValues, PasswordField, Pill, PxHeader, PxPanel, pxDanger, pxPrimary, pxSecondary, ReasonField, Table, Tone } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { RoleEditor } from "@/components/platform/role-editor";
import {
  deactivateAccountAction, platformDeactivateMemberAction, platformMemberAction, platformReactivateMemberAction, platformResetAction, platformRolesAction, reactivateAccountAction,
  requireResetAction, revokeResetLinksAction, revokeSessionAction, revokeSessionsAction,
} from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

/** One person's account: memberships (changed one organisation at a time), password recovery, sessions and security history. */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const a = await orNotFound(getAccount(ctx, id));
  const back = `/platform-admin/users/${id}`;
  const roles = Object.entries(ORG_ROLE_NAMES) as [OrgRole, string][];
  const map: Record<string, string[]> = {};
  for (const [perm, rs] of Object.entries(ORG_PERMISSIONS)) for (const r of rs as readonly string[]) (map[r] ??= []).push(perm);
  const self = a.id === ctx.userId;
  const canEmail = emailProvider().name === "smtp";
  const uid = <input type="hidden" name="userId" value={a.id} />;
  return (
    <>
      <PxHeader
        crumbs={[{ href: "/platform-admin/users", label: "All Users" }]}
        title={<span className="flex flex-wrap items-center gap-3">{a.name}{a.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : a.passwordResetRequired ? <Pill value="REQUESTED" label="New password required" /> : <Pill value="ACTIVE" />}</span>}
        description={<>{a.email}{a.multiOrg ? ` · member of ${a.memberships.length} organisations` : ""}{self ? " · this is you" : ""}</>}
      />
      <Flash searchParams={sp} />
      <OneTimeLink />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <PxPanel title="Account">
            <KeyValues items={[
              ["Created", fmtDate(a.createdAt)], ["Last sign-in", fmtDate(a.lastSignIn, true)], ["Password", a.hasPassword ? "Set by the person (never visible)" : "Not set yet"],
              ["Multi-factor sign-in", "Not available on this platform yet"], ["Evantix platform roles", a.platformRoles.length ? a.platformRoles.map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES]).join(", ") : "None"], ["Demo account", a.isDemo ? "Yes (keeps the shared demo password)" : "No"],
            ]} />
          </PxPanel>
          <PxPanel title={`Organisation memberships (${a.memberships.length})`} description="Each membership is changed on its own. Changing one never alters the person's access to another organisation.">
            {a.memberships.length ? (
              <ul className="divide-y divide-[#f1f2f6]">
                {a.memberships.map((m) => {
                  const branches = a.branches.filter((b) => b.organisationId === m.organisation.id);
                  const mback = back;
                  return (
                    <li key={m.id} className="py-3 text-[13.5px]">
                      <p className="flex flex-wrap items-center gap-2"><Link href={`/platform-admin/clients/${m.organisation.id}`} className="font-medium">{m.organisation.name}</Link>{m.organisation.customerAccount ? <Pill value={m.organisation.customerAccount.status} /> : null}{m.deactivatedAt ? <Pill value="CLOSED" label="Membership deactivated" /> : null}</p>
                      <p className="text-[#46505f]">{m.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") || "No roles"}{m.jobTitle ? ` · ${m.jobTitle}` : ""} · {m.branches.length ? branches.filter((b) => m.branches.some((x) => x.branchId === b.id)).map((b) => b.name).join(", ") : "all branches"}</p>
                      <details className="mt-1 text-[12.5px]"><summary className="cursor-pointer text-[#3b1a86]">Effective permissions here</summary>
                        <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">{effectivePermissions(m.roles).map((g) => <li key={g.group} className="flex justify-between gap-2"><span>{g.group}</span><span className={g.level === "No access" ? "text-[#7a8294]" : ""}>{g.level}</span></li>)}</ul>
                      </details>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.deactivatedAt ? (
                          <form action={platformReactivateMemberAction}><Back value={mback} /><input type="hidden" name="organisationId" value={m.organisation.id} /><input type="hidden" name="membershipId" value={m.id} /><button className={`${pxSecondary} !py-1 text-[13px]`}>Reactivate membership</button></form>
                        ) : (
                          <>
                            <Confirm label="Roles & branch access">
                              <form action={platformMemberAction} className="space-y-3">
                                <Back value={mback} /><input type="hidden" name="organisationId" value={m.organisation.id} /><input type="hidden" name="membershipId" value={m.id} />
                                <RoleEditor idPrefix={m.id} roles={roles} branches={branches} selectedRoles={m.roles} selectedBranches={m.branches.map((b) => b.branchId)} jobTitle={m.jobTitle} rolePermissions={map} />
                                <button className={pxPrimary}>Save for {m.organisation.name}</button>
                              </form>
                            </Confirm>
                            <Confirm label="Deactivate in this organisation" tone="danger">
                              <form action={platformDeactivateMemberAction} className="space-y-2"><Back value={mback} /><input type="hidden" name="organisationId" value={m.organisation.id} /><input type="hidden" name="membershipId" value={m.id} /><ReasonField /><button className={pxDanger}>Deactivate membership</button></form>
                            </Confirm>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyRow>No organisation memberships.</EmptyRow>}
          </PxPanel>
          <PxPanel title={`Sessions (${a.sessions.length})`}>
            <Table head={["Signed in", "Last active", "Ends", "Organisation", "Device", ""]} empty={a.sessions.length ? null : <EmptyRow>Not signed in anywhere.</EmptyRow>}>
              {a.sessions.map((s) => (
                <tr key={s.id}><td>{fmtDate(s.createdAt, true)}</td><td>{fmtDate(s.lastSeenAt, true)}</td><td>{fmtDate(s.expiresAt, true)}</td><td>{a.memberships.find((m) => m.organisation.id === s.activeOrgId)?.organisation.name ?? "—"}</td><td className="text-[12px] text-[#5b6478]">{s.ip ?? "—"}<span className="block max-w-[200px] truncate">{s.userAgent ?? ""}</span></td><td><form action={revokeSessionAction}><Back value={back} /><input type="hidden" name="sessionId" value={s.id} /><button className="text-[13px] text-[#a11d2b] underline">End</button></form></td></tr>
              ))}
            </Table>
          </PxPanel>
          <PxPanel title="Security history">
            <Table head={["When", "Event", "Details"]} empty={a.history.length ? null : <EmptyRow>Nothing recorded yet.</EmptyRow>}>
              {a.history.map((h) => {
                const d = (h.data && typeof h.data === "object" && !Array.isArray(h.data) ? h.data : {}) as Record<string, unknown>;
                return <tr key={h.id}><td className="whitespace-nowrap">{fmtDate(h.createdAt, true)}</td><td><Tone tone={actionTone(h.action)}>{actionLabel(h.action)}</Tone></td><td className="text-[12.5px] text-[#46505f]">{typeof d.reason === "string" ? `Reason: ${d.reason}` : ""}{d.outcome === "blocked" ? " Blocked" : ""}</td></tr>;
              })}
            </Table>
          </PxPanel>
        </div>
        <div className="space-y-4">
          <PxPanel title="Password" description="Platform-level account recovery. It also works for people in several organisations, whose own administrators cannot reset them.">
            {a.deactivatedAt ? <p className="text-[13.5px] text-[#5b6478]">Reactivate the account first.</p> : a.isDemo ? <p className="text-[13.5px] text-[#5b6478]">Demo accounts keep the shared demo password.</p> : (
              <div className="space-y-3">
                <form action={platformResetAction} className="flex flex-wrap gap-2"><Back value={back} />{uid}<input type="hidden" name="delivery" value="show" /><button className={pxPrimary}>Reset password (show link once)</button></form>
                {canEmail ? <form action={platformResetAction}><Back value={back} />{uid}<input type="hidden" name="delivery" value="email" /><button className={pxSecondary}>Email reset link to {a.email}</button></form> : <p className="text-[12.5px] text-[#5b6478]">Email is not configured, so links are handed over in person.</p>}
                {!self ? (
                  <Confirm label="Require a new password" tone="danger">
                    <form action={requireResetAction} className="space-y-2"><Back value={back} />{uid}<p className="text-[12.5px] text-[#5b6478]">Signs them out everywhere and blocks sign-in with the old password until they use the new link.</p><ReasonField /><button className={pxDanger}>Require new password</button></form>
                  </Confirm>
                ) : null}
              </div>
            )}
            <h3 className="mb-1 mt-4 text-[13px] font-semibold">Reset links</h3>
            {a.tokens.filter((t) => t.kind === "RESET").length ? (
              <ul className="space-y-1 text-[12.5px]">{a.tokens.filter((t) => t.kind === "RESET").map((t) => <li key={t.id} className="flex justify-between gap-2"><span>{fmtDate(t.createdAt, true)}</span><Pill value={t.state} /></li>)}</ul>
            ) : <p className="text-[12.5px] text-[#5b6478]">None.</p>}
            {a.tokens.some((t) => t.kind === "RESET" && t.state === "active") ? <form action={revokeResetLinksAction} className="mt-2"><Back value={back} />{uid}<button className="text-[13px] text-[#a11d2b] underline">Revoke unused reset links</button></form> : null}
          </PxPanel>
          <PxPanel title="Sessions">
            <Confirm label="Sign out everywhere"><form action={revokeSessionsAction} className="space-y-2"><Back value={back} />{uid}<ReasonField /><button className={pxDanger}>Sign out of {a.sessions.length} session(s)</button></form></Confirm>
          </PxPanel>
          <PxPanel title="Evantix platform roles" description="Only platform administrators can change these. Needs your password; at least one platform administrator always remains.">
            <form action={platformRolesAction} className="space-y-2">
              <Back value={back} />{uid}
              {Object.entries(PLATFORM_ROLE_NAMES).map(([v, l]) => <label key={v} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="platformRoles" value={v} defaultChecked={a.platformRoles.includes(v as never)} />{l}</label>)}
              <ReasonField />
              <PasswordField />
              <button className={pxSecondary}>Save platform roles</button>
            </form>
          </PxPanel>
          <PxPanel title="Account status">
            {a.deactivatedAt ? (
              <form action={reactivateAccountAction} className="space-y-2"><Back value={back} />{uid}<p className="text-[13px]">Deactivated {fmtDate(a.deactivatedAt, true)}.</p><ReasonField /><button className={pxPrimary}>Reactivate account</button></form>
            ) : self ? <p className="text-[13px] text-[#5b6478]">You cannot deactivate your own account.</p> : (
              <Confirm label="Deactivate account" tone="danger">
                <form action={deactivateAccountAction} className="space-y-2"><Back value={back} />{uid}<p className="text-[12.5px] text-[#5b6478]">Stops sign-in to every organisation and ends all sessions and links. Memberships and history are kept.</p><ReasonField /><PasswordField /><button className={pxDanger}>Deactivate account</button></form>
              </Confirm>
            )}
          </PxPanel>
        </div>
      </div>
    </>
  );
}

import type { OrgRole } from "@prisma/client";
import Link from "@/components/link";
import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import type { getClient } from "@/server/platform/customers";
import { clientBranches } from "@/server/platform/customers";
import { clientMembers, ORG_PERMISSIONS, ORG_ROLE_NAMES, tokenState } from "@/server/platform/accounts";
import { listPlans, subscriptionHistory } from "@/server/platform/subscriptions";
import { aiUsage, storageGrowth } from "@/server/platform/usage";
import { clientAudit } from "@/server/platform/activity";
import { activeSupportGrant, listSupportGrants, SUPPORT_SCOPES, supportConfigurationView } from "@/server/platform/support";
import { effectivePermissions } from "@/server/platform/permissions";
import { MODULES } from "@/lib/platform-modules";
import { fmtDate } from "@/components/ui";
import { Back, Confirm, EmptyRow, fmtBytes, fmtMoney, fmtNumber, KeyValues, NotConfigured, PasswordField, Pill, PxPanel, pxDanger, pxPrimary, pxSecondary, ReasonField, Table, Tone } from "@/components/platform/ui";
import { RoleEditor } from "@/components/platform/role-editor";
import {
  addClientBranchAction, changeSubscriptionAction, customerStatusAction, emergencySupportAction, extendTrialAction, markCqcCheckedAction, moduleLimitsAction, platformDeactivateMemberAction,
  platformInviteAction, platformMemberAction, platformReactivateMemberAction, platformRevokeInviteAction, requestSupportAction, revokeSupportAction, setModuleAction, updateCompanyAction,
} from "@/app/platform-actions";

type Client = Awaited<ReturnType<typeof getClient>>;
interface P { ctx: Ctx; client: Client; back: string; sp: Record<string, string | undefined> }

const Hidden = ({ id, back }: { id: string; back: string }) => (<><input type="hidden" name="organisationId" value={id} /><Back value={back} /></>);
const SERVICE_TYPES = ["Domiciliary care", "Supported living", "Live-in care", "Extra care housing", "Residential care", "Nursing care", "Day services"];
const dateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export function OverviewTab({ client }: P) {
  const { account: a, subscription: s, usage: u, modules, admins } = client;
  const on = modules.filter((m) => m.enabled);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <PxPanel title="Usage" description="Counted from records. Content is not shown.">
          <KeyValues items={[
            ["Active users", fmtNumber(u.users)],
            ["Branches", fmtNumber(u.branches)],
            ["Service user records", fmtNumber(u.serviceUsers)],
            ["Visits", fmtNumber(u.visits)],
            ["Stored files", `${fmtNumber(u.storage.files)} · ${fmtBytes(u.storage.bytes)}`],
            ["AI requests this month", fmtNumber(u.aiThisMonth)],
          ]} />
        </PxPanel>
        <PxPanel title="Modules" actions={<Link href="?tab=modules" className="text-[13px]">Manage modules</Link>}>
          <p className="text-[13.5px]">{on.length} of {modules.length} on: {on.map((m) => m.name).join(", ") || "none"}.</p>
        </PxPanel>
      </div>
      <div className="space-y-4">
        <PxPanel title="Subscription" actions={<Link href="?tab=subscription" className="text-[13px]">Change</Link>}>
          {s ? (
            <KeyValues items={[["Plan", s.plan.name], ["Status", <Pill key="s" value={s.status} />], ["Billing period", s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"], [s.status === "TRIAL" ? "Trial ends" : "Renews", fmtDate(s.status === "TRIAL" ? s.trialEndsAt : s.renewsAt)]]} />
          ) : <p className="text-[13.5px] text-[#5b6478]">No subscription yet. <Link href="?tab=subscription">Start one</Link>.</p>}
        </PxPanel>
        <PxPanel title="Organisation administrators" actions={<Link href="?tab=users" className="text-[13px]">Users</Link>}>
          {admins.length ? <ul className="space-y-1 text-[13.5px]">{admins.map((m) => <li key={m.id}><Link href={`/platform-admin/users/${m.user.id}`}>{m.user.name}</Link> <span className="text-[#5b6478]">{m.user.email}</span></li>)}</ul> : <p className="text-[13.5px] text-[#a11d2b]">No active administrator{client.pendingAdminInvites ? ` (${client.pendingAdminInvites} invitation waiting)` : ""}.</p>}
        </PxPanel>
        <PxPanel title="Contact">
          <KeyValues items={[["Main contact", a.mainContactName ?? "—"], ["Email", a.contactEmail ?? "—"], ["Telephone", a.contactPhone ?? "—"], ["Client since", fmtDate(a.createdAt)]]} />
        </PxPanel>
      </div>
    </div>
  );
}

export function CompanyTab({ client, back }: P) {
  const a = client.account;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <PxPanel title="Company details">
        <form action={updateCompanyAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Hidden id={client.org.id} back={back} />
          <label><span className="label">Legal company name</span><input name="legalName" required defaultValue={a.legalName} className="input" /></label>
          <label><span className="label">Trading name</span><input name="tradingName" defaultValue={a.tradingName ?? ""} className="input" /></label>
          <label><span className="label">Company registration number</span><input name="companyNumber" defaultValue={a.companyNumber ?? ""} className="input" /></label>
          <label><span className="label">Country and jurisdiction</span><input name="country" defaultValue={a.country} className="input" /></label>
          <label className="md:col-span-2"><span className="label">Main business address</span><textarea name="address" rows={2} defaultValue={a.address ?? ""} className="input" /></label>
          <label><span className="label">Main contact person</span><input name="mainContactName" defaultValue={a.mainContactName ?? ""} className="input" /></label>
          <label><span className="label">Contact email</span><input type="email" name="contactEmail" defaultValue={a.contactEmail ?? ""} className="input" /></label>
          <label><span className="label">Contact telephone</span><input name="contactPhone" defaultValue={a.contactPhone ?? ""} className="input" /></label>
          <label><span className="label">CQC provider ID</span><input name="cqcProviderId" defaultValue={a.cqcProviderId ?? ""} placeholder="1-123456789" className="input" /></label>
          <label className="md:col-span-2"><span className="label">CQC location IDs (separate with commas)</span><input name="cqcLocationIds" defaultValue={a.cqcLocationIds.join(", ")} className="input" /></label>
          <fieldset className="md:col-span-2"><legend className="label">Service types</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">{SERVICE_TYPES.map((t) => <label key={t} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="serviceTypes" value={t} defaultChecked={a.serviceTypes.includes(t)} />{t}</label>)}</div>
          </fieldset>
          <div className="md:col-span-2"><button className={pxPrimary}>Save company details</button></div>
        </form>
      </PxPanel>
      <PxPanel title="CQC registration">
        <p className="text-[13.5px]">{a.cqcProviderId ? <>Provider ID <span className="font-mono">{a.cqcProviderId}</span>.</> : "No CQC provider ID recorded."}</p>
        <p className="mt-2 text-[13.5px]">{a.cqcCheckedAt ? <Tone tone="green">Checked against the CQC register on {fmtDate(a.cqcCheckedAt)}</Tone> : <Tone tone="amber">Not checked. An ID given by a customer is not proof of registration.</Tone>}</p>
        {a.cqcProviderId && !a.cqcCheckedAt ? (
          <form action={markCqcCheckedAction} className="mt-3"><Hidden id={client.org.id} back={back} /><p className="mb-2 text-[12.5px] text-[#5b6478]">Look the ID up on the CQC website first. The platform does not check it for you.</p><button className={pxSecondary}>I have checked it on the CQC register</button></form>
        ) : null}
      </PxPanel>
    </div>
  );
}

export async function BranchesTab({ ctx, client, back }: P) {
  const branches = await clientBranches(ctx, client.org.id);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <PxPanel title={`Branches (${branches.length})`} description="The customer's own administrators manage branches day to day in their Settings.">
        <Table head={["Branch", "Address", "CQC location", "Services", "People limited to it", "Added"]} empty={branches.length ? null : <EmptyRow>No branches yet.</EmptyRow>}>
          {branches.map((b) => (
            <tr key={b.id}><td className="font-medium">{b.name}</td><td>{b.address ?? "—"}</td><td className="font-mono text-[12.5px]">{b.cqcLocationId ?? "—"}</td><td>{b.services.map((s) => s.serviceTypeCode.toLowerCase().replace(/_/g, " ")).join(", ") || "—"}</td><td className="tabular-nums">{b._count.grants}</td><td>{fmtDate(b.createdAt)}</td></tr>
          ))}
        </Table>
      </PxPanel>
      <PxPanel title="Add a branch">
        <form action={addClientBranchAction} className="space-y-3">
          <Hidden id={client.org.id} back={back} />
          <label className="block"><span className="label">Branch name</span><input name="name" required minLength={2} className="input" /></label>
          <label className="block"><span className="label">Address</span><input name="address" className="input" /></label>
          <label className="block"><span className="label">CQC location ID</span><input name="cqcLocationId" className="input" /></label>
          <button className={pxPrimary}>Add branch</button>
        </form>
      </PxPanel>
    </div>
  );
}

function rolePermissionMap() {
  const out: Record<string, string[]> = {};
  for (const [perm, roles] of Object.entries(ORG_PERMISSIONS)) for (const r of roles as readonly string[]) (out[r] ??= []).push(perm);
  return out;
}

export async function UsersTab({ ctx, client, back }: P) {
  const { members, invites, branches } = await clientMembers(ctx, client.org.id);
  const roles = Object.entries(ORG_ROLE_NAMES) as [OrgRole, string][];
  const map = rolePermissionMap();
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <PxPanel title={`Members of ${client.org.name} (${members.length})`} description="Changes here apply to this organisation only. A person's memberships of other organisations are never changed.">
        {members.length ? (
          <ul className="divide-y divide-[#f1f2f6]">
            {members.map((m) => (
              <li key={m.id} className="py-3 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/platform-admin/users/${m.user.id}`} className="font-medium text-[#0f1b3d]">{m.user.name}</Link>
                  <span className="text-[#5b6478]">{m.user.email}</span>
                  {m.deactivatedAt ? <Pill value="CLOSED" label="Deactivated here" /> : null}
                  {m.user.deactivatedAt ? <Pill value="SUSPENDED" label="Account deactivated" /> : null}
                  {m.user._count.memberships > 1 ? <Tone tone="violet">{m.user._count.memberships} organisations</Tone> : null}
                </div>
                <p className="mt-0.5 text-[#46505f]">{m.roles.length ? m.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") : "No roles"}{m.jobTitle ? ` · ${m.jobTitle}` : ""} · {m.branches.length ? m.branches.map((b) => branchName.get(b.branchId) ?? "Branch").join(", ") : "all branches"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.deactivatedAt ? (
                    <form action={platformReactivateMemberAction}><Hidden id={client.org.id} back={back} /><input type="hidden" name="membershipId" value={m.id} /><button className={`${pxSecondary} !py-1 text-[13px]`}>Reactivate membership</button></form>
                  ) : (
                    <>
                      <Confirm label="Roles & branch access">
                        <form action={platformMemberAction} className="space-y-3">
                          <Hidden id={client.org.id} back={back} /><input type="hidden" name="membershipId" value={m.id} />
                          <RoleEditor idPrefix={m.id} roles={roles} branches={branches} selectedRoles={m.roles} selectedBranches={m.branches.map((b) => b.branchId)} jobTitle={m.jobTitle} rolePermissions={map} />
                          <button className={pxPrimary}>Save for {client.org.name}</button>
                        </form>
                      </Confirm>
                      <Confirm label="Deactivate here" tone="danger">
                        <form action={platformDeactivateMemberAction} className="space-y-2">
                          <Hidden id={client.org.id} back={back} /><input type="hidden" name="membershipId" value={m.id} />
                          <p className="text-[12.5px] text-[#5b6478]">Ends their access to {client.org.name} only. Their roles are kept for reactivation.</p>
                          <ReasonField />
                          <button className={pxDanger}>Deactivate membership</button>
                        </form>
                      </Confirm>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : <EmptyRow>No members yet.</EmptyRow>}
      </PxPanel>
      <div className="space-y-4">
        <PxPanel title="Invite a person">
          <form action={platformInviteAction} className="space-y-3">
            <Hidden id={client.org.id} back={back} />
            <label className="block"><span className="label">Name</span><input name="name" required className="input" /></label>
            <label className="block"><span className="label">Email</span><input type="email" name="email" required className="input" /></label>
            <fieldset><legend className="label">Roles</legend><div className="grid grid-cols-1 gap-1">{roles.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="roles" value={v} defaultChecked={v === "ORG_ADMIN"} />{l}</label>)}</div></fieldset>
            <label className="block"><span className="label">Job title</span><input name="jobTitle" className="input" /></label>
            <button className={pxPrimary}>Create invitation link</button>
            <p className="text-[12px] text-[#5b6478]">A single-use link is shown once. No password is set by Evantix.</p>
          </form>
        </PxPanel>
        <PxPanel title={`Open invitations (${invites.length})`}>
          {invites.length ? <ul className="space-y-2 text-[13.5px]">{invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{i.name ?? i.email}</span> <span className="text-[#5b6478]">{i.email} · {i.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ")} · until {fmtDate(i.expiresAt)}</span></span>
              <form action={platformRevokeInviteAction}><Hidden id={client.org.id} back={back} /><input type="hidden" name="inviteId" value={i.id} /><button className="text-[13px] text-[#a11d2b] underline">Revoke</button></form>
            </li>
          ))}</ul> : <p className="text-[13.5px] text-[#5b6478]">None.</p>}
        </PxPanel>
        <PxPanel title="Effective permissions of administrators">
          <ul className="space-y-1 text-[12.5px]">{effectivePermissions(["ORG_ADMIN"]).map((g) => <li key={g.group} className="flex justify-between gap-2"><span>{g.group}</span><span className="text-[#5b6478]">{g.level}</span></li>)}</ul>
        </PxPanel>
      </div>
    </div>
  );
}

export async function SubscriptionTab({ ctx, client, back }: P) {
  const [plans, history] = await Promise.all([listPlans(ctx), subscriptionHistory(ctx, client.org.id)]);
  const s = client.subscription;
  const blocked = client.account.status === "SUSPENDED" || client.account.status === "CLOSED";
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <PxPanel title="Current subscription">
          {s ? (
            <KeyValues items={[
              ["Plan", s.plan.name], ["Status", <Pill key="s" value={s.status} />], ["Billing period", s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"],
              ["Price", fmtMoney(s.billingPeriod === "ANNUAL" ? s.plan.annualPricePence : s.plan.monthlyPricePence) ?? <NotConfigured key="p">Price not set</NotConfigured>],
              ["Trial ends", fmtDate(s.trialEndsAt)], ["Renews", fmtDate(s.renewsAt)],
              ["User allowance", s.userAllowance === null ? "Unlimited" : `${fmtNumber(client.usage.users)} of ${fmtNumber(s.userAllowance)}`],
              ["Branch allowance", s.branchAllowance === null ? "Unlimited" : `${fmtNumber(client.usage.branches)} of ${fmtNumber(s.branchAllowance)}`],
              ["Storage allowance", s.storageMb === null ? "Unlimited" : `${fmtBytes(client.usage.storage.bytes)} of ${fmtNumber(s.storageMb)} MB`],
              ["AI requests per month", s.aiRequestsPerMonth === null ? "No allowance set" : `${fmtNumber(client.usage.aiThisMonth)} of ${fmtNumber(s.aiRequestsPerMonth)}`],
              ["Effective from", fmtDate(s.startsAt, true)],
            ]} />
          ) : <p className="text-[13.5px] text-[#5b6478]">No subscription yet.</p>}
          <p className="mt-3 text-[12.5px] text-[#5b6478]">No billing provider is connected: these are internal records only. No payment is taken.</p>
        </PxPanel>
        <PxPanel title="History" description="Every period is kept with its dates, so entitlement changes can be traced.">
          <Table head={["From", "Until", "Plan", "Status", "Allowances", "Reason"]} empty={history.length ? null : <EmptyRow>No history yet.</EmptyRow>}>
            {history.map((h) => (
              <tr key={h.id}><td className="whitespace-nowrap">{fmtDate(h.startsAt, true)}</td><td className="whitespace-nowrap">{h.endedAt ? fmtDate(h.endedAt, true) : <Tone tone="green">Current</Tone>}</td><td>{h.plan.name}</td><td><Pill value={h.status} /></td><td className="text-[12.5px]">{h.userAllowance ?? "∞"} users · {h.branchAllowance ?? "∞"} branches · {h.storageMb ?? "∞"} MB · {h.aiRequestsPerMonth ?? "—"} AI</td><td className="text-[12.5px]">{h.changeReason ?? "—"}</td></tr>
            ))}
          </Table>
        </PxPanel>
      </div>
      <div className="space-y-4">
        <PxPanel title={s ? "Change subscription" : "Start subscription"}>
          {blocked ? <p className="text-[13.5px] text-[#a11d2b]">This client is {client.account.status.toLowerCase()}. Reinstate it under Settings first.</p> : plans.length ? (
            <form action={changeSubscriptionAction} className="space-y-3">
              <Hidden id={client.org.id} back={back} />
              <label className="block"><span className="label">Plan</span><select name="planId" required defaultValue={s?.planId ?? ""} className="input"><option value="" disabled>Choose a plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Status</span><select name="status" defaultValue={s?.status === "TRIAL" ? "TRIAL" : "ACTIVE"} className="input"><option value="TRIAL">Trial</option><option value="ACTIVE">Paid (active)</option></select></label>
                <label><span className="label">Billing period</span><select name="billingPeriod" defaultValue={s?.billingPeriod ?? "MONTHLY"} className="input"><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></label>
                <label><span className="label">Trial ends</span><input type="date" name="trialEndsAt" defaultValue={dateInput(s?.trialEndsAt)} className="input" /></label>
                <label><span className="label">Renews</span><input type="date" name="renewsAt" defaultValue={dateInput(s?.renewsAt)} className="input" /></label>
                <label><span className="label">Users</span><input type="number" min={0} name="userAllowance" defaultValue={s?.userAllowance ?? ""} placeholder="Plan" className="input" /></label>
                <label><span className="label">Branches</span><input type="number" min={0} name="branchAllowance" defaultValue={s?.branchAllowance ?? ""} placeholder="Plan" className="input" /></label>
                <label><span className="label">Storage (MB)</span><input type="number" min={0} name="storageMb" defaultValue={s?.storageMb ?? ""} placeholder="Plan" className="input" /></label>
                <label><span className="label">AI requests / month</span><input type="number" min={0} name="aiRequestsPerMonth" defaultValue={s?.aiRequestsPerMonth ?? ""} placeholder="Plan" className="input" /></label>
              </div>
              <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="applyPlanModules" />Also switch modules to match the plan</label>
              <ReasonField />
              <button className={pxPrimary}>Save subscription</button>
            </form>
          ) : <p className="text-[13.5px]">No plans are set up yet. <Link href="/platform-admin/plans">Create a plan</Link> first.</p>}
        </PxPanel>
        {s?.status === "TRIAL" ? (
          <PxPanel title="Extend trial">
            <form action={extendTrialAction} className="space-y-3"><Hidden id={client.org.id} back={back} /><label className="block"><span className="label">New trial end</span><input type="date" name="trialEndsAt" required className="input" /></label><ReasonField /><button className={pxSecondary}>Extend trial</button></form>
          </PxPanel>
        ) : null}
      </div>
    </div>
  );
}

export function ModulesTab({ client, back }: P) {
  return (
    <PxPanel title="Modules" description="Switching a module off stops its permissions on the server at the person's next click. Nothing is deleted, and switching it back on restores access to the same records.">
      <ul className="divide-y divide-[#f1f2f6]">
        {client.modules.map((m) => (
          <li key={m.key} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1 basis-[20rem]">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">{m.name}{m.enabled ? <Pill value="ACTIVE" label="On" /> : <Pill value="CLOSED" label="Off" />}{m.critical ? <Tone tone="amber">Care-critical</Tone> : null}</p>
              <p className="text-[13px] text-[#5b6478]">{m.summary}</p>
              {m.updatedAt ? <p className="text-[12px] text-[#7a8294]">Last changed {fmtDate(m.updatedAt, true)}</p> : null}
              {m.limits && m.key === "AI_COORDINATOR" ? (
                <form action={moduleLimitsAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <Hidden id={client.org.id} back={back} /><input type="hidden" name="moduleKey" value={m.key} />
                  <label><span className="label">Requests per month</span><input type="number" min={1} name="monthlyRequests" defaultValue={m.limits.monthlyRequests ?? ""} placeholder="Subscription" className="input w-40" /></label>
                  <label><span className="label">Spend limit per month (£)</span><input name="monthlySpend" defaultValue={m.limits.monthlySpendPence ? (m.limits.monthlySpendPence / 100).toFixed(2) : ""} placeholder="None" className="input w-40" /></label>
                  <button className={`${pxSecondary} !py-[7px]`}>Save limits</button>
                </form>
              ) : null}
            </div>
            <Confirm label={m.enabled ? "Switch off" : "Switch on"} tone={m.enabled ? "danger" : "default"}>
              <form action={setModuleAction} className="w-[300px] max-w-full space-y-2">
                <Hidden id={client.org.id} back={back} /><input type="hidden" name="moduleKey" value={m.key} /><input type="hidden" name="enabled" value={m.enabled ? "false" : "true"} />
                {m.enabled ? <p className="text-[12.5px] text-[#a11d2b]">{m.consequence}</p> : null}
                {m.enabled && m.critical ? <label className="block"><span className="label">Type <strong>{client.org.name}</strong> to confirm</span><input name="confirmName" required className="input" autoComplete="off" /></label> : null}
                <ReasonField />
                <button className={m.enabled ? pxDanger : pxPrimary}>{m.enabled ? `Switch off ${m.name}` : `Switch on ${m.name}`}</button>
              </form>
            </Confirm>
          </li>
        ))}
      </ul>
    </PxPanel>
  );
}

export async function AiTab({ ctx, client }: P) {
  const u = await aiUsage(ctx, { organisationId: client.org.id });
  const ai = client.modules.find((m) => m.key === "AI_COORDINATOR");
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <PxPanel title="AI usage this month" description="Metadata only: no document, prompt or answer is shown.">
        <KeyValues items={[
          ["Requests", fmtNumber(u.requests)], ["Failed", fmtNumber(u.failed)], ["Support plans processed", fmtNumber(u.supportPlansProcessed)], ["Documents processed", fmtNumber(u.documentsProcessed)],
          ["Tokens", u.tokensMetered ? fmtNumber(u.inputTokens + u.outputTokens) : <NotConfigured key="t">Not metered</NotConfigured>],
          ["Estimated cost", u.estimatedCostPence === null ? <NotConfigured key="c">Token prices not set</NotConfigured> : fmtMoney(u.estimatedCostPence)],
          ["Average duration", u.avgDurationMs === null ? "—" : `${(u.avgDurationMs / 1000).toFixed(1)} s`],
          ["Background processing failures", fmtNumber(u.failedBackgroundJobs)],
        ]} />
        <h3 className="mt-4 text-[13.5px] font-semibold">By feature</h3>
        <Table head={["Feature", "Requests", "Tokens", "Estimated cost"]} empty={u.byFeature.length ? null : <EmptyRow>No AI requests this month.</EmptyRow>}>
          {u.byFeature.map((f) => <tr key={f.feature}><td>{f.feature}</td><td className="tabular-nums">{fmtNumber(f.requests)}</td><td className="tabular-nums">{fmtNumber(f.tokens)}</td><td>{fmtMoney(f.costPence) ?? "—"}</td></tr>)}
        </Table>
      </PxPanel>
      <PxPanel title="Entitlement">
        <p className="text-[13.5px]">AI Care Coordinator is <strong>{ai?.enabled ? "on" : "off"}</strong> for this client.</p>
        <p className="mt-1 text-[13.5px]">Monthly allowance: {ai?.limits.monthlyRequests ?? client.subscription?.aiRequestsPerMonth ?? "none set"}.</p>
        <p className="mt-1 text-[13.5px]">Spending limit: {fmtMoney(ai?.limits.monthlySpendPence ?? null) ?? "none set"}.</p>
        <p className="mt-3 text-[12.5px] text-[#5b6478]">When a limit is reached, AI requests are refused and staff see a plain message; the rest of the platform keeps working. <Link href="?tab=modules">Change limits</Link></p>
      </PxPanel>
    </div>
  );
}

export async function StorageTab({ client }: P) {
  const growth = await storageGrowth(client.org.id);
  const max = Math.max(1, ...growth.map((g) => g.bytes));
  const s = client.subscription;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <PxPanel title="Stored files" description="Measured from file records (documents, evidence, photos, intakes and HR files).">
        <KeyValues items={[["Total", fmtBytes(client.usage.storage.bytes)], ["Files", fmtNumber(client.usage.storage.files)], ["Allowance", s?.storageMb ? `${fmtNumber(s.storageMb)} MB` : "None set"], ["Used", s?.storageMb ? `${Math.round((client.usage.storage.bytes / (s.storageMb * 1048576)) * 100)}%` : "—"]]} />
        <h3 className="mt-4 text-[13.5px] font-semibold">Added per month</h3>
        <ul className="mt-2 space-y-1.5">
          {growth.map((g) => (
            <li key={g.month} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2 text-[12.5px]">
              <span className="tabular-nums text-[#5b6478]">{g.month}</span>
              <span className="h-2.5 rounded-full bg-[#f1f2f6]"><span className="block h-2.5 rounded-full bg-[#7c3aed]" style={{ width: `${(g.bytes / max) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{fmtBytes(g.bytes)}</span>
            </li>
          ))}
        </ul>
      </PxPanel>
      <PxPanel title="Records">
        <KeyValues items={[["Users", fmtNumber(client.usage.users)], ["Service user records", fmtNumber(client.usage.serviceUsers)], ["Visits", fmtNumber(client.usage.visits)], ["Branches", fmtNumber(client.usage.branches)]]} />
      </PxPanel>
    </div>
  );
}

export async function SecurityTab({ ctx, client, back }: P) {
  const [grants, links, sessions] = await Promise.all([
    listSupportGrants(ctx, client.org.id),
    db.accountToken.findMany({ where: { organisationId: client.org.id, kind: "RESET" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, email: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } }),
    db.session.count({ where: { activeOrgId: client.org.id, expiresAt: { gt: new Date() } } }),
  ]);
  const scopes = Object.entries(SUPPORT_SCOPES);
  const supportForm = (emergency: boolean) => (
    <form action={emergency ? emergencySupportAction : requestSupportAction} className="space-y-2">
      <Hidden id={client.org.id} back={back} />
      <label className="block"><span className="label">Purpose</span><textarea name="purpose" required minLength={10} rows={2} className="input" /></label>
      <fieldset><legend className="label">What support needs to see</legend>{scopes.map(([k, v]) => <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="scopes" value={k} />{v}</label>)}</fieldset>
      <label className="block"><span className="label">For how many hours</span><input type="number" name="hours" min={1} max={emergency ? 4 : 72} defaultValue={emergency ? 2 : 24} className="input w-28" /></label>
      {emergency ? <PasswordField /> : null}
      <button className={emergency ? pxDanger : pxPrimary}>{emergency ? "Open emergency access" : "Ask the client for access"}</button>
    </form>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <PxPanel title="Support access" description="Time-limited and purpose-bound. Covers configuration and the activity log only, never service user records or signing in as a customer user.">
          <Table head={["Requested", "Purpose", "Scope", "Authorised", "State", ""]} empty={grants.length ? null : <EmptyRow>No support access has been requested.</EmptyRow>}>
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="whitespace-nowrap">{fmtDate(g.createdAt, true)}<span className="block text-[12px] text-[#5b6478]">{g.requestedBy}</span></td>
                <td className="max-w-[260px]">{g.purpose}</td>
                <td className="text-[12.5px]">{g.scopes.map((s) => s.toLowerCase().replace("_", " ")).join(", ")}</td>
                <td className="text-[12.5px]">{g.authorisation === "EMERGENCY" ? "Emergency (Evantix)" : g.decidedBy ? `By ${g.decidedBy}` : "Waiting for the client"}</td>
                <td><Pill value={g.state} />{g.state === "ACTIVE" && g.expiresAt ? <span className="block text-[12px] text-[#5b6478]">until {fmtDate(g.expiresAt, true)}</span> : null}</td>
                <td>{g.state === "ACTIVE" || g.state === "REQUESTED" ? <Confirm label="Revoke"><form action={revokeSupportAction} className="space-y-2"><Back value={back} /><input type="hidden" name="grantId" value={g.id} /><ReasonField /><button className={pxDanger}>Revoke</button></form></Confirm> : null}</td>
              </tr>
            ))}
          </Table>
        </PxPanel>
        <PxPanel title="Password reset links for this client">
          <Table head={["Created", "For", "Expires", "State"]} empty={links.length ? null : <EmptyRow>None.</EmptyRow>}>
            {links.map((l) => <tr key={l.id}><td>{fmtDate(l.createdAt, true)}</td><td>{l.email}</td><td>{fmtDate(l.expiresAt, true)}</td><td><Pill value={tokenState(l)} /></td></tr>)}
          </Table>
          <p className="mt-2 text-[12.5px] text-[#5b6478]">{sessions} session(s) are signed in to this organisation now. Manage them from <Link href="/platform-admin/sessions">Login Sessions</Link>.</p>
        </PxPanel>
      </div>
      <div className="space-y-4">
        <PxPanel title="Ask for support access">{supportForm(false)}</PxPanel>
        <PxPanel title="Emergency access" description="Only when the client cannot be reached and the issue cannot wait. At most 4 hours. The client's administrators and the other platform administrators are told.">
          <Confirm label="Open emergency access" tone="danger">{supportForm(true)}</Confirm>
        </PxPanel>
      </div>
    </div>
  );
}

export async function SettingsTab({ ctx, client, back }: P) {
  const status = client.account.status;
  const grant = await activeSupportGrant(client.org.id, "CONFIGURATION");
  const config = grant ? await supportConfigurationView(ctx, client.org.id) : null;
  const statusForm = (action: "suspend" | "reinstate" | "close" | "reopen", label: string, danger: boolean, needsPassword: boolean, explain: string) => (
    <Confirm label={label} tone={danger ? "danger" : "default"}>
      <form action={customerStatusAction} className="w-[340px] max-w-full space-y-2">
        <Hidden id={client.org.id} back={back} /><input type="hidden" name="statusAction" value={action} />
        <p className="text-[12.5px] text-[#5b6478]">{explain}</p>
        <ReasonField />
        {needsPassword ? <PasswordField /> : null}
        <button className={danger ? pxDanger : pxPrimary}>{label}</button>
      </form>
    </Confirm>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <PxPanel title="Account status" description="Suspending or closing never deletes the client's records. Its staff see a plain notice and can do nothing until it is reinstated.">
        <p className="mb-3 text-[13.5px]">Status: <Pill value={status} />{client.account.statusReason ? <span className="ml-2 text-[#5b6478]">Reason: {client.account.statusReason}</span> : null}{client.account.statusChangedAt ? <span className="ml-2 text-[#5b6478]">({fmtDate(client.account.statusChangedAt, true)})</span> : null}</p>
        <div className="flex flex-wrap items-start gap-2">
          {status === "ACTIVE" || status === "TRIAL" ? statusForm("suspend", "Suspend client", true, true, "Every member of this organisation loses access at their next click. Their sessions stay, their data stays.") : null}
          {status === "SUSPENDED" ? statusForm("reinstate", "Reinstate client", false, false, "Restores access with the same roles, modules and data.") : null}
          {status !== "CLOSED" ? statusForm("close", "Close client", true, true, "Use when the client has left. Data is kept for retention; nobody can use the organisation.") : statusForm("reopen", "Reopen client", false, false, "Restores access to a closed client.")}
        </div>
      </PxPanel>
      <PxPanel title="Organisation configuration" description="Visible only while the client has approved support access to its configuration.">
        {config ? (
          <div className="space-y-2 text-[13px]">
            <p><Tone tone="amber">Support access active until {fmtDate(grant!.expiresAt, true)}</Tone></p>
            <p>Jurisdiction: {config.org.jurisdiction}</p>
            <p>Branches: {config.branches.map((b) => `${b.name}${b.hrBranchKey ? " (HR linked)" : ""}`).join(", ") || "none"}</p>
            <p>Rota settings: {config.rotaSettings ? "configured" : "not configured"}</p>
            <pre className="max-h-64 overflow-auto rounded-[4px] bg-[#f5f6fa] p-2 text-[12px]">{JSON.stringify(config.org.settings, null, 2)}</pre>
          </div>
        ) : <p className="text-[13.5px] text-[#5b6478]">No active support access. <Link href="?tab=security">Ask the client for access</Link>.</p>}
      </PxPanel>
    </div>
  );
}

export async function AuditTab({ ctx, client, sp }: P) {
  const full = sp.full === "1" && Boolean(await activeSupportGrant(client.org.id, "ACTIVITY_LOG"));
  const page = Number(sp.page ?? "1") || 1;
  const { entries, total } = await clientAudit(ctx, client.org.id, { full, page });
  return (
    <PxPanel title={full ? "Full activity log (support access)" : "Account and security history"} description={full ? "Shown under the client's approved support access; each view is audited." : "Invitations, roles, password resets, status, subscription and module changes. Care activity is not shown."} actions={!full && (await activeSupportGrant(client.org.id, "ACTIVITY_LOG")) ? <Link href="?tab=audit&full=1" className="text-[13px]">Open full log</Link> : null}>
      <Table head={["When", "Event", "By", "Details"]} empty={entries.length ? null : <EmptyRow>No events yet.</EmptyRow>}>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="whitespace-nowrap tabular-nums">{fmtDate(e.at, true)}</td>
            <td><Tone tone={e.tone}>{e.label}</Tone>{e.subject ? <span className="block text-[12.5px]"><Link href={`/platform-admin/users/${e.subjectId}`}>{e.subject}</Link></span> : null}</td>
            <td>{e.actor}</td>
            <td className="max-w-[360px] text-[12.5px] text-[#46505f]">{e.reason ? <span className="block">Reason: {e.reason}</span> : null}{e.before !== null || e.after !== null ? <span className="block break-words font-mono text-[11.5px]">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</span> : null}{e.outcome !== "Done" ? <span className="block text-[#a11d2b]">{e.outcome}</span> : null}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-[12.5px] text-[#5b6478]">{total} event(s).</p>
    </PxPanel>
  );
}

export { MODULES };

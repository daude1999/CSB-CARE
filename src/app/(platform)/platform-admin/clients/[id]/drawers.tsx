import type { OrgRole } from "@prisma/client";
import Link from "@/components/link";
import type { Ctx } from "@/server/auth/rbac";
import type { getClient } from "@/server/platform/customers";
import { clientMembers, ORG_PERMISSIONS, ORG_ROLE_NAMES } from "@/server/platform/accounts";
import { listPlans } from "@/server/platform/subscriptions";
import { SUPPORT_SCOPES } from "@/server/platform/support";
import { permissionCatalogue } from "@/server/platform/permissions";
import { fmtDate } from "@/components/ui";
import { Back, Confirm, PasswordField, PxDrawer, pxDanger, pxPrimary, pxSecondary, ReasonField, Tone } from "@/components/platform/ui";
import { RoleEditor } from "@/components/platform/role-editor";
import {
  addClientBranchAction, changeSubscriptionAction, emergencySupportAction, extendTrialAction, markCqcCheckedAction, platformDeactivateMemberAction, platformInviteAction, platformMemberAction,
  requestSupportAction, updateCompanyAction,
} from "@/app/platform-actions";

type Client = Awaited<ReturnType<typeof getClient>>;

export const DRAWERS = ["company", "branch", "invite", "member", "subscription", "trial", "support", "emergency"] as const;
export type DrawerKey = (typeof DRAWERS)[number];

interface P { ctx: Ctx; client: Client; edit: DrawerKey; back: string; closeHref: string; memberId?: string }

const SERVICE_TYPES = ["Domiciliary care", "Supported living", "Live-in care", "Extra care housing", "Residential care", "Nursing care", "Day services"];
const dateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const Hidden = ({ id, back }: { id: string; back: string }) => (<><input type="hidden" name="organisationId" value={id} /><Back value={back} /></>);
const Footer = ({ children, closeHref }: { children: React.ReactNode; closeHref: string }) => (
  <div className="sticky bottom-0 -mx-5 mt-5 flex items-center justify-end gap-2 border-t border-px-line bg-white px-5 py-3">
    <Link href={closeHref} scroll={false} className={pxSecondary}>Cancel</Link>
    {children}
  </div>
);

export function rolePermissionMap() {
  const out: Record<string, string[]> = {};
  for (const [perm, roles] of Object.entries(ORG_PERMISSIONS)) for (const r of roles as readonly string[]) (out[r] ??= []).push(perm);
  return out;
}

/** The side panel for one focused change to a client. Every form posts to the same server actions as before. */
export async function ClientDrawer(p: P) {
  const { client, back, closeHref } = p;
  const id = client.org.id;
  const a = client.account;
  switch (p.edit) {
    case "company":
      return (
        <PxDrawer closeHref={closeHref} title="Company details" description="The customer's legal and contact record. A changed CQC provider ID needs checking again.">
          <form action={updateCompanyAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Hidden id={id} back={back} />
            <label className="sm:col-span-2"><span className="label">Legal company name</span><input name="legalName" required defaultValue={a.legalName} className="input" /></label>
            <label><span className="label">Trading name</span><input name="tradingName" defaultValue={a.tradingName ?? ""} className="input" /></label>
            <label><span className="label">Company number</span><input name="companyNumber" defaultValue={a.companyNumber ?? ""} className="input" /></label>
            <label className="sm:col-span-2"><span className="label">Registered address</span><textarea name="address" rows={2} defaultValue={a.address ?? ""} className="input" /></label>
            <label><span className="label">Country</span><input name="country" defaultValue={a.country} className="input" /></label>
            <label><span className="label">Main contact</span><input name="mainContactName" defaultValue={a.mainContactName ?? ""} className="input" /></label>
            <label><span className="label">Contact email</span><input type="email" name="contactEmail" defaultValue={a.contactEmail ?? ""} className="input" /></label>
            <label><span className="label">Contact telephone</span><input name="contactPhone" defaultValue={a.contactPhone ?? ""} className="input" /></label>
            <label><span className="label">CQC provider ID</span><input name="cqcProviderId" defaultValue={a.cqcProviderId ?? ""} placeholder="1-123456789" className="input" /></label>
            <label><span className="label">CQC location IDs</span><input name="cqcLocationIds" defaultValue={a.cqcLocationIds.join(", ")} placeholder="Separate with commas" className="input" /></label>
            <fieldset className="sm:col-span-2"><legend className="label">Service types</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{SERVICE_TYPES.map((t) => <label key={t} className="flex items-center gap-2 text-body"><input type="checkbox" name="serviceTypes" value={t} defaultChecked={a.serviceTypes.includes(t)} />{t}</label>)}</div>
            </fieldset>
            <div className="sm:col-span-2"><Footer closeHref={closeHref}><button className={pxPrimary}>Save details</button></Footer></div>
          </form>
          {a.cqcProviderId && !a.cqcCheckedAt ? (
            <form action={markCqcCheckedAction} className="mt-2 rounded-[8px] border border-px-line bg-px-field p-3 text-meta">
              <Hidden id={id} back={back} />
              <p className="mb-2 text-px-body"><Tone tone="amber">Not checked</Tone> Look provider <span className="font-mono">{a.cqcProviderId}</span> up on the CQC website first. The platform does not check it for you.</p>
              <button className={pxSecondary}>I have checked it on the CQC register</button>
            </form>
          ) : null}
        </PxDrawer>
      );
    case "branch":
      return (
        <PxDrawer closeHref={closeHref} title="Add a branch" description="For onboarding help. The customer's own administrators manage branches day to day.">
          <form action={addClientBranchAction} className="space-y-3">
            <Hidden id={id} back={back} />
            <label className="block"><span className="label">Branch name</span><input name="name" required minLength={2} className="input" /></label>
            <label className="block"><span className="label">Address</span><input name="address" className="input" /></label>
            <label className="block"><span className="label">CQC location ID</span><input name="cqcLocationId" className="input" /></label>
            <Footer closeHref={closeHref}><button className={pxPrimary}>Add branch</button></Footer>
          </form>
        </PxDrawer>
      );
    case "invite": {
      const roles = Object.entries(ORG_ROLE_NAMES) as [OrgRole, string][];
      return (
        <PxDrawer closeHref={closeHref} title={`Invite someone to ${client.org.name}`} description="Creates a single-use link, shown once. Evantix never sets anyone's password.">
          <form action={platformInviteAction} className="space-y-3">
            <Hidden id={id} back={back} />
            <label className="block"><span className="label">Name</span><input name="name" required className="input" /></label>
            <label className="block"><span className="label">Email</span><input type="email" name="email" required className="input" /></label>
            <label className="block"><span className="label">Job title</span><input name="jobTitle" className="input" /></label>
            <fieldset><legend className="label">Roles</legend><div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{roles.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-body"><input type="checkbox" name="roles" value={v} defaultChecked={v === "ORG_ADMIN"} />{l}</label>)}</div></fieldset>
            <Footer closeHref={closeHref}><button className={pxPrimary}>Create invitation link</button></Footer>
          </form>
        </PxDrawer>
      );
    }
    case "member": {
      const { members, branches } = await clientMembers(p.ctx, id);
      const m = members.find((x) => x.id === p.memberId);
      if (!m) return <PxDrawer closeHref={closeHref} title="Person not found"><p className="text-body text-px-muted">This membership no longer exists. Close this panel and refresh the list.</p></PxDrawer>;
      const roles = Object.entries(ORG_ROLE_NAMES) as [OrgRole, string][];
      return (
        <PxDrawer closeHref={closeHref} title={m.user.name} description={<>{m.user.email} · access to {client.org.name} only. Their other organisations are not changed.</>}>
          {m.deactivatedAt ? <p className="text-body text-px-muted">This membership is deactivated. Reactivate it from the Users list first.</p> : (
            <>
              <form action={platformMemberAction} className="space-y-3">
                <Hidden id={id} back={back} /><input type="hidden" name="membershipId" value={m.id} />
                <RoleEditor idPrefix={m.id} roles={roles} branches={branches} selectedRoles={m.roles} selectedBranches={m.branches.map((b) => b.branchId)} jobTitle={m.jobTitle} rolePermissions={rolePermissionMap()} catalogue={permissionCatalogue()} />
                <Footer closeHref={closeHref}><button className={pxPrimary}>Save access</button></Footer>
              </form>
              <div className="mt-6 border-t border-px-line pt-4">
                <h3 className="text-body font-semibold text-px-ink">Remove access</h3>
                <p className="mb-2 mt-0.5 text-meta text-px-muted">Ends their access to {client.org.name} only. Their roles are kept so the membership can be reactivated.</p>
                <Confirm label="Deactivate membership" tone="danger">
                  <form action={platformDeactivateMemberAction} className="space-y-2">
                    <Hidden id={id} back={back} /><input type="hidden" name="membershipId" value={m.id} />
                    <ReasonField />
                    <button className={pxDanger}>Deactivate membership</button>
                  </form>
                </Confirm>
              </div>
              <p className="mt-4 text-meta"><Link href={`/platform-admin/users/${m.user.id}`}>Open {m.user.name}&apos;s account</Link> for password reset and sessions.</p>
            </>
          )}
        </PxDrawer>
      );
    }
    case "subscription": {
      const plans = await listPlans(p.ctx);
      const s = client.subscription;
      const blocked = a.status === "SUSPENDED" || a.status === "CLOSED";
      return (
        <PxDrawer closeHref={closeHref} title={s ? "Change subscription" : "Start a subscription"} description="Starts a new subscription period; the old one is kept in the history. No payment is taken: no billing provider is connected.">
          {blocked ? <p className="text-body text-px-danger">This client is {a.status.toLowerCase()}. Reinstate it on the Settings tab first.</p> : plans.length ? (
            <form action={changeSubscriptionAction} className="space-y-3">
              <Hidden id={id} back={back} />
              <label className="block"><span className="label">Plan</span><select name="planId" required defaultValue={s?.planId ?? ""} className="input"><option value="" disabled>Choose a plan</option>{plans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">Status</span><select name="status" defaultValue={s?.status === "TRIAL" ? "TRIAL" : "ACTIVE"} className="input"><option value="TRIAL">Trial</option><option value="ACTIVE">Paid (active)</option></select></label>
                <label><span className="label">Billing period</span><select name="billingPeriod" defaultValue={s?.billingPeriod ?? "MONTHLY"} className="input"><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option></select></label>
                <label><span className="label">Trial ends</span><input type="date" name="trialEndsAt" defaultValue={dateInput(s?.trialEndsAt)} className="input" /></label>
                <label><span className="label">Renews</span><input type="date" name="renewsAt" defaultValue={dateInput(s?.renewsAt)} className="input" /></label>
              </div>
              <fieldset className="rounded-[8px] border border-px-line p-3">
                <legend className="px-1 text-meta font-medium text-px-body">Allowances <span className="font-normal text-px-muted">(empty uses the plan&apos;s)</span></legend>
                <div className="grid grid-cols-2 gap-3">
                  <label><span className="label">Users</span><input type="number" min={0} name="userAllowance" defaultValue={s?.userAllowance ?? ""} placeholder="Plan" className="input" /></label>
                  <label><span className="label">Branches</span><input type="number" min={0} name="branchAllowance" defaultValue={s?.branchAllowance ?? ""} placeholder="Plan" className="input" /></label>
                  <label><span className="label">Storage (MB)</span><input type="number" min={0} name="storageMb" defaultValue={s?.storageMb ?? ""} placeholder="Plan" className="input" /></label>
                  <label><span className="label">AI requests / month</span><input type="number" min={0} name="aiRequestsPerMonth" defaultValue={s?.aiRequestsPerMonth ?? ""} placeholder="Plan" className="input" /></label>
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-body"><input type="checkbox" name="applyPlanModules" />Also switch modules to match the plan</label>
              <ReasonField />
              <Footer closeHref={closeHref}><button className={pxPrimary}>Save subscription</button></Footer>
            </form>
          ) : <p className="text-body text-px-body">No plans exist yet. <Link href="/platform-admin/plans?new=1">Create a plan</Link> first, then come back here.</p>}
        </PxDrawer>
      );
    }
    case "trial":
      return (
        <PxDrawer closeHref={closeHref} title="Extend trial" description={client.subscription?.trialEndsAt ? `The trial currently ends on ${fmtDate(client.subscription.trialEndsAt)}.` : undefined}>
          <form action={extendTrialAction} className="space-y-3">
            <Hidden id={id} back={back} />
            <label className="block"><span className="label">New trial end</span><input type="date" name="trialEndsAt" required className="input" /></label>
            <ReasonField />
            <Footer closeHref={closeHref}><button className={pxPrimary}>Extend trial</button></Footer>
          </form>
        </PxDrawer>
      );
    case "support":
    case "emergency": {
      const emergency = p.edit === "emergency";
      return (
        <PxDrawer closeHref={closeHref} title={emergency ? "Open emergency access" : "Ask for support access"} description={emergency ? "Only when the client cannot be reached and the issue cannot wait. At most 4 hours. The client's administrators and the other platform administrators are told." : "The client's administrators approve or decline it in their Settings. Access covers configuration and the activity log only, never care records."}>
          <form action={emergency ? emergencySupportAction : requestSupportAction} className="space-y-3">
            <Hidden id={id} back={back} />
            <label className="block"><span className="label">Purpose</span><textarea name="purpose" required minLength={10} rows={3} className="input" placeholder="What you need to look at and why" /></label>
            <fieldset><legend className="label">What support needs to see</legend><div className="space-y-1.5">{Object.entries(SUPPORT_SCOPES).map(([k, v]) => <label key={k} className="flex items-center gap-2 text-body"><input type="checkbox" name="scopes" value={k} />{v}</label>)}</div></fieldset>
            <label className="block"><span className="label">For how many hours</span><input type="number" name="hours" min={1} max={emergency ? 4 : 72} defaultValue={emergency ? 2 : 24} className="input w-28" /></label>
            {emergency ? <PasswordField /> : null}
            <Footer closeHref={closeHref}><button className={emergency ? pxDanger : pxPrimary}>{emergency ? "Open emergency access" : "Send request"}</button></Footer>
          </form>
        </PxDrawer>
      );
    }
  }
}

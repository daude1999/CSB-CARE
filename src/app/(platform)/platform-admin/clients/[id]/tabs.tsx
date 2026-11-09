import { Plus, Warning } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { db } from "@/lib/db";
import type { Ctx } from "@/server/auth/rbac";
import type { getClient } from "@/server/platform/customers";
import { clientBranches } from "@/server/platform/customers";
import { clientMembers, ORG_ROLE_NAMES, tokenState } from "@/server/platform/accounts";
import { subscriptionHistory } from "@/server/platform/subscriptions";
import { aiUsage, storageGrowth } from "@/server/platform/usage";
import { clientAudit } from "@/server/platform/activity";
import { activeSupportGrant, listSupportGrants, supportConfigurationView } from "@/server/platform/support";
import { effectivePermissions } from "@/server/platform/permissions";
import { MODULES } from "@/lib/platform-modules";
import { fmtDate } from "@/components/ui";
import { Progress } from "@/components/platform/charts";
import {
  Back, Confirm, DetailRows, EmptyRow, EmptyState, fmtBytes, fmtMoney, fmtNumber, KeyValues, NotConfigured, PasswordField, Pill, PxPanel, pxDanger, pxLink, pxPrimary, pxSecondary, pxSm,
  ReasonField, Split, Table, Tone,
} from "@/components/platform/ui";
import { customerStatusAction, moduleLimitsAction, platformReactivateMemberAction, platformRevokeInviteAction, revokeSupportAction, setModuleAction } from "@/app/platform-actions";
import type { DrawerKey } from "./drawers";

type Client = Awaited<ReturnType<typeof getClient>>;
interface P { ctx: Ctx; client: Client; back: string; sp: Record<string, string | undefined>; drawerHref: (k: DrawerKey, extra?: string) => string }

const Hidden = ({ id, back }: { id: string; back: string }) => (<><input type="hidden" name="organisationId" value={id} /><Back value={back} /></>);

/** Allowance use as "12 of 20" with a bar, or the plain figure when there is no allowance. */
function Allowance({ used, limit, unit = "", fmt = fmtNumber }: { used: number; limit: number | null; unit?: string; fmt?: (n: number) => string }) {
  if (limit === null) return <span className="tabular-nums">{fmt(used)}{unit}<span className="ml-1 text-px-subtle">no limit</span></span>;
  const over = used > limit;
  return (
    <span className="block min-w-[140px]">
      <span className={`tabular-nums ${over ? "font-medium text-px-danger" : ""}`}>{fmt(used)} of {fmt(limit)}{unit}</span>
      <span className="mt-1 block"><Progress value={used} max={limit} label="Allowance used" tone={over ? "rose" : used / limit > 0.85 ? "amber" : "violet"} /></span>
    </span>
  );
}

function alertsFor(client: Client) {
  const { account: a, subscription: s, usage: u, admins } = client;
  const out: { tone: "danger" | "warn"; text: string; href?: string; action?: string }[] = [];
  if (a.status === "SUSPENDED") out.push({ tone: "danger", text: `Suspended${a.statusReason ? `: ${a.statusReason}` : ""}. Staff cannot use the platform.`, href: "?tab=settings", action: "Reinstate" });
  if (a.status === "CLOSED") out.push({ tone: "danger", text: "Closed. Records are kept but nobody can sign in.", href: "?tab=settings", action: "Reopen" });
  if (!admins.length) out.push({ tone: "danger", text: `No active organisation administrator${client.pendingAdminInvites ? ` (${client.pendingAdminInvites} invitation waiting)` : ""}.`, href: "?tab=users", action: "Invite one" });
  if (!s && a.status !== "CLOSED") out.push({ tone: "warn", text: "No subscription, so no allowances apply.", href: "?tab=subscription", action: "Start one" });
  if (s?.status === "TRIAL" && s.trialEndsAt) {
    const days = Math.ceil((s.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    if (days <= 14) out.push({ tone: days <= 3 ? "danger" : "warn", text: days < 0 ? `Trial ended on ${fmtDate(s.trialEndsAt)}.` : `Trial ends in ${days} day${days === 1 ? "" : "s"}.`, href: "?tab=subscription", action: "Review" });
  }
  const users = s?.userAllowance ?? s?.plan.includedUsers ?? null;
  if (users !== null && u.users > users) out.push({ tone: "warn", text: `${u.users - users} more user${u.users - users === 1 ? "" : "s"} than the allowance of ${users}.`, href: "?tab=subscription", action: "Change plan" });
  if (a.cqcProviderId && !a.cqcCheckedAt) out.push({ tone: "warn", text: "CQC provider ID not checked against the register." });
  return out;
}

export async function OverviewTab({ ctx, client, drawerHref }: P) {
  const { account: a, subscription: s, usage: u, modules, admins } = client;
  const branches = await clientBranches(ctx, client.org.id);
  const alerts = alertsFor(client);
  const on = modules.filter((m) => m.enabled).length;
  return (
    <>
      {alerts.length ? (
        <ul aria-label="Alerts" className="mb-4 divide-y divide-px-row overflow-hidden rounded-[10px] border border-px-line bg-white">
          {alerts.map((al) => (
            <li key={al.text} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
              <Warning size={16} weight="fill" className={`shrink-0 ${al.tone === "danger" ? "text-px-danger-strong" : "text-[#d48806]"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-px-body">{al.text}</span>
              {al.href ? <Link href={al.href} className={pxLink}>{al.action}</Link> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Split asideWidth={340} aside={
        <>
          <PxPanel title="Subscription" actions={<Link href={drawerHref("subscription")} scroll={false} className={pxLink}>{s ? "Change" : "Start"}</Link>}>
            {s ? (
              <DetailRows items={[
                ["Plan", s.plan.name], ["Status", <Pill key="s" value={s.status} />], ["Billing", s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"],
                ["Price", fmtMoney(s.billingPeriod === "ANNUAL" ? s.plan.annualPricePence : s.plan.monthlyPricePence) ?? <NotConfigured key="p">Not set</NotConfigured>],
                [s.status === "TRIAL" ? "Trial ends" : "Renews", fmtDate(s.status === "TRIAL" ? s.trialEndsAt : s.renewsAt)],
              ]} />
            ) : <p className="text-[13.5px] text-px-muted">No subscription yet.</p>}
          </PxPanel>
          <PxPanel title="Usage" actions={<Link href="?tab=usage" className={pxLink}>Details</Link>}>
            <DetailRows items={[
              ["Users", <Allowance key="u" used={u.users} limit={s?.userAllowance ?? s?.plan.includedUsers ?? null} />],
              ["Branches", <Allowance key="b" used={u.branches} limit={s?.branchAllowance ?? s?.plan.includedBranches ?? null} />],
              ["AI requests this month", <Allowance key="a" used={u.aiThisMonth} limit={s?.aiRequestsPerMonth ?? s?.plan.aiRequestsPerMonth ?? null} />],
              ["Storage", <Allowance key="s" used={u.storage.bytes} limit={s?.storageMb ? s.storageMb * 1048576 : null} fmt={fmtBytes} />],
              ["Modules on", <Link key="m" href="?tab=modules">{on} of {modules.length}</Link>],
            ]} />
          </PxPanel>
          <PxPanel title="Administrators" actions={<Link href={drawerHref("invite")} scroll={false} className={pxLink}>Invite</Link>}>
            {admins.length ? (
              <ul className="-my-1 divide-y divide-px-row text-[13.5px]">{admins.map((m) => <li key={m.id} className="py-2"><Link href={`/platform-admin/users/${m.user.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{m.user.name}</Link><span className="block truncate text-[12.5px] text-px-muted">{m.user.email}</span></li>)}</ul>
            ) : <p className="text-[13.5px] text-px-danger">No active administrator.</p>}
          </PxPanel>
        </>
      }>
        <PxPanel title="Company" actions={<Link href={drawerHref("company")} scroll={false} className={pxLink}>Edit</Link>}>
          <KeyValues cols={3} items={[
            ["Legal name", a.legalName], ["Trading name", a.tradingName ?? "—"], ["Company number", a.companyNumber ? <span className="font-mono">{a.companyNumber}</span> : "—"],
            ["Main contact", a.mainContactName ?? "—"], ["Email", a.contactEmail ? <a href={`mailto:${a.contactEmail}`}>{a.contactEmail}</a> : "—"], ["Telephone", a.contactPhone ?? "—"],
            ["Address", a.address ?? "—"], ["Country", a.country], ["Client since", fmtDate(a.createdAt)],
            ["CQC provider", a.cqcProviderId ? <span key="c" className="flex flex-wrap items-center gap-2"><span className="font-mono">{a.cqcProviderId}</span>{a.cqcCheckedAt ? <Tone tone="green">Checked</Tone> : <Tone tone="amber">Not checked</Tone>}</span> : "—"],
            ["Service types", a.serviceTypes.join(", ") || "—"],
          ]} />
        </PxPanel>
        <PxPanel id="branches" title="Branches" description={`${branches.length} branch${branches.length === 1 ? "" : "es"}. The customer manages branches day to day.`} actions={<Link href={drawerHref("branch")} scroll={false} className={`${pxSecondary} ${pxSm}`}><Plus size={13} aria-hidden="true" />Add branch</Link>} flush>
          {branches.length ? (
            <div className="px-4">
              <Table label="Branches" minWidth={560} head={["Branch", "Address", "CQC location", "Limited staff", "Added"]} align={["left", "left", "left", "right", "left"]}>
                {branches.map((b) => <tr key={b.id}><td className="font-medium">{b.name}</td><td className="text-px-body">{b.address ?? "—"}</td><td className="font-mono text-[12.5px]">{b.cqcLocationId ?? "—"}</td><td className="text-right tabular-nums">{b._count.grants}</td><td className="whitespace-nowrap">{fmtDate(b.createdAt)}</td></tr>)}
              </Table>
            </div>
          ) : <EmptyState title="No branches yet">Add the first branch, or let the customer add branches in their own Settings.</EmptyState>}
        </PxPanel>
      </Split>
    </>
  );
}

export async function UsersTab({ ctx, client, back, drawerHref }: P) {
  const { members, invites, branches } = await clientMembers(ctx, client.org.id);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const active = members.filter((m) => !m.deactivatedAt).length;
  return (
    <div className="space-y-4">
      <PxPanel title="People" description={`${active} active of ${members.length}. Changes apply to ${client.org.name} only.`} actions={<Link href={drawerHref("invite")} scroll={false} className={`${pxPrimary} ${pxSm}`}><Plus size={13} aria-hidden="true" />Invite person</Link>} flush>
        {members.length ? (
          <div className="px-4">
            <Table label="People" minWidth={760} head={["Person", "Roles", "Branch access", "Status", ""]} align={["left", "left", "left", "left", "right"]}>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/platform-admin/users/${m.user.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{m.user.name}</Link><span className="block text-[12.5px] text-px-muted">{m.user.email}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</span></td>
                  <td className="max-w-[260px] text-[13px]">{m.roles.length ? m.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ") : <span className="text-px-subtle">No roles</span>}</td>
                  <td className="max-w-[200px] text-[13px] text-px-body">{m.branches.length ? m.branches.map((b) => branchName.get(b.branchId) ?? "Branch").join(", ") : "All branches"}</td>
                  <td>
                    {m.user.deactivatedAt ? <Pill value="SUSPENDED" label="Account deactivated" /> : m.deactivatedAt ? <Pill value="CLOSED" label="Removed here" /> : <Pill value="ACTIVE" />}
                    {m.user._count.memberships > 1 ? <span className="mt-0.5 block text-[11.5px] text-px-subtle">{m.user._count.memberships} organisations</span> : null}
                  </td>
                  <td className="text-right">
                    {m.deactivatedAt ? (
                      <form action={platformReactivateMemberAction}><Hidden id={client.org.id} back={back} /><input type="hidden" name="membershipId" value={m.id} /><button className={`${pxSecondary} ${pxSm}`}>Reactivate</button></form>
                    ) : <Link href={drawerHref("member", `&member=${m.id}`)} scroll={false} className={`${pxSecondary} ${pxSm}`} aria-label={`Edit access for ${m.user.name}`}>Edit access</Link>}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyState title="No one has access yet" action={<Link href={drawerHref("invite")} scroll={false} className={pxPrimary}>Invite the administrator</Link>}>Invite the client&apos;s administrator first; they can then invite their own staff.</EmptyState>}
      </PxPanel>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <PxPanel title="Open invitations" description={invites.length ? undefined : "Nobody is waiting to accept an invitation."} flush>
          {invites.length ? (
            <ul className="divide-y divide-px-row">{invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                <span className="min-w-0"><span className="block font-medium">{i.name ?? i.email}</span><span className="block text-[12.5px] text-px-muted">{i.email} · {i.roles.map((r) => ORG_ROLE_NAMES[r]).join(", ")} · until {fmtDate(i.expiresAt)}</span></span>
                <form action={platformRevokeInviteAction}><Hidden id={client.org.id} back={back} /><input type="hidden" name="inviteId" value={i.id} /><button className={`${pxSecondary} ${pxSm}`}>Revoke</button></form>
              </li>
            ))}</ul>
          ) : null}
        </PxPanel>
        <PxPanel title="What an administrator can do" description="Effective access of the Organisation administrator role, from the permission registry the server enforces.">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">{effectivePermissions(["ORG_ADMIN"]).map((g) => <li key={g.group} className="flex justify-between gap-2 border-b border-px-row pb-1.5"><span>{g.group}</span><span className={g.level === "No access" ? "text-px-subtle" : "font-medium text-px-ink"}>{g.level}</span></li>)}</ul>
        </PxPanel>
      </div>
    </div>
  );
}

export async function SubscriptionTab({ ctx, client, drawerHref }: P) {
  const history = await subscriptionHistory(ctx, client.org.id);
  const s = client.subscription;
  const u = client.usage;
  return (
    <div className="space-y-4">
      <PxPanel
        title="Current subscription"
        description="Internal record. No payment is taken: no billing provider is connected."
        actions={<>{s?.status === "TRIAL" ? <Link href={drawerHref("trial")} scroll={false} className={`${pxSecondary} ${pxSm}`}>Extend trial</Link> : null}<Link href={drawerHref("subscription")} scroll={false} className={`${pxPrimary} ${pxSm}`}>{s ? "Change plan" : "Start subscription"}</Link></>}
      >
        {s ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DetailRows items={[
              ["Plan", <span key="p" className="font-medium">{s.plan.name}</span>], ["Status", <Pill key="s" value={s.status} />], ["Billing period", s.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"],
              ["Price", fmtMoney(s.billingPeriod === "ANNUAL" ? s.plan.annualPricePence : s.plan.monthlyPricePence) ?? <NotConfigured key="p">Price not set</NotConfigured>],
              ["Trial ends", fmtDate(s.trialEndsAt)], ["Renews", fmtDate(s.renewsAt)], ["Effective from", fmtDate(s.startsAt, true)],
            ]} />
            <DetailRows items={[
              ["Users", <Allowance key="u" used={u.users} limit={s.userAllowance} />],
              ["Branches", <Allowance key="b" used={u.branches} limit={s.branchAllowance} />],
              ["Storage", <Allowance key="s" used={u.storage.bytes} limit={s.storageMb === null ? null : s.storageMb * 1048576} fmt={fmtBytes} />],
              ["AI requests this month", <Allowance key="a" used={u.aiThisMonth} limit={s.aiRequestsPerMonth} />],
            ]} />
          </div>
        ) : <EmptyState title="No subscription" action={<Link href={drawerHref("subscription")} scroll={false} className={pxPrimary}>Start subscription</Link>}>Give this client a plan so its allowances and renewal date are tracked.</EmptyState>}
      </PxPanel>
      <PxPanel title="History" description="Every period is kept with its dates, so entitlement changes can be traced." flush>
        {history.length ? (
          <div className="px-4">
            <Table label="Subscription history" minWidth={760} head={["From", "Until", "Plan", "Status", "Allowances", "Reason"]}>
              {history.map((h) => (
                <tr key={h.id}><td className="whitespace-nowrap tabular-nums">{fmtDate(h.startsAt, true)}</td><td className="whitespace-nowrap tabular-nums">{h.endedAt ? fmtDate(h.endedAt, true) : <Tone tone="green">Current</Tone>}</td><td>{h.plan.name}</td><td><Pill value={h.status} /></td><td className="text-[12.5px] text-px-body">{h.userAllowance ?? "∞"} users · {h.branchAllowance ?? "∞"} branches · {h.storageMb ?? "∞"} MB · {h.aiRequestsPerMonth ?? "—"} AI</td><td className="text-[12.5px] text-px-body">{h.changeReason ?? "—"}</td></tr>
              ))}
            </Table>
          </div>
        ) : <EmptyRow>No subscription periods yet.</EmptyRow>}
      </PxPanel>
    </div>
  );
}

export function ModulesTab({ client, back }: P) {
  return (
    <PxPanel title="Modules" description="Switching a module off stops its permissions on the server at each person's next click. Nothing is deleted; switching it back on restores the same records." flush>
      <ul className="divide-y divide-px-row">
        {client.modules.map((m) => (
          <li key={m.key} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5">
            <div className="min-w-0 flex-1 basis-[22rem]">
              <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-px-ink">{m.name}{m.critical ? <Tone tone="amber">Care-critical</Tone> : null}</p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-px-muted">{m.summary}{m.updatedAt ? ` · Changed ${fmtDate(m.updatedAt, true)}` : ""}</p>
              {m.enabled && m.limits && m.key === "AI_COORDINATOR" ? (
                <form action={moduleLimitsAction} className="mt-2.5 flex flex-wrap items-end gap-2">
                  <Hidden id={client.org.id} back={back} /><input type="hidden" name="moduleKey" value={m.key} />
                  <label><span className="label">Requests per month</span><input type="number" min={1} name="monthlyRequests" defaultValue={m.limits.monthlyRequests ?? ""} placeholder="From subscription" className="input w-44" /></label>
                  <label><span className="label">Spend limit per month (£)</span><input name="monthlySpend" defaultValue={m.limits.monthlySpendPence ? (m.limits.monthlySpendPence / 100).toFixed(2) : ""} placeholder="None" className="input w-44" /></label>
                  <button className={pxSecondary}>Save limits</button>
                </form>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Pill value={m.enabled ? "ACTIVE" : "CLOSED"} label={m.enabled ? "On" : "Off"} />
              <Confirm small label={m.enabled ? "Switch off" : "Switch on"} tone={m.enabled ? "danger" : "default"}>
                <form action={setModuleAction} className="w-[300px] max-w-full space-y-2">
                  <Hidden id={client.org.id} back={back} /><input type="hidden" name="moduleKey" value={m.key} /><input type="hidden" name="enabled" value={m.enabled ? "false" : "true"} />
                  {m.enabled ? <p className="text-[12.5px] text-px-danger">{m.consequence}</p> : null}
                  {m.enabled && m.critical ? <label className="block"><span className="label">Type <strong>{client.org.name}</strong> to confirm</span><input name="confirmName" required className="input" autoComplete="off" /></label> : null}
                  <ReasonField />
                  <button className={m.enabled ? pxDanger : pxPrimary}>{m.enabled ? `Switch off ${m.name}` : `Switch on ${m.name}`}</button>
                </form>
              </Confirm>
            </div>
          </li>
        ))}
      </ul>
    </PxPanel>
  );
}

export async function UsageTab({ ctx, client }: P) {
  const [ai, growth] = await Promise.all([aiUsage(ctx, { organisationId: client.org.id }), storageGrowth(client.org.id)]);
  const aiModule = client.modules.find((m) => m.key === "AI_COORDINATOR");
  const max = Math.max(1, ...growth.map((g) => g.bytes));
  const s = client.subscription;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <PxPanel title="AI this month" description="Metadata only: no document, prompt or answer is shown.">
          <DetailRows items={[
            ["Requests", <Allowance key="r" used={ai.requests} limit={aiModule?.limits.monthlyRequests ?? s?.aiRequestsPerMonth ?? null} />],
            ["Failed", <span key="f" className={ai.failed ? "font-medium text-px-danger" : ""}>{fmtNumber(ai.failed)}</span>],
            ["Support plans processed", fmtNumber(ai.supportPlansProcessed)], ["Documents processed", fmtNumber(ai.documentsProcessed)],
            ["Tokens", ai.tokensMetered ? fmtNumber(ai.inputTokens + ai.outputTokens) : <NotConfigured key="t">Not metered</NotConfigured>],
            ["Estimated cost", ai.estimatedCostPence === null ? <NotConfigured key="c">Token prices not set</NotConfigured> : fmtMoney(ai.estimatedCostPence)],
            ["Spend limit", fmtMoney(aiModule?.limits.monthlySpendPence ?? null) ?? "None set"],
            ["AI Care Coordinator", aiModule?.enabled ? "On" : "Off"],
          ]} />
        </PxPanel>
        <PxPanel title="Storage" description="Measured from file records: documents, evidence, photos, intakes and HR files.">
          <DetailRows items={[
            ["Stored", <Allowance key="s" used={client.usage.storage.bytes} limit={s?.storageMb ? s.storageMb * 1048576 : null} fmt={fmtBytes} />],
            ["Files", fmtNumber(client.usage.storage.files)],
          ]} />
          <h3 className="mb-2 mt-4 text-[12.5px] font-medium text-px-muted">Added per month</h3>
          <ul className="space-y-1.5">
            {growth.map((g) => (
              <li key={g.month} className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-2 text-[12.5px]">
                <span className="tabular-nums text-px-muted">{g.month}</span>
                <span className="h-2 rounded-full bg-px-row"><span className="block h-2 rounded-full bg-px-focus" style={{ width: `${(g.bytes / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{fmtBytes(g.bytes)}</span>
              </li>
            ))}
          </ul>
        </PxPanel>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <PxPanel title="AI by feature" flush>
          {ai.byFeature.length ? (
            <div className="px-4"><Table label="AI by feature" minWidth={420} head={["Feature", "Requests", "Tokens", "Estimated cost"]} align={["left", "right", "right", "right"]}>
              {ai.byFeature.map((f) => <tr key={f.feature}><td>{f.feature}</td><td className="text-right tabular-nums">{fmtNumber(f.requests)}</td><td className="text-right tabular-nums">{fmtNumber(f.tokens)}</td><td className="text-right">{fmtMoney(f.costPence) ?? "—"}</td></tr>)}
            </Table></div>
          ) : <EmptyRow>No AI requests this month.</EmptyRow>}
        </PxPanel>
        <PxPanel title="Records" description="Counted for metering only. Their content is never shown here.">
          <DetailRows items={[["Users", fmtNumber(client.usage.users)], ["Service user records", fmtNumber(client.usage.serviceUsers)], ["Visits", fmtNumber(client.usage.visits)], ["Branches", fmtNumber(client.usage.branches)]]} />
        </PxPanel>
      </div>
    </div>
  );
}

export async function SecurityTab({ ctx, client, back, sp, drawerHref }: P) {
  const full = sp.full === "1" && Boolean(await activeSupportGrant(client.org.id, "ACTIVITY_LOG"));
  const page = Number(sp.page ?? "1") || 1;
  const [grants, links, sessions, audit, logGrant] = await Promise.all([
    listSupportGrants(ctx, client.org.id),
    db.accountToken.findMany({ where: { organisationId: client.org.id, kind: "RESET" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, email: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } }),
    db.session.count({ where: { activeOrgId: client.org.id, expiresAt: { gt: new Date() } } }),
    clientAudit(ctx, client.org.id, { full, page }),
    activeSupportGrant(client.org.id, "ACTIVITY_LOG"),
  ]);
  return (
    <div className="space-y-4">
      <PxPanel
        title="Support access"
        description="Time-limited and purpose-bound. Covers configuration and the activity log only, never care records or signing in as a customer."
        actions={<><Link href={drawerHref("emergency")} scroll={false} className={`${pxSecondary} ${pxSm} !text-px-danger`}>Emergency access</Link><Link href={drawerHref("support")} scroll={false} className={`${pxPrimary} ${pxSm}`}>Ask for access</Link></>}
        flush
      >
        {grants.length ? (
          <div className="px-4">
            <Table label="Support access" minWidth={780} head={["Requested", "Purpose", "Scope", "Authorised", "State", ""]} align={["left", "left", "left", "left", "left", "right"]}>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap tabular-nums">{fmtDate(g.createdAt, true)}<span className="block text-[12px] text-px-muted">{g.requestedBy}</span></td>
                  <td className="max-w-[260px]">{g.purpose}</td>
                  <td className="text-[12.5px]">{g.scopes.map((s) => s.toLowerCase().replace("_", " ")).join(", ")}</td>
                  <td className="text-[12.5px]">{g.authorisation === "EMERGENCY" ? "Emergency (Evantix)" : g.decidedBy ? `By ${g.decidedBy}` : "Waiting for the client"}</td>
                  <td><Pill value={g.state} />{g.state === "ACTIVE" && g.expiresAt ? <span className="block text-[12px] text-px-muted">until {fmtDate(g.expiresAt, true)}</span> : null}</td>
                  <td className="text-right">{g.state === "ACTIVE" || g.state === "REQUESTED" ? <Confirm small label="Revoke"><form action={revokeSupportAction} className="w-[260px] space-y-2 text-left"><Back value={back} /><input type="hidden" name="grantId" value={g.id} /><ReasonField /><button className={pxDanger}>Revoke access</button></form></Confirm> : null}</td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyRow>No support access has been requested for this client.</EmptyRow>}
      </PxPanel>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel title={full ? "Full activity log" : "Account and security history"} description={full ? "Shown under the client's approved support access; each view is audited." : "Invitations, roles, password resets, status, subscription and module changes. Care activity is not shown."} actions={!full && logGrant ? <Link href="?tab=security&full=1" className={pxLink}>Open full log</Link> : null} flush>
          {audit.entries.length ? (
            <div className="px-4">
              <Table label="History" minWidth={620} head={["When", "Event", "By", "Details"]}>
                {audit.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap tabular-nums text-[12.5px]">{fmtDate(e.at, true)}</td>
                    <td><Tone tone={e.tone}>{e.label}</Tone>{e.subject ? <span className="mt-0.5 block text-[12.5px]"><Link href={`/platform-admin/users/${e.subjectId}`}>{e.subject}</Link></span> : null}</td>
                    <td className="text-[13px]">{e.actor}</td>
                    <td className="max-w-[320px] text-[12.5px] text-px-body">{e.reason ? <span className="block">Reason: {e.reason}</span> : null}{e.before !== null || e.after !== null ? <span className="block break-words font-mono text-[11.5px] text-px-muted">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</span> : null}{e.outcome !== "Done" ? <span className="block text-px-danger">{e.outcome}</span> : null}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : <EmptyRow>No events yet.</EmptyRow>}
          <p className="border-t border-px-divider px-4 py-2 text-[12.5px] text-px-muted">{audit.total} event{audit.total === 1 ? "" : "s"}</p>
        </PxPanel>
        <PxPanel title="Sign-in" description={`${sessions} session${sessions === 1 ? " is" : "s are"} signed in to this organisation now.`} actions={<Link href="/platform-admin/sessions" className={pxLink}>Sessions</Link>}>
          <h3 className="mb-1 text-[12.5px] font-medium text-px-muted">Recent password reset links</h3>
          {links.length ? <ul className="-my-1 divide-y divide-px-row text-[13px]">{links.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block truncate">{l.email}</span><span className="block text-[12px] text-px-muted">{fmtDate(l.createdAt, true)}</span></span><Pill value={tokenState(l)} /></li>)}</ul> : <p className="text-[13px] text-px-muted">None.</p>}
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
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-px-row py-4 last:border-0">
      <div className="min-w-0 flex-1 basis-[18rem]"><p className="text-[13.5px] font-medium text-px-ink">{label}</p><p className="mt-0.5 text-[12.5px] leading-[18px] text-px-muted">{explain}</p></div>
      <Confirm label={label} tone={danger ? "danger" : "default"}>
        <form action={customerStatusAction} className="w-[320px] max-w-full space-y-2">
          <Hidden id={client.org.id} back={back} /><input type="hidden" name="statusAction" value={action} />
          <ReasonField />
          {needsPassword ? <PasswordField /> : null}
          <button className={danger ? pxDanger : pxPrimary}>{label}</button>
        </form>
      </Confirm>
    </div>
  );
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <PxPanel title="Account status" description="Suspending or closing never deletes records. The client's staff see a plain notice until it is reinstated.">
        <p className="mb-1 flex flex-wrap items-center gap-2 text-[13.5px]">Currently <Pill value={status} />{client.account.statusChangedAt ? <span className="text-px-muted">since {fmtDate(client.account.statusChangedAt, true)}</span> : null}</p>
        {client.account.statusReason ? <p className="text-[12.5px] text-px-muted">Reason: {client.account.statusReason}</p> : null}
        <div className="mt-2">
          {status === "ACTIVE" || status === "TRIAL" ? statusForm("suspend", "Suspend client", true, true, "Every member loses access at their next click. Sessions and data are kept. Needs your password.") : null}
          {status === "SUSPENDED" ? statusForm("reinstate", "Reinstate client", false, false, "Restores access with the same roles, modules and data.") : null}
          {status !== "CLOSED" ? statusForm("close", "Close client", true, true, "When the client has left. Data is kept for retention; nobody can use the organisation. Needs your password.") : statusForm("reopen", "Reopen client", false, false, "Restores access to a closed client.")}
        </div>
      </PxPanel>
      <PxPanel title="Organisation configuration" description="Visible only while the client has approved support access to its configuration.">
        {config ? (
          <div className="space-y-2 text-[13px]">
            <p><Tone tone="amber">Support access active until {fmtDate(grant!.expiresAt, true)}</Tone></p>
            <DetailRows items={[["Jurisdiction", config.org.jurisdiction], ["Branches", config.branches.map((b) => `${b.name}${b.hrBranchKey ? " (HR linked)" : ""}`).join(", ") || "None"], ["Rota settings", config.rotaSettings ? "Configured" : "Not configured"]]} />
            <pre className="max-h-64 overflow-auto rounded-[6px] bg-px-field p-2 text-[12px]">{JSON.stringify(config.org.settings, null, 2)}</pre>
          </div>
        ) : <EmptyState title="No active support access" action={<Link href="?tab=security" className={pxSecondary}>Ask the client for access</Link>}>The client&apos;s configuration stays private until one of its administrators approves a request.</EmptyState>}
      </PxPanel>
    </div>
  );
}

export { MODULES };

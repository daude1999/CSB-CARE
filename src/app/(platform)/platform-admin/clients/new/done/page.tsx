import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getClient } from "@/server/platform/customers";
import { KeyValues, Pill, PxHeader, PxPanel, pxPrimary, pxSecondary } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { fmtDate } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client created" };

/** Step 5: what was set up, with the first administrator's invitation link shown once. */
export default async function ClientCreated({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const c = await orNotFound(getClient(ctx, sp.org ?? ""));
  const [branches, invite] = await Promise.all([
    db.branch.findMany({ where: { organisationId: c.org.id }, select: { name: true }, orderBy: { name: "asc" } }),
    db.accountToken.findFirst({ where: { organisationId: c.org.id, kind: "INVITE", roles: { has: "ORG_ADMIN" } }, orderBy: { createdAt: "desc" }, select: { email: true, name: true, expiresAt: true, usedAt: true } }),
  ]);
  const base = `/platform-admin/clients/${c.org.id}`;
  return (
    <>
      <PxHeader crumbs={[{ href: "/platform-admin/clients", label: "All Clients" }]} title={`${c.org.name} is set up`} description={sp.reused ? "This form had already been submitted, so nothing new was created. These are the client's details." : "Everything below was created in one step."} />
      <ol aria-label="Onboarding steps" className="mb-4 flex flex-wrap gap-2 text-[12.5px]">{["Company details", "Subscription", "Administrator", "Provisioned", "Completed"].map((s, i) => <li key={s} className="rounded-full bg-[#ede9fe] px-3 py-1 text-[#3b1a86]">{i + 1}. {s} ✓</li>)}</ol>
      <OneTimeLink />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PxPanel title="Organisation">
          <KeyValues items={[["Customer reference", <span key="r" className="font-mono">{c.account.reference}</span>], ["Legal name", c.account.legalName], ["Status", <Pill key="s" value={c.account.status} />], ["Branches", branches.map((b) => b.name).join(", ")]]} />
        </PxPanel>
        <PxPanel title="Subscription and modules">
          <KeyValues items={[["Plan", c.subscription?.plan.name ?? "—"], [c.subscription?.status === "TRIAL" ? "Trial ends" : "Renews", fmtDate(c.subscription?.status === "TRIAL" ? c.subscription.trialEndsAt : c.subscription?.renewsAt)], ["Modules on", c.modules.filter((m) => m.enabled).map((m) => m.name).join(", ")]]} />
        </PxPanel>
        <PxPanel title="First administrator">
          {invite ? <KeyValues items={[["Invited", `${invite.name ?? ""} ${invite.email}`], ["Invitation", invite.usedAt ? "Accepted" : `Waiting, valid until ${fmtDate(invite.expiresAt, true)}`]]} /> : <p className="text-[13.5px]">No invitation found.</p>}
          {!invite?.usedAt ? <p className="mt-2 text-[12.5px] text-[#5b6478]">Lost the link? Create a new one from <Link href={`${base}?tab=users`}>Users &amp; Permissions</Link>; the old one stops working.</p> : null}
        </PxPanel>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={base} className={pxPrimary}>Open client profile</Link>
        <Link href={`${base}?tab=users`} className={pxSecondary}>Manage users</Link>
        <Link href={`${base}?tab=modules`} className={pxSecondary}>Configure modules</Link>
        <Link href={`${base}?tab=subscription`} className={pxSecondary}>View subscription</Link>
      </div>
    </>
  );
}

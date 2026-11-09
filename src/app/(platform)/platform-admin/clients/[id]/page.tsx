import { notFound } from "next/navigation";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getClient } from "@/server/platform/customers";
import { Pill, PxFlash, PxHeader, pxSecondary, returnTo, Tabs } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { ModulesTab, OverviewTab, SecurityTab, SettingsTab, SubscriptionTab, UsageTab, UsersTab } from "./tabs";
import { ClientDrawer, DRAWERS, type DrawerKey } from "./drawers";

export const dynamic = "force-dynamic";

const TABS = [["overview", "Overview"], ["users", "Users & Permissions"], ["subscription", "Subscription"], ["modules", "Modules"], ["usage", "Usage"], ["security", "Security"], ["settings", "Settings"]] as const;
type Tab = (typeof TABS)[number][0];
/** Tabs of the first Admin Centre, kept working as deep links: each opens the tab that now holds its content. */
const LEGACY: Record<string, { tab: Tab; edit?: DrawerKey }> = { company: { tab: "overview", edit: "company" }, branches: { tab: "overview" }, ai: { tab: "usage" }, storage: { tab: "usage" }, audit: { tab: "security" } };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const c = await getClient(ctx, (await params).id).catch(() => null);
  return { title: c ? c.org.name : "Client" };
}

/**
 * One client's workspace. The client's name, reference and status stay at the top of every tab; focused changes
 * (company details, a branch, an invitation, a person's access, the plan) open in a side panel over the tab.
 */
export default async function ClientWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const client = await orNotFound(getClient(ctx, id));
  if (!client) notFound();
  const legacy = sp.tab ? LEGACY[sp.tab] : undefined;
  const tab: Tab = legacy?.tab ?? (TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : "overview");
  const edit = (sp.edit ?? legacy?.edit) as DrawerKey | undefined;
  const base = `/platform-admin/clients/${id}`;
  const listBack = returnTo(sp.back, "/platform-admin/clients");
  const keep = sp.back ? `&back=${encodeURIComponent(listBack)}` : "";
  const here = `${base}?tab=${tab}${keep}`;
  const drawerHref = (key: DrawerKey, extra = "") => `${here}&edit=${key}${extra}`;
  const props = { ctx, client, back: here, sp, drawerHref, tab };
  const { account: a, subscription: s } = client;
  return (
    <>
      <PxHeader
        crumbs={[{ href: listBack, label: "Clients" }]}
        title={<span className="flex flex-wrap items-center gap-2.5">{client.org.name}<Pill value={a.status} /></span>}
        meta={
          <>
            <span className="font-mono text-px-body">{a.reference}</span>
            <span>{s ? <>{s.plan.name} · <span className="lowercase">{s.status === "TRIAL" ? "trial" : s.billingPeriod}</span></> : "No subscription"}</span>
            <span>{client.usage.users} users · {client.usage.branches} branch{client.usage.branches === 1 ? "" : "es"}</span>
            {a.legalName !== client.org.name ? <span>{a.legalName}</span> : null}
          </>
        }
        actions={<Link href={drawerHref("company")} scroll={false} className={pxSecondary}><PencilSimple size={15} aria-hidden="true" />Edit details</Link>}
      />
      <Tabs label="Client workspace" items={TABS.map(([t, l]) => ({ href: `${base}?tab=${t}${keep}`, label: l, active: t === tab }))} />
      <PxFlash searchParams={sp} />
      <OneTimeLink />
      {tab === "overview" ? <OverviewTab {...props} /> : null}
      {tab === "users" ? <UsersTab {...props} /> : null}
      {tab === "subscription" ? <SubscriptionTab {...props} /> : null}
      {tab === "modules" ? <ModulesTab {...props} /> : null}
      {tab === "usage" ? <UsageTab {...props} /> : null}
      {tab === "security" ? <SecurityTab {...props} /> : null}
      {tab === "settings" ? <SettingsTab {...props} /> : null}
      {edit && DRAWERS.includes(edit) ? <ClientDrawer edit={edit} {...props} closeHref={here} memberId={sp.member} /> : null}
    </>
  );
}

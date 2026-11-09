import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getClient } from "@/server/platform/customers";
import { Flash } from "@/components/ui";
import { Pill, PxHeader, Tabs } from "@/components/platform/ui";
import { OneTimeLink } from "@/components/platform/one-time-link";
import { AiTab, AuditTab, BranchesTab, CompanyTab, ModulesTab, OverviewTab, SecurityTab, SettingsTab, StorageTab, SubscriptionTab, UsersTab } from "./tabs";

export const dynamic = "force-dynamic";

const TABS: [string, string][] = [
  ["overview", "Overview"], ["company", "Company Details"], ["branches", "Branches"], ["users", "Users & Permissions"], ["subscription", "Subscription"],
  ["modules", "Modules"], ["ai", "AI Usage"], ["storage", "Storage"], ["security", "Security"], ["settings", "Settings"], ["audit", "Audit History"],
];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const c = await getClient(ctx, (await params).id).catch(() => null);
  return { title: c ? c.org.name : "Client" };
}

/** One client's administration profile. The client is named at the top of every tab. */
export default async function ClientProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const client = await orNotFound(getClient(ctx, id));
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "overview";
  const base = `/platform-admin/clients/${id}`;
  const back = `${base}?tab=${tab}`;
  if (!client) notFound();
  const props = { ctx, client, back, sp };
  return (
    <>
      <PxHeader
        crumbs={[{ href: "/platform-admin/clients", label: "All Clients" }]}
        title={<span className="flex flex-wrap items-center gap-3">{client.org.name}<Pill value={client.account.status} /></span>}
        description={<>Customer reference <span className="font-mono">{client.account.reference}</span>{client.account.legalName !== client.org.name ? ` · ${client.account.legalName}` : ""}{client.subscription ? ` · ${client.subscription.plan.name}` : " · no subscription"}</>}
      />
      <Tabs items={TABS.map(([t, l]) => ({ href: `${base}?tab=${t}`, label: l, active: t === tab }))} />
      <Flash searchParams={sp} />
      <OneTimeLink />
      {tab === "overview" ? <OverviewTab {...props} /> : null}
      {tab === "company" ? <CompanyTab {...props} /> : null}
      {tab === "branches" ? <BranchesTab {...props} /> : null}
      {tab === "users" ? <UsersTab {...props} /> : null}
      {tab === "subscription" ? <SubscriptionTab {...props} /> : null}
      {tab === "modules" ? <ModulesTab {...props} /> : null}
      {tab === "ai" ? <AiTab {...props} /> : null}
      {tab === "storage" ? <StorageTab {...props} /> : null}
      {tab === "security" ? <SecurityTab {...props} /> : null}
      {tab === "settings" ? <SettingsTab {...props} /> : null}
      {tab === "audit" ? <AuditTab {...props} /> : null}
    </>
  );
}

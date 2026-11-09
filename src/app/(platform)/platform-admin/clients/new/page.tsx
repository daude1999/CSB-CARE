import { randomBytes } from "node:crypto";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { requirePlatform } from "@/server/platform/access";
import { listPlans } from "@/server/platform/subscriptions";
import { getSetting } from "@/server/platform/settings";
import { ORG_ROLE_NAMES } from "@/server/platform/accounts";
import { MODULES } from "@/lib/platform-modules";
import { EmptyState, PxHeader, PxPanel, pxPrimary } from "@/components/platform/ui";
import { OnboardingWizard } from "@/components/platform/onboarding-wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add Client" };

/** Add New Client: a guided five-step set-up. The form carries a one-time key so a retried submission never duplicates the client. */
export default async function NewClientPage() {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.customers");
  const [plans, trialDays, defaultModules] = await Promise.all([listPlans(ctx), getSetting("customers.trialDays"), getSetting("customers.defaultModules")]);
  const trialEnd = new Date(Date.now() + trialDays * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <PxHeader title="Add client" description="Creates the organisation, its subscription and modules, and its first administrator's invitation in one step. Safe to retry." />
      {plans.length ? (
        <OnboardingWizard
          onboardingKey={randomBytes(18).toString("base64url")}
          plans={plans.map((p) => ({ id: p.id, name: p.name, modules: p.modules, includedUsers: p.includedUsers, includedBranches: p.includedBranches, storageMb: p.storageMb, aiRequestsPerMonth: p.aiRequestsPerMonth, monthlyPricePence: p.monthlyPricePence, annualPricePence: p.annualPricePence }))}
          modules={MODULES.map((m) => ({ key: m.key, name: m.name, summary: m.summary }))}
          defaultModules={defaultModules}
          trialEnd={trialEnd}
          roles={Object.entries(ORG_ROLE_NAMES)}
        />
      ) : (
        <PxPanel>
          <EmptyState title="Create a plan first" action={<Link href="/platform-admin/plans?new=1" className={pxPrimary}>Create a plan</Link>}>Every client starts on a subscription plan, and none exists yet. Prices are never assumed; you can leave them empty for now.</EmptyState>
        </PxPanel>
      )}
    </>
  );
}

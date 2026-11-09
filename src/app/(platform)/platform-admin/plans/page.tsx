import { requireCtx } from "@/server/auth/current";
import { listPlans } from "@/server/platform/subscriptions";
import { MODULES } from "@/lib/platform-modules";
import { Flash } from "@/components/ui";
import { Back, Confirm, EmptyRow, fmtMoney, fmtNumber, NotConfigured, Pill, PxHeader, PxPanel, pxPrimary } from "@/components/platform/ui";
import { savePlanAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans & Pricing" };

type Plan = Awaited<ReturnType<typeof listPlans>>[number];
const pounds = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));

function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <form action={savePlanAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Back value="/platform-admin/plans" />
      {plan ? <input type="hidden" name="planId" value={plan.id} /> : null}
      <label><span className="label">Plan name</span><input name="name" required defaultValue={plan?.name ?? ""} className="input" /></label>
      <label><span className="label">Code</span><input name="code" required defaultValue={plan?.code ?? ""} placeholder="STARTER" className="input font-mono" /></label>
      <label className="md:col-span-2"><span className="label">Description</span><input name="description" defaultValue={plan?.description ?? ""} className="input" /></label>
      <label><span className="label">Monthly price (£, leave empty if not agreed)</span><input name="monthlyPrice" inputMode="decimal" defaultValue={pounds(plan?.monthlyPricePence ?? null)} className="input" /></label>
      <label><span className="label">Annual price (£)</span><input name="annualPrice" inputMode="decimal" defaultValue={pounds(plan?.annualPricePence ?? null)} className="input" /></label>
      <label><span className="label">Included users</span><input type="number" min={0} name="includedUsers" defaultValue={plan?.includedUsers ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">Included branches</span><input type="number" min={0} name="includedBranches" defaultValue={plan?.includedBranches ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">Storage allowance (MB)</span><input type="number" min={0} name="storageMb" defaultValue={plan?.storageMb ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">AI requests per month</span><input type="number" min={0} name="aiRequestsPerMonth" defaultValue={plan?.aiRequestsPerMonth ?? ""} placeholder="None set" className="input" /></label>
      <label><span className="label">Support entitlement</span><input name="supportLevel" defaultValue={plan?.supportLevel ?? ""} placeholder="e.g. Email, next working day" className="input" /></label>
      <label><span className="label">Optional add-ons (commas)</span><input name="addOns" defaultValue={plan?.addOns.join(", ") ?? ""} className="input" /></label>
      <fieldset className="md:col-span-2"><legend className="label">Available modules</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">{MODULES.map((m) => <label key={m.key} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="modules" value={m.key} defaultChecked={plan ? plan.modules.includes(m.key) : true} />{m.name}</label>)}</div>
      </fieldset>
      <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="active" defaultChecked={plan ? plan.active : true} />Available for new subscriptions</label>
      <div className="md:col-span-2"><button className={pxPrimary}>{plan ? "Save plan" : "Create plan"}</button></div>
    </form>
  );
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const plans = await listPlans(ctx, { includeInactive: true });
  return (
    <>
      <PxHeader title="Plans & Pricing" description="Configure the plans Evantix offers. No price is assumed: a plan without an agreed price says so, and revenue figures leave it out. Changing a plan does not change existing subscriptions' allowances." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {plans.length ? plans.map((p) => (
            <PxPanel key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.name}<span className="font-mono text-[12px] font-normal text-[#5b6478]">{p.code}</span>{p.active ? null : <Pill value="CLOSED" label="Not offered" />}</span>} actions={<span className="text-[12.5px] text-[#5b6478]">{p.currentClients} client(s)</span>}>
              <p className="text-[13.5px]">{fmtMoney(p.monthlyPricePence) ?? <NotConfigured>Monthly price not set</NotConfigured>} a month · {fmtMoney(p.annualPricePence) ?? <NotConfigured>Annual price not set</NotConfigured>} a year</p>
              <p className="mt-1 text-[12.5px] text-[#46505f]">{p.includedUsers === null ? "Unlimited" : fmtNumber(p.includedUsers)} users · {p.includedBranches === null ? "unlimited" : fmtNumber(p.includedBranches)} branches · {p.storageMb === null ? "unlimited" : `${fmtNumber(p.storageMb)} MB`} storage · {p.aiRequestsPerMonth === null ? "no AI allowance set" : `${fmtNumber(p.aiRequestsPerMonth)} AI requests a month`}{p.supportLevel ? ` · ${p.supportLevel}` : ""}</p>
              <p className="mt-1 text-[12.5px] text-[#46505f]">Modules: {p.modules.map((k) => MODULES.find((m) => m.key === k)?.name ?? k).join(", ")}</p>
              <div className="mt-2"><Confirm label="Edit plan"><PlanForm plan={p} /></Confirm></div>
            </PxPanel>
          )) : <PxPanel><EmptyRow>No plans yet. Create the first one.</EmptyRow></PxPanel>}
        </div>
        <PxPanel title="New plan"><PlanForm /></PxPanel>
      </div>
    </>
  );
}

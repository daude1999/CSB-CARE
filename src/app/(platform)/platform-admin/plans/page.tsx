import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { listPlans } from "@/server/platform/subscriptions";
import { MODULES } from "@/lib/platform-modules";
import { Back, EmptyState, fmtMoney, fmtNumber, NotConfigured, Pill, PxDrawer, PxFlash, PxHeader, PxPanel, pxPrimary, pxSecondary, pxSm, Table } from "@/components/platform/ui";
import { savePlanAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans" };

type Plan = Awaited<ReturnType<typeof listPlans>>[number];
const pounds = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));
const limit = (n: number | null, unit = "") => (n === null ? "Unlimited" : `${fmtNumber(n)}${unit}`);

function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <form action={savePlanAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Back value="/platform-admin/plans" />
      {plan ? <input type="hidden" name="planId" value={plan.id} /> : null}
      <label><span className="label">Plan name</span><input name="name" required defaultValue={plan?.name ?? ""} className="input" /></label>
      <label><span className="label">Code</span><input name="code" required defaultValue={plan?.code ?? ""} placeholder="STARTER" className="input font-mono" /></label>
      <label className="sm:col-span-2"><span className="label">Description</span><input name="description" defaultValue={plan?.description ?? ""} className="input" /></label>
      <label><span className="label">Monthly price (£)</span><input name="monthlyPrice" inputMode="decimal" defaultValue={pounds(plan?.monthlyPricePence ?? null)} placeholder="Leave empty if not agreed" className="input" /></label>
      <label><span className="label">Annual price (£)</span><input name="annualPrice" inputMode="decimal" defaultValue={pounds(plan?.annualPricePence ?? null)} placeholder="Leave empty if not agreed" className="input" /></label>
      <label><span className="label">Included users</span><input type="number" min={0} name="includedUsers" defaultValue={plan?.includedUsers ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">Included branches</span><input type="number" min={0} name="includedBranches" defaultValue={plan?.includedBranches ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">Storage (MB)</span><input type="number" min={0} name="storageMb" defaultValue={plan?.storageMb ?? ""} placeholder="Unlimited" className="input" /></label>
      <label><span className="label">AI requests per month</span><input type="number" min={0} name="aiRequestsPerMonth" defaultValue={plan?.aiRequestsPerMonth ?? ""} placeholder="None set" className="input" /></label>
      <label><span className="label">Support</span><input name="supportLevel" defaultValue={plan?.supportLevel ?? ""} placeholder="e.g. Email, next working day" className="input" /></label>
      <label><span className="label">Add-ons</span><input name="addOns" defaultValue={plan?.addOns.join(", ") ?? ""} placeholder="Separate with commas" className="input" /></label>
      <fieldset className="sm:col-span-2"><legend className="label">Modules included</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{MODULES.map((m) => <label key={m.key} className="flex items-center gap-2 text-body"><input type="checkbox" name="modules" value={m.key} defaultChecked={plan ? plan.modules.includes(m.key) : true} />{m.name}</label>)}</div>
      </fieldset>
      <label className="flex items-center gap-2 text-body sm:col-span-2"><input type="checkbox" name="active" defaultChecked={plan ? plan.active : true} />Offered for new subscriptions</label>
      <div className="sticky bottom-0 -mx-5 mt-2 flex justify-end gap-2 border-t border-px-line bg-white px-5 py-3 sm:col-span-2">
        <Link href="/platform-admin/plans" scroll={false} className={pxSecondary}>Cancel</Link>
        <button className={pxPrimary}>{plan ? "Save plan" : "Create plan"}</button>
      </div>
    </form>
  );
}

/** The plans Evantix offers. No price is ever assumed: a plan without an agreed price says so. */
export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const plans = await listPlans(ctx, { includeInactive: true });
  const editing = sp.edit ? plans.find((p) => p.id === sp.edit) : undefined;
  return (
    <>
      <PxHeader title="Plans" description="The plans Evantix offers. Prices are never assumed, and changing a plan does not change existing subscriptions' allowances." actions={<Link href="?new=1" scroll={false} className={pxPrimary}><Plus size={15} aria-hidden="true" />New plan</Link>} />
      <PxFlash searchParams={sp} />
      <PxPanel flush>
        {plans.length ? (
          <div className="px-4">
            <Table label="Plans" minWidth={980} head={["Plan", "Monthly", "Annual", "Users", "Branches", "Storage", "AI / month", "Modules", "Clients", ""]} align={["left", "right", "right", "right", "right", "right", "right", "left", "right", "right"]}>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><span className="flex flex-wrap items-center gap-2 font-medium text-px-ink">{p.name}{p.active ? null : <Pill value="CLOSED" label="Not offered" />}</span><span className="block font-mono text-caption text-px-subtle">{p.code}{p.supportLevel ? ` · ${p.supportLevel}` : ""}</span></td>
                  <td className="text-right tabular-nums">{fmtMoney(p.monthlyPricePence) ?? <NotConfigured>Not set</NotConfigured>}</td>
                  <td className="text-right tabular-nums">{fmtMoney(p.annualPricePence) ?? <NotConfigured>Not set</NotConfigured>}</td>
                  <td className="text-right tabular-nums">{limit(p.includedUsers)}</td>
                  <td className="text-right tabular-nums">{limit(p.includedBranches)}</td>
                  <td className="text-right tabular-nums">{limit(p.storageMb, " MB")}</td>
                  <td className="text-right tabular-nums">{p.aiRequestsPerMonth === null ? "—" : fmtNumber(p.aiRequestsPerMonth)}</td>
                  <td className="text-meta text-px-body" title={p.modules.map((k) => MODULES.find((m) => m.key === k)?.name ?? k).join(", ")}>{p.modules.length} of {MODULES.length}</td>
                  <td className="text-right tabular-nums">{fmtNumber(p.currentClients)}</td>
                  <td className="text-right"><Link href={`?edit=${p.id}`} scroll={false} className={`${pxSecondary} ${pxSm}`} aria-label={`Edit ${p.name}`}>Edit</Link></td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyState title="No plans yet" action={<Link href="?new=1" scroll={false} className={pxPrimary}>Create the first plan</Link>}>A plan sets a client&apos;s allowances and modules. Leave prices empty until they are agreed.</EmptyState>}
      </PxPanel>
      {sp.new ? <PxDrawer closeHref="/platform-admin/plans" title="New plan" description="Prices are optional. Revenue figures leave out plans without one."><PlanForm /></PxDrawer> : null}
      {editing ? <PxDrawer closeHref="/platform-admin/plans" title={`Edit ${editing.name}`} description={`${editing.currentClients} client${editing.currentClients === 1 ? " is" : "s are"} on this plan. Their allowances do not change.`}><PlanForm plan={editing} /></PxDrawer> : null}
    </>
  );
}

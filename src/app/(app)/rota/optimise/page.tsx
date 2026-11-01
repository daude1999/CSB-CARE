import Link from "@/components/link";
import { addDays, fmtLondonDate, londonDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { DEFAULT_GAP_MINUTES, DEFAULT_MAX_SHIFT, MAX_PLAN_DAYS, listPlans, planRange, type PlanSummary } from "@/server/rota/optimise";
import { memberNames, rotaLookups } from "@/server/rota/queries";
import { generatePlanAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const STATUS = { DRAFT: ["Draft", "amber"], APPLIED: ["Applied", "green"], DISCARDED: ["Discarded", "slate"] } as const;
const day = (iso: string) => fmtLondonDate(iso, { weekday: "short", day: "numeric", month: "short" });

/**
 * Generate & Optimise: proposes carers for the open slots in a date range, with small time adjustments where they let a
 * carer fit. It only proposes; the coordinator accepts or rejects each change and applies them.
 */
export default async function OptimisePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const [plans, lk] = await Promise.all([listPlans(ctx, 15), rotaLookups(ctx)]);
  const names = await memberNames(ctx, plans.map((p) => p.createdById));
  const tomorrow = addDays(londonDate(), 1);

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="daily" active="optimise" />}
        title="Generate & Optimise Rota"
        back="/rota"
        subtitle="Proposes a carer for every open slot, using only carers who pass the eligibility checks, and suggests small time changes where they let someone fit. Nothing changes on the rota until you accept changes and apply them."
        actions={<Link href="/rota/unassigned" className="btn-secondary">Unassigned Visits</Link>}
      />
      <Flash searchParams={sp} />
      {canBuild ? (
        <section aria-labelledby="gen-h" className="panel mb-4">
          <h2 id="gen-h" className="text-[16px] font-medium text-navy-900">New plan</h2>
          <form action={generatePlanAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
            <input type="hidden" name="back" value="/rota/optimise" />
            <label><span className="label">From</span><input type="date" name="from" defaultValue={sp.from ?? tomorrow} min={londonDate()} required className="input w-full" /></label>
            <label><span className="label">Days</span><select name="days" defaultValue="1" className="input w-full">{Array.from({ length: MAX_PLAN_DAYS }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} day{i ? "s" : ""}</option>)}</select></label>
            <label><span className="label">Area</span><select name="areaId" defaultValue="" className="input w-full"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label><span className="label">Minimum gap between visits (min)</span><input type="number" name="gapMinutes" min={0} max={120} defaultValue={DEFAULT_GAP_MINUTES} className="input w-full" /></label>
            <label><span className="label">Largest time change (min)</span><select name="maxShiftMinutes" defaultValue={String(DEFAULT_MAX_SHIFT)} className="input w-full">{[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m ? `Up to ${m} minutes` : "Never move visits"}</option>)}</select></label>
            <button className="btn-primary">Generate plan</button>
            <label className="flex items-center gap-2 text-[14px] sm:col-span-2 lg:col-span-6">
              <input type="checkbox" name="respectWeeklyLimits" defaultChecked /> Keep carers within their weekly hours limit
            </label>
          </form>
          <p className="mt-3 text-[13px] text-slate-600">
            Gaps are judged in <strong className="font-medium">time-gap mode</strong>: a fixed number of minutes between one visit ending and the next starting. The platform has no routing service, so it does not know distances or driving times and never shows them. Time-locked visits and visits that already have a carer are never moved.
          </p>
        </section>
      ) : (
        <p className="panel mb-4 text-[14px] text-slate-700">Your role can view plans but not generate or apply them.</p>
      )}

      <Card title="Recent plans">
        {plans.length ? (
          <div className="overflow-x-auto">
            <table className="table min-w-[720px] text-[14px]">
              <thead><tr><th scope="col">Dates</th><th scope="col">Area</th><th scope="col">Proposed</th><th scope="col">Left open</th><th scope="col">Status</th><th scope="col">Made by</th></tr></thead>
              <tbody>
                {plans.map((p) => {
                  const s = p.summary as unknown as PlanSummary;
                  const r = planRange(p);
                  const [label, tone] = STATUS[p.status];
                  return (
                    <tr key={p.id}>
                      <td><Link href={`/rota/optimise/${p.id}`} className="row-title">{r.from === r.to ? day(r.from) : `${day(r.from)} to ${day(r.to)}`}</Link></td>
                      <td>{p.areaId ? lk.areas.find((a) => a.id === p.areaId)?.name ?? "Area" : "All areas"}</td>
                      <td className="tabular-nums">{s.proposed ?? 0} of {s.openSlots ?? 0}</td>
                      <td className="tabular-nums">{s.unfilled?.length ?? 0}</td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td>{names.get(p.createdById) ?? "—"} · {p.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No plans yet. Generate one above.</Empty>}
      </Card>
    </>
  );
}

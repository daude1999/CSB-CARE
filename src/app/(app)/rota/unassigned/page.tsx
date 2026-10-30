import type { AssignmentSlot } from "@prisma/client";
import Link from "@/components/link";
import { addDays, fmtLondonDate, fromDbDate, isIsoDate, londonDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listVisits, rotaLookups, suName, visitCandidatesMany } from "@/server/rota/queries";
import { assignCarerAction } from "@/app/rota-actions";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import { AreaDot, CarerSlots, TimeSpan } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const STATE = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;
/** Ranked suggestions are worked out for this many visits per page; the rest link to the visit page. */
const SUGGEST = 25;

export default async function UnassignedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const from = sp.from && isIsoDate(sp.from) ? sp.from : londonDate();
  const days = Math.min(Math.max(Number(sp.days) || 14, 1), 28);
  const to = addDays(from, days - 1);
  const [{ rows }, lk] = await Promise.all([listVisits(ctx, { date: from, to, unassigned: true, areaId: sp.area || undefined }), rotaLookups(ctx)]);
  const now = Date.now();
  const open = rows.filter((v) => v.scheduledEnd.getTime() > now);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const wanted = (canEdit ? open.slice(0, SUGGEST) : []).map((v) => ({ visit: v, slot: (v.assignments.some((a) => a.slot === "PRIMARY") ? "SECOND" : "PRIMARY") as AssignmentSlot }));
  const ranked = await visitCandidatesMany(ctx, wanted);
  const suggestions = new Map(wanted.map(({ visit, slot }) => [visit.id, { slot, list: (ranked.get(visit.id) ?? []).filter((c) => c.state !== "NOT_ELIGIBLE").slice(0, 8) }] as const));
  const dates = [...new Set(open.map((v) => fromDbDate(v.date)))];
  const back = `/rota/unassigned?from=${from}&days=${days}${sp.area ? `&area=${sp.area}` : ""}`;
  const slots = open.reduce((n, v) => n + v.flags.unassignedSlots, 0);

  return (
    <>
      <PageHeader title="Unassigned Visits" back="/rota" subtitle="Visits with an empty carer slot, soonest first. Suggestions are ranked by the shared eligibility check; people who cannot work the visit are not offered." />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
          <label><span className="label">Days</span><select name="days" defaultValue={String(days)} className="input"><option value="7">7</option><option value="14">14</option><option value="28">28</option></select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className="btn-primary">Show</button>
          <p className="ml-auto pb-2 text-[13.5px] text-slate-600"><span className="tabular-nums">{open.length}</span> visits · <span className="tabular-nums">{slots}</span> empty slots · {fmtLondonDate(from, { day: "numeric", month: "short" })} to {fmtLondonDate(to, { day: "numeric", month: "short" })}</p>
        </form>
      </section>
      {open.length ? (
        dates.map((d) => (
          <Card key={d} title={fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })} className="mb-3">
            <ul className="rows">
              {open.filter((v) => fromDbDate(v.date) === d).map((v) => {
                const s = suggestions.get(v.id);
                return (
                  <li key={v.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
                      <TimeSpan start={v.scheduledStart} end={v.scheduledEnd} />
                      <Link href={`/rota/visits/${v.id}`} className="row-title">{suName(v.serviceUser)}</Link>
                      <span className="text-slate-600">{v.callType.name}{v.carersRequired > 1 ? " · double-up" : ""}</span>
                      <AreaDot area={v.area} />
                      <CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} />
                    </div>
                    {s ? (
                      s.list.length ? (
                        <form action={assignCarerAction} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="visitId" value={v.id} />
                          <input type="hidden" name="slot" value={s.slot} />
                          <input type="hidden" name="lockVersion" value={v.lockVersion} />
                          <select name="staffId" required className="input min-w-0 max-w-lg basis-full py-1.5 text-[14px] sm:basis-0 sm:flex-1" aria-label={`Carer for ${suName(v.serviceUser)} at ${v.scheduledStart.toISOString()}`}>
                            <option value="">Choose a carer…</option>
                            {s.list.map((c) => <option key={c.id} value={c.id}>{c.name} — {STATE[c.state]}{c.reasons.length ? `: ${c.reasons.slice(0, 2).join("; ")}` : ""}</option>)}
                          </select>
                          <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" name="acceptWarnings" className="h-4 w-4" /> Accept warnings</label>
                          <button className="btn-primary py-1">Assign</button>
                        </form>
                      ) : <p className="mt-1 text-[13px] text-[#a3242c]">No one is free and eligible for this time. Consider moving the visit or asking HR about absences.</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      ) : (
        <Card><Empty>No empty carer slots in these dates.</Empty></Card>
      )}
      {canEdit && open.length > SUGGEST ? <p className="text-[13px] text-slate-600">Suggestions are shown for the first {SUGGEST} visits. Assign those, or open a visit to choose a carer.</p> : null}
    </>
  );
}

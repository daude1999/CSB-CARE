import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonTime, mondayOf, dbDate } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { previewBuild, type BuildPlan } from "@/server/rota/build";
import { memberNames, rotaLookups } from "@/server/rota/queries";
import { confirmBuildAction, deleteBuildAction, publishBuildAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { Stepper } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

export default async function BuildRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.build")) notFound();
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const thisMonday = mondayOf(londonDate());
  const week = (() => {
    const w = one("week");
    return w && isIsoDate(w) ? mondayOf(w) : addDays(thisMonday, 7);
  })();
  const areaIds = ([] as string[]).concat(sp.areas ?? []).filter(Boolean);
  const cycle = one("cycle") ? Number(one("cycle")) : undefined;
  const lk = await rotaLookups(ctx);
  let plan: BuildPlan | null = null;
  let planError: string | null = null;
  try {
    plan = await previewBuild(ctx, { weekStart: week, areaIds, cycleWeek: cycle });
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    planError = e.message;
  }
  const builds = await db.rotaBuild.findMany({ where: { organisationId: lk.scope.organisationId, weekStart: dbDate(week) }, orderBy: { builtAt: "desc" } });
  const unpublished = builds.length
    ? await db.visit.groupBy({ by: ["rotaBuildId"], where: { rotaBuildId: { in: builds.map((b) => b.id) }, publishedAt: null, status: { not: "CANCELLED" } }, _count: true })
    : [];
  const names = await memberNames(ctx, builds.flatMap((b) => [b.builtById, b.deletedById]));
  const past = week < thisMonday;
  const params = { week, cycle: one("cycle") };
  const back = `/rota/build?week=${week}`;
  const days = plan ? [...new Set(plan.visits.map((v) => v.date))].sort() : [];
  const areaName = new Map(lk.areas.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader
        title="Build Rota"
        back="/rota"
        subtitle="Turns the rota templates for one week into dated visits. Every proposed carer is checked first; anyone who cannot work a visit is left off and the slot stays unassigned. Nothing is saved until you confirm, and a week can never be built twice."
      />
      <Flash searchParams={sp as Record<string, string | undefined>} />

      <div className="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card title="1. Choose the week">
            <Stepper base="/rota/build" params={params} param="week" prev={addDays(week, -7)} next={addDays(week, 7)} label={`w/c ${fmtLondonDate(week, { day: "numeric", month: "short", year: "numeric" })}`} />
            <form method="get" className="mt-3 space-y-2.5">
              <input type="hidden" name="week" value={week} />
              <fieldset>
                <legend className="label">Areas (none ticked means all yours)</legend>
                <div className="grid grid-cols-2 gap-1">
                  {lk.areas.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="areas" value={a.id} defaultChecked={areaIds.includes(a.id)} className="h-4 w-4" /> {a.name}</label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="label">Cycle week</span>
                <select name="cycle" defaultValue={one("cycle") ?? ""} className="input">
                  <option value="">Work it out from the cycle start</option>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Week {n}</option>)}
                </select>
              </label>
              <button className="btn-secondary">Preview</button>
            </form>
          </Card>

          {plan ? (
            <Card title="2. Before you build">
              <ul className="space-y-2">
                {plan.checklist.map((c) => (
                  <li key={c.label} className="flex gap-2 text-[14px]">
                    <span aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 rounded-full ${c.ok ? "bg-[#3fae6a]" : "bg-[#e3934a]"}`} />
                    <span><span className="font-medium">{c.label}</span><span className="sr-only">{c.ok ? " (done)" : " (check)"}</span><span className="block text-slate-600">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12.5px] text-slate-500">Holiday and sickness requests are decided in <Link href="/workforce/absences">Workforce absences</Link>.</p>
            </Card>
          ) : null}

          {plan ? (
            <Card title="3. Confirm">
              <dl className="grid grid-cols-2 gap-2 text-[14px]">
                <dt className="text-slate-600">Visits to create</dt><dd className="text-right tabular-nums">{plan.visits.length}</dd>
                <dt className="text-slate-600">Already built</dt><dd className="text-right tabular-nums">{plan.alreadyBuilt}</dd>
                <dt className="text-slate-600">Skipped</dt><dd className="text-right tabular-nums">{plan.skipped.length}</dd>
                <dt className="text-slate-600">Carer slots left empty</dt><dd className={`text-right tabular-nums ${plan.unassignedSlots ? "text-[#a3242c]" : ""}`}>{plan.unassignedSlots}</dd>
                <dt className="text-slate-600">Allocated with warnings</dt><dd className="text-right tabular-nums">{plan.flaggedSlots}</dd>
                <dt className="text-slate-600">Planned care hours</dt><dd className="text-right tabular-nums">{(plan.forecastMinutes / 60).toFixed(1)}</dd>
              </dl>
              {past ? (
                <p className="mt-3 text-[14px] text-[#8a5a00]">This week has started or passed, so it cannot be built.</p>
              ) : plan.visits.length ? (
                <form action={confirmBuildAction} className="mt-3">
                  <input type="hidden" name="back" value={`${back}${cycle ? `&cycle=${cycle}` : ""}${areaIds.map((a) => `&areas=${a}`).join("")}`} />
                  <input type="hidden" name="weekStart" value={week} />
                  {cycle ? <input type="hidden" name="cycleWeek" value={cycle} /> : null}
                  {areaIds.map((a) => <input key={a} type="hidden" name="areaIds" value={a} />)}
                  <button className="btn-primary w-full">Build {plan.visits.length} visits for Week {plan.cycleWeek}</button>
                  <p className="mt-2 text-[12.5px] text-slate-500">Visits are saved unpublished. Carers see them only after you publish.</p>
                </form>
              ) : (
                <p className="mt-3 text-[14px] text-slate-600">Nothing new to build for this week.</p>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-3">
          {planError ? <div role="alert" className="rounded-[3px] border-l-4 border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{planError}</div> : null}

          <Card title={`Builds for w/c ${fmtLondonDate(week, { day: "numeric", month: "short" })}`}>
            {builds.length ? (
              <ul className="rows">
                {builds.map((b) => {
                  const pending = unpublished.find((u) => u.rotaBuildId === b.id)?._count ?? 0;
                  return (
                    <li key={b.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-navy-900">Week {b.cycleWeek} · {b.visitCount} visits</span>
                        {b.status === "DELETED" ? <Badge>Deleted</Badge> : pending ? <Badge tone="amber">{pending} not published</Badge> : <Badge tone="green">Published</Badge>}
                        {b.unassignedSlots ? <Badge tone="rose">{b.unassignedSlots} empty slots at build</Badge> : null}
                      </div>
                      <p className="text-[13px] text-slate-600">
                        Built by {names.get(b.builtById) ?? "a former member"} on {fmtDate(b.builtAt, true)} · {b.areaIds.length ? b.areaIds.map((a) => areaName.get(a) ?? "other area").join(", ") : "all areas"}
                        {b.deletedAt ? ` · deleted by ${names.get(b.deletedById ?? "") ?? "a former member"} on ${fmtDate(b.deletedAt, true)}` : ""}
                      </p>
                      {b.status === "BUILT" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Link href={`/rota/visits?date=${fromDbDate(b.weekStart)}`} className="btn-secondary py-1">Check visits</Link>
                          {pending ? (
                            <form action={publishBuildAction}>
                              <input type="hidden" name="back" value={back} />
                              <input type="hidden" name="buildId" value={b.id} />
                              <button className="btn-primary py-1">Publish to carers</button>
                            </form>
                          ) : null}
                          <form action={deleteBuildAction} className="flex items-center gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="buildId" value={b.id} />
                            <input name="reason" required minLength={3} className="input w-48 py-1.5 text-[14px]" placeholder="Reason to delete" aria-label="Reason to delete this build" />
                            <button className="btn-secondary py-1">Delete build</button>
                          </form>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>This week has not been built yet.</Empty>
            )}
            <p className="mt-2 text-[12.5px] text-slate-500">A build can be deleted only while none of its visits has started, been changed by hand or had anything recorded.</p>
          </Card>

          {plan ? (
            <Card title={`Preview: ${plan.visits.length} new visits`}>
              {plan.visits.length ? (
                <div className="space-y-4">
                  {days.map((d) => {
                    const list = plan!.visits.filter((v) => v.date === d);
                    return (
                      <section key={d} aria-label={fmtLondonDate(d)}>
                        <h3 className="mb-1 text-[14.5px] font-semibold text-navy-900">{fmtLondonDate(d, { weekday: "long", day: "numeric", month: "short" })} <span className="font-normal text-slate-500">· {list.length} visits</span></h3>
                        <table className="table">
                          <thead><tr><th>Time</th><th>Service user</th><th>Call</th><th>Carers</th></tr></thead>
                          <tbody>
                            {list.map((v) => (
                              <tr key={`${v.templateId}-${d}`}>
                                <td className="tabular-nums">{londonTime(v.start)}–{londonTime(v.end)}</td>
                                <td>{v.serviceUserName}</td>
                                <td>{v.callType}</td>
                                <td>
                                  <span className="flex flex-wrap gap-1">
                                    {v.slots.map((s) => (
                                      <span key={s.slot} title={s.reason} className={`rounded-[3px] px-1.5 text-[12.5px] ${s.state === "UNASSIGNED" ? "border border-dashed border-[#e4544f] text-[#a3242c]" : s.state === "FLAGGED" ? "bg-[#fdf0d8] text-[#8a5a00]" : "bg-[#e3effb] text-[#1d4f91]"}`}>
                                        {s.state === "UNASSIGNED" ? `Unassigned${s.staffName ? ` (${s.staffName} not eligible)` : ""}` : s.staffName}
                                        {s.slot === "SHADOW" ? " · shadow" : ""}
                                      </span>
                                    ))}
                                  </span>
                                  {v.slots.some((s) => s.reason) ? <span className="mt-0.5 block text-[12px] text-slate-500">{v.slots.filter((s) => s.reason).map((s) => s.reason).join("; ")}</span> : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <Empty>{plan.alreadyBuilt ? `All ${plan.alreadyBuilt} visits for this week are already built.` : "No templates fall in this week."}</Empty>
              )}
              {plan.skipped.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[14px] font-medium text-navy-900">{plan.skipped.length} skipped</summary>
                  <ul className="mt-2 space-y-1 text-[13.5px]">
                    {plan.skipped.map((s) => <li key={`${s.templateId}-${s.date}`}>{fmtLondonDate(s.date)} · {s.serviceUserName}: {s.reason}</li>)}
                  </ul>
                </details>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import { ArrowsClockwise, CheckCircle, Hammer, ProhibitInset } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { fmtLondonDate, isIsoDate, londonDate, londonTime, mondayOf } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listBuilds, previewBuild, suggestBuildWeek, type BuildPlan } from "@/server/rota/build";
import { memberNames, rotaLookups } from "@/server/rota/queries";
import { confirmBuildAction, deleteBuildAction, publishBuildAction, rollForwardAction } from "@/app/rota-actions";
import { previewRollForward, ROLL_WEEKS, type RollPlan } from "@/server/rota/roll-forward";
import { pounds } from "@/server/finance/pricing";
import { addDays } from "@/lib/london";
import { Flash, fmtDate } from "@/components/ui";
import { SearchTable } from "@/components/search-table";

export const dynamic = "force-dynamic";

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Build Rota, laid out as the office knows it from OnePlan: the All Rotas list with a Build Rota button, which opens
 * the Add New Rota form over the list. Our form checks the week first and shows what will be created before it saves.
 */
export default async function BuildRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.build")) {
    if (!hasOrgPermission(ctx, "rota.view")) notFound();
    return (
      <section className="panel max-w-2xl" aria-labelledby="no-build">
        <h1 id="no-build" className="text-[20px] font-normal text-navy-900">Build Rota</h1>
        <p className="mt-2 text-[14.5px] text-slate-700">Your role can view the rota but not build or publish it. Building is open to administrators, care managers and care coordinators. Ask an administrator to change your role if you need it.</p>
      </section>
    );
  }
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const thisMonday = mondayOf(londonDate());
  const rolling = one("roll") === "1";
  const adding = !rolling && (one("new") === "1" || !!one("week"));
  // With no week chosen, the form opens on the next week that still needs building, not blindly on next Monday.
  const suggested = await suggestBuildWeek(ctx);
  const week = (() => {
    const w = one("week");
    return w && isIsoDate(w) ? mondayOf(w) : suggested.weekStart;
  })();
  const areaIds = ([] as string[]).concat(sp.areas ?? []).filter(Boolean);
  const cycle = one("cycle") ? Number(one("cycle")) : undefined;
  const [lk, builds] = await Promise.all([rotaLookups(ctx), listBuilds(ctx)]);
  const names = await memberNames(ctx, builds.flatMap((b) => [b.builtById, b.deletedById]));
  const areaName = new Map(lk.areas.map((a) => [a.id, a.name]));

  let plan: BuildPlan | null = null;
  let planError: string | null = null;
  if (adding) {
    try {
      plan = await previewBuild(ctx, { weekStart: week, areaIds, cycleWeek: cycle });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      planError = e.message;
    }
  }
  // Roll Forward: copy a built week into the next 1, 2, 3 or 4 weeks as drafts.
  const builtWeeks = [...new Set(builds.filter((b) => b.status === "BUILT").map((b) => b.weekStart))].sort().reverse();
  const rollFrom = (() => {
    const f = one("from");
    return f && isIsoDate(f) ? mondayOf(f) : (builtWeeks.find((w) => w <= thisMonday) ?? builtWeeks[builtWeeks.length - 1] ?? thisMonday);
  })();
  const rollTo = (() => {
    const t = one("to");
    if (t && isIsoDate(t)) return mondayOf(t);
    return suggested.weekStart > rollFrom ? suggested.weekStart : addDays(rollFrom, 7);
  })();
  const rollWeeks = Number(one("weeks") ?? "1");
  let roll: RollPlan | null = null;
  let rollError: string | null = null;
  if (rolling) {
    try {
      roll = await previewRollForward(ctx, { sourceWeek: rollFrom, targetWeek: rollTo, weeks: rollWeeks, areaIds });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      rollError = e.message;
    }
  }
  const changesOnly = one("changes") === "1";
  const rollRows = roll ? roll.visits.filter((v) => !changesOnly || v.slots.some((x) => x.state !== "KEPT")) : [];
  const past = week < thisMonday;
  const back = "/rota/build";
  const days = plan ? [...new Set(plan.visits.map((v) => v.date))].sort() : [];

  const rows = builds.map((b) => {
    const areas = (b.areaIds.length ? b.areaIds.map((a) => areaName.get(a) ?? "Other area").join(", ") : b.otherAreas ? "" : "All areas") + (b.otherAreas ? `${b.areaIds.length ? " " : ""}(+${b.otherAreas} other branch area${b.otherAreas === 1 ? "" : "s"})` : "");
    const built = `${londonTime(b.builtAt)} ${fmtDate(b.builtAt).replace(/\s/g, " ")}`;
    return {
      key: b.id,
      text: `${dmy(b.weekStart)} ${dmy(b.weekEnd)} week ${b.cycleWeek} ${areas} ${names.get(b.builtById) ?? ""}`,
      tone: b.status === "DELETED" ? "[&>td]:bg-slate-100 [&>td]:text-slate-500" : b.current ? "[&>td]:bg-[#e3f3df]" : "",
      cells: [
        <span key="s" className="tabular-nums">{dmy(b.weekStart)}</span>,
        <span key="e" className="tabular-nums">{dmy(b.weekEnd)}</span>,
        b.current ? "Yes" : "No",
        <Link key="w" href={`/rota/visits?date=${b.weekStart}`}>Week {b.cycleWeek} Rota</Link>,
        areas,
        <span key="c"><span className="tabular-nums">{built}</span><span className="block text-[12.5px] text-slate-500">{names.get(b.builtById) ?? "A former member"}</span></span>,
        b.status === "DELETED" ? (
          <span key="st" className="text-[13px]">Deleted{b.deletedAt ? ` ${fmtDate(b.deletedAt)}` : ""}</span>
        ) : b.unpublished ? (
          <span key="st" className="text-[13px] font-medium text-[#8a5a00]">{b.unpublished} not published</span>
        ) : (
          <span key="st" className="inline-flex items-center gap-1 text-[13px] text-[#2e7d32]"><CheckCircle size={18} weight="fill" aria-hidden />Published</span>
        ),
        b.status === "BUILT" ? (
          <span key="a" className="flex flex-wrap items-start gap-1.5">
            <Link href={`/rota/build?roll=1&from=${b.weekStart}`} className="rounded-[3px] border border-slate-300 px-2.5 py-1 text-[13px] font-medium text-navy-900 no-underline hover:bg-slate-50">Roll forward</Link>
            {b.unpublished ? (
              <form action={publishBuildAction}>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="buildId" value={b.id} />
                <button className="btn-primary py-1 text-[13px]">Publish</button>
              </form>
            ) : null}
            {b.future && !b.otherAreas ? (
              <details className="relative">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-[3px] bg-[#d9473f] px-2.5 py-1 text-[13px] font-medium text-white hover:bg-[#b93a33]"><ProhibitInset size={15} aria-hidden />Delete</summary>
                <form action={deleteBuildAction} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded border border-slate-300 bg-white p-2.5 shadow-lg">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="buildId" value={b.id} />
                  <label className="block text-[13px]"><span className="label">Reason for deleting Week {b.cycleWeek} ({dmy(b.weekStart)})</span><input name="reason" required minLength={3} className="input py-1.5" /></label>
                  <button className="btn-secondary w-full py-1">Delete {b.visitCount} visits</button>
                </form>
              </details>
            ) : null}
          </span>
        ) : "",
      ],
    };
  });

  return (
    <>
      <Flash searchParams={sp as Record<string, string | undefined>} />
      <div inert={adding || rolling}>
        <section className="panel" aria-labelledby="all-rotas">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-2">
            <h1 id="all-rotas" className="text-[20px] font-normal text-navy-900">All Rotas</h1>
            <span className="flex flex-wrap gap-2">
              <Link href="/rota/build?roll=1" className="btn-secondary inline-flex items-center gap-1.5"><ArrowsClockwise size={16} aria-hidden />Roll Forward</Link>
              <Link href="/rota/build?new=1" className="btn-primary inline-flex items-center gap-1.5 bg-[#13703c] hover:bg-[#0f5c31]"><Hammer size={16} weight="fill" aria-hidden />Build Rota</Link>
            </span>
          </div>
          <SearchTable
            label="All rotas"
            tall
            columns={["Start Date", "End Date", "Current Rota", "Week", "Areas", "Created", "Build Status", ""]}
            rows={rows}
            empty="No rota has been built yet. Press Build Rota to build the first week from your templates."
          />
          <p className="mt-2 text-[12.5px] text-slate-500">Only weeks that have not started can be deleted, and only while none of their visits has started, been changed by hand or had anything recorded.</p>
        </section>
      </div>

      {adding ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="add-rota" className="mx-auto max-w-[680px] overflow-hidden rounded-[4px] bg-[#13a05a] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/25 bg-[#0f8a4c] px-4 py-3">
              <h2 id="add-rota" className="text-[20px] font-normal">Add New Rota</h2>
              <Link href="/rota/build" aria-label="Close" className="text-[22px] leading-none text-white/80 no-underline hover:text-white">×</Link>
            </div>
            <div className="space-y-3 px-4 py-4 text-[15px]">
              <p>You have chosen to build a new rota. The system builds a one week rota, Monday to Sunday, from the week you choose.</p>
              <p>Before you build a rota, please double check the following:</p>
              {plan ? (
                <ul className="list-disc space-y-1 pl-6">
                  {plan.checklist.map((c) => (
                    <li key={c.label}>
                      <span className="font-medium">{c.label}</span> <span className={c.ok ? "text-white/85" : "rounded-[3px] bg-white px-1 text-[13px] font-medium text-[#8a5a00]"}>{c.ok ? "(done)" : "(check)"}</span>
                      <span className="block text-[13.5px] text-white/85">{c.detail}</span>
                    </li>
                  ))}
                  <li>Holidays are recorded (<Link href="/workforce/absences" className="text-white underline">check here</Link>), and the templates are right (<Link href="/rota/templates" className="text-white underline">check here</Link>).</li>
                </ul>
              ) : null}
              {!one("week") && suggested.builtThrough ? (
                <p className="rounded-[3px] bg-white/15 px-3 py-2 text-[14px]">Your rota is already built up to {fmtLondonDate(suggested.builtThrough, { weekday: "long", day: "numeric", month: "long" })}, so the form has opened on the next week that still needs building.</p>
              ) : null}
              {planError ? <p role="alert" className="rounded-[3px] bg-white px-3 py-2 text-[14px] text-[#a3242c]">{planError}</p> : null}

              <form method="get" className="space-y-2.5 rounded-[3px] bg-white/10 p-3">
                <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[150px_1fr]">
                  <label htmlFor="b-week" className="font-semibold sm:text-right"><span aria-hidden className="text-[#ffd7d7]">* </span>Start</label>
                  <input id="b-week" name="week" type="date" required defaultValue={week} className="input text-navy-900" autoFocus />
                  <label htmlFor="b-cycle" className="font-semibold sm:text-right"><span aria-hidden className="text-[#ffd7d7]">* </span>Week Setting</label>
                  <select id="b-cycle" name="cycle" defaultValue={one("cycle") ?? ""} className="input text-navy-900">
                    <option value="">Work it out from the cycle start{plan ? ` (Week ${plan.cycleWeek})` : ""}</option>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Week {n}</option>)}
                  </select>
                  <span className="font-semibold sm:text-right">Areas</span>
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                    <legend className="sr-only">Areas (none ticked means all yours)</legend>
                    {lk.areas.map((a) => (
                      <label key={a.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="areas" value={a.id} defaultChecked={areaIds.includes(a.id)} className="h-4 w-4" /> {a.name}</label>
                    ))}
                  </fieldset>
                </div>
                <p className="text-[13px] text-white/85">The start is moved to the Monday of the week you pick. No areas ticked means all your areas.</p>
                <button className="rounded-[3px] border border-white px-3 py-1.5 text-[14px] hover:bg-white/10">Check this week</button>
              </form>

              {plan ? (
                <div className="rounded-[3px] bg-white p-3 text-navy-900">
                  <p className="text-[14.5px]">
                    Week {plan.cycleWeek} rota for <span className="font-semibold">{fmtLondonDate(week, { day: "numeric", month: "long", year: "numeric" })}</span>: <span className="font-semibold">{plan.visits.length}</span> visits to create ({(plan.forecastMinutes / 60).toFixed(1)} care hours)
                    {plan.alreadyBuilt ? `, ${plan.alreadyBuilt} already built` : ""}{plan.skipped.length ? `, ${plan.skipped.length} skipped` : ""}.
                    {plan.unassignedSlots ? <span className="text-[#a3242c]"> {plan.unassignedSlots} carer slots will be left empty because nobody eligible was found.</span> : null}
                    {plan.flaggedSlots ? ` ${plan.flaggedSlots} are allocated with warnings.` : ""}
                  </p>
                  {plan.visits.length || plan.skipped.length ? (
                    <details className="mt-2 text-[14px]">
                      <summary className="cursor-pointer font-medium">See what will be created</summary>
                      <div className="mt-2 max-h-[340px] space-y-3 overflow-auto">
                        {days.map((d) => (
                          <table key={d} className="table text-[13px]">
                            <caption className="py-1 text-left font-semibold">{fmtLondonDate(d, { weekday: "long", day: "numeric", month: "short" })}</caption>
                            <thead><tr><th>Time</th><th>Service user</th><th>Call</th><th>Carers</th></tr></thead>
                            <tbody>
                              {plan!.visits.filter((v) => v.date === d).map((v) => (
                                <tr key={`${v.templateId}-${d}`}>
                                  <td className="tabular-nums">{londonTime(v.start)}–{londonTime(v.end)}</td>
                                  <td>{v.serviceUserName}</td>
                                  <td>{v.callType}</td>
                                  <td>{v.slots.map((s) => (s.state === "UNASSIGNED" ? `Unassigned${s.staffName ? ` (${s.staffName} not eligible)` : ""}` : `${s.staffName}${s.state === "FLAGGED" ? " (warning)" : ""}`) + (s.slot === "SHADOW" ? " · shadow" : "")).join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                        {plan.skipped.length ? (
                          <ul className="space-y-1 text-[13px]">
                            {plan.skipped.map((s) => <li key={`${s.templateId}-${s.date}`}>Skipped {fmtLondonDate(s.date)} · {s.serviceUserName}: {s.reason}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {plan && past ? (
                <div role="alert" className="rounded-[3px] bg-white px-3 py-2 text-[14px] text-navy-900">
                  <p className="font-medium text-[#a3242c]">This week has already finished, so it cannot be built.</p>
                  <Link href={`/rota/build?week=${suggested.weekStart}`} className="mt-1 inline-block font-medium text-[#0f6e3b] underline">Go to the next week that needs building ({dmy(suggested.weekStart)})</Link>
                </div>
              ) : plan && plan.visits.length ? (
                <form action={confirmBuildAction}>
                  <input type="hidden" name="back" value={`/rota/build?week=${week}${cycle ? `&cycle=${cycle}` : ""}${areaIds.map((a) => `&areas=${a}`).join("")}`} />
                  <input type="hidden" name="weekStart" value={week} />
                  {cycle ? <input type="hidden" name="cycleWeek" value={cycle} /> : null}
                  {areaIds.map((a) => <input key={a} type="hidden" name="areaIds" value={a} />)}
                  <button className="inline-flex items-center gap-1.5 rounded-[3px] border border-white bg-white px-3 py-1.5 text-[14.5px] font-medium text-[#0f6e3b] hover:bg-[#eafbf0]"><Hammer size={15} weight="fill" aria-hidden />Build New Rota</button>
                  <p className="mt-1.5 text-[13px] text-white/85">Visits are saved unpublished. Carers see them only after you publish the rota from the list.</p>
                </form>
              ) : plan ? (
                <div role="alert" className="space-y-1.5 rounded-[3px] bg-white px-3 py-2 text-[14px] text-navy-900">
                  <p className="font-semibold text-[#a3242c]">Nothing can be built for this week</p>
                  {(plan.blockers.length ? plan.blockers : [{ code: "NONE", message: "There are no visits to create for this week." }]).map((b) => (
                    <p key={b.code}>
                      {b.message}
                      {"action" in b && b.action ? <> <Link href={b.action.href} className="font-medium text-[#0f6e3b] underline">{b.action.label}</Link></> : null}
                    </p>
                  ))}
                  {week !== suggested.weekStart && !past ? (
                    <p><Link href={`/rota/build?week=${suggested.weekStart}`} className="font-medium text-[#0f6e3b] underline">Go to the next week that needs building ({dmy(suggested.weekStart)})</Link></p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end border-t border-white/25 bg-[#0f8a4c] px-4 py-3">
              <Link href="/rota/build" className="rounded-[3px] border border-white px-3 py-1.5 text-[14px] text-white no-underline hover:bg-white/10">No, cancel for now</Link>
            </div>
          </div>
        </div>
      ) : null}

      {rolling ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-3 py-6 sm:px-4 sm:py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="roll-forward" className="mx-auto max-w-[1080px] overflow-hidden rounded-[6px] bg-white text-navy-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="roll-forward" className="text-[20px] font-medium">Roll Forward Rota</h2>
                <p className="text-[13.5px] text-slate-600">Copies a built week, with every change made to it, into the following weeks as drafts. Each carer is checked again for the new dates.</p>
              </div>
              <Link href="/rota/build" aria-label="Close" className="text-[22px] leading-none text-slate-500 no-underline hover:text-navy-900">×</Link>
            </div>
            <div className="space-y-3 px-4 py-4 text-[14.5px]">
              <form method="get" className="grid grid-cols-1 gap-3 rounded-[4px] border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] md:grid-cols-[1fr_1fr_1fr_auto]">
                <input type="hidden" name="roll" value="1" />
                <label><span className="label">Copy from week</span>
                  <select name="from" defaultValue={rollFrom} className="input">
                    {builtWeeks.length ? builtWeeks.map((w) => <option key={w} value={w}>{dmy(w)} – {dmy(addDays(w, 6))}{w === thisMonday ? " (this week)" : ""}</option>) : <option value={rollFrom}>No built weeks yet</option>}
                  </select>
                </label>
                <label><span className="label">New rota starts</span><input type="date" name="to" defaultValue={rollTo} className="input" /></label>
                <fieldset>
                  <legend className="label">How many weeks</legend>
                  <div className="flex gap-1.5">
                    {ROLL_WEEKS.map((n) => (
                      <label key={n} className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border border-slate-300 bg-white px-2 py-2 text-[14px] has-[:checked]:border-[#13703c] has-[:checked]:bg-[#e8f5ec] has-[:checked]:font-medium">
                        <input type="radio" name="weeks" value={n} defaultChecked={rollWeeks === n} className="h-4 w-4" />{n} week{n === 1 ? "" : "s"}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex items-end"><button className="btn-primary w-full">Preview</button></div>
                <fieldset className="sm:col-span-3 md:col-span-4 flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="label">Areas (none ticked means all yours)</legend>
                  {lk.areas.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="areas" value={a.id} defaultChecked={areaIds.includes(a.id)} className="h-4 w-4" /> {a.name}</label>
                  ))}
                </fieldset>
              </form>

              {rollError ? <p role="alert" className="rounded-[4px] border border-[#f1c2c5] bg-[#fdf0f1] px-3 py-2 text-[#a3242c]">{rollError}</p> : null}

              {roll ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Roll forward summary">
                    {[
                      ["Visits to create", String(roll.counts.create), "text-navy-900"],
                      ["Carers kept", String(roll.counts.kept), "text-[#1f6f3a]"],
                      ["Need review", String(roll.counts.review), "text-[#8a5a00]"],
                      ["Uncovered slots", String(roll.counts.uncovered), "text-[#a3242c]"],
                      ["Already in place", String(roll.existing), "text-slate-700"],
                      ["Skipped", String(roll.skipped.length), "text-slate-700"],
                    ].map(([k, v, tone]) => (
                      <div key={k} className="rounded-[4px] border border-slate-200 px-3 py-2"><dt className="text-[12.5px] text-slate-600">{k}</dt><dd className={`text-[20px] font-semibold tabular-nums ${tone}`}>{v}</dd></div>
                    ))}
                  </dl>
                  <p className="text-[13.5px] text-slate-700">
                    Copying {roll.sourceVisits} visits from {dmy(roll.sourceWeek)} into {roll.targetWeeks.map(dmy).join(", ")}. Care hours {(roll.forecastMinutes / 60).toFixed(1)}. Estimated basic pay for carers kept {pounds(roll.estimatedPayPence)}
                    {roll.slotsWithoutRate ? ` (${roll.slotsWithoutRate} carer slots have no pay rate and are not costed)` : ""}. Estimates use pay rate cards only and are not payroll figures.
                    {roll.counts.doubleUpsShort ? <span className="text-[#a3242c]"> {roll.counts.doubleUpsShort} double-ups will be short of a carer.</span> : null}
                  </p>
                  {roll.blockers.length ? (
                    <div role="alert" className="rounded-[4px] border border-[#f1c2c5] bg-[#fdf0f1] px-3 py-2">
                      <p className="font-semibold text-[#a3242c]">Nothing can be rolled forward</p>
                      {roll.blockers.map((b) => <p key={b}>{b}</p>)}
                      {roll.existing ? <p><Link href={`/rota/build?roll=1&from=${rollFrom}&to=${suggested.weekStart > rollFrom ? suggested.weekStart : addDays(rollTo, 7)}&weeks=${rollWeeks}`} className="font-medium text-[#0f6e3b] underline">Try the next week that still needs building</Link></p> : null}
                    </div>
                  ) : null}
                  {roll.visits.length ? (
                    <section aria-labelledby="roll-compare">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <h3 id="roll-compare" className="text-[15px] font-semibold">Previous rota and proposed rota</h3>
                        <Link href={`/rota/build?roll=1&from=${rollFrom}&to=${rollTo}&weeks=${rollWeeks}${areaIds.map((a) => `&areas=${a}`).join("")}${changesOnly ? "" : "&changes=1"}`} className="text-[13.5px] font-medium text-[#1d4f91]">{changesOnly ? "Show every visit" : "Show only visits that change"}</Link>
                      </div>
                      <div className="max-h-[420px] overflow-auto rounded-[4px] border border-slate-200">
                        <table className="table min-w-[760px] text-[13px]">
                          <thead className="sticky top-0 bg-white"><tr><th>Date</th><th>Time</th><th>Service user</th><th>Previous carers ({dmy(roll.sourceWeek)})</th><th>Proposed carers</th></tr></thead>
                          <tbody>
                            {rollRows.slice(0, 500).map((v) => (
                              <tr key={`${v.sourceVisitId}-${v.date}`}>
                                <td className="whitespace-nowrap tabular-nums">{fmtLondonDate(v.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                                <td className="whitespace-nowrap tabular-nums">{londonTime(v.start)}–{londonTime(v.end)}</td>
                                <td>{v.serviceUserName}<span className="block text-[12px] text-slate-500">{v.callType}{v.carersRequired > 1 ? " · double-up" : ""}</span></td>
                                <td>{v.slots.map((x) => x.fromName ?? "empty slot").join(", ")}</td>
                                <td>
                                  <ul className="space-y-0.5">
                                    {v.slots.map((x) => (
                                      <li key={x.slot}>
                                        <span className={`mr-1.5 inline-block rounded-[3px] px-1.5 text-[11.5px] font-semibold ${x.state === "KEPT" ? "bg-[#e3f3e7] text-[#1f6f3a]" : x.state === "REVIEW" ? "bg-[#fdf1d8] text-[#8a5a00]" : "bg-[#fbe4e6] text-[#a3242c]"}`}>{x.state === "KEPT" ? "Kept" : x.state === "REVIEW" ? "Review" : "Uncovered"}</span>
                                        {x.staffName ?? "Unassigned"}{x.slot === "SHADOW" ? " (shadow)" : ""}
                                        {x.reason ? <span className="block text-[12px] text-slate-600">{x.reason}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rollRows.length > 500 ? <p className="px-3 py-2 text-[13px] text-slate-600">Showing the first 500 of {rollRows.length}. All of them are saved.</p> : null}
                        {!rollRows.length ? <p className="px-3 py-2 text-[13px] text-slate-600">Every carer is kept: nothing changes.</p> : null}
                      </div>
                    </section>
                  ) : null}
                  {roll.skipped.length ? (
                    <details className="text-[13.5px]"><summary className="cursor-pointer font-medium">Skipped visits ({roll.skipped.length})</summary>
                      <ul className="mt-1 max-h-[200px] space-y-0.5 overflow-auto">{roll.skipped.slice(0, 300).map((x) => <li key={`${x.sourceReference}-${x.date}`}>{fmtLondonDate(x.date)} · {x.serviceUserName}: {x.reason}</li>)}</ul>
                    </details>
                  ) : null}
                  {roll.visits.length ? (
                    <form action={rollForwardAction} className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                      <input type="hidden" name="back" value={`/rota/build?roll=1&from=${rollFrom}&to=${rollTo}&weeks=${rollWeeks}${areaIds.map((a) => `&areas=${a}`).join("")}`} />
                      <input type="hidden" name="sourceWeek" value={rollFrom} />
                      <input type="hidden" name="targetWeek" value={rollTo} />
                      <input type="hidden" name="weeks" value={rollWeeks} />
                      {areaIds.map((a) => <input key={a} type="hidden" name="areaIds" value={a} />)}
                      <button className="btn-primary inline-flex items-center gap-1.5 bg-[#13703c] hover:bg-[#0f5c31]"><ArrowsClockwise size={16} aria-hidden />Save {roll.counts.create} visits as drafts</button>
                      <p className="text-[13px] text-slate-600">Nothing is published. Change any visit, cover the gaps, then publish each week from the list. An untouched draft week can be deleted.</p>
                    </form>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="flex justify-end border-t border-slate-200 px-4 py-3">
              <Link href="/rota/build" className="btn-secondary">Cancel</Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

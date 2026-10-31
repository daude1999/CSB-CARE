import type { AssignmentSlot } from "@prisma/client";
import { redirect } from "next/navigation";
import { ArrowsClockwise, CalendarPlus, Plus, UserSwitch, Faders } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { addDays, fmtLondonDate, londonDate, londonTime, mondayOf } from "@/lib/london";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rosterWeek } from "@/server/rota/roster";
import { getVisit } from "@/server/rota/visits";
import { suName, visitCandidates } from "@/server/rota/queries";
import { assignCarerAction, moveVisitAction } from "@/app/rota-actions";
import { Flash, PageHeader, SegmentNav } from "@/components/ui";
import { NotBuiltNotice, Stepper, VisitStatusBadge } from "@/components/rota-ui";
import { PlannerBoard } from "@/components/planner-board";
import { RosterKey } from "@/components/roster-key";
import { CarerRecommendations, SCORE_NOTE } from "@/components/rota-match";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<AssignmentSlot, string> = { PRIMARY: "Lead carer", SECOND: "Second carer", SHADOW: "Shadow" };

/**
 * Weekly Planner (Advanced Rota): the week as a roster, one row per carer (or service user), in the style the owner chose on
 * 31 Oct 2026 (Birdie-inspired, original CSB design). Today's call figures sit in one strip on top; planning actions
 * are buttons on the roster; opening a visit shows it in a side panel with the best-matched carers.
 */
export default async function WeeklyPlanner({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view")) redirect(rotaHome(ctx));
  const filters = { week: sp.week, area: sp.area || undefined, view: sp.view, cancelled: sp.cancelled === "1", all: sp.all === "1" };
  const keep = { week: sp.week, area: sp.area, view: sp.view, cancelled: sp.cancelled, all: sp.all };
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const r = await rosterWeek(ctx, filters, (id) => `/rota/planner?${qs({ visit: id })}`);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const back = `/rota/planner?${qs({})}`;

  // Side panel for one visit, with ranked carers for its first open slot (or the lead slot).
  const panel = sp.visit ? await getVisit(ctx, sp.visit).catch(() => null) : null;
  const live = panel ? panel.assignments.filter((a) => !a.removedAt) : [];
  const openSlot: AssignmentSlot | null = panel ? (["PRIMARY", ...(panel.carersRequired > 1 ? (["SECOND"] as const) : [])] as AssignmentSlot[]).find((s) => !live.some((a) => a.slot === s)) ?? "PRIMARY" : null;
  const assignable = !!panel && canEdit && ["SCHEDULED", "MISSED"].includes(panel.status);
  const candidates = panel && openSlot && assignable ? await visitCandidates(ctx, panel, openSlot) : [];

  return (
    <>
      <PageHeader
        title="Weekly Planner"
        back="/rota"
        subtitle="The week by carer. Drag a visit to another carer or day; every move is checked against leave, HR checks, clashes and preferences before it is saved. Open a visit to see it beside the roster."
        actions={
          <span className="flex flex-wrap gap-2">
            {canBuild ? <Link href="/rota/build" className="btn-primary inline-flex items-center gap-1.5"><CalendarPlus size={16} aria-hidden />Plan rota</Link> : null}
            {canBuild ? <Link href={`/rota/build?roll=1&from=${addDays(r.week, -7)}&to=${r.week}&weeks=1`} className="btn-secondary inline-flex items-center gap-1.5"><ArrowsClockwise size={16} aria-hidden />Roll forward</Link> : null}
            {canBuild ? <Link href={`/rota/optimise?from=${r.week > r.today ? r.week : r.today}`} className="btn-secondary inline-flex items-center gap-1.5"><Faders size={16} aria-hidden />Fill open slots</Link> : null}
            <Link href="/rota/cover" className="btn-secondary inline-flex items-center gap-1.5"><UserSwitch size={16} aria-hidden />Cover</Link>
            {canEdit ? <Link href={`/rota/visits/new?date=${r.week >= mondayOf(r.today) && r.week <= r.today ? r.today : r.week}`} className="btn-secondary inline-flex items-center gap-1.5"><Plus size={16} aria-hidden />Add visit</Link> : null}
          </span>
        }
      />
      <Flash searchParams={sp} />


      <SegmentNav
        label="Rota layout"
        items={[
          { href: `/rota/planner?${qs({})}`, label: "Week", active: true },
          { href: `/rota/visits?date=${r.week <= r.today && r.today < addDays(r.week, 7) ? r.today : r.week}`, label: "Day", active: false },
          { href: `/rota/visits?date=${r.week <= r.today && r.today < addDays(r.week, 7) ? r.today : r.week}&layout=list`, label: "List", active: false },
        ]}
      />
      <section aria-label="Week and filters" className="panel mb-3 flex flex-wrap items-end justify-between gap-3">
        <Stepper base="/rota/planner" params={keep} param="week" prev={addDays(r.week, -7)} next={addDays(r.week, 7)} label={`w/c ${fmtLondonDate(r.week, { day: "numeric", month: "short", year: "numeric" })}`} />
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={r.week} />
          <label><span className="label">Show</span><select name="view" defaultValue={r.view} className="input"><option value="carers">By carer</option><option value="clients">By service user</option></select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{r.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <fieldset className="flex items-center gap-3 pb-2 text-[14px]">
            <legend className="sr-only">Display options</legend>
            <label className="flex items-center gap-1.5"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="h-4 w-4" /> Everyone, even with no visits</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" name="cancelled" value="1" defaultChecked={sp.cancelled === "1"} className="h-4 w-4" /> Cancelled</label>
          </fieldset>
          <button className="btn-primary">Show</button>
          {r.week !== mondayOf(r.today) ? <Link href="/rota/planner" className="btn-secondary">This week</Link> : null}
        </form>
      </section>

      {r.notBuilt ? <NotBuiltNotice date={r.week} canBuild={canBuild} /> : null}

      <div className={panel ? "grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]" : ""}>
        <section className="panel min-w-0" aria-label="Week roster">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <RosterKey tones={["ok", "draft", "active", "done", "missed", "review", "empty"]} shades={r.view === "carers" ? ["leave", "sick", "unavailable", "requested"] : []} />
            <p className="text-[13px] text-slate-600">
              <span className="tabular-nums">{r.counts.visits}</span> visits this week
              {r.counts.emptySlots ? <> · <span className="font-medium tabular-nums text-[#a3242c]">{r.counts.emptySlots}</span> carer slots to fill</> : null}
              {r.counts.draft ? <> · <span className="tabular-nums">{r.counts.draft}</span> drafts not published{canBuild ? <> (<Link href="/rota/build">publish</Link>)</> : null}</> : null}
              {r.counts.review ? <> · <span className="tabular-nums">{r.counts.review}</span> to review</> : null}
            </p>
          </div>
          <PlannerBoard days={r.days} rows={r.rows} action={assignCarerAction} moveAction={r.view === "carers" ? moveVisitAction : undefined} back={back} canEdit={canEdit && r.view === "carers"} rowLabel={r.view === "clients" ? "Service user" : "Carer"} stateColours />
          {r.truncated ? <p className="mt-2 text-[13px] text-[#8a5a00]">This week has more than 4,000 visits. Choose an area to see them all.</p> : null}
          {!r.rows.some((x) => x.cells.some((cell) => cell.length)) && !r.notBuilt ? <p className="mt-2 text-[14px] text-slate-600">No visits match these filters this week.</p> : null}
        </section>

        {panel ? (
          <aside aria-label="Visit details" className="panel xl:sticky xl:top-3 xl:self-start">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-semibold">{suName(panel.serviceUser)}</h2>
                <p className="text-[13.5px] text-slate-600">{fmtLondonDate(londonDate(panel.scheduledStart), { weekday: "long", day: "numeric", month: "long" })} · {londonTime(panel.scheduledStart)}–{londonTime(panel.scheduledEnd)} · {panel.callType.name}</p>
              </div>
              <Link href={back} aria-label="Close visit details" className="text-[22px] leading-none text-slate-500 no-underline hover:text-navy-900">×</Link>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              <VisitStatusBadge status={panel.status} />
              {!panel.publishedAt && panel.status === "SCHEDULED" ? <span className="rounded-full bg-[#eef1f5] px-2 py-0.5 text-[#3c4a5c]">Draft, not published</span> : null}
              {panel.timeLocked ? <span className="rounded-full bg-slate-100 px-2 py-0.5">Time locked</span> : null}
              <span className="text-slate-500">{panel.reference}</span>
            </div>
            <h3 className="mt-3 text-[14px] font-semibold">Carers</h3>
            <ul className="mt-1 space-y-1 text-[13.5px]">
              {(["PRIMARY", ...(panel.carersRequired > 1 ? (["SECOND"] as const) : [])] as AssignmentSlot[]).map((s) => {
                const a = live.find((x) => x.slot === s);
                return <li key={s}><span className="text-slate-600">{SLOT_LABEL[s]}:</span> {a ? <span className={a.reviewReason ? "text-[#8a5a00]" : ""}>{a.staff.displayName}{a.reviewReason ? ` (needs review: ${a.reviewReason})` : ""}</span> : <span className="font-medium text-[#a3242c]">Not filled</span>}</li>;
              })}
            </ul>
            {assignable && openSlot ? (
              <>
                <h3 className="mt-3 text-[14px] font-semibold">{live.some((a) => a.slot === openSlot) ? `Best matches to replace the ${SLOT_LABEL[openSlot].toLowerCase()}` : `Best matches for the ${SLOT_LABEL[openSlot].toLowerCase()}`}</h3>
                {candidates.some((x) => x.score !== null) ? (
                  <CarerRecommendations list={candidates} visitId={panel.id} slot={openSlot} lockVersion={panel.lockVersion} back={`/rota/planner?${qs({ visit: panel.id })}`} replacing={live.some((a) => a.slot === openSlot)} />
                ) : <p className="mt-1 text-[13px] text-[#a3242c]">No one is free and eligible for this time. Open the visit to see each carer&rsquo;s reasons.</p>}
                <p className="mt-1 text-[12px] text-slate-500">{SCORE_NOTE}</p>
              </>
            ) : null}
            <Link href={`/rota/visits/${panel.id}`} className="btn-secondary mt-3 inline-block">Open visit</Link>
          </aside>
        ) : sp.visit ? (
          <p role="alert" className="mt-2 text-[14px] text-[#a3242c]">That visit could not be found, or is outside your areas.</p>
        ) : null}
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/link";
import { NotFoundError } from "@/lib/errors";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getPlan, planRange } from "@/server/rota/optimise";
import { memberNames, suName } from "@/server/rota/queries";
import { applyPlanAction, decidePlanChangesAction, discardPlanAction, publishPlanAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

const DECISION = { PENDING: ["To decide", "slate"], ACCEPTED: ["Accepted", "teal"], REJECTED: ["Rejected", "rose"], APPLIED: ["Applied", "green"], FAILED: ["Not applied", "rose"] } as const;
const SLOT = { PRIMARY: "Lead carer", SECOND: "Second carer", SHADOW: "Shadow" } as const;
const day = (iso: string) => fmtLondonDate(iso, { weekday: "long", day: "numeric", month: "long" });

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage();
  const data = await getPlan(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { plan, summary, changes } = data;
  const names = await memberNames(ctx, [plan.createdById, plan.appliedById, plan.discardedById]);
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const draft = plan.status === "DRAFT";
  const editable = canBuild && draft;
  const r = planRange(plan);
  const back = `/rota/optimise/${plan.id}`;
  const accepted = changes.filter((c) => c.decision === "ACCEPTED").length;
  const pending = changes.filter((c) => c.decision === "PENDING").length;
  const clean = changes.filter((c) => c.kind === "ASSIGN" && c.eligibility === "ELIGIBLE" && c.decision === "PENDING" && !changes.some((d) => d.visitId === c.visitId && d.kind === "RETIME")).length;
  const applied = changes.filter((c) => c.decision === "APPLIED");
  const unpublished = new Set(applied.filter((c) => !c.visit.publishedAt).map((c) => c.visitId)).size;

  const byDay = new Map<string, typeof changes>();
  for (const c of changes) {
    const d = londonDate(c.toStart ?? c.visit.scheduledStart);
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }

  return (
    <>
      <PageHeader
        title={`Plan for ${r.from === r.to ? day(r.from) : `${day(r.from)} to ${day(r.to)}`}`}
        back="/rota/optimise"
        subtitle={
          draft
            ? "A proposal only. Accept or reject each change, then apply. Applying runs every eligibility and double-booking check again, one visit at a time."
            : plan.status === "APPLIED"
              ? `Applied by ${names.get(plan.appliedById ?? "") ?? "a coordinator"}. Each change shows whether it was made.`
              : `Discarded by ${names.get(plan.discardedById ?? "") ?? "a coordinator"}. The rota was not changed.`
        }
        actions={
          canBuild ? (
            <div className="flex flex-wrap gap-2">
              {draft ? (
                <>
                  <form action={applyPlanAction}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn-primary" disabled={!accepted}>Apply {accepted} accepted change{accepted === 1 ? "" : "s"}</button>
                  </form>
                  <form action={discardPlanAction}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn-secondary">Discard plan</button>
                  </form>
                </>
              ) : plan.status === "APPLIED" && unpublished ? (
                <form action={publishPlanAction}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="btn-primary">Publish {unpublished} changed visit{unpublished === 1 ? "" : "s"}</button>
                </form>
              ) : null}
            </div>
          ) : null
        }
      />
      <Flash searchParams={sp} />

      <section aria-label="Plan summary" className="panel mb-3 text-[14px]">
        <p>
          <strong className="font-medium tabular-nums">{summary.proposed}</strong> of <span className="tabular-nums">{summary.openSlots}</span> open carer slot{summary.openSlots === 1 ? "" : "s"} filled
          {summary.retimed ? <> · <span className="tabular-nums">{summary.retimed}</span> with a time change</> : null}
          {summary.needsReview ? <> · <span className="tabular-nums">{summary.needsReview}</span> need you to read warnings</> : null}
          {summary.viaSwap ? <> · <span className="tabular-nums">{summary.viaSwap}</span> found by moving another proposal</> : null}
          {" "}· <span className="tabular-nums">{summary.unfilled.length}</span> left open
          {draft ? <> · <span className="tabular-nums">{pending}</span> to decide, <span className="tabular-nums">{accepted}</span> accepted</> : null}
        </p>
        <p className="mt-1 text-[13px] text-slate-600">
          {summary.travelLabel} Weekly hours limits were {plan.respectWeeklyLimits ? "kept" : "not applied"}. Time changes up to {plan.maxShiftMinutes} minutes. {summary.passes} passes, {summary.checks.toLocaleString("en-GB")} checks, {(summary.ms / 1000).toFixed(1)} s{summary.budgetSpent ? ". The check budget ran out, so some slots were not tried" : ""}.
        </p>
      </section>

      {editable && changes.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-slate-600">Whole plan:</span>
          {([["ALL_CLEAN", "ACCEPTED", `Accept every clean match (${clean})`], ["ALL", "ACCEPTED", "Accept all"], ["ALL", "REJECTED", "Reject all"]] as const).map(([which, decision, label]) => (
            <form key={label} action={decidePlanChangesAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="which" value={which} />
              <button name="decision" value={decision} className="btn-secondary" disabled={which === "ALL_CLEAN" && !clean}>{label}</button>
            </form>
          ))}
          <span className="text-[12.5px] text-slate-500">A clean match passes every check with no warnings and does not move the visit.</span>
        </div>
      ) : null}

      <form action={decidePlanChangesAction}>
        <input type="hidden" name="planId" value={plan.id} />
        <input type="hidden" name="back" value={back} />
        {editable && changes.length ? (
          <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white py-2">
            <span className="text-[13.5px] text-slate-600">Ticked changes:</span>
            <button name="decision" value="ACCEPTED" className="btn-secondary">Accept</button>
            <button name="decision" value="REJECTED" className="btn-secondary">Reject</button>
            <button name="decision" value="PENDING" className="btn-secondary">Reset</button>
            <span className="text-[12.5px] text-slate-500">A carer change on a moved visit is accepted or rejected with the time change.</span>
          </div>
        ) : null}

        {changes.length ? (
          [...byDay].map(([d, list]) => (
            <Card key={d} title={day(d)} className="mb-3">
              <ul className="rows">
                {list.map((c) => {
                  const [label, tone] = DECISION[c.decision];
                  const from = c.fromStart ?? c.visit.scheduledStart;
                  return (
                    <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                      {editable && ["PENDING", "ACCEPTED", "REJECTED"].includes(c.decision) ? (
                        <input type="checkbox" name="changeIds" value={c.id} aria-label={`Select change for ${suName(c.visit.serviceUser)} at ${londonTime(from)}`} className="mt-1" />
                      ) : <span className="w-[13px]" />}
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                          <span className="tabular-nums">{londonTime(c.visit.scheduledStart)}–{londonTime(c.visit.scheduledEnd)}</span>
                          <Link href={`/rota/visits/${c.visitId}`} className="row-title">{suName(c.visit.serviceUser)}</Link>
                          <span className="text-slate-600">{c.visit.callType.name}</span>
                          <AreaDot area={c.visit.area} />
                          <Badge tone={tone}>{label}</Badge>
                          {c.stale ? <Badge tone="amber" title="The visit was edited after the plan was made; applying will refuse it">Visit changed since</Badge> : null}
                        </p>
                        {c.kind === "RETIME" ? (
                          <p className="mt-1 text-[14px]">
                            <strong className="font-medium">Move the visit</strong> from <span className="tabular-nums">{londonTime(c.fromStart!)}–{londonTime(c.fromEnd!)}</span> to <span className="tabular-nums">{londonTime(c.toStart!)}–{londonTime(c.toEnd!)}</span>
                            <span className="text-slate-600"> · {c.reasons[0]}</span>
                          </p>
                        ) : (
                          <>
                            <p className="mt-1 text-[14px]">
                              <strong className="font-medium">{SLOT[c.slot ?? "PRIMARY"]}: {c.staffName}</strong>
                              {c.score !== null ? <span className="text-slate-600"> · match {c.score}</span> : null}
                              {c.eligibility === "REQUIRES_REVIEW" ? <Badge tone="amber">Allowed with warnings</Badge> : null}
                            </p>
                            {c.warnings.length ? <p className="mt-1 text-[13px] text-[#8a5a00]">Accepting confirms you have read: {c.warnings.join("; ")}</p> : null}
                            <details className="mt-1 text-[13px] text-slate-600">
                              <summary className="cursor-pointer">Why this carer</summary>
                              <ul className="mt-1 list-disc pl-5">{c.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                            </details>
                          </>
                        )}
                        {c.outcome ? <p className={`mt-1 text-[13px] ${c.decision === "FAILED" ? "text-[#a3242c]" : "text-[#1c7a43]"}`}>{c.outcome}</p> : null}
                      </div>
                      {editable && ["PENDING", "ACCEPTED", "REJECTED"].includes(c.decision) ? (
                        <div className="flex gap-1">
                          <button name="row" value={`ACCEPTED|${c.id}`} className="btn-secondary !px-3 !py-1 text-[13px]" disabled={c.decision === "ACCEPTED"} aria-label={`Accept: ${c.kind === "RETIME" ? "move" : c.staffName} for ${suName(c.visit.serviceUser)} at ${londonTime(from)}`}>Accept</button>
                          <button name="row" value={`REJECTED|${c.id}`} className="btn-secondary !px-3 !py-1 text-[13px]" disabled={c.decision === "REJECTED"} aria-label={`Reject: ${c.kind === "RETIME" ? "move" : c.staffName} for ${suName(c.visit.serviceUser)} at ${londonTime(from)}`}>Reject</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))
        ) : (
          <Card className="mb-3"><Empty>{summary.openSlots ? "The plan found no carer who fits any open slot. The reasons are below." : "There were no open carer slots in these dates."}</Empty></Card>
        )}
      </form>

      {summary.unfilled.length ? (
        <Card title={`Left open (${summary.unfilled.length})`}>
          <ul className="rows">
            {summary.unfilled.map((u) => (
              <li key={`${u.visitId}:${u.slot}`} className="py-2.5 text-[14px]">
                <span className="tabular-nums text-slate-600">{fmtLondonDate(londonDate(new Date(u.start)), { weekday: "short", day: "numeric", month: "short" })} {londonTime(new Date(u.start))}</span>{" "}
                <Link href={`/rota/visits/${u.visitId}`} className="row-title">{u.label}</Link> <span className="text-slate-600">· {SLOT[u.slot as keyof typeof SLOT] ?? u.slot}</span>
                <p className="text-[13px] text-[#8a5a00]">{u.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

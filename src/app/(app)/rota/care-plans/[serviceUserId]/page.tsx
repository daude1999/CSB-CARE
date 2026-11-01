import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { PLAN_SECTIONS, carePlansFor, draftFingerprint } from "@/server/care/care-plans";
import { memberNames, suName } from "@/server/rota/queries";
import { db } from "@/lib/db";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { approvePlanAction, discardDraftAction, returnPlanAction, saveDraftAction, startDraftAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav, type Tone } from "@/components/ui";
import { CareSummaryView } from "@/components/care-summary-view";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "slate" },
  IN_REVIEW: { label: "Awaiting approval", tone: "amber" },
  ACTIVE: { label: "In use", tone: "green" },
  SUPERSEDED: { label: "Replaced", tone: "slate" },
};

export default async function CarePlanPage({ params, searchParams }: { params: Promise<{ serviceUserId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ serviceUserId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const { serviceUser: su, plans, visitingCarers } = await orNotFound(carePlansFor(ctx, serviceUserId));
  const canEdit = hasOrgPermission(ctx, "care.plan.edit");
  const canApprove = hasOrgPermission(ctx, "care.plan.approve");
  const active = plans.find((p) => p.status === "ACTIVE") ?? null;
  const open = plans.find((p) => p.status === "DRAFT" || p.status === "IN_REVIEW") ?? null;
  const asked = sp.v ? plans.find((p) => String(p.version) === sp.v) : null;
  const shown = asked ?? (sp.edit && open ? open : active ?? open ?? plans[0] ?? null);
  const editing = !!(sp.edit && canEdit && shown && shown.status === "DRAFT" && shown.id === open?.id);
  const base = `/rota/care-plans/${su.id}`;
  const names = await memberNames(ctx, plans.flatMap((p) => [p.createdById, p.submittedById, p.approvedById]));
  const who = (id: string | null) => (id ? names.get(id) ?? "Former member" : "—");
  const riskCount = await db.riskAssessment.count({ where: { serviceUserId: su.id, organisationId: su.organisationId, status: "ACTIVE" } });
  const readBy = new Set(active?.acknowledgements.map((a) => a.staffId) ?? []);
  const hint = (key: string) => PLAN_SECTIONS.find((s) => s.key === key)?.hint ?? "";

  return (
    <>
      <PageHeader
        title={`Care plan · ${suName(su)}`}
        back="/rota/care-plans"
        subtitle="The plan carers follow on every visit. Changes are made in a new draft and only reach carers once a second person approves them."
        actions={<><Link href={`/rota/service-users/${su.id}`} className="btn-secondary">Person’s record</Link><Link href={`/rota/risks?su=${su.id}`} className="btn-secondary">Risk assessments ({riskCount})</Link></>}
        tabs={<SegmentNav label="Care plan views" items={[{ href: base, label: "Care plan", active: sp.view !== "summary" }, { href: `${base}?view=summary`, label: "Care Summary and recent records", active: sp.view === "summary" }]} />}
      />
      <Flash searchParams={sp} />
      {sp.view === "summary" ? <CareSummaryView ctx={ctx} serviceUserId={su.id} sp={sp} /> : (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {!shown ? (
            <Card><Empty>There is no care plan for {suName(su)} yet.{canEdit ? " Start the first one from the panel alongside." : ""}</Empty></Card>
          ) : editing ? (
            <form action={saveDraftAction} className="space-y-3" aria-label={`Edit draft version ${shown.version}`}>
              <input type="hidden" name="back" value={`${base}?edit=1`} />
              <input type="hidden" name="done" value={base} />
              <input type="hidden" name="planId" value={shown.id} />
              <input type="hidden" name="fingerprint" value={draftFingerprint(shown, shown.sections)} />
              <Card title={`Draft version ${shown.version}`}>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
                  <label><span className="label">Summary for carers</span><textarea name="summary" rows={3} defaultValue={shown.summary ?? ""} className="input" required /></label>
                  <label><span className="label">Review by</span><input type="date" name="reviewDue" defaultValue={shown.reviewDue ? fromDbDate(shown.reviewDue) : ""} className="input" required /></label>
                </div>
              </Card>
              {shown.sections.map((s) => (
                <Card key={s.id} title={s.title}>
                  <p className="mb-2 text-[13px] text-slate-600">{hint(s.key)}</p>
                  <label className="block"><span className="label">What carers need to know and do</span><textarea name={`section.${s.key}.body`} rows={5} defaultValue={s.body} className="input" /></label>
                  <label className="mt-2 block"><span className="label">Outcomes the person wants (optional)</span><textarea name={`section.${s.key}.outcomes`} rows={2} defaultValue={s.outcomes ?? ""} className="input" /></label>
                </Card>
              ))}
              <div className="panel sticky bottom-0 flex flex-wrap items-center gap-2">
                <button className="btn-primary" name="then" value="save">Save draft</button>
                <button className="btn-secondary" name="then" value="submit">Save and send for approval</button>
                <Link href={base} className="btn-secondary">Stop editing</Link>
                <span className="text-[12.5px] text-slate-500">Every section must be filled in before it can be sent for approval.</span>
              </div>
            </form>
          ) : (
            <article aria-label={`Care plan version ${shown.version}`} className="space-y-3">
              <Card title={`Version ${shown.version}`} actions={<Badge tone={STATUS[shown.status]!.tone}>{STATUS[shown.status]!.label}</Badge>}>
                {shown.summary ? <p className="whitespace-pre-line text-[14.5px]">{shown.summary}</p> : <p className="text-[14px] text-slate-500">No summary yet.</p>}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-slate-600 md:grid-cols-4">
                  <div><dt className="font-medium text-slate-700">Written by</dt><dd>{who(shown.createdById)}</dd></div>
                  <div><dt className="font-medium text-slate-700">Sent for approval</dt><dd>{shown.submittedAt ? `${who(shown.submittedById)}, ${fmtDate(shown.submittedAt)}` : "—"}</dd></div>
                  <div><dt className="font-medium text-slate-700">Approved</dt><dd>{shown.approvedAt ? `${who(shown.approvedById)}, ${fmtDate(shown.approvedAt)}` : "—"}</dd></div>
                  <div><dt className="font-medium text-slate-700">Review by</dt><dd>{shown.reviewDue ? fmtLondonDate(fromDbDate(shown.reviewDue)) : "—"}</dd></div>
                </dl>
                {shown.sourceSummaryId ? <p className="mt-2 text-[12.5px] text-slate-600">This version was started from a <Link href={`${base}?view=summary&summary=${shown.sourceSummaryId}`}>Care Summary</Link>. Its text was written by staff, not copied from the summary.</p> : null}
              </Card>
              {shown.sections.map((s) => (
                <Card key={s.id} title={s.title}>
                  {s.body ? <p className="whitespace-pre-line text-[14.5px]">{s.body}</p> : <p className="text-[14px] text-slate-500">Not written yet.</p>}
                  {s.outcomes ? <p className="mt-2 whitespace-pre-line border-l-2 border-teal-600 pl-3 text-[14px] text-slate-700"><span className="font-medium">Outcomes: </span>{s.outcomes}</p> : null}
                </Card>
              ))}
            </article>
          )}
        </div>

        <aside className="order-first space-y-3 lg:order-none" aria-label="Plan status and versions">
          <Card title="Next step">
            {!open && canEdit ? (
              <form action={startDraftAction}>
                <input type="hidden" name="back" value={base} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <p className="mb-2 text-[14px]">{active ? `Version ${active.version} is in use. Start a new version to make changes; it is copied from the current one.` : "No plan yet. The draft starts with the standard sections."}</p>
                <button className="btn-primary">{active ? "Start a new version" : "Start the first care plan"}</button>
              </form>
            ) : null}
            {open?.status === "DRAFT" ? (
              <div className="space-y-2 text-[14px]">
                <p>Version {open.version} is being drafted by {who(open.createdById)}.</p>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    {!editing ? <Link href={`${base}?edit=1`} className="btn-primary">Continue editing</Link> : null}
                    <form action={discardDraftAction}><input type="hidden" name="back" value={base} /><input type="hidden" name="planId" value={open.id} /><button className="btn-secondary">Discard draft</button></form>
                  </div>
                ) : null}
              </div>
            ) : null}
            {open?.status === "IN_REVIEW" ? (
              <div className="space-y-3 text-[14px]">
                <p>Version {open.version} was sent for approval by {who(open.submittedById)}{open.submittedAt ? ` on ${fmtDate(open.submittedAt)}` : ""}.{shown?.id !== open.id ? <> <Link href={`${base}?v=${open.version}`}>Read it</Link>.</> : null}</p>
                {canApprove && open.createdById !== ctx.userId && open.submittedById !== ctx.userId ? (
                  <form action={approvePlanAction}>
                    <input type="hidden" name="back" value={base} />
                    <input type="hidden" name="planId" value={open.id} />
                    <button className="btn-primary">Approve and put in use</button>
                  </form>
                ) : <p className="text-[13px] text-slate-600">{canApprove ? "You wrote or sent this version, so another manager must approve it." : "A care manager approves care plans."}</p>}
                {canEdit ? (
                  <form action={returnPlanAction} className="space-y-1.5">
                    <input type="hidden" name="back" value={base} />
                    <input type="hidden" name="planId" value={open.id} />
                    <label className="block"><span className="label">Send back with a reason</span><input name="reason" required minLength={3} className="input" /></label>
                    <button className="btn-secondary">Return to draft</button>
                  </form>
                ) : null}
              </div>
            ) : null}
            {!open && !canEdit ? <p className="text-[14px] text-slate-600">Nothing waiting.</p> : null}
          </Card>

          {active ? (
            <Card title={`Read by carers (${visitingCarers.filter((c) => readBy.has(c.id)).length} of ${visitingCarers.length})`}>
              {visitingCarers.length ? (
                <ul className="rows text-[14px]">
                  {visitingCarers.map((c) => <li key={c.id} className="flex justify-between py-1.5"><span>{c.displayName}</span>{readBy.has(c.id) ? <Badge tone="green">Read</Badge> : <Badge tone="amber">Not yet</Badge>}</li>)}
                </ul>
              ) : <Empty>No carers booked in the next 14 days.</Empty>}
            </Card>
          ) : null}

          <Card title="Versions">
            {plans.length ? (
              <ul className="rows text-[14px]">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`${base}?v=${p.version}`} aria-current={shown?.id === p.id ? "page" : undefined} className={shown?.id === p.id ? "font-semibold" : ""}>Version {p.version}</Link>
                    <span className="flex items-center gap-2 text-[12.5px] text-slate-500">{p.approvedAt ? fmtDate(p.approvedAt) : fmtDate(p.createdAt)} <Badge tone={STATUS[p.status]!.tone}>{STATUS[p.status]!.label}</Badge></span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No versions yet.</Empty>}
            <p className="mt-2 text-[12.5px] text-slate-500">Approved and replaced versions cannot be changed or deleted.</p>
          </Card>
        </aside>
      </div>
      )}
    </>
  );
}

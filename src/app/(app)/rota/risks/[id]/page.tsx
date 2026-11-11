import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { RISK_ORIGIN_LABEL, RISK_TYPE_LABEL, REVIEW_STATE_LABEL, getRisk, reviewState } from "@/server/care/risks";
import { memberNames, suName } from "@/server/rota/queries";
import { fmtLondonDate, fromDbDate } from "@/lib/london";
import { approveRiskDraftAction, archiveRiskAction, reviewRiskAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { LEVEL, RiskFields } from "@/components/risk-fields";

export const dynamic = "force-dynamic";

const CHANGE: Record<string, string> = { CREATED: "Assessed", REVIEWED: "Reviewed", ARCHIVED: "Archived", RECORDED_BEFORE_HISTORY: "Version on record when history began" };
const REVIEW_TONE = { OVERDUE: "rose", DUE_SOON: "amber", IN_DATE: "green" } as const;

/** One risk assessment: its current content (or an earlier saved version), every version, review and archive. */
export default async function RiskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const { risk: r, versions } = await orNotFound(getRisk(ctx, id));
  const canEdit = hasOrgPermission(ctx, "care.plan.edit") && r.status === "ACTIVE";
  const names = await memberNames(ctx, [r.assessedById, r.archivedById, ...versions.map((v) => v.changedById)]);
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "System");
  const back = `/rota/risks/${r.id}`;
  const profile = `/rota/service-users/${r.serviceUser.id}?tab=risks`;
  // An earlier version is shown read-only; the current content is the assessment itself.
  const old = sp.v ? versions.find((v) => String(v.version) === sp.v && v.version !== r.version) ?? null : null;
  const shown = old ?? r;
  const state = r.status === "ACTIVE" ? reviewState(r.reviewDue) : null;
  const draft = r.status === "DRAFT";
  const canApproveDraft = draft && hasOrgPermission(ctx, "care.plan.edit");

  return (
    <>
      <PageHeader title={r.title} back={profile} subtitle={`${RISK_TYPE_LABEL[r.type]} risk assessment for ${suName(r.serviceUser)}.`} actions={<Link href={`/rota/care-plans/${r.serviceUser.id}`} className="btn-secondary">Care plan</Link>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {draft ? (
            <p role="note" className="rounded-md border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-body text-[#6b4a00]">
              This is a draft written from the person&apos;s documents before drafts were retired. Carers do not see it yet. Check the fields against the documents and put it in use; no second person is needed.
            </p>
          ) : null}
          {r.origin !== "MANUAL" && !old ? (
            <p role="note" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-body text-slate-700">
              <span className="font-medium">{RISK_ORIGIN_LABEL[r.origin] ?? r.origin}.</span> Saved by CSB AI from {r.sourceNote ?? "the person's documents"}.{r.origin === "AI_INFERRED" ? " CSB AI wrote it from what the support plan says; the plan did not contain a completed assessment for it. Check the level and controls at the next review." : " The council's own assessment, saved as written."} Edit it with Review this assessment.
            </p>
          ) : null}
          {old ? (
            <p role="note" className="rounded-md border border-[#f0d9a8] bg-[#fff8e8] px-3 py-2 text-body text-[#6b4a00]">
              You are reading version {old.version}, saved {fmtDate(old.changedAt, true)}. It is kept for the record and cannot be changed. <Link href={back}>Back to the current version</Link>
            </p>
          ) : null}
          <Card title={old ? `Version ${old.version}` : `Assessment · version ${r.version}`} actions={<span className="flex flex-wrap gap-1"><Badge tone={LEVEL[shown.level].tone}>{LEVEL[shown.level].label} risk</Badge>{shown.status === "DRAFT" ? <Badge tone="amber">Draft, not in use</Badge> : !old && r.origin === "AI_INFERRED" ? <Badge tone="slate">AI-generated</Badge> : shown.status === "ARCHIVED" ? <Badge>Archived</Badge> : !old && state ? <Badge tone={REVIEW_TONE[state]}>{REVIEW_STATE_LABEL[state]}</Badge> : null}</span>}>
            {old && old.title !== r.title ? <p className="mb-2 text-body"><span className="font-medium">Title then:</span> {old.title}</p> : null}
            <h3 className="text-body font-semibold">Hazards</h3>
            <p className="mb-3 whitespace-pre-line text-body">{shown.hazards}</p>
            <h3 className="text-body font-semibold">Controls carers follow</h3>
            <p className="mb-3 whitespace-pre-line text-body">{shown.controls}</p>
            <h3 className="text-body font-semibold">Actions still required</h3>
            {shown.requiredActions ? (
              <p className="whitespace-pre-line text-body">{shown.requiredActions}<span className="mt-1 block text-meta text-slate-600">Responsible: {shown.responsiblePerson}</span></p>
            ) : <p className="text-body text-slate-600">None recorded.</p>}
            <p className="mt-3 text-meta text-slate-600">
              {old ? <>{CHANGE[old.change] ?? old.change} by {who(old.changedById)}. Review was due {fmtLondonDate(fromDbDate(old.reviewDue))}.</> : <>Last assessed by {who(r.assessedById)} on {fmtDate(r.assessedAt)}. Review by <span className={state === "OVERDUE" ? "font-medium text-[#a3242c]" : ""}>{fmtLondonDate(fromDbDate(r.reviewDue))}</span>.</>}
            </p>
          </Card>
          {canApproveDraft && !old ? (
            <Card title="Check and put in use">
              <p className="mb-2 text-meta text-slate-600">Correct anything that does not match the documents or your own assessment, then put it in use. Your name is recorded on the version.</p>
              <form action={approveRiskDraftAction} className="space-y-3">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="riskId" value={r.id} />
                <input type="hidden" name="version" value={r.version} />
                <RiskFields risk={r} />
                <button className="btn-primary">Put in use</button>
              </form>
            </Card>
          ) : null}
          {canEdit && !old ? (
            <Card title="Review this assessment">
              <p className="mb-2 text-meta text-slate-600">Saving a review keeps this version as it is and starts version {r.version + 1}.</p>
              <form action={reviewRiskAction} className="space-y-3">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="riskId" value={r.id} />
                <input type="hidden" name="version" value={r.version} />
                <RiskFields risk={r} />
                <button className="btn-primary">Save review</button>
              </form>
            </Card>
          ) : null}
        </div>
        <aside className="space-y-3">
          <Card title="Versions">
            {versions.length ? (
              <ol className="rows text-body" aria-label="Saved versions, newest first">
                {versions.map((v) => {
                  const current = v.version === r.version;
                  const here = old ? old.version === v.version : current;
                  return (
                    <li key={v.id} className="py-2" aria-current={here ? "true" : undefined}>
                      <span className="font-medium">{current ? `Version ${v.version} (current)` : <Link href={`${back}?v=${v.version}`}>Version {v.version}</Link>}</span> · {CHANGE[v.change] ?? v.change}
                      <span className="block text-slate-600">{who(v.changedById)} · {fmtDate(v.changedAt, true)} · {LEVEL[v.level].label.toLowerCase()} risk</span>
                      {v.reason ? <span className="block text-slate-600">{v.reason}</span> : null}
                    </li>
                  );
                })}
              </ol>
            ) : <Empty>No versions saved.</Empty>}
          </Card>
          {canEdit ? (
            <Card title="No longer applies">
              <form action={archiveRiskAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="riskId" value={r.id} />
                <label className="block"><span className="label">Reason</span><input name="reason" required minLength={3} className="input" /></label>
                <button className="btn-danger">Archive assessment</button>
              </form>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}

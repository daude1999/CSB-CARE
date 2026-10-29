import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { RISK_TYPE_LABEL, getRisk } from "@/server/care/risks";
import { memberNames, suName } from "@/server/rota/queries";
import { fmtLondonDate, fromDbDate, londonDate } from "@/lib/london";
import { archiveRiskAction, reviewRiskAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { LEVEL, RiskFields } from "@/components/risk-fields";

export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = { "risk.created": "Assessed", "risk.reviewed": "Reviewed", "risk.archived": "Archived" };

export default async function RiskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const { risk: r, history } = await orNotFound(getRisk(ctx, id));
  const canEdit = hasOrgPermission(ctx, "care.plan.edit") && r.status === "ACTIVE";
  const names = await memberNames(ctx, [r.assessedById, r.archivedById, ...history.map((h) => h.actorId)]);
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "System");
  const back = `/rota/risks/${r.id}`;
  const due = fromDbDate(r.reviewDue);

  return (
    <>
      <PageHeader title={r.title} back={`/rota/risks?su=${r.serviceUser.id}`} subtitle={`${RISK_TYPE_LABEL[r.type]} risk assessment for ${suName(r.serviceUser)}.`} actions={<Link href={`/rota/care-plans/${r.serviceUser.id}`} className="btn-secondary">Care plan</Link>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <Card title="Assessment" actions={<span className="flex gap-1"><Badge tone={LEVEL[r.level].tone}>{LEVEL[r.level].label} risk</Badge>{r.status === "ARCHIVED" ? <Badge>Archived</Badge> : null}</span>}>
            <h3 className="text-[13.5px] font-semibold">Hazards</h3>
            <p className="mb-3 whitespace-pre-line text-[14.5px]">{r.hazards}</p>
            <h3 className="text-[13.5px] font-semibold">Controls carers follow</h3>
            <p className="whitespace-pre-line text-[14.5px]">{r.controls}</p>
            <p className="mt-3 text-[13px] text-slate-600">Last assessed by {who(r.assessedById)} on {fmtDate(r.assessedAt)}. Review by <span className={r.status === "ACTIVE" && due < londonDate() ? "font-medium text-[#a3242c]" : ""}>{fmtLondonDate(due)}</span>.</p>
          </Card>
          {canEdit ? (
            <Card title="Review this assessment">
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
          <Card title="History">
            {history.length ? (
              <ul className="rows text-[13.5px]">
                {history.map((h) => {
                  const d = (h.data ?? {}) as { reason?: string; previous?: { level?: string; reviewDue?: string } };
                  return (
                    <li key={h.id} className="py-2">
                      <span className="font-medium">{ACTION[h.action] ?? h.action}</span> · {who(h.actorId)} · {fmtDate(h.createdAt, true)}
                      {d.previous ? <span className="block text-slate-600">Before: {d.previous.level?.toLowerCase()} risk, review by {d.previous.reviewDue}</span> : null}
                      {d.reason ? <span className="block text-slate-600">{d.reason}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>No history.</Empty>}
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

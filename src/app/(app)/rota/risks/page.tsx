import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { RISK_TYPE_LABEL, listRisks } from "@/server/care/risks";
import { rotaLookups, suName } from "@/server/rota/queries";
import { fmtLondonDate, fromDbDate, londonDate } from "@/lib/london";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { LEVEL } from "@/components/risk-fields";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

export default async function RisksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const [rows, lk] = await Promise.all([listRisks(ctx, { serviceUserId: sp.su || undefined, type: sp.type, level: sp.level, due: sp.due, archived: sp.archived === "1", q: sp.q?.trim() || undefined }), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "care.plan.edit");
  const today = londonDate();

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="risks" />}
        title="Risk Assessments"
        back="/rota"
        subtitle="Every active risk assessment, soonest review first. Carers see the controls for the people they visit. Reviews keep the previous wording in the history; assessments that no longer apply are archived, not deleted."
        actions={canEdit ? <Link href={`/rota/risks/new${sp.su ? `?su=${sp.su}` : ""}`} className="btn-primary">New assessment</Link> : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <label className="col-span-2 md:col-span-1"><span className="label">Person</span><select name="su" defaultValue={sp.su ?? ""} className="input"><option value="">Everyone</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select></label>
          <label><span className="label">Type</span><select name="type" defaultValue={sp.type ?? ""} className="input"><option value="">Any type</option>{Object.entries(RISK_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span className="label">Level</span><select name="level" defaultValue={sp.level ?? ""} className="input"><option value="">Any level</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>
          <label><span className="label">Review</span><select name="due" defaultValue={sp.due ?? ""} className="input"><option value="">Any date</option><option value="overdue">Overdue</option><option value="30">Due within 30 days</option></select></label>
          <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Title or name" className="input" /></label>
          <div className="col-span-2 flex flex-wrap items-end gap-3 md:col-span-3 xl:col-span-1">
            <label className="flex items-center gap-2 pb-2 text-[14px]"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} className="h-4 w-4" /> Archived</label>
            <button className="btn-primary" type="submit">Apply</button>
          </div>
        </form>
      </section>
      <Card>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Assessment</th><th>Person</th><th>Type</th><th>Level</th><th>Review by</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const due = fromDbDate(r.reviewDue);
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/rota/risks/${r.id}`}>{r.title}</Link></td>
                      <td><Link href={`/rota/care-plans/${r.serviceUser.id}`}>{suName(r.serviceUser)}</Link></td>
                      <td>{RISK_TYPE_LABEL[r.type]}</td>
                      <td><Badge tone={LEVEL[r.level].tone}>{LEVEL[r.level].label}</Badge></td>
                      <td className={`tabular-nums ${r.status === "ACTIVE" && due < today ? "font-medium text-[#a3242c]" : ""}`}>{fmtLondonDate(due)}{r.status === "ACTIVE" && due < today ? " · overdue" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No risk assessments match these filters.</Empty>}
      </Card>
    </>
  );
}

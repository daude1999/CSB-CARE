import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { listIncidents } from "@/server/care/incidents";
import { suName } from "@/server/rota/queries";
import { fmtDate, Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { IncidentStatusBadge, SeverityBadge } from "@/components/incident-ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("incident.report");
  const manage = hasOrgPermission(ctx, "incident.manage");
  const rows = await listIncidents(ctx, { status: sp.status, severity: sp.severity, safeguarding: sp.safeguarding === "1", q: sp.q?.trim() || undefined });

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="incidents" />}
        title="Incidents"
        back={manage || hasOrgPermission(ctx, "rota.view") ? "/rota" : "/carer"}
        subtitle={manage ? "Incidents and accidents reported by staff, newest first. Serious incidents and safeguarding concerns alert managers in the app at once. The platform never sends notifications to CQC or the local authority; the registered manager does that." : "Incidents you have reported. A manager reviews each one."}
        actions={<Link href="/rota/incidents/new" className="btn-primary">Report an incident</Link>}
      />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <label><span className="label">Status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Not closed</option><option value="OPEN">Open</option><option value="INVESTIGATING">Investigating</option><option value="CLOSED">Closed</option><option value="all">All</option></select></label>
          <label><span className="label">Severity</span><select name="severity" defaultValue={sp.severity ?? ""} className="input"><option value="">Any</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MODERATE">Moderate</option><option value="LOW">Low</option></select></label>
          <label className="col-span-2 md:col-span-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Reference, name or words" className="input" /></label>
          <div className="col-span-2 flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-[14px]"><input type="checkbox" name="safeguarding" value="1" defaultChecked={sp.safeguarding === "1"} className="h-4 w-4" /> Safeguarding only</label>
            <button className="btn-primary" type="submit">Apply</button>
          </div>
        </form>
      </section>
      <Card>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Reference</th><th>When</th><th>Person</th><th>Category</th><th>Severity</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/rota/incidents/${i.id}`}>{i.reference}</Link></td>
                    <td className="tabular-nums">{fmtDate(i.occurredAt, true)}</td>
                    <td>{i.serviceUser ? suName(i.serviceUser) : <span className="text-slate-500">Not about a person</span>}</td>
                    <td>{i.category}{i.safeguarding ? <> <Badge tone="rose">Safeguarding</Badge></> : null}{i.notifiable ? <> <Badge tone="violet">May need notifying</Badge></> : null}</td>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td><IncidentStatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No incidents match these filters.</Empty>}
      </Card>
    </>
  );
}

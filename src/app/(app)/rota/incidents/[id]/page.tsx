import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getIncident } from "@/server/care/incidents";
import { memberNames, suName } from "@/server/rota/queries";
import { closeIncidentAction, incidentNoteAction, reopenIncidentAction, triageIncidentAction } from "@/app/rota-actions";
import { Badge, Card, Field, Flash, fmtDate, PageHeader } from "@/components/ui";
import { IncidentStatusBadge, SeverityBadge } from "@/components/incident-ui";

export const dynamic = "force-dynamic";

const ACTION: Record<string, string> = { "incident.reported": "Reported", "incident.triaged": "Reviewed", "incident.note": "Note", "incident.closed": "Closed", "incident.reopened": "Reopened" };

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("incident.report");
  const { incident: i, history, visit, staff } = await orNotFound(getIncident(ctx, id));
  const manage = hasOrgPermission(ctx, "incident.manage");
  const names = await memberNames(ctx, [i.reportedById, i.investigatorId, i.closedById, ...history.map((h) => h.actorId)]);
  const who = (u: string | null) => (u ? names.get(u) ?? "Former member" : "—");
  const back = `/rota/incidents/${i.id}`;

  return (
    <>
      <PageHeader title={`${i.reference} · ${i.category}`} back="/rota/incidents" subtitle={`Reported by ${who(i.reportedById)} on ${fmtDate(i.reportedAt, true)}.`} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card title="What happened" actions={<span className="flex flex-wrap gap-1"><SeverityBadge severity={i.severity} /><IncidentStatusBadge status={i.status} />{i.safeguarding ? <Badge tone="rose">Safeguarding</Badge> : null}{i.notifiable ? <Badge tone="violet">May need notifying</Badge> : null}</span>}>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="When">{fmtDate(i.occurredAt, true)}</Field>
              <Field label="Person">{i.serviceUser ? (manage ? <Link href={`/rota/care-plans/${i.serviceUser.id}`}>{suName(i.serviceUser)}</Link> : suName(i.serviceUser)) : "Not about a particular person"}</Field>
              <Field label="Staff member">{staff?.displayName ?? "—"}</Field>
              <Field label="Visit">{visit ? (manage ? <Link href={`/rota/visits/${visit.id}`}>{visit.reference}</Link> : visit.reference) : "—"}</Field>
            </div>
            <p className="whitespace-pre-line text-[14.5px]">{i.description}</p>
            {i.immediateAction ? <><h3 className="mt-3 text-[13.5px] font-semibold">Immediate action</h3><p className="whitespace-pre-line text-[14.5px]">{i.immediateAction}</p></> : null}
            {i.outcome ? <><h3 className="mt-3 text-[13.5px] font-semibold">Outcome</h3><p className="whitespace-pre-line text-[14.5px]">{i.outcome}</p><p className="text-[13px] text-slate-600">Closed by {who(i.closedById)} on {i.closedAt ? fmtDate(i.closedAt, true) : ""}</p></> : null}
          </Card>
          <Card title="Timeline">
            <ol className="rows text-[13.5px]">
              {history.map((h) => {
                const d = (h.data ?? {}) as { note?: string; reason?: string; to?: { severity?: string; safeguarding?: boolean; notifiable?: boolean } };
                return (
                  <li key={h.id} className="py-2">
                    <span className="font-medium">{ACTION[h.action] ?? h.action}</span> · {who(h.actorId)} · {fmtDate(h.createdAt, true)}
                    {d.to ? <span className="block text-slate-600">Severity {d.to.severity?.toLowerCase()}{d.to.safeguarding ? ", safeguarding" : ""}{d.to.notifiable ? ", may need notifying" : ""}</span> : null}
                    {d.note || d.reason ? <span className="block whitespace-pre-line text-slate-700">{d.note ?? d.reason}</span> : null}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
        {manage ? (
          <aside className="space-y-3">
            {i.status !== "CLOSED" ? (
              <>
                <Card title="Review">
                  <form action={triageIncidentAction} className="space-y-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="incidentId" value={i.id} />
                    <input type="hidden" name="version" value={i.version} />
                    <label className="block"><span className="label">Severity</span><select name="severity" defaultValue={i.severity} className="input"><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
                    <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="safeguarding" defaultChecked={i.safeguarding} className="h-4 w-4" /> Safeguarding concern</label>
                    <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="notifiable" defaultChecked={i.notifiable} className="h-4 w-4" /> May need a statutory notification</label>
                    <label className="block"><span className="label">Note</span><textarea name="note" rows={2} required minLength={3} className="input" /></label>
                    <button className="btn-secondary">{i.status === "OPEN" ? "Start investigating" : "Save review"}</button>
                  </form>
                </Card>
                <Card title="Add a note">
                  <form action={incidentNoteAction} className="space-y-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="incidentId" value={i.id} />
                    <label className="block"><span className="sr-only">Note</span><textarea name="note" rows={3} required minLength={3} className="input" placeholder="Calls made, findings, actions agreed" /></label>
                    <button className="btn-secondary">Add note</button>
                  </form>
                </Card>
                <Card title="Close">
                  <form action={closeIncidentAction} className="space-y-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="incidentId" value={i.id} />
                    <input type="hidden" name="version" value={i.version} />
                    <label className="block"><span className="label">Outcome and lessons learned</span><textarea name="outcome" rows={4} required minLength={20} className="input" /></label>
                    {i.notifiable ? <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="notificationHandled" className="mt-0.5 h-4 w-4" /> The notification has been made by the registered manager, or was not needed</label> : null}
                    <button className="btn-primary">Close incident</button>
                  </form>
                </Card>
              </>
            ) : (
              <Card title="Reopen">
                <form action={reopenIncidentAction} className="space-y-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="incidentId" value={i.id} />
                  <input type="hidden" name="version" value={i.version} />
                  <label className="block"><span className="label">Reason</span><input name="reason" required minLength={3} className="input" /></label>
                  <button className="btn-secondary">Reopen</button>
                </form>
              </Card>
            )}
          </aside>
        ) : null}
      </div>
    </>
  );
}

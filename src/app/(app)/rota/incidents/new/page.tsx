import { requireRotaPage } from "@/server/auth/portals";
import { INCIDENT_CATEGORIES, reportableServiceUsers } from "@/server/care/incidents";
import { suName } from "@/server/rota/queries";
import { hhmm, londonDate, londonMinute } from "@/lib/london";
import { reportIncidentAction } from "@/app/rota-actions";
import { Card, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("incident.report");
  const people = await reportableServiceUsers(ctx);
  const back = `/rota/incidents/new${sp.su ? `?su=${sp.su}` : ""}${sp.visit ? `${sp.su ? "&" : "?"}visit=${sp.visit}` : ""}`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Report an incident" back="/rota/incidents" subtitle="Report anything that happened, or nearly happened, that affected someone's safety or wellbeing. If someone is in danger now, call 999 first. Managers are alerted in the app straight away for serious incidents and safeguarding concerns." />
      <Flash searchParams={sp} />
      <Card>
        <form action={reportIncidentAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input type="hidden" name="back" value={back} />
          {sp.visit ? <input type="hidden" name="visitId" value={sp.visit} /> : null}
          <label className="md:col-span-2"><span className="label">Who was involved (optional)</span>
            <select name="serviceUserId" defaultValue={sp.su ?? ""} className="input"><option value="">Not about a particular person</option>{people.map((p) => <option key={p.id} value={p.id}>{suName(p)}</option>)}</select>
          </label>
          <label><span className="label">Date it happened</span><input type="date" name="date" required defaultValue={londonDate()} className="input" /></label>
          <label><span className="label">Time</span><input type="time" name="time" required defaultValue={hhmm(londonMinute(new Date()))} className="input" /></label>
          <label><span className="label">Category</span><select name="category" required defaultValue="" className="input"><option value="" disabled>Choose…</option>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label><span className="label">How serious</span><select name="severity" required defaultValue="" className="input"><option value="" disabled>Choose…</option><option value="LOW">Low: no harm</option><option value="MODERATE">Moderate: minor harm</option><option value="HIGH">High: harm needing treatment</option><option value="CRITICAL">Critical: serious harm or death</option></select></label>
          <label className="md:col-span-2"><span className="label">What happened</span><textarea name="description" rows={6} required minLength={20} className="input" /></label>
          <label className="md:col-span-2"><span className="label">What you did straight away (optional)</span><textarea name="immediateAction" rows={3} className="input" /></label>
          <label className="flex items-center gap-2 text-[14px] md:col-span-2"><input type="checkbox" name="safeguarding" className="h-4 w-4" /> I think this is a safeguarding concern (abuse or neglect)</label>
          <div className="md:col-span-2"><button className="btn-primary">Send report</button></div>
        </form>
      </Card>
    </div>
  );
}

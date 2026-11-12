import { requireRotaPage } from "@/server/auth/portals";
import { INCIDENT_CATEGORIES, incidentDraftFromNote, reportableServiceUsers } from "@/server/care/incidents";
import { suName } from "@/server/rota/queries";
import { hhmm, londonDate, londonMinute } from "@/lib/london";
import { reportIncidentAction } from "@/app/rota-actions";
import { Card, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("incident.report");
  const people = await reportableServiceUsers(ctx);
  // Started from a visit note: the person, visit, time and the note's words are filled in, to check and complete.
  const draft = sp.note ? await incidentDraftFromNote(ctx, sp.note.slice(0, 40)) : null;
  const su = draft?.serviceUserId ?? sp.su;
  const visit = draft?.visitId ?? sp.visit;
  const back = `/rota/incidents/new${su ? `?su=${su}` : ""}${visit ? `${su ? "&" : "?"}visit=${visit}` : ""}`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Report an incident" back="/rota/incidents" subtitle="Report anything that happened, or nearly happened, that affected someone's safety or wellbeing. If someone is in danger now, call 999 first. Managers are alerted in the app straight away for serious incidents and safeguarding concerns." />
      <Flash searchParams={sp} />
      <Card>
        <form action={reportIncidentAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input type="hidden" name="back" value={back} />
          {visit ? <input type="hidden" name="visitId" value={visit} /> : null}
          {draft ? <p className="rounded-[6px] bg-[#f0f5ff] px-3 py-2 text-body text-[#1d4f91] md:col-span-2" data-testid="incident-from-note">Filled in from the visit note. Check the details, choose a category and how serious it was, then send.</p> : null}
          <label className="md:col-span-2"><span className="label">Who was involved (optional)</span>
            <select name="serviceUserId" defaultValue={su ?? ""} className="input"><option value="">Not about a particular person</option>{people.map((p) => <option key={p.id} value={p.id}>{suName(p)}</option>)}</select>
          </label>
          <label><span className="label">Date it happened</span><input type="date" name="date" required defaultValue={draft?.date ?? londonDate()} className="input" /></label>
          <label><span className="label">Time</span><input type="time" name="time" required defaultValue={draft?.time ?? hhmm(londonMinute(new Date()))} className="input" /></label>
          <label><span className="label">Category</span><select name="category" required defaultValue="" className="input"><option value="" disabled>Choose…</option>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label><span className="label">How serious</span><select name="severity" required defaultValue="" className="input"><option value="" disabled>Choose…</option><option value="LOW">Low: no harm</option><option value="MODERATE">Moderate: minor harm</option><option value="HIGH">High: harm needing treatment</option><option value="CRITICAL">Critical: serious harm or death</option></select></label>
          <label className="md:col-span-2"><span className="label">What happened</span><textarea name="description" rows={6} required minLength={20} defaultValue={draft?.description} className="input" /></label>
          <label className="md:col-span-2"><span className="label">What you did straight away (optional)</span><textarea name="immediateAction" rows={3} className="input" /></label>
          <label className="md:col-span-2"><span className="label">Who was told (optional)</span><input name="peopleNotified" maxLength={1000} className="input" placeholder="e.g. Daughter by phone at 10:15; GP surgery; the office" /></label>
          <label className="flex items-center gap-2 text-body md:col-span-2"><input type="checkbox" name="safeguarding" className="h-4 w-4" /> I think this is a safeguarding concern (abuse or neglect)</label>
          <div className="md:col-span-2"><button className="btn-primary">Send report</button></div>
        </form>
      </Card>
    </div>
  );
}

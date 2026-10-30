import { requireRotaPage } from "@/server/auth/portals";
import { rotaLookups, suName } from "@/server/rota/queries";
import { createVisitAction } from "@/app/rota-actions";
import { isIsoDate, londonDate } from "@/lib/london";
import { Card, Empty, Flash, PageHeader } from "@/components/ui";
import Link from "@/components/link";

export const dynamic = "force-dynamic";

/** A one-off visit outside the recurring templates. The visit starts unassigned; carers are allocated on its page. */
export default async function NewVisitPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.edit");
  const lk = await rotaLookups(ctx);
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const serviceUsers = lk.serviceUsers.filter((s) => s.status === "ACTIVE");
  const back = `/rota/visits/new?date=${date}`;
  return (
    <>
      <PageHeader title="Add visit" back={`/rota/visits?date=${date}`} subtitle="A one-off visit outside the templates. It is created without carers; allocate them from the visit page, where eligibility is checked." />
      <Flash searchParams={sp} />
      <Card>
        {serviceUsers.length === 0 ? (
          <Empty>No service user has active care in your areas. <Link href="/rota/service-users">Open Service Users</Link> to start someone&apos;s care first.</Empty>
        ) : lk.callTypes.length === 0 ? (
          <Empty>No call types are set up. <Link href="/rota/settings">Add call types in Rota Settings</Link> first.</Empty>
        ) : (
          <form action={createVisitAction} className="grid max-w-3xl gap-4 md:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <label className="md:col-span-2"><span className="label">Service user</span>
              <select name="serviceUserId" className="input" required defaultValue={sp.serviceUserId ?? ""}>
                <option value="" disabled>Choose a service user</option>
                {serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)} ({s.reference})</option>)}
              </select>
            </label>
            <label><span className="label">Call type</span>
              <select name="callTypeId" className="input" required defaultValue={lk.callTypes[0]?.id}>
                {lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span className="label">Date</span><input type="date" name="date" className="input" required defaultValue={date} /></label>
            <label><span className="label">Start (UK time)</span><input type="time" name="start" className="input" required defaultValue="08:00" /></label>
            <label><span className="label">Length (minutes)</span><input type="number" name="durationMin" className="input" required min={5} max={1440} step={5} defaultValue={30} /></label>
            <label><span className="label">Carers needed</span>
              <select name="carersRequired" className="input" defaultValue="1">
                <option value="1">One carer</option>
                <option value="2">Two carers (double-up)</option>
              </select>
            </label>
            <div className="flex flex-col gap-2 pt-6 text-[14px]">
              <label className="flex items-center gap-2"><input type="checkbox" name="medicationRequired" value="on" /> Medication prompt on this visit</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="timeLocked" value="on" /> Time locked (cannot be moved without unlocking)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="publish" value="on" defaultChecked /> Publish now (visible to the allocated carer)</label>
            </div>
            <label className="md:col-span-2"><span className="label">Notes for the office (optional)</span><textarea name="notes" className="input" rows={3} maxLength={2000} /></label>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary">Add visit</button>
              <Link href={`/rota/visits?date=${date}`} className="btn-secondary">Cancel</Link>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { fromDbDate } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaSettings } from "@/server/rota/settings";
import { callTypeActiveAction, careTaskActiveAction, createCallTypeAction, createCareTaskAction, rotaSettingsAction } from "@/app/rota-actions";
import { Card, Flash, fmtDate, PageHeader } from "@/components/ui";
import { medicationSwitchAction } from "@/app/medication-actions";

export const dynamic = "force-dynamic";

const RULES = [["BLOCK", "Block allocation"], ["REVIEW", "Allow after review"], ["IGNORE", "Ignore"]] as const;

function Num({ name, label, value, min, max, hint }: { name: string; label: string; value: number; min: number; max: number; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" name={name} min={min} max={max} required defaultValue={value} className="input" />
      {hint ? <span className="mt-0.5 block text-[12px] text-slate-500">{hint}</span> : null}
    </label>
  );
}
function Tick({ name, label, value }: { name: string; label: string; value: boolean }) {
  return <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name={name} defaultChecked={value} className="h-4 w-4" /> {label}</label>;
}

export default async function RotaSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.settings")) notFound();
  const org = ctx.organisationId!;
  const [s, callTypes, tasks] = await Promise.all([rotaSettings(db, org), db.callType.findMany({ where: { organisationId: org }, orderBy: { name: "asc" } }), db.careTask.findMany({ where: { organisationId: org }, orderBy: { name: "asc" } })]);
  const back = "/rota/settings";
  return (
    <>
      <PageHeader title="Rostering Settings" back="/rota" subtitle="How the rota cycle, allocation checks and call timings work for your organisation. Every change is recorded. Clocking, geofence and carer-app settings take effect when those features are built." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Rules">
          <form action={rotaSettingsAction} className="space-y-5">
            <input type="hidden" name="back" value={back} />
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-[15px] font-medium text-navy-900">Rota cycle</legend>
              <label><span className="label">Cycle length</span><select name="cycleLength" defaultValue={s.cycleLength} className="input">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} week{n > 1 ? "s" : ""}</option>)}</select></label>
              <label><span className="label">Week 1 starts on (a Monday)</span><input type="date" name="anchorMonday" required defaultValue={fromDbDate(s.anchorMonday)} className="input" /></label>
              <Num name="buildAheadWeeks" label="Weeks to build ahead" value={s.buildAheadWeeks} min={0} max={8} />
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-[15px] font-medium text-navy-900">Allocation checks</legend>
              <label><span className="label">DBS</span><select name="dbsRule" defaultValue={s.dbsRule} className="input">{RULES.filter(([k]) => k !== "IGNORE").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Right to work</span><select name="rightToWorkRule" defaultValue={s.rightToWorkRule} className="input">{RULES.filter(([k]) => k !== "IGNORE").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Required training</span><select name="trainingRule" defaultValue={s.trainingRule} className="input">{RULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Lowest carer rating allowed</span><select name="minPreferenceRating" defaultValue={s.minPreferenceRating ?? ""} className="input"><option value="">No minimum</option>{[2, 3, 4].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></label>
              <label className="md:col-span-2"><span className="label">Care roles (one job title per line)</span><textarea name="careRoleTitles" rows={4} defaultValue={s.careRoleTitles.join("\n")} className="input" /><span className="mt-0.5 block text-[12px] text-slate-500">Staff with these HR job titles take part in the rota unless switched off on their staff page. DBS and right to work checks can never be ignored.</span></label>
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-[15px] font-medium text-navy-900">Call timing</legend>
              <Num name="lateAfterMin" label="Late after (minutes)" value={s.lateAfterMin} min={1} max={120} />
              <Num name="missedAfterMin" label="Missed after (minutes)" value={s.missedAfterMin} min={2} max={480} />
              <Num name="earlyBeforeMin" label="Early clock-in allowed (minutes)" value={s.earlyBeforeMin} min={0} max={120} />
              <Num name="shortVisitPercent" label="Short if under (% of planned)" value={s.shortVisitPercent} min={1} max={100} />
              <Num name="alertLatencyTargetSec" label="Alert target (seconds)" value={s.alertLatencyTargetSec} min={60} max={3600} hint="How soon after a call becomes late the office should be told." />
              <div className="space-y-2 pt-5"><Tick name="blockEarlyClockIn" label="Block early clock-in" value={s.blockEarlyClockIn} /><Tick name="requireNoteOnShortVisit" label="Note required on a short visit" value={s.requireNoteOnShortVisit} /></div>
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-[15px] font-medium text-navy-900">Missed calls</legend>
              <Num name="repeatOffenderCount" label="Repeat offender: missed calls" value={s.repeatOffenderCount} min={2} max={20} hint="A care worker with this many in the window is flagged. Calls found to be delivered, or not their doing, are left out." />
              <Num name="repeatClientCount" label="Repeat service-user incident: missed calls" value={s.repeatClientCount} min={2} max={20} />
              <Num name="repeatWindowDays" label="Window (days)" value={s.repeatWindowDays} min={7} max={365} />
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-[15px] font-medium text-navy-900">Carer app <span className="text-[12.5px] font-normal text-slate-500">(not built yet)</span></legend>
              <Num name="carerDaysForward" label="Days ahead carers see" value={s.carerDaysForward} min={0} max={28} />
              <Num name="carerDaysBack" label="Days back carers see" value={s.carerDaysBack} min={0} max={14} />
              <Num name="geofenceMetres" label="Location check radius (m)" value={s.geofenceMetres} min={25} max={2000} hint="Location is simulated in the demo." />
              <div className="space-y-2"><Tick name="mandatoryClockOutNote" label="Note required at clock-out" value={s.mandatoryClockOutNote} /><Tick name="doorstepCancel" label="Carers may record no reply at the door" value={s.doorstepCancel} /></div>
            </fieldset>
            <div className="flex items-center gap-3"><button className="btn-primary">Save settings</button><span className="text-[12.5px] text-slate-500">Last changed {fmtDate(s.updatedAt, true)}</span></div>
          </form>
        </Card>
        <div className="space-y-3">
          <Card title="Call types">
            <ul className="space-y-1.5 text-[14px]">
              {callTypes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className={c.active ? "" : "text-slate-400"}>{c.name} <span className="text-slate-500">· {c.defaultDurationMin}m{c.chargeable ? "" : " · not charged"}</span></span>
                  <form action={callTypeActiveAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><button className="btn-secondary px-2 py-0.5 text-[13px]">{c.active ? "Switch off" : "Switch on"}</button></form>
                </li>
              ))}
            </ul>
            <form action={createCallTypeAction} className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
              <input type="hidden" name="back" value={back} />
              <label className="col-span-2"><span className="label">New call type</span><input name="name" required className="input" /></label>
              <label><span className="label">Usual minutes</span><input type="number" name="defaultDurationMin" min={5} max={1440} defaultValue={30} className="input" /></label>
              <div className="space-y-1 pt-5"><Tick name="chargeable" label="Charged" value={true} /><Tick name="monitored" label="Monitored" value={true} /></div>
              <button className="btn-secondary col-span-2">Add call type</button>
            </form>
          </Card>
          <Card title="Care tasks">
            <ul className="space-y-1.5 text-[14px]">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className={t.active ? "" : "text-slate-400"}>{t.name}</span>
                  <form action={careTaskActiveAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? "0" : "1"} /><button className="btn-secondary px-2 py-0.5 text-[13px]">{t.active ? "Switch off" : "Switch on"}</button></form>
                </li>
              ))}
            </ul>
            <form action={createCareTaskAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">New task</span><input name="name" required className="input" /></label>
              <label className="block"><span className="label">Description</span><input name="description" className="input" /></label>
              <button className="btn-secondary">Add task</button>
            </form>
            <p className="mt-2 text-[12.5px] text-slate-500">Medication is recorded separately from tasks; see Medication records.</p>
          </Card>
          <Card title="Medication records">
            {s.medicationEnabledAt ? (
              <>
                <p className="text-[14px]">Switched on {fmtDate(s.medicationEnabledAt, true)}. Clinical review: {s.medicationReviewNote}</p>
                {hasOrgPermission(ctx, "org.manage") ? (
                  <form action={medicationSwitchAction} className="mt-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="0" /><button className="btn-secondary">Switch off</button></form>
                ) : null}
              </>
            ) : hasOrgPermission(ctx, "org.manage") ? (
              <form action={medicationSwitchAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="1" />
                <p className="text-[14px]">Off. Switching on lets managers keep each person&apos;s medicines (checked by a second person) and carers record each dose on the visit, with missed-medication exceptions and a monthly MAR chart. The platform does not check doses, interactions or stock.</p>
                <label className="block"><span className="label">Who reviewed this for clinical safety, and when</span><input name="reviewNote" required minLength={10} className="input" placeholder="e.g. J. Smith, registered nurse, 30 Oct 2026" /></label>
                <button className="btn-primary">Switch on medication records</button>
              </form>
            ) : <p className="text-[14px]">Off. An organisation admin can switch medication records on after a clinical review.</p>}
          </Card>
          <Card title="Areas">
            <p className="text-[14px]">Areas and which coordinators work in them are managed in <Link href="/admin/areas">Administration → Areas</Link>.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

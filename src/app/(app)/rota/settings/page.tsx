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
import { careSummarySwitchAction } from "@/app/care-summary-actions";
import { bodyMapAiSwitchAction } from "@/app/su-record-actions";
import { missedAutomationSettingsAction } from "@/app/missed-auto-actions";
import { coordinatorAiSwitchAction } from "@/app/coordinator-actions";
import { aiProviderProblem, getAiProvider } from "@/server/ai";
import { coordinatorAiUsage } from "@/server/care/coordinator/agent";

export const dynamic = "force-dynamic";

const RULES = [["BLOCK", "Block allocation"], ["REVIEW", "Allow after review"], ["IGNORE", "Ignore"]] as const;

function Num({ name, label, value, min, max, hint }: { name: string; label: string; value: number; min: number; max: number; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" name={name} min={min} max={max} required defaultValue={value} className="input" />
      {hint ? <span className="mt-0.5 block text-caption text-slate-500">{hint}</span> : null}
    </label>
  );
}
function Tick({ name, label, value }: { name: string; label: string; value: boolean }) {
  return <label className="flex items-center gap-2 text-body"><input type="checkbox" name={name} defaultChecked={value} className="h-4 w-4" /> {label}</label>;
}

export default async function RotaSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.settings")) notFound();
  const org = ctx.organisationId!;
  const [s, callTypes, tasks] = await Promise.all([rotaSettings(db, org), db.callType.findMany({ where: { organisationId: org }, orderBy: { name: "asc" } }), db.careTask.findMany({ where: { organisationId: org }, orderBy: { name: "asc" } })]);
  const back = "/rota/settings";
  const ai = getAiProvider();
  const aiName = ai?.summariseCare ? (ai.isSimulated ? "Simulated (rule-based, labelled; no AI and nothing leaves the platform)" : ai.name) : null;
  // Which hosting setting stops Claude being used, for the organisation admin (never shows the key or the raw value).
  const aiProblem = hasOrgPermission(ctx, "org.manage") ? aiProviderProblem() : null;
  const aiProblemLine = aiProblem ? <p className="mt-1 text-meta text-amber-800" data-testid="ai-provider-problem">Why Claude is not in use: {aiProblem}</p> : null;
  // Usage of the Claude chat, from the audit log (token counts only), for the organisation admin.
  const coordinatorUsage = aiName && s.careCoordinatorAiEnabledAt && hasOrgPermission(ctx, "org.manage") ? await coordinatorAiUsage(ctx, 30) : null;
  return (
    <>
      <PageHeader title="Rostering Settings" back="/rota" subtitle="How the rota cycle, allocation checks and call timings work for your organisation. Every change is recorded. Clocking, geofence and carer-app settings take effect when those features are built." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Rules">
          <form action={rotaSettingsAction} className="space-y-5">
            <input type="hidden" name="back" value={back} />
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-lead font-medium text-navy-900">Rota cycle</legend>
              <label><span className="label">Cycle length</span><select name="cycleLength" defaultValue={s.cycleLength} className="input">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} week{n > 1 ? "s" : ""}</option>)}</select></label>
              <label><span className="label">Week 1 starts on (a Monday)</span><input type="date" name="anchorMonday" required defaultValue={fromDbDate(s.anchorMonday)} className="input" /></label>
              <Num name="buildAheadWeeks" label="Weeks to build ahead" value={s.buildAheadWeeks} min={0} max={8} />
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-lead font-medium text-navy-900">Allocation checks</legend>
              <label><span className="label">DBS</span><select name="dbsRule" defaultValue={s.dbsRule} className="input">{RULES.filter(([k]) => k !== "IGNORE").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Right to work</span><select name="rightToWorkRule" defaultValue={s.rightToWorkRule} className="input">{RULES.filter(([k]) => k !== "IGNORE").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Required training</span><select name="trainingRule" defaultValue={s.trainingRule} className="input">{RULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Lowest carer rating allowed</span><select name="minPreferenceRating" defaultValue={s.minPreferenceRating ?? ""} className="input"><option value="">No minimum</option>{[2, 3, 4].map((n) => <option key={n} value={n}>{n} of 5</option>)}</select></label>
              <label className="md:col-span-2"><span className="label">Care roles (one job title per line)</span><textarea name="careRoleTitles" rows={4} defaultValue={s.careRoleTitles.join("\n")} className="input" /><span className="mt-0.5 block text-caption text-slate-500">Staff with these HR job titles take part in the rota unless switched off on their staff page. DBS and right to work checks can never be ignored.</span></label>
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-lead font-medium text-navy-900">Call timing</legend>
              <Num name="lateAfterMin" label="Late after (minutes)" value={s.lateAfterMin} min={1} max={120} />
              <Num name="missedAfterMin" label="Missed after (minutes)" value={s.missedAfterMin} min={2} max={480} />
              <Num name="earlyBeforeMin" label="Early clock-in allowed (minutes)" value={s.earlyBeforeMin} min={0} max={120} />
              <Num name="shortVisitPercent" label="Short if under (% of planned)" value={s.shortVisitPercent} min={1} max={100} />
              <Num name="alertLatencyTargetSec" label="Alert target (seconds)" value={s.alertLatencyTargetSec} min={60} max={3600} hint="How soon after a call becomes late the office should be told." />
              <div className="space-y-2 pt-5"><Tick name="blockEarlyClockIn" label="Block early clock-in" value={s.blockEarlyClockIn} /><Tick name="requireNoteOnShortVisit" label="Note required on a short visit" value={s.requireNoteOnShortVisit} /></div>
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-lead font-medium text-navy-900">Missed calls</legend>
              <Num name="repeatOffenderCount" label="Repeat offender: missed calls" value={s.repeatOffenderCount} min={2} max={20} hint="A care worker with this many in the window is flagged. Calls found to be delivered, or not their doing, are left out." />
              <Num name="repeatClientCount" label="Repeat service-user incident: missed calls" value={s.repeatClientCount} min={2} max={20} />
              <Num name="repeatWindowDays" label="Window (days)" value={s.repeatWindowDays} min={7} max={365} />
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-2 text-lead font-medium text-navy-900">Carer app <span className="text-meta font-normal text-slate-500">(not built yet)</span></legend>
              <Num name="carerDaysForward" label="Days ahead carers see" value={s.carerDaysForward} min={0} max={28} />
              <Num name="carerDaysBack" label="Days back carers see" value={s.carerDaysBack} min={0} max={14} />
              <Num name="geofenceMetres" label="Location check radius (m)" value={s.geofenceMetres} min={25} max={2000} hint="Location is simulated in the demo." />
              <div className="space-y-2"><Tick name="mandatoryClockOutNote" label="Note required at clock-out" value={s.mandatoryClockOutNote} /><Tick name="doorstepCancel" label="Carers may record no reply at the door" value={s.doorstepCancel} /></div>
            </fieldset>
            <div className="flex items-center gap-3"><button className="btn-primary">Save settings</button><span className="text-meta text-slate-500">Last changed {fmtDate(s.updatedAt, true)}</span></div>
          </form>
        </Card>
        <div className="space-y-3">
          <Card title="Call types">
            <ul className="space-y-1.5 text-body">
              {callTypes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className={c.active ? "" : "text-slate-400"}>{c.name} <span className="text-slate-500">· {c.defaultDurationMin}m{c.chargeable ? "" : " · not charged"}</span></span>
                  <form action={callTypeActiveAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><button className="btn-secondary px-2 py-0.5 text-meta">{c.active ? "Switch off" : "Switch on"}</button></form>
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
            <ul className="space-y-1.5 text-body">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className={t.active ? "" : "text-slate-400"}>{t.name}</span>
                  <form action={careTaskActiveAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? "0" : "1"} /><button className="btn-secondary px-2 py-0.5 text-meta">{t.active ? "Switch off" : "Switch on"}</button></form>
                </li>
              ))}
            </ul>
            <form action={createCareTaskAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">New task</span><input name="name" required className="input" /></label>
              <label className="block"><span className="label">Description</span><input name="description" className="input" /></label>
              <button className="btn-secondary">Add task</button>
            </form>
            <p className="mt-2 text-meta text-slate-500">Medication is recorded separately from tasks; see Medication records.</p>
          </Card>
          <Card title="Medication records">
            {s.medicationEnabledAt ? (
              <>
                <p className="text-body">Switched on {fmtDate(s.medicationEnabledAt, true)}. Clinical review: {s.medicationReviewNote}</p>
                {hasOrgPermission(ctx, "org.manage") ? (
                  <form action={medicationSwitchAction} className="mt-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="0" /><button className="btn-secondary">Switch off</button></form>
                ) : null}
              </>
            ) : hasOrgPermission(ctx, "org.manage") ? (
              <form action={medicationSwitchAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="1" />
                <p className="text-body">Off. Switching on lets managers keep each person&apos;s medicines (checked by a second person) and carers record each dose on the visit, with missed-medication exceptions and a monthly MAR chart. The platform does not check doses, interactions or stock.</p>
                <label className="block"><span className="label">Who reviewed this for clinical safety, and when</span><input name="reviewNote" required minLength={10} className="input" placeholder="e.g. J. Smith, registered nurse, 30 Oct 2026" /></label>
                <button className="btn-primary">Switch on medication records</button>
              </form>
            ) : <p className="text-body">Off. An organisation admin can switch medication records on after a clinical review.</p>}
          </Card>
          <Card title="Care Summary (AI)">
            {s.careSummaryEnabledAt ? (
              <>
                <p className="text-body">Switched on {fmtDate(s.careSummaryEnabledAt, true)}. Authorised by: {s.careSummaryReviewNote}</p>
                <p className="mt-1 text-meta text-slate-600">AI provider: {aiName ?? "not configured, so summaries cannot be created"}.</p>
                {hasOrgPermission(ctx, "org.manage") ? (
                  <form action={careSummarySwitchAction} className="mt-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="0" /><button className="btn-secondary">Switch off</button></form>
                ) : null}
              </>
            ) : hasOrgPermission(ctx, "org.manage") ? (
              <form action={careSummarySwitchAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="1" />
                <p className="text-body">Off. Switching on lets coordinators ask the AI provider for a draft summary of a person&apos;s recent records on their care plan. Record text is sent to the provider; names and addresses are not. Summaries are marked unapproved, never change a plan, and the recent records view works whether this is on or off.</p>
                <p className="text-meta text-slate-600">AI provider: {aiName ?? "not configured"}.</p>
                <label className="block"><span className="label">Who authorised sending care records to the AI provider, and when</span><input name="authorisedBy" required minLength={10} className="input" placeholder="e.g. M. Mire, CEO, after DPIA, 1 Nov 2026" /></label>
                <button className="btn-primary">Switch on Care Summary</button>
              </form>
            ) : <p className="text-body">Off. An organisation admin can switch it on after confirming data protection approval.</p>}
          </Card>
          <Card title="Body map recommendations (AI)">
            {s.bodyMapAiEnabledAt ? (
              <>
                <p className="text-body">Switched on {fmtDate(s.bodyMapAiEnabledAt, true)}. Authorised by: {s.bodyMapAiReviewNote}</p>
                <p className="mt-1 text-meta text-slate-600">AI provider: {aiName ?? "not configured, so no suggestions can be made"}.</p>
                {hasOrgPermission(ctx, "org.manage") ? (
                  <form action={bodyMapAiSwitchAction} className="mt-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="0" /><button className="btn-secondary">Switch off</button></form>
                ) : null}
              </>
            ) : hasOrgPermission(ctx, "org.manage") ? (
              <form action={bodyMapAiSwitchAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="on" value="1" />
                <p className="text-body">Off. Switching on lets office staff ask for AI-assisted suggestions on body map observations (follow-up, care plan, risk assessment, incident and medication reviews). Recorded text is sent to the provider; photographs, names and addresses are not. Suggestions never change records; a manager decides. Keep it off for real records until the DPIA and clinical safety review are done.</p>
                <p className="text-meta text-slate-600">AI provider: {aiName ?? "not configured"}.</p>
                <label className="block"><span className="label">Who authorised it (DPIA and clinical safety review), and when</span><input name="authorisedBy" required minLength={10} className="input" placeholder="e.g. M. Mire, CEO, after DPIA, 3 Nov 2026" /></label>
                <button className="btn-primary">Switch on body map recommendations</button>
              </form>
            ) : <p className="text-body">Off. An organisation admin can switch it on after the data protection and clinical safety review.</p>}
          </Card>
          <Card title="Care Coordinator AI (document reading and AI CSB Coordinator chat)">
            <div id="coordinator-ai" className="scroll-mt-20" />
            {s.careCoordinatorAiEnabledAt ? (
              <>
                <p className="text-body">Switched on {fmtDate(s.careCoordinatorAiEnabledAt, true)}. Authorised by: {s.careCoordinatorAiReviewNote}</p>
                <p className="mt-1 text-meta text-slate-600">AI provider: {aiName ?? "not configured, so CSB's own reader and the built-in CRM answers are used"}.</p>
                {aiProblemLine}
                {coordinatorUsage ? <p className="mt-1 text-meta text-slate-600" data-testid="coordinator-ai-usage">AI CSB Coordinator, last 30 days: {coordinatorUsage.messages} AI message{coordinatorUsage.messages === 1 ? "" : "s"} from {coordinatorUsage.people} {coordinatorUsage.people === 1 ? "person" : "people"}, about ${coordinatorUsage.estimatedCostUsd.toFixed(2)} at list price (an estimate from token counts, not a bill).</p> : null}
                {hasOrgPermission(ctx, "org.manage") ? (
                  <form action={coordinatorAiSwitchAction} className="mt-2"><input type="hidden" name="back" value={`${back}#coordinator-ai`} /><input type="hidden" name="on" value="0" /><button className="btn-secondary">Switch off</button></form>
                ) : null}
              </>
            ) : hasOrgPermission(ctx, "org.manage") ? (
              <form action={coordinatorAiSwitchAction} className="space-y-2">
                <input type="hidden" name="back" value={`${back}#coordinator-ai`} /><input type="hidden" name="on" value="1" />
                <p className="text-body">Off. Documents uploaded to the Care Coordinator are read on CSB&apos;s own server, which recognises labelled lines and timetable rows only. Switching on sends each uploaded PDF, including names, health details and addresses, to the AI provider to read every page. Every quote it returns is checked against the page, nothing is saved until the Care Coordinator reviews and confirms it, and the AI never approves anything. The same switch lets the AI CSB Coordinator chat use Claude with the CRM&apos;s own permission-checked tools (search, intakes, extracted facts, review steps); it can start draft intakes and read uploaded documents, but cannot approve, save to a record or publish.</p>
                <p className="text-meta text-slate-600">AI provider: {aiName ?? "not configured"}.</p>
                {aiProblemLine}
                <label className="block"><span className="label">Who authorised sending care documents to the AI provider (data protection review), and when</span><input name="authorisedBy" required minLength={10} className="input" placeholder="e.g. M. Mire, CEO, after DPIA, 4 Nov 2026" /></label>
                <button className="btn-primary">Switch on AI document reading</button>
              </form>
            ) : <p className="text-body">Off. Documents are read on CSB&apos;s own server. An organisation admin can switch AI reading on after the data protection review.</p>}
          </Card>
          <Card title="Missed call automation">
            <div id="missed-automation" className="scroll-mt-20" />
            <p className="mb-2 text-body">Helps investigate missed calls. It never marks a visit done, never changes clock times, never closes a case and never sends anything outside the platform: coordinators still record the reason and managers still sign off. Switching a stage off stops it at once; what it already recorded stays on the case.</p>
            {hasOrgPermission(ctx, "org.manage") ? (
              <form action={missedAutomationSettingsAction} className="space-y-2">
                <input type="hidden" name="back" value={`${back}#missed-automation`} />
                <Tick name="evidence" label="1. Collect evidence and build a timeline for each missed call" value={!!s.missedAutoEvidenceAt} />
                <Tick name="confirm" label="2. Ask booked carers with a sign-in what happened (in the app only)" value={!!s.missedAutoConfirmAt} />
                <Tick name="summary" label="3. Suggest a reason for the coordinator to accept or reject" value={!!s.missedAutoSummaryAt} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Num name="confirmMinutes" label="Minutes a carer has to answer" value={s.missedConfirmMinutes} min={15} max={1440} hint="Then the coordinator is told." />
                  <Num name="reminders" label="Reminders before then" value={s.missedConfirmReminders} min={0} max={2} />
                  <Num name="reminderMinutes" label="Minutes between reminders" value={s.missedConfirmReminderMinutes} min={5} max={1440} />
                </div>
                <p className="text-meta text-slate-500">High-risk and urgent missed calls are not held back for a carer&apos;s answer: the usual alerts and the investigation deadline still apply straight away.</p>
                <button className="btn-primary">Save automation settings</button>
              </form>
            ) : <p className="text-body">{s.missedAutoEvidenceAt ? `Evidence collection is on${s.missedAutoConfirmAt ? ", with carer confirmation" : ""}${s.missedAutoSummaryAt ? " and suggested reasons" : ""}.` : "Off."} An organisation admin can change this.</p>}
            {s.missedAutoEvidenceAt ? <p className="mt-2 text-meta text-slate-500">Evidence collection switched on {fmtDate(s.missedAutoEvidenceAt, true)}.</p> : null}
          </Card>
          <Card title="Areas">
            <p className="text-body">Areas and which coordinators work in them are managed in <Link href="/admin/areas">Administration → Branches &amp; Areas</Link>.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

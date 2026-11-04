import Link from "@/components/link";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, fromDbDate, hhmm, londonDate, londonTime, mondayOf, WEEKDAYS } from "@/lib/london";
import { preferredOf } from "@/lib/carer-places";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getServiceUser, nextStatuses, revealKeySafe } from "@/server/care/service-users";
import { packageCoverage } from "@/server/care/packages";
import { listMedications, medicationEnabled } from "@/server/care/medication";
import { recentIncidentsFor } from "@/server/care/incidents";
import { IncidentStatusBadge, SeverityBadge } from "@/components/incident-ui";
import { listRisks, RISK_TYPE_LABEL, REVIEW_STATE_LABEL, reviewState } from "@/server/care/risks";
import { serviceUserCompliance, serviceUserVisitNotes } from "@/server/care/su-records";
import { NOTE_LABEL } from "@/server/care/visit-record";
import { ServiceUserCompliance } from "@/components/su-compliance";
import { LEVEL } from "@/components/risk-fields";
import { MedicationList, MedicationOff } from "@/components/medication-ui";
import { serviceUserGlance } from "@/server/care/glance";
import { memberNames, rotaLookups, suName } from "@/server/rota/queries";
import { listTemplates } from "@/server/rota/templates";
import { rotaSettings } from "@/server/rota/settings";
import { parseSuRotaFilter, serviceUserRota, suRotaWeek } from "@/server/rota/su-rota";
import { parseList, ServiceUserTemplateTab } from "@/components/su-template-tab";
import { ServiceUserRotaTab } from "@/components/su-rota-tab";
import { addAbsenceAction, addContactAction, cancelAbsenceAction, carerPreferenceAction, keySafeAction, removeCarerPreferenceAction, removeContactAction, updateContactAction, serviceUserStatusAction, updateServiceUserAction, createPackageAction, endPackageAction, updatePackageAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SegmentNav, StatusBadge } from "@/components/ui";
import { CarerSlots, VisitStatusBadge } from "@/components/rota-ui";
import { MissedHistory } from "@/components/missed-history";
import { ServiceUserForm } from "@/components/service-user-form";
import { AUTHORITY_LABEL, PREFERRED_LABEL } from "@/server/rota/cover-communication";
import { ServiceUserDocuments } from "@/components/su-documents";
import { BodyMapSection } from "@/components/body-map";

export const dynamic = "force-dynamic";

const CONTACT_LABEL: Record<string, string> = { NEXT_OF_KIN: "Next of kin", FAMILY: "Family", LPA_HEALTH: "LPA (health and welfare)", LPA_FINANCE: "LPA (property and finance)", GP: "GP", PHARMACY: "Pharmacy", SOCIAL_WORKER: "Social worker", DISTRICT_NURSE: "District nurse", OTHER: "Other" };
const TABS = [["overview", "Overview"], ["care-plans", "Care plans"], ["risks", "Risk assessments"], ["incidents", "Incidents"], ["visits", "Visits"], ["template", "Template"], ["rota", "Rota"], ["notes", "Visit notes"], ["package", "Care package"], ["medication", "Medication"], ["people", "Contacts & carers"], ["details", "Personal details"], ["missed", "Missed calls"], ["documents", "Documents"], ["bodymap", "Body map"], ["history", "History"]] as const;
type TabKey = (typeof TABS)[number][0];
/**
 * The profile's sections, grouped so the bar stays short: each group opens its first section, and a group with more
 * than one shows them as a second row. A group is hidden when none of its sections may be opened. Other sections
 * (documents, body map) join their group by key.
 */
const GROUPS: { label: string; tabs: string[] }[] = [
  { label: "Overview", tabs: ["overview"] },
  { label: "Personal details", tabs: ["details"] },
  { label: "Care", tabs: ["care-plans", "risks", "package", "medication"] },
  { label: "Health and safety", tabs: ["incidents", "bodymap"] },
  { label: "Visits", tabs: ["visits", "template", "rota", "notes", "missed"] },
  { label: "Documents", tabs: ["documents"] },
  { label: "Contacts & carers", tabs: ["people"] },
  { label: "History", tabs: ["history"] },
];
const REVIEW_TONE = { OVERDUE: "rose", DUE_SOON: "amber", IN_DATE: "green" } as const;

export default async function ServiceUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage("serviceUser.view");
  const su = await orNotFound(getServiceUser(ctx, id));
  const canReportIncident = hasOrgPermission(ctx, "incident.report");
  const canNotes = hasOrgPermission(ctx, "rota.view");
  const availableTabs = TABS.filter(([key]) => (key !== "incidents" || canReportIncident) && (key !== "notes" || canNotes) && ((key !== "template" && key !== "rota") || canNotes));
  const tab: TabKey = availableTabs.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const tabLabel = new Map<string, string>(availableTabs);
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => tabLabel.has(t)) })).filter((g) => g.tabs.length);
  const group = groups.find((g) => g.tabs.includes(tab)) ?? groups[0]!;
  const canEdit = hasOrgPermission(ctx, "serviceUser.edit");
  const canKeySafe = hasOrgPermission(ctx, "serviceUser.keysafe");
  const base = `/rota/service-users/${su.id}`;
  const back = `${base}?tab=${tab}`;
  let keySafe: string | null = null;
  let keySafeError: string | null = null;
  if (sp.reveal === "keysafe" && canKeySafe) {
    try {
      keySafe = await revealKeySafe(ctx, su.id);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      keySafeError = e.message;
    }
  }
  const today = londonDate();
  const canFund = hasOrgPermission(ctx, "finance.manage");
  const [lk, visits, history, coverage, funders] = await Promise.all([
    rotaLookups(ctx),
    tab === "visits" || tab === "overview"
      ? db.visit.findMany({ where: { serviceUserId: su.id, organisationId: su.organisationId, date: { gte: dbDate(addDays(today, tab === "visits" ? -14 : 0)), lte: dbDate(addDays(today, tab === "visits" ? 14 : 2)) } }, orderBy: { scheduledStart: "asc" }, include: { callType: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { slot: true, position: true, reviewReason: true, staff: { select: { id: true, displayName: true } } } } } })
      : Promise.resolve([]),
    tab === "history" ? db.auditLog.findMany({ where: { organisationId: su.organisationId, entityType: "ServiceUser", entityId: su.id }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
    tab === "overview" || tab === "package" ? packageCoverage(su.organisationId, su.id) : Promise.resolve(null),
    tab === "package" && canFund ? db.funder.findMany({ where: { organisationId: su.organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const [glance, compliance] = tab === "overview" ? await Promise.all([serviceUserGlance(ctx, su), serviceUserCompliance(ctx, su)]) : [null, []];
  // The person owns these records. Only load what the selected profile section needs.
  const [plans, risks, archivedRisks, incidents, notes] = await Promise.all([
    tab === "care-plans"
      ? db.carePlan.findMany({ where: { serviceUserId: su.id, organisationId: su.organisationId }, select: { id: true, version: true, status: true, reviewDue: true, approvedAt: true }, orderBy: { version: "desc" } })
      : Promise.resolve([]),
    tab === "risks" ? listRisks(ctx, { serviceUserId: su.id }) : Promise.resolve([]),
    tab === "risks" ? listRisks(ctx, { serviceUserId: su.id, archived: true }) : Promise.resolve([]),
    tab === "incidents" ? recentIncidentsFor(ctx, su.id, 100) : Promise.resolve(null),
    tab === "notes" ? serviceUserVisitNotes(ctx, su.id, { category: sp.category, days: Number(sp.days) || undefined, q: sp.q?.trim().slice(0, 100) || undefined }) : Promise.resolve(null),
  ]);
  // Visits -> Template and Rota read the same template and visit records as Daily Templates and the Daily Rota.
  const cycleLength = tab === "template" ? (await rotaSettings(db, su.organisationId)).cycleLength : 4;
  const tplWeeks = parseList(sp.weeks, cycleLength);
  const tplDays = parseList(sp.days, 7);
  const [suTemplates, suRota] = await Promise.all([
    tab === "template" ? listTemplates(ctx, { serviceUserId: su.id, state: "all", weeks: tplWeeks, days: tplDays }) : Promise.resolve(null),
    tab === "rota" ? serviceUserRota(ctx, su.id, suRotaWeek(sp.week), parseSuRotaFilter(sp.status)) : Promise.resolve(null),
  ]);
  const todayDb = dbDate(today);
  const names = await memberNames(ctx, history.map((h) => h.actorId));
  const staffName = new Map(lk.staff.map((s) => [s.id, s.displayName]));
  const active = su.packages.find((p) => p.status === "ACTIVE") ?? null;

  return (
    <>
      <PageHeader
        title={suName(su)}
        back="/rota/service-users"
        subtitle={`${su.reference} · ${su.area?.name ?? "no area"} · ${su.postcode ?? "no postcode"}${su.organisation.isDemo ? ". Fictional demonstration person." : ""}`}
        actions={<StatusBadge status={su.status} />}
      />
      <Flash searchParams={sp} />
      <SegmentNav label="Service user sections" items={groups.map((g) => ({ href: `${base}?tab=${g.tabs[0]}`, label: g.label, active: g === group }))} />
      {group.tabs.length > 1 ? (
        <nav aria-label={`${group.label} sections`} className="mb-3 flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
          {group.tabs.map((t) => (
            <Link key={t} href={`${base}?tab=${t}`} aria-current={t === tab ? "page" : undefined} className={`rounded-full px-3 py-1 text-[13.5px] no-underline ${t === tab ? "bg-[#1d4f91] font-medium text-white" : "bg-[#eef1f5] text-[#1d2939] hover:bg-[#e1e6ee]"}`}>{tabLabel.get(t)}</Link>
          ))}
        </nav>
      ) : null}

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-3">
            <Card title="About">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                <Field label="Known as">{su.preferredName ?? su.firstName}</Field>
                <Field label="Date of birth">{su.sensitiveHidden ? <span className="text-slate-500">Restricted</span> : su.dateOfBirth ? fmtDate(su.dateOfBirth) : "—"}</Field>
                <Field label="First language">{su.firstLanguage ?? "—"}</Field>
                <Field label="Carer preference">{su.carerGenderPreference === "ANY" ? "No preference" : `${su.carerGenderPreference.toLowerCase()} carers`}</Field>
                <Field label="Risk">{su.riskLevel ? <Badge tone={su.riskLevel === "HIGH" ? "rose" : su.riskLevel === "MEDIUM" ? "amber" : "slate"}>{su.riskLevel.toLowerCase()}</Badge> : "Not assessed"}</Field>
                <Field label="Care started">{su.startDate ? fmtDate(su.startDate) : "—"}</Field>
              </dl>
              {su.riskSummary ? <p className="mt-3 text-[14px]"><span className="font-medium">Risk summary:</span> {su.riskSummary}</p> : null}
              {su.carePreferences ? <p className="mt-2 text-[14px]"><span className="font-medium">What matters to them:</span> {su.carePreferences}</p> : null}
              {su.communicationNeeds ? <p className="mt-2 text-[14px]"><span className="font-medium">Communication:</span> {su.communicationNeeds}</p> : null}
            </Card>
            <ServiceUserCompliance rows={compliance} />
            {glance ? (
              <section aria-labelledby="glance-h" className="card" data-testid="recent-care">
                <h2 id="glance-h" className="mb-3 text-[17px]">Recent care</h2>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Carers who visit most (28 days)">{glance.carers.length ? <span className="block text-[14px]">{glance.carers.map((c) => `${c.name} (${c.visits})`).join(", ")}</span> : "No visits booked"}</Field>
                  <Field label="Medication">{glance.medication.on ? <><Link href={`${base}?tab=medication`}>{glance.medication.active} {glance.medication.active === 1 ? "medicine" : "medicines"} in use</Link><span className={`block text-[13px] ${glance.medication.exceptions7d ? "text-[#a3242c]" : "text-slate-600"}`}>{glance.medication.exceptions7d} refused or not given in 7 days</span></> : <span className="text-slate-600">Medication records are switched off</span>}</Field>
                  <Field label="Care Summary">{glance.summary ? <Link href={`/rota/care-plans/${su.id}?view=summary&summary=${glance.summary.id}`}>{fmtDate(glance.summary.createdAt)}, {glance.summary.status === "UNREVIEWED" ? "not yet reviewed" : glance.summary.status === "REVIEWED" ? "reviewed" : "dismissed"}</Link> : <Link href={`/rota/care-plans/${su.id}?view=summary`}>Recent records</Link>}</Field>
                </dl>
                {glance.notes.length ? (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <h3 className="text-[13px] font-medium text-slate-700">Latest visit notes</h3>
                    <ul className="mt-1 space-y-1 text-[14px]">
                      {glance.notes.map((n) => <li key={n.id} className="flex gap-2"><span className="w-[132px] shrink-0 text-[13px] text-slate-500">{fmtDate(n.createdAt, true)}</span><Link href={`/rota/visits/${n.visitId}`} className="min-w-0 truncate text-slate-800 no-underline hover:underline" title={n.text}>{n.text}</Link></li>)}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
            <Card title="Next visits" actions={<Link href={`${base}?tab=visits`} className="btn-secondary py-1">All visits</Link>}>
              {visits.length ? (
                <ul className="rows">
                  {visits.filter((v) => v.scheduledEnd > new Date()).slice(0, 8).map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
                      <span className="w-[150px] tabular-nums">{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })} {londonTime(v.scheduledStart)}</span>
                      <Link href={`/rota/visits/${v.id}`} className="row-title">{v.callType.name}</Link>
                      <CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} />
                      <span className="ml-auto"><VisitStatusBadge status={v.status} /></span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No visits in the next two days.</Empty>}
            </Card>
            <Card title="Repeating visits" actions={canEdit ? <Link href={`/rota/templates/new?su=${su.id}`} className="btn-secondary py-1">New template</Link> : null}>
              {su.templates.length ? (
                <table className="table">
                  <thead><tr><th>Call</th><th>Time</th><th>Days</th><th>Carers</th></tr></thead>
                  <tbody>
                    {su.templates.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/rota/templates/${t.id}`}>{t.callType.name}</Link></td>
                        <td className="tabular-nums">{hhmm(t.startMinute)} · {t.durationMin}m</td>
                        <td>{t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 2)).join(" ")} · weeks {t.cycleWeeks.join(", ")}</td>
                        <td>{preferredOf(t).map((x) => (x ? staffName.get(x) ?? "Former staff" : "No carer")).join(" + ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>No repeating visits.</Empty>}
            </Card>
          </div>
          <div className="space-y-3">
            <Card title="Care package" actions={<Link href={`${base}?tab=package`} className="btn-secondary py-1">{canEdit ? "Manage" : "History"}</Link>}>
              {active ? (
                <div className="text-[14px]">
                  <div className="font-medium">{active.reference ?? "Package"} <Badge tone="green">Active</Badge></div>
                  <div className="text-slate-600">{active.commissionedMinutesPerWeek !== null ? `${hours(active.commissionedMinutesPerWeek)} commissioned hours a week` : "Hours not recorded"} · from {fmtDate(active.startDate)}{active.endDate ? ` to ${fmtDate(active.endDate)}` : ""}{active.funder ? ` · ${active.funder.name}` : " · no funder linked"}</div>
                  {active.requirements ? <div className="text-slate-600">{active.requirements}</div> : null}
                </div>
              ) : <Empty>No active care package.</Empty>}
              {coverage ? <Coverage c={coverage} /> : null}
            </Card>
            <Card title="Key contacts" actions={<Link href={`${base}?tab=people`} className="btn-secondary py-1">All contacts</Link>}>
              {su.contacts.length ? (
                <ul className="space-y-2 text-[14px]">
                  {su.contacts.slice(0, 3).map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{c.name}</span> {c.isEmergency ? <Badge tone="rose">Emergency</Badge> : null}
                      <span className="block text-[12.5px] text-slate-600">{CONTACT_LABEL[c.kind]}{c.relationship ? ` · ${c.relationship}` : ""}{c.phone ? ` · ${c.phone}` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-slate-600">No contacts recorded.</p>}
            </Card>
            <Card title="Getting in">
              <p className="text-[14px]">{su.accessNotes ?? "No access notes."}</p>
              {su.hasKeySafe ? (
                canKeySafe ? (
                  keySafe ? (
                    <p className="mt-2 text-[14px]">Key safe code: <span className="font-mono text-[16px] font-semibold">{keySafe}</span> <span className="block text-[12.5px] text-slate-500">This view has been recorded.</span></p>
                  ) : (
                    <form method="get" className="mt-2"><input type="hidden" name="reveal" value="keysafe" /><button className="btn-secondary py-1">Show key safe code</button><span className="ml-2 text-[12.5px] text-slate-500">Each view is recorded.</span></form>
                  )
                ) : <p className="mt-2 text-[13px] text-slate-500">A key safe code is recorded. Your role cannot view it.</p>
              ) : <p className="mt-2 text-[13px] text-slate-500">No key safe code recorded.</p>}
              {keySafeError ? <p role="alert" className="text-[13px] text-[#a3242c]">{keySafeError}</p> : null}
              {canKeySafe && canEdit ? (
                <form action={keySafeAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="serviceUserId" value={su.id} />
                  <input name="code" autoComplete="off" className="input py-1.5" placeholder="New code (blank clears)" aria-label="New key safe code" />
                  <button className="btn-secondary py-1">Save</button>
                </form>
              ) : null}
            </Card>
            <Card title="Away">
              {su.absences.length ? (
                <ul className="space-y-2 text-[14px]">
                  {su.absences.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span>{a.reason.toLowerCase()} · {fmtDate(a.startsAt)}{a.endsAt ? ` to ${fmtDate(new Date(a.endsAt.getTime() - 1))}` : " onwards"}</span>
                      {canEdit ? <form action={cancelAbsenceAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="absenceId" value={a.id} /><button className="btn-secondary py-0.5 text-[13px]">End now</button></form> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-slate-600">No current or planned absences.</p>}
              {canEdit && su.status !== "ENDED" ? (
                <details className="mt-3 border-t border-slate-200 pt-3">
                <summary className="btn-secondary inline-block cursor-pointer py-1">Record an absence</summary>
                <form action={addAbsenceAction} className="mt-3 grid grid-cols-2 gap-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="serviceUserId" value={su.id} />
                  <label className="col-span-2"><span className="label">Reason</span><select name="reason" className="input"><option value="HOSPITAL">Hospital</option><option value="RESPITE">Respite</option><option value="HOLIDAY">Holiday</option><option value="OTHER">Other</option></select></label>
                  <label><span className="label">First day</span><input type="date" name="from" required defaultValue={today} className="input" /></label>
                  <label><span className="label">Last day</span><input type="date" name="to" className="input" /></label>
                  <label className="col-span-2"><span className="label">Note</span><input name="note" className="input" /></label>
                  <button className="btn-secondary col-span-2">Record absence</button>
                  <p className="col-span-2 text-[12.5px] text-slate-500">Built visits in the period that have not started are cancelled. No last day means until further notice.</p>
                </form>
                </details>
              ) : null}
            </Card>
            {canEdit ? (
              <Card title="Status">
                <form action={serviceUserStatusAction} className="space-y-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="serviceUserId" value={su.id} />
                  <label className="block"><span className="label">Move to</span><select name="to" className="input">{nextStatuses(su.status).map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
                  <label className="block"><span className="label">Reason</span><input name="reason" required minLength={3} className="input" /></label>
                  <label className="block"><span className="label">End date (when ending care)</span><input type="date" name="endDate" className="input" /></label>
                  <button className="btn-secondary">Change status</button>
                  <p className="text-[12.5px] text-slate-500">Ending care switches off their repeating visits and cancels future visits that have not started.</p>
                </form>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}


      {tab === "care-plans" ? (
        <Card title="Care plans" actions={<Link href={`/rota/care-plans/${su.id}`} className="btn-primary">View or manage care plan</Link>}>
          <p className="mb-3 text-[13.5px] text-slate-600">Care plans for {suName(su)}. Review the current plan, its status and earlier versions here.</p>
          {plans.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Version</th><th>Status</th><th>Review due</th><th>Approved</th><th>Record</th></tr></thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td className="font-medium">Version {plan.version}</td>
                      <td><Badge tone={plan.status === "ACTIVE" ? "green" : plan.status === "IN_REVIEW" ? "amber" : "slate"}>{plan.status === "ACTIVE" ? "In use" : plan.status === "IN_REVIEW" ? "Awaiting approval" : plan.status === "DRAFT" ? "Draft" : plan.status.toLowerCase().replaceAll("_", " ")}</Badge></td>
                      <td>{plan.reviewDue ? <span className={plan.reviewDue < todayDb && plan.status === "ACTIVE" ? "font-medium text-[#a3242c]" : ""}>{fmtLondonDate(fromDbDate(plan.reviewDue))}</span> : "—"}</td>
                      <td>{plan.approvedAt ? fmtDate(plan.approvedAt) : "—"}</td>
                      <td><Link href={`/rota/care-plans/${su.id}?v=${plan.version}`}>Open plan</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No care plan recorded for this person.</Empty>}
        </Card>
      ) : null}

      {tab === "risks" ? (
        <Card title="Risk assessments" actions={hasOrgPermission(ctx, "care.plan.edit") ? <Link href={`/rota/risks/new?su=${su.id}`} className="btn-primary">New assessment</Link> : null}>
          <p className="mb-3 text-[13.5px] text-slate-600">Active risk assessments for {suName(su)}, soonest review first. Open one to read its hazards, controls, actions still required and every saved version.</p>
          {risks.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Assessment</th><th>Category</th><th>Level</th><th>Review</th><th>Actions required</th><th>Version</th></tr></thead>
                <tbody>
                  {risks.map((risk) => {
                    const state = reviewState(risk.reviewDue, today);
                    return (
                      <tr key={risk.id}>
                        <td><Link href={`/rota/risks/${risk.id}`}>{risk.title}</Link></td>
                        <td>{RISK_TYPE_LABEL[risk.type]}</td>
                        <td><Badge tone={LEVEL[risk.level].tone}>{LEVEL[risk.level].label}</Badge></td>
                        <td><span className="tabular-nums">{fmtLondonDate(fromDbDate(risk.reviewDue))}</span> <Badge tone={REVIEW_TONE[state]}>{REVIEW_STATE_LABEL[state]}</Badge></td>
                        <td className="max-w-[260px]">{risk.requiredActions ? <span className="line-clamp-2" title={risk.requiredActions}>{risk.responsiblePerson}: {risk.requiredActions}</span> : <span className="text-slate-500">None</span>}</td>
                        <td className="tabular-nums">{risk.version}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>No active risk assessments for this person.</Empty>}
          {archivedRisks.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Archived assessments ({archivedRisks.length})</summary>
              <ul className="rows mt-1 text-[14px]">
                {archivedRisks.map((r) => <li key={r.id} className="py-1.5"><Link href={`/rota/risks/${r.id}`}>{r.title}</Link> <span className="text-[13px] text-slate-600">{RISK_TYPE_LABEL[r.type]}{r.archivedAt ? ` · archived ${fmtDate(r.archivedAt)}` : ""}</span></li>)}
              </ul>
            </details>
          ) : <p className="mt-3 text-[13px] text-slate-600">No archived assessments.</p>}
        </Card>
      ) : null}

      {tab === "notes" && notes ? (
        <Card title="Visit notes">
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label="Filter visit notes">
            <input type="hidden" name="tab" value="notes" />
            <label><span className="label">Period</span><select name="days" defaultValue={String(notes.days)} className="input"><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select></label>
            <label><span className="label">Kind</span><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Any</option>{Object.entries(NOTE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label><span className="label">Contains</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label>
            <button className="btn-primary">Apply</button>
            <Link href={`${base}?tab=notes`} className="btn-secondary">Clear</Link>
          </form>
          {notes.notes.length ? (
            <ul className="rows">
              {notes.notes.map((n) => (
                <li key={n.id} className="py-3 text-[14.5px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600">
                    <Badge tone={n.category === "CONCERN" ? "rose" : n.category === "HANDOVER" ? "violet" : "slate"}>{NOTE_LABEL[n.category] ?? n.category}</Badge>
                    <Link href={`/rota/visits/${n.visit.id}`} className="row-title">{fmtLondonDate(londonDate(n.visit.scheduledStart), { weekday: "short", day: "numeric", month: "short" })} · {n.visit.callType}</Link>
                    <span className="tabular-nums">planned {londonTime(n.visit.scheduledStart)}–{londonTime(n.visit.scheduledEnd)}</span>
                    <span>{n.actualMinutes !== null ? `actual ${n.actualMinutes} min` : "no clock times"}</span>
                    <span className="ml-auto">{n.author}{n.fromOffice ? " (office)" : ""} · {fmtDate(n.createdAt, true)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No visit notes for this person in this period.</Empty>}
          {notes.notes.length === 300 ? <p className="mt-2 text-[13px] text-slate-600">Showing the newest 300. Narrow the period or kind to see older notes.</p> : null}
          <p className="mt-2 text-[12.5px] text-slate-500">Notes are written on visits by carers and the office and cannot be edited or deleted.</p>
        </Card>
      ) : null}

      {tab === "incidents" && canReportIncident ? (
        <Card title="Incidents" actions={<Link href={`/rota/incidents/new?su=${su.id}`} className="btn-primary">Report an incident</Link>}>
          <p className="mb-3 text-[13.5px] text-slate-600">Incidents linked to {suName(su)}, including open and closed reports. Records are shown according to your incident permissions.</p>
          {incidents?.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Reference</th><th>When</th><th>Category</th><th>Severity</th><th>Status</th></tr></thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.id}>
                      <td><Link href={`/rota/incidents/${incident.id}`}>{incident.reference}</Link></td>
                      <td>{fmtDate(incident.occurredAt, true)}</td>
                      <td>{incident.category}{incident.safeguarding ? <> <Badge tone="rose">Safeguarding</Badge></> : null}</td>
                      <td><SeverityBadge severity={incident.severity} /></td>
                      <td><IncidentStatusBadge status={incident.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No incidents recorded for this person that you have permission to view.</Empty>}
          {incidents && incidents.length === 100 ? <p className="mt-2 text-[12.5px] text-slate-600">Showing the latest 100 incidents.</p> : null}
        </Card>
      ) : null}

      {tab === "medication" ? (
        !hasOrgPermission(ctx, "medication.view") ? <Card><Empty>You do not have access to medication records.</Empty></Card>
        : !(await medicationEnabled(su.organisationId)) ? <MedicationOff />
        : await (async () => {
          const meds = await listMedications(ctx, su.id);
          const medNames = await memberNames(ctx, meds.flatMap((m) => [m.createdById, m.approvedById]));
          return <MedicationList meds={meds} serviceUserId={su.id} back={back} canManage={hasOrgPermission(ctx, "medication.manage")} me={ctx.userId} names={medNames} month={today.slice(0, 7)} />;
        })()
      ) : null}

      {tab === "package" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card title="Packages">
            {coverage ? <Coverage c={coverage} /> : null}
            {su.packages.length ? (
              <ul className="rows mt-2">
                {su.packages.map((p) => (
                  <li key={p.id} className="py-3 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.reference ?? "Package"}</span>{p.status === "ACTIVE" ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>}</div>
                    <div className="text-slate-600">{p.commissionedMinutesPerWeek !== null ? `${hours(p.commissionedMinutesPerWeek)} hours a week` : "Hours not recorded"} · {fmtDate(p.startDate)} to {p.endDate ? fmtDate(p.endDate) : "open-ended"}{p.funder ? ` · ${p.funder.name}` : " · no funder linked"}</div>
                    {p.requirements ? <div className="text-slate-600">{p.requirements}</div> : null}
                    {canEdit && p.status === "ACTIVE" ? (
                      <div className="mt-2 grid gap-3 lg:grid-cols-2">
                        <details>
                          <summary className="btn-secondary inline-block cursor-pointer py-1">Edit</summary>
                          <PackageForm action={updatePackageAction} hidden={{ packageId: p.id }} back={back} p={p} funders={funders} canFund={canFund} submit="Save changes" />
                        </details>
                        <details>
                          <summary className="btn-secondary inline-block cursor-pointer py-1">End package</summary>
                          <form action={endPackageAction} className="mt-2 space-y-2">
                            <input type="hidden" name="back" value={back} /><input type="hidden" name="packageId" value={p.id} />
                            <label className="block"><span className="label">Last day</span><input type="date" name="endDate" required defaultValue={today} className="input" /></label>
                            <label className="block"><span className="label">Why it ends</span><input name="reason" required minLength={3} className="input" /></label>
                            <button className="btn-danger">End package</button>
                          </form>
                        </details>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No care package recorded yet.</Empty>}
          </Card>
          {canEdit ? (
            <Card title={active ? "Replace with a new package" : "Record a package"}>
              {active ? <p className="mb-2 text-[13.5px] text-slate-600">The active package ends the day before the new one starts. Past invoices keep using the package that was in force on each visit date.</p> : null}
              <PackageForm action={createPackageAction} hidden={{ serviceUserId: su.id }} back={back} funders={funders} canFund={canFund} submit="Record package" today={today} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "visits" ? (
        <Card title={`Visits from ${fmtLondonDate(addDays(today, -14), { day: "numeric", month: "short" })} to ${fmtLondonDate(addDays(today, 14), { day: "numeric", month: "short" })}`}>
          {visits.length ? (
            <table className="table">
              <thead><tr><th>Date</th><th>Time</th><th>Call</th><th>Carers</th><th>Status</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} className={v.status === "CANCELLED" ? "opacity-60" : undefined}>
                    <td><Link href={`/rota/visits/${v.id}`}>{fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" })}</Link></td>
                    <td className="tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}{v.actualStart ? <span className="block text-[12px] text-slate-500">actual {londonTime(v.actualStart)}–{v.actualEnd ? londonTime(v.actualEnd) : "…"}</span> : null}</td>
                    <td>{v.callType.name}</td>
                    <td><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                    <td><VisitStatusBadge status={v.status} />{v.cancelReason ? <span className="block text-[12px] text-slate-500">{v.cancelReason}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No visits in this period.</Empty>}
        </Card>
      ) : null}

      {tab === "people" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card title="Contacts">
            {su.contacts.length ? (
              <ul className="rows">
                {su.contacts.map((c) => (
                  <li key={c.id} className="py-2.5 text-[14px]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{c.name} {c.isPrimary ? <Badge tone="violet">Primary contact</Badge> : null} {c.isEmergency ? <Badge tone="rose">Emergency</Badge> : null} {c.canReceiveUpdates ? <Badge tone="teal">Can receive updates</Badge> : null}</div>
                        <div className="text-slate-600">{CONTACT_LABEL[c.kind]}{c.relationship ? ` · ${c.relationship}` : ""}{c.phone ? ` · ${c.phone}` : ""}{c.altPhone ? ` · alt. ${c.altPhone}` : ""}{c.email ? ` · ${c.email}` : ""}</div>
                        {c.authorityType ? <div className="text-[13px] text-slate-600">Authority: {AUTHORITY_LABEL[c.authorityType as keyof typeof AUTHORITY_LABEL] ?? c.authorityType}{c.authorityScope ? ` (${c.authorityScope})` : ""}</div> : null}
                        {c.preferredContactMethod ? <div className="text-[13px] text-slate-600">Prefers: {PREFERRED_LABEL[c.preferredContactMethod] ?? c.preferredContactMethod}</div> : null}
                      </div>
                      {canEdit ? <form action={removeContactAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="contactId" value={c.id} /><button className="btn-secondary py-0.5 text-[13px]">Remove</button></form> : null}
                    </div>
                    {canEdit ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[13px] font-medium text-[#1d4f91]">Edit {c.name}</summary>
                        <form action={updateContactAction} className="mt-2 grid gap-2 md:grid-cols-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="serviceUserId" value={su.id} />
                          <input type="hidden" name="contactId" value={c.id} />
                          <ContactFields c={c} />
                          <button className="btn-secondary md:col-span-2">Save contact</button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No contacts recorded.</Empty>}
            {canEdit ? (
              <form action={addContactAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <ContactFields />
                <button className="btn-secondary md:col-span-2">Add contact</button>
              </form>
            ) : null}
            <p className="mt-2 text-[12.5px] text-slate-500">Emergency contact, permission to receive updates and authority to act are recorded separately. Being next of kin does not give authority. Communication already recorded keeps the number used at the time.</p>
          </Card>
          <Card title="Carer preferences">
            {su.carerPreferences.length ? (
              <ul className="rows">
                {su.carerPreferences.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                    <div>
                      <Link href={`/rota/staff/${p.staff.id}`} className="row-title">{p.staff.displayName}</Link> {p.blocked ? <Badge tone="rose">Must not visit</Badge> : null} {p.rating ? <Badge tone={p.rating >= 4 ? "green" : p.rating <= 2 ? "amber" : "slate"}>Rating {p.rating} of 5</Badge> : null}
                      {p.reason ? <div className="text-slate-600">{p.reason}</div> : null}
                    </div>
                    {canEdit ? <form action={removeCarerPreferenceAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="staffId" value={p.staff.id} /><button className="btn-secondary py-0.5 text-[13px]">Remove</button></form> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No carer preferences recorded.</Empty>}
            {canEdit ? (
              <form action={carerPreferenceAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <label className="md:col-span-2"><span className="label">Carer</span><select name="staffId" required className="input"><option value="">Choose…</option>{lk.carers.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
                <label><span className="label">Rating</span><select name="rating" className="input"><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label className="flex items-center gap-2 pt-6 text-[14px]"><input type="checkbox" name="blocked" className="h-4 w-4" /> Must not visit</label>
                <label className="md:col-span-2"><span className="label">Reason</span><input name="reason" className="input" placeholder="Required when a carer must not visit" /></label>
                <button className="btn-secondary md:col-span-2">Save preference</button>
                <p className="text-[12.5px] text-slate-500 md:col-span-2">A carer who must not visit is never offered for this person, and visits already booked with them are flagged for review.</p>
              </form>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "details" ? (
        <Card>
          {canEdit ? (
            <ServiceUserForm action={updateServiceUserAction} su={su} areas={lk.areas} back={back} sensitive={hasOrgPermission(ctx, "serviceUser.sensitive")} submit="Save details" />
          ) : (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Address">{[su.addressLine1, su.addressLine2, su.town, su.postcode].filter(Boolean).join(", ") || "—"}</Field>
              <Field label="Phone">{su.phone ?? "—"}</Field>
              <Field label="NHS number">{su.sensitiveHidden ? "Restricted" : su.nhsNumber ?? "—"}</Field>
            </dl>
          )}
        </Card>
      ) : null}

      {tab === "template" && suTemplates ? <ServiceUserTemplateTab base={base} rows={suTemplates} weeks={tplWeeks} days={tplDays} cycleLength={cycleLength} canEdit={hasOrgPermission(ctx, "rota.edit")} serviceUserId={su.id} confirmOff={sp.off} /> : null}
      {tab === "rota" && suRota ? <ServiceUserRotaTab base={base} rota={suRota} filter={parseSuRotaFilter(sp.status)} thisMonday={mondayOf(today)} canEdit={hasOrgPermission(ctx, "rota.edit")} serviceUserId={su.id} /> : null}
      {tab === "missed" ? <MissedHistory ctx={ctx} serviceUserId={su.id} /> : null}

      {tab === "documents" ? (
        <>
          <nav aria-label="Document sections" className="mb-3 flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
            {([["council", "Council Documents"], ["other", "Other Documents"]] as const).map(([k, label]) => {
              const on = (sp.section === "other" ? "other" : "council") === k;
              return <Link key={k} href={`${base}?tab=documents&section=${k}`} aria-current={on ? "page" : undefined} className={`rounded-full px-3 py-1 text-[13.5px] no-underline ${on ? "bg-[#1d4f91] font-medium text-white hover:text-white" : "bg-[#eef1f5] text-[#1d2939] hover:bg-[#e1e6ee]"}`}>{label}</Link>;
            })}
          </nav>
          <ServiceUserDocuments ctx={ctx} serviceUserId={su.id} section={sp.section === "other" ? "OTHER" : "COUNCIL"} selectedId={sp.doc} base={base} />
        </>
      ) : null}

      {tab === "bodymap" ? <BodyMapSection ctx={ctx} serviceUserId={su.id} personName={`${su.firstName} ${su.lastName}`} base={base} sp={sp} /> : null}

      {tab === "history" ? (
        <Card title="Record history">
          {history.length ? (
            <ol className="space-y-2 text-[14px]">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                  <div className="font-medium">{h.action.replace("serviceUser.", "").replace(/\./g, " ")}</div>
                  <div className="text-[13px] text-slate-500">{names.get(h.actorId ?? "") ?? "System"} · {fmtDate(h.createdAt, true)}</div>
                </li>
              ))}
            </ol>
          ) : <Empty>No changes recorded since this record was created.</Empty>}
        </Card>
      ) : null}
    </>
  );
}

const hours = (min: number) => (min / 60).toFixed(1).replace(/\.0$/, "");

/** Commissioned against planned, so a coordinator sees at once when the repeating visits do not match the package. */
function Coverage({ c }: { c: Awaited<ReturnType<typeof packageCoverage>> }) {
  if (c.commissioned === null) return <p className="mt-2 text-[13.5px] text-slate-600">Repeating visits plan {hours(c.planned)} hours a week ({hours(c.plannedCarerMinutes)} carer hours). No commissioned hours recorded to compare.</p>;
  const off = Math.abs(c.difference ?? 0) > 30;
  return (
    <p className={`mt-2 text-[13.5px] ${off ? "text-[#8a5a00]" : "text-slate-600"}`}>
      Repeating visits plan {hours(c.planned)} hours a week against {hours(c.commissioned)} commissioned
      {c.difference ? ` (${c.difference > 0 ? "over" : "under"} by ${hours(Math.abs(c.difference))} hours)` : " (matches)"}; {hours(c.plannedCarerMinutes)} carer hours with double-ups, averaged over the rota cycle.
    </p>
  );
}

type PackageRow = { reference: string | null; commissionedMinutesPerWeek: number | null; startDate: Date; endDate: Date | null; requirements: string | null; funderId: string | null };

function PackageForm({ action, hidden, back, p, funders, canFund, submit, today }: { action: (fd: FormData) => Promise<void>; hidden: Record<string, string>; back: string; p?: PackageRow; funders: { id: string; name: string }[]; canFund: boolean; submit: string; today?: string }) {
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="back" value={back} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Reference</span><input name="reference" defaultValue={p?.reference ?? ""} maxLength={80} className="input" /></label>
        <label><span className="label">Hours a week</span><input name="hoursPerWeek" type="number" min="0" max="336" step="0.25" defaultValue={p?.commissionedMinutesPerWeek != null ? p.commissionedMinutesPerWeek / 60 : ""} className="input" /></label>
        <label><span className="label">Starts</span><input name="startDate" type="date" required defaultValue={p ? fromDbDate(p.startDate) : today} className="input" /></label>
        <label><span className="label">Ends (optional)</span><input name="endDate" type="date" defaultValue={p?.endDate ? fromDbDate(p.endDate) : ""} className="input" /></label>
      </div>
      <label className="block"><span className="label">What was commissioned</span><textarea name="requirements" rows={2} maxLength={2000} defaultValue={p?.requirements ?? ""} placeholder="e.g. four calls a day, two carers for hoist transfers" className="input" /></label>
      {canFund ? (
        <label className="block"><span className="label">Funder</span><select name="funderId" defaultValue={p?.funderId ?? ""} className="input"><option value="">None yet</option>{funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      ) : <p className="text-[12.5px] text-slate-600">Finance links the funder.</p>}
      <button className="btn-primary">{submit}</button>
    </form>
  );
}

type ContactRow = { kind: string; name: string; relationship: string | null; phone: string | null; altPhone: string | null; email: string | null; isEmergency: boolean; canReceiveUpdates: boolean; isPrimary: boolean; preferredContactMethod: string | null; authorityType: string | null; authorityScope: string | null };

/** The contact fields, shared by Add contact and Edit. Optional fields stay empty unless the office fills them in. */
function ContactFields({ c }: { c?: ContactRow }) {
  return (
    <>
      <label><span className="label">Type</span><select name="kind" defaultValue={c?.kind} className="input">{Object.entries(CONTACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="label">Name</span><input name="name" required defaultValue={c?.name} className="input" /></label>
      <label><span className="label">Relationship</span><input name="relationship" defaultValue={c?.relationship ?? ""} className="input" /></label>
      <label><span className="label">Phone</span><input name="phone" type="tel" defaultValue={c?.phone ?? ""} className="input" /></label>
      <label><span className="label">Alternative phone</span><input name="altPhone" type="tel" defaultValue={c?.altPhone ?? ""} className="input" /></label>
      <label><span className="label">E-mail</span><input name="email" type="email" defaultValue={c?.email ?? ""} className="input" /></label>
      <label><span className="label">Prefers to be contacted by</span><select name="preferredContactMethod" defaultValue={c?.preferredContactMethod ?? ""} className="input"><option value="">Not recorded</option><option value="PHONE">Telephone</option><option value="SMS">Text message</option><option value="EMAIL">Email</option><option value="OTHER">Other</option></select></label>
      <label><span className="label">Recorded authority to act</span><select name="authorityType" defaultValue={c?.authorityType ?? ""} className="input"><option value="">None recorded</option>{Object.entries(AUTHORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="md:col-span-2"><span className="label">What the authority covers (optional)</span><input name="authorityScope" maxLength={500} defaultValue={c?.authorityScope ?? ""} className="input" placeholder="For example: health and welfare decisions, registered with the OPG" /></label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="isPrimary" defaultChecked={c?.isPrimary} className="h-4 w-4" /> Primary contact</label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="isEmergency" defaultChecked={c?.isEmergency} className="h-4 w-4" /> Emergency contact</label>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="canReceiveUpdates" defaultChecked={c?.canReceiveUpdates} className="h-4 w-4" /> Can receive updates</label>
    </>
  );
}

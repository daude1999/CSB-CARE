import Link from "@/components/link";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, fromDbDate, hhmm, londonDate, londonTime, WEEKDAYS } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { getServiceUser, nextStatuses, revealKeySafe } from "@/server/care/service-users";
import { memberNames, rotaLookups, suName } from "@/server/rota/queries";
import { addAbsenceAction, addContactAction, cancelAbsenceAction, carerPreferenceAction, keySafeAction, removeCarerPreferenceAction, removeContactAction, serviceUserStatusAction, updateServiceUserAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SegmentNav, StatusBadge } from "@/components/ui";
import { CarerSlots, VisitStatusBadge } from "@/components/rota-ui";
import { ServiceUserForm } from "@/components/service-user-form";

export const dynamic = "force-dynamic";

const CONTACT_LABEL: Record<string, string> = { NEXT_OF_KIN: "Next of kin", FAMILY: "Family", LPA_HEALTH: "LPA (health and welfare)", LPA_FINANCE: "LPA (property and finance)", GP: "GP", PHARMACY: "Pharmacy", SOCIAL_WORKER: "Social worker", DISTRICT_NURSE: "District nurse", OTHER: "Other" };
const TABS = [["overview", "Overview"], ["visits", "Visits"], ["people", "Contacts & carers"], ["details", "Details"], ["history", "History"]] as const;

export default async function ServiceUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePortal("rota");
  const su = await orNotFound(getServiceUser(ctx, id));
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview";
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
  const [lk, visits, history] = await Promise.all([
    rotaLookups(ctx),
    tab === "visits" || tab === "overview"
      ? db.visit.findMany({ where: { serviceUserId: su.id, organisationId: su.organisationId, date: { gte: dbDate(addDays(today, tab === "visits" ? -14 : 0)), lte: dbDate(addDays(today, tab === "visits" ? 14 : 2)) } }, orderBy: { scheduledStart: "asc" }, include: { callType: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { slot: true, reviewReason: true, staff: { select: { id: true, displayName: true } } } } } })
      : Promise.resolve([]),
    tab === "history" ? db.auditLog.findMany({ where: { organisationId: su.organisationId, entityType: "ServiceUser", entityId: su.id }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
  ]);
  const names = await memberNames(ctx, history.map((h) => h.actorId));
  const staffName = new Map(lk.staff.map((s) => [s.id, s.displayName]));
  const mins = su.packages.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + (p.commissionedMinutesPerWeek ?? 0), 0);
  const plannedMins = su.templates.reduce((n, t) => n + t.durationMin * t.carersRequired * t.weekdays.length, 0);

  return (
    <>
      <PageHeader
        title={suName(su)}
        back="/rota/service-users"
        subtitle={`${su.reference} · ${su.area?.name ?? "no area"} · ${su.postcode ?? "no postcode"}. Fictional demonstration person.`}
        actions={<StatusBadge status={su.status} />}
      />
      <Flash searchParams={sp} />
      <SegmentNav label="Service user sections" items={TABS.map(([k, label]) => ({ href: `${base}?tab=${k}`, label, active: tab === k }))} />

      {tab === "overview" ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
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
              <p className="mt-3 text-[12.5px] text-slate-500">Care plans and risk assessments are planned and not built yet.</p>
            </Card>
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
            <Card title="Repeating visits" actions={canEdit ? <Link href="/rota/templates/new" className="btn-secondary py-1">New template</Link> : null}>
              {su.templates.length ? (
                <table className="table">
                  <thead><tr><th>Call</th><th>Time</th><th>Days</th><th>Carers</th></tr></thead>
                  <tbody>
                    {su.templates.map((t) => (
                      <tr key={t.id}>
                        <td><Link href={`/rota/templates/${t.id}`}>{t.callType.name}</Link></td>
                        <td className="tabular-nums">{hhmm(t.startMinute)} · {t.durationMin}m</td>
                        <td>{t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 2)).join(" ")} · weeks {t.cycleWeeks.join(", ")}</td>
                        <td>{[t.preferredStaff1Id, t.carersRequired > 1 ? t.preferredStaff2Id : undefined].filter((x) => x !== undefined).map((x) => (x ? staffName.get(x) ?? "Former staff" : "No carer")).join(" + ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty>No repeating visits.</Empty>}
            </Card>
          </div>
          <div className="space-y-3">
            <Card title="Package">
              {su.packages.length ? (
                <ul className="space-y-2 text-[14px]">
                  {su.packages.map((p) => (
                    <li key={p.id}>
                      <div className="font-medium">{p.reference ?? "Package"} {p.status === "ACTIVE" ? <Badge tone="green">Active</Badge> : <Badge>Ended</Badge>}</div>
                      <div className="text-slate-600">{p.commissionedMinutesPerWeek ? `${(p.commissionedMinutesPerWeek / 60).toFixed(1)} commissioned hours a week` : "Hours not recorded"} · from {fmtDate(p.startDate)}{p.funder ? ` · ${p.funder.name}` : ""}</div>
                      {p.requirements ? <div className="text-slate-600">{p.requirements}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : <Empty>No care package recorded.</Empty>}
              {mins ? <p className={`mt-3 text-[13.5px] ${Math.abs(plannedMins - mins) > 60 ? "text-[#8a5a00]" : "text-slate-600"}`}>Repeating visits plan about {(plannedMins / 60).toFixed(1)} carer hours a week against {(mins / 60).toFixed(1)} commissioned (all cycle weeks counted alike).</p> : null}
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
                <form action={addAbsenceAction} className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="serviceUserId" value={su.id} />
                  <label className="col-span-2"><span className="label">Reason</span><select name="reason" className="input"><option value="HOSPITAL">Hospital</option><option value="RESPITE">Respite</option><option value="HOLIDAY">Holiday</option><option value="OTHER">Other</option></select></label>
                  <label><span className="label">First day</span><input type="date" name="from" required defaultValue={today} className="input" /></label>
                  <label><span className="label">Last day</span><input type="date" name="to" className="input" /></label>
                  <label className="col-span-2"><span className="label">Note</span><input name="note" className="input" /></label>
                  <button className="btn-secondary col-span-2">Record absence</button>
                  <p className="col-span-2 text-[12.5px] text-slate-500">Built visits in the period that have not started are cancelled. No last day means until further notice.</p>
                </form>
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
        <div className="grid gap-3 xl:grid-cols-2">
          <Card title="Contacts">
            {su.contacts.length ? (
              <ul className="rows">
                {su.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-[14px]">
                    <div>
                      <div className="font-medium">{c.name} {c.isEmergency ? <Badge tone="rose">Emergency</Badge> : null} {c.canReceiveUpdates ? <Badge tone="teal">Can receive updates</Badge> : null}</div>
                      <div className="text-slate-600">{CONTACT_LABEL[c.kind]}{c.relationship ? ` · ${c.relationship}` : ""}{c.phone ? ` · ${c.phone}` : ""}{c.email ? ` · ${c.email}` : ""}</div>
                    </div>
                    {canEdit ? <form action={removeContactAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="contactId" value={c.id} /><button className="btn-secondary py-0.5 text-[13px]">Remove</button></form> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No contacts recorded.</Empty>}
            {canEdit ? (
              <form action={addContactAction} className="mt-3 grid gap-2 border-t border-slate-200 pt-3 md:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={su.id} />
                <label><span className="label">Type</span><select name="kind" className="input">{Object.entries(CONTACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="label">Name</span><input name="name" required className="input" /></label>
                <label><span className="label">Relationship</span><input name="relationship" className="input" /></label>
                <label><span className="label">Phone</span><input name="phone" type="tel" className="input" /></label>
                <label className="md:col-span-2"><span className="label">E-mail</span><input name="email" type="email" className="input" /></label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="isEmergency" className="h-4 w-4" /> Emergency contact</label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="canReceiveUpdates" className="h-4 w-4" /> Can receive updates</label>
                <button className="btn-secondary md:col-span-2">Add contact</button>
              </form>
            ) : null}
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
                <label className="md:col-span-2"><span className="label">Carer</span><select name="staffId" required className="input"><option value="">Choose…</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
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

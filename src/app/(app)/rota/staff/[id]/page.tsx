import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, isIsoDate, londonDate, londonToUtc, londonTime, parseHhmm } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, staffDirectoryWhere } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { suName } from "@/server/rota/queries";
import { checkStaffEligibility, complianceOn, type EligibilityResult } from "@/server/workforce/eligibility";
import { rotaProfileAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader } from "@/components/ui";
import { VisitStatusBadge } from "@/components/rota-ui";
import { ReadinessPanel } from "@/components/readiness-ui";
import { listRequirements, staffReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

const STATE = { ELIGIBLE: ["Eligible", "green"], REQUIRES_REVIEW: ["Requires review", "amber"], NOT_ELIGIBLE: ["Not eligible", "rose"] } as const;

export default async function StaffMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "staff.directory")) notFound();
  const scope = await rotaScope(ctx, "staff.directory");
  const s = await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id }, include: { profile: true, compliance: { orderBy: [{ category: "asc" }, { name: "asc" }] }, areas: true, branch: true, absences: { where: { endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 10 } } });
  if (!s) notFound();
  const today = londonDate();
  const c = complianceOn(s.compliance, today);
  const [areas, upcoming, settings] = await Promise.all([
    db.area.findMany({ where: { organisationId: scope.organisationId, active: true }, orderBy: { name: "asc" } }),
    db.visitAssignment.findMany({ where: { staffId: s.id, removedAt: null, startsAt: { gte: dbDate(today), lt: dbDate(addDays(today, 8)) } }, orderBy: { startsAt: "asc" }, include: { visit: { select: { id: true, status: true, reference: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } } } } } }),
    rotaSettings(db, scope.organisationId),
  ]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  // Readiness: evaluated from evidence on every view; the forms are shown only to people the server will let act.
  const canReadiness = hasOrgPermission(ctx, "readiness.view");
  const [readiness, requirements, careTasks, serviceUsers] = canReadiness
    ? await Promise.all([
        staffReadiness(ctx, s.id),
        listRequirements(ctx),
        db.careTask.findMany({ where: { organisationId: scope.organisationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: { lastName: "asc" }, take: 500 }),
      ])
    : [null, [], [], []];
  // The eligibility checker: any date and time, judged with the same rules as allocation.
  let check: EligibilityResult | null = null;
  let checkError: string | null = null;
  const cDate = sp.date && isIsoDate(sp.date) ? sp.date : today;
  const cStart = parseHhmm(sp.start ?? "") ?? 9 * 60;
  const cLen = Math.min(Math.max(Number(sp.len) || 30, 5), 720);
  if (sp.check) {
    try {
      const start = londonToUtc(cDate, cStart);
      check = await checkStaffEligibility(ctx, { staffId: s.id, start, end: new Date(start.getTime() + cLen * 60000), areaId: sp.area || null });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      checkError = e.message;
    }
  }
  const back = `/rota/staff/${s.id}`;
  const careDefault = settings.careRoleTitles.some((t) => t.toLowerCase() === s.jobTitle.toLowerCase());

  return (
    <>
      <PageHeader title={s.displayName} back="/rota/staff" subtitle={`${s.jobTitle} · ${s.branch?.name ?? "no branch"} · staff number ${s.staffNumber}. Employment and checks come from HR & Workforce.`} actions={hasOrgPermission(ctx, "workforce.link") ? <Link href="/admin/workforce" className="btn-secondary">Sign-in links</Link> : null} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          {readiness ? (
            <ReadinessPanel
              profile={readiness}
              back={back}
              requirements={requirements}
              careTasks={careTasks}
              serviceUsers={serviceUsers.map((u) => ({ id: u.id, name: suName(u) }))}
              can={{ record: hasOrgPermission(ctx, "readiness.record"), verify: hasOrgPermission(ctx, "readiness.verify"), exception: hasOrgPermission(ctx, "readiness.exception"), evidence: hasOrgPermission(ctx, "readiness.evidence") }}
              me={ctx.userId}
            />
          ) : null}
          <Card title="From HR & Workforce">
            <dl className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Employment">{s.employmentStatus.toLowerCase()}</Field>
              <Field label="Started">{s.startDate ? fmtDate(s.startDate) : "—"}</Field>
              <Field label="Leaving">{s.leavingDate ? fmtDate(s.leavingDate) : "—"}</Field>
              <Field label="Last update from HR">{fmtDate(s.projectedAt, true)}</Field>
            </dl>
            {s.compliance.length ? (
              <table className="table">
                <thead><tr><th>Check</th><th>Area</th><th>Evidence</th><th>Verified</th><th>Next review</th></tr></thead>
                <tbody>
                  {s.compliance.map((x) => {
                    const overdue = x.dueDate && x.dueDate.toISOString().slice(0, 10) < today;
                    return (
                      <tr key={x.id}>
                        <td>{x.name}{x.required ? "" : <span className="text-slate-500"> (optional)</span>}</td>
                        <td>{x.category}</td>
                        <td>{x.hasEvidence ? "Held" : <span className="text-[#a3242c]">Missing</span>}</td>
                        <td>{x.verified ? "Yes" : <span className="text-[#8a5a00]">Not yet</span>}</td>
                        <td className={overdue ? "text-[#a3242c]" : ""}>{x.dueDate ? fmtDate(x.dueDate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <Empty>No checks recorded in HR.</Empty>}
            {c.problems.length ? <p className="mt-2 text-[13px] text-[#a3242c]">For the rota: {c.problems.join("; ")}.</p> : <p className="mt-2 text-[13px] text-[#1c7a43]">All required checks are in order today.</p>}
          </Card>

          <Card title="Next 7 days">
            {upcoming.length ? (
              <ul className="rows">
                {upcoming.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
                    <span className="w-[140px] tabular-nums">{fmtLondonDate(londonDate(a.startsAt), { weekday: "short", day: "numeric", month: "short" })} {londonTime(a.startsAt)}</span>
                    <Link href={`/rota/visits/${a.visit.id}`} className="row-title">{suName(a.visit.serviceUser)}</Link>
                    <span className="text-slate-600">{a.visit.callType.name}{a.slot === "SHADOW" ? " · shadowing" : ""}</span>
                    <span className="ml-auto flex gap-1"><VisitStatusBadge status={a.visit.status} />{a.reviewReason && ["SCHEDULED", "MISSED"].includes(a.visit.status) ? <Badge tone="rose" title={a.reviewReason}>Needs review</Badge> : null}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No visits booked in the next 7 days.</Empty>}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="Check eligibility">
            <form method="get" className="grid grid-cols-2 gap-2">
              <input type="hidden" name="check" value="1" />
              <label className="col-span-2"><span className="label">Date</span><input type="date" name="date" defaultValue={cDate} className="input" /></label>
              <label><span className="label">Start</span><input type="time" name="start" defaultValue={`${String(Math.floor(cStart / 60)).padStart(2, "0")}:${String(cStart % 60).padStart(2, "0")}`} className="input" /></label>
              <label><span className="label">Minutes</span><input type="number" name="len" min={5} max={720} defaultValue={cLen} className="input" /></label>
              <label className="col-span-2"><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">Any</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <button className="btn-secondary col-span-2">Check</button>
            </form>
            {checkError ? <p role="alert" className="mt-3 text-[14px] text-[#a3242c]">{checkError}</p> : null}
            {check ? (
              <div className="mt-3 space-y-2 text-[14px]" aria-live="polite">
                <Badge tone={STATE[check.state][1]}>{STATE[check.state][0]}</Badge>
                {check.blocking.length ? <ul className="list-disc pl-5 text-[#a3242c]">{check.blocking.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul> : null}
                {check.warnings.length ? <ul className="list-disc pl-5 text-[#8a5a00]">{check.warnings.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul> : null}
                {!check.blocking.length && !check.warnings.length ? <p>No problems found for this time.</p> : null}
                <p className="text-[12.5px] text-slate-500">DBS: {check.compliance.dbs} · Right to work: {check.compliance.rightToWork} · Training: {check.compliance.training}</p>
              </div>
            ) : null}
          </Card>

          <Card title="Rota details">
            <form action={rotaProfileAction} className="space-y-2.5">
              <fieldset disabled={!canEdit} className="space-y-2.5">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="staffId" value={s.id} />
                <label className="block"><span className="label">Takes part in the rota</span>
                  <select name="rotaEnabled" defaultValue={s.profile?.rotaEnabled === null || s.profile?.rotaEnabled === undefined ? "" : s.profile.rotaEnabled ? "yes" : "no"} className="input">
                    <option value="">From job title ({careDefault ? "yes" : "no"})</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
                <label className="block"><span className="label">Gender for matching preferences</span>
                  <select name="gender" defaultValue={s.profile?.gender ?? ""} className="input"><option value="">Not recorded</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option><option value="UNDISCLOSED">Prefers not to say</option></select>
                </label>
                <label className="block"><span className="label">Weekly hour limit</span><input type="number" name="maxWeeklyHours" min={0} max={80} step={0.5} defaultValue={s.profile?.maxWeeklyMinutes ? s.profile.maxWeeklyMinutes / 60 : ""} className="input" /></label>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="drives" defaultChecked={s.profile?.drives ?? false} className="h-4 w-4" /> Drives</label>
                <fieldset>
                  <legend className="label">Areas</legend>
                  <div className="grid grid-cols-2 gap-1">{areas.map((a) => <label key={a.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="areaIds" value={a.id} defaultChecked={s.areas.some((x) => x.areaId === a.id)} className="h-4 w-4" /> {a.name}</label>)}</div>
                </fieldset>
                <label className="block"><span className="label">Notes for coordinators</span><textarea name="notes" rows={2} defaultValue={s.profile?.notes ?? ""} className="input" /></label>
                {canEdit ? <button className="btn-primary">Save rota details</button> : <p className="text-[13px] text-slate-500">You can view these details. Changing them needs rota editing rights.</p>}
              </fieldset>
            </form>
          </Card>

          <Card title="Upcoming absences">
            {s.absences.length ? <ul className="space-y-1 text-[14px]">{s.absences.map((a) => <li key={a.id}>{a.kind.toLowerCase()} · {fmtDate(a.startsAt)} to {fmtDate(a.endsAt)} · <span className={a.status === "APPROVED" ? "" : "text-[#8a5a00]"}>{a.status.toLowerCase()}</span></li>)}</ul> : <Empty>None recorded.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}

import type { Prisma } from "@prisma/client";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { fromDbDate, hhmm, WEEKDAYS } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { templateBulkAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";
import { SelectAll } from "@/components/select-all";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  const lk = await rotaLookups(ctx);
  const org = lk.scope.organisationId;
  const settings = await rotaSettings(db, org);
  const week = Number(sp.week) || undefined;
  const day = Number(sp.day) || undefined;
  const where: Prisma.VisitTemplateWhereInput = {
    organisationId: org,
    ...(lk.scope.areaIds ? { areaId: { in: lk.scope.areaIds } } : {}),
    ...(sp.su ? { serviceUserId: sp.su } : {}),
    ...(sp.area ? { areaId: sp.area } : {}),
    ...(sp.call ? { callTypeId: sp.call } : {}),
    ...(sp.carer ? { OR: [{ preferredStaff1Id: sp.carer }, { preferredStaff2Id: sp.carer }, { shadowStaffId: sp.carer }] } : {}),
    ...(week ? { cycleWeeks: { has: week } } : {}),
    ...(day ? { weekdays: { has: day } } : {}),
    ...(sp.state === "off" ? { enabled: false } : sp.state === "all" ? {} : { enabled: true }),
    ...(sp.empty === "1" ? { preferredStaff1Id: null } : {}),
  };
  const rows = await db.visitTemplate.findMany({ where, include: { serviceUser: { select: { firstName: true, lastName: true, preferredName: true, reference: true, area: { select: { name: true, colour: true } } } }, callType: { select: { name: true } } }, orderBy: [{ serviceUser: { lastName: "asc" } }, { startMinute: "asc" }], take: 500 });
  const staffName = new Map(lk.staff.map((s) => [s.id, s.displayName]));
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const back = `/rota/templates?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && !["ok", "error"].includes(e[0])))}`;

  return (
    <>
      <PageHeader
        title="Rota Templates"
        back="/rota"
        subtitle={`The repeating pattern of care for each person over a ${settings.cycleLength}-week cycle. Build Rota turns these into dated visits. Changing a template does not change visits already built until you apply the change from the template.`}
        actions={canEdit ? <><Link href="/rota/templates/planner" className="btn-secondary">Template Planner</Link><Link href="/rota/templates/new" className="btn-primary">New template</Link></> : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <label><span className="label">Service user</span><select name="su" defaultValue={sp.su ?? ""} className="input"><option value="">Anyone</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span className="label">Carer</span><select name="carer" defaultValue={sp.carer ?? ""} className="input"><option value="">Any carer</option>{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
          <label><span className="label">Call type</span><select name="call" defaultValue={sp.call ?? ""} className="input"><option value="">Any call</option>{lk.callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span className="label">Cycle week</span><select name="week" defaultValue={sp.week ?? ""} className="input"><option value="">Any week</option>{Array.from({ length: settings.cycleLength }, (_, i) => <option key={i} value={i + 1}>Week {i + 1}</option>)}</select></label>
          <label><span className="label">Day</span><select name="day" defaultValue={sp.day ?? ""} className="input"><option value="">Any day</option>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>
          <label><span className="label">Status</span><select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Switched on</option><option value="off">Switched off</option><option value="all">All</option></select></label>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 pb-2 text-[13.5px]"><input type="checkbox" name="empty" value="1" defaultChecked={sp.empty === "1"} className="h-4 w-4" /> No carer</label>
          </div>
          <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-8"><button className="btn-primary">Apply filters</button><Link href="/rota/templates" className="btn-secondary">Clear</Link></div>
        </form>
      </section>

      {canEdit ? (
        <form id="tbulk" action={templateBulkAction} className="panel mb-3 flex flex-wrap items-end gap-3" aria-label="Change selected templates">
          <input type="hidden" name="back" value={back} />
          <span className="pb-2 text-[14px] font-medium text-navy-900">Selected templates:</span>
          <button className="btn-secondary" name="kind" value="enable">Switch on</button>
          <button className="btn-secondary" name="kind" value="disable">Switch off</button>
          <label><span className="label">Minutes (− earlier)</span><input type="number" name="minutes" min={-240} max={240} step={5} defaultValue={15} className="input w-24" /></label>
          <button className="btn-secondary" name="kind" value="nudge">Move times</button>
          <span className="pb-2 text-[12.5px] text-slate-500">Locked times are not moved. Built visits keep their times until a change is applied.</span>
        </form>
      ) : null}

      <Card>
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                {canEdit ? <th className="w-8"><SelectAll form="tbulk" name="templateIds" label="Select all templates" /></th> : null}
                <th>Service user</th><th>Call</th><th>Time</th><th>Days</th><th>Weeks</th><th>Carers</th><th>Area</th><th>Runs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.enabled ? undefined : "opacity-60"}>
                  {canEdit ? <td><input type="checkbox" form="tbulk" name="templateIds" value={t.id} aria-label={`Select template for ${suName(t.serviceUser)} ${t.callType.name}`} className="h-4 w-4" /></td> : null}
                  <td><Link href={`/rota/templates/${t.id}`}>{suName(t.serviceUser)}</Link><div className="text-[12.5px] text-slate-500">{t.serviceUser.reference}</div></td>
                  <td>{t.callType.name}{t.medicationRequired ? <span className="block text-[12px] text-slate-500">Medication prompt</span> : null}</td>
                  <td className="whitespace-nowrap tabular-nums">{hhmm(t.startMinute)} · {t.durationMin}m{t.timeLocked ? <span className="block text-[12px] text-slate-500">Locked</span> : null}</td>
                  <td className="whitespace-nowrap">{t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 2)).join(" ")}</td>
                  <td className="whitespace-nowrap">{t.cycleWeeks.length === settings.cycleLength ? "All" : t.cycleWeeks.join(", ")}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {[t.preferredStaff1Id, ...(t.carersRequired > 1 ? [t.preferredStaff2Id] : [])].map((id, i) =>
                        id ? <span key={i} className="rounded-[3px] bg-[#e3effb] px-1.5 text-[12.5px] text-[#1d4f91]">{staffName.get(id) ?? "Former staff"}</span> : <span key={i} className="rounded-[3px] border border-dashed border-[#e4544f] px-1.5 text-[12.5px] text-[#a3242c]">No carer</span>,
                      )}
                    </span>
                  </td>
                  <td><AreaDot area={t.serviceUser.area} /></td>
                  <td className="text-[13px]">{t.enabled ? `From ${fmtDate(fromDbDate(t.effectiveFrom))}` : <Badge>Switched off</Badge>}{t.effectiveTo ? <span className="block">to {fmtDate(fromDbDate(t.effectiveTo))}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No templates match these filters.</Empty>
        )}
      </Card>
    </>
  );
}

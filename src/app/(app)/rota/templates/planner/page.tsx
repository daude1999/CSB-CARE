import Link from "@/components/link";
import { db } from "@/lib/db";
import { hhmm, WEEKDAYS } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { templateScopeWhere } from "@/server/rota/scope";
import { templateCarerAction } from "@/app/rota-actions";
import { Flash } from "@/components/ui";
import { ChoiceGroup, TemplatesHeader } from "@/components/template-ui";
import { PlannerBoard, type PlannerChip, type PlannerRow } from "@/components/planner-board";

export const dynamic = "force-dynamic";

export default async function TemplatePlannerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const lk = await rotaLookups(ctx);
  const org = lk.scope.organisationId;
  const settings = await rotaSettings(db, org);
  const week = Math.min(Math.max(Number(sp.week) || 1, 1), settings.cycleLength);
  const templates = await db.visitTemplate.findMany({
    // The area filter narrows the member's own scope; it can never widen it to another branch's area.
    where: { organisationId: org, enabled: true, cycleWeeks: { has: week }, AND: [templateScopeWhere(lk.scope), sp.area ? { areaId: sp.area } : {}] },
    include: { serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } } },
    orderBy: { startMinute: "asc" },
  });
  const blank = () => WEEKDAYS.map((): PlannerChip[] => []);
  const byStaff = new Map<string, { cells: PlannerChip[][]; minutes: number }>();
  const empty = blank();
  for (const t of templates) {
    const label = `${suName(t.serviceUser)}${t.carersRequired > 1 ? " (2)" : ""}`;
    const title = `${t.callType.name} ${hhmm(t.startMinute)} for ${t.durationMin} minutes`;
    const slots: ["PRIMARY" | "SECOND" | "SHADOW", string | null][] = [["PRIMARY", t.preferredStaff1Id], ...(t.carersRequired > 1 ? [["SECOND", t.preferredStaff2Id] as ["SECOND", string | null]] : []), ...(t.shadowStaffId ? [["SHADOW", t.shadowStaffId] as ["SHADOW", string]] : [])];
    for (const day of t.weekdays) {
      for (const [slot, staffId] of slots) {
        const chip: PlannerChip = { visitId: t.id, slot, lockVersion: t.version, href: `/rota/templates/${t.id}`, time: hhmm(t.startMinute), label: slot === "SHADOW" ? `${label} (shadow)` : label, title, tone: staffId ? "ok" : "empty", movable: true };
        if (!staffId) empty[day - 1]!.push(chip);
        else {
          const row = byStaff.get(staffId) ?? { cells: blank(), minutes: 0 };
          row.cells[day - 1]!.push(chip);
          if (slot !== "SHADOW") row.minutes += t.durationMin;
          byStaff.set(staffId, row);
        }
      }
    }
  }
  const pool = new Set(lk.carers.map((s) => s.id));
  const staffRows = lk.staff.filter((s) => byStaff.has(s.id) || (pool.has(s.id) && (sp.area ? s.areas.some((a) => a.areaId === sp.area) : sp.all === "1")));
  const rows: PlannerRow[] = [
    { id: "unassigned", name: "No carer", sub: `${empty.flat().length} slots`, cells: empty },
    ...staffRows.map((s) => ({ id: s.id, name: s.displayName, sub: `${((byStaff.get(s.id)?.minutes ?? 0) / 60).toFixed(1)} h in Week ${week}`, href: `/rota/staff/${s.id}`, cells: byStaff.get(s.id)?.cells ?? blank() })),
  ];
  const q = (w: number) => `/rota/templates/planner?week=${w}${sp.area ? `&area=${sp.area}` : ""}${sp.all ? "&all=1" : ""}`;
  return (
    <>
      <TemplatesHeader title="Advanced Templates" subtitle="Repeating visits by carer for one cycle week. Drag a visit to another carer to change who it is planned for." active="advanced" canBuild={hasOrgPermission(ctx, "rota.build")} />
      <p className="mb-3 text-[13.5px] text-[#475467]">The change applies to every day and week that template runs. Weeks already built keep their carers. Each carer’s round order is set in <Link href="/rota/routes/templates">Template Run Routes</Link>.</p>
      <Flash searchParams={sp} />
      <div className="mb-3"><ChoiceGroup label="Cycle week" items={Array.from({ length: settings.cycleLength }, (_, i) => ({ href: q(i + 1), label: `Week ${i + 1}`, active: week === i + 1 }))} /></div>
      <section className="panel" aria-label="Template planner">
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={week} />
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="h-4 w-4" /> Show carers with no visits</label>
          <button className="btn-primary">Show</button>
        </form>
        <PlannerBoard days={WEEKDAYS.map((d) => ({ date: d, label: d, today: false }))} rows={rows} action={templateCarerAction} back={q(week)} canEdit={hasOrgPermission(ctx, "rota.edit")} idName="templateId" versionName="version" />
      </section>
    </>
  );
}

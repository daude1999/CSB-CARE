import { db } from "../src/lib/db";
import { addDays, londonDate, mondayOf } from "../src/lib/london";
import { DEMO_ORG_SLUG } from "../src/server/seed/demo";
import { UAT_BRANCHES } from "../src/server/seed/uat";

/**
 * Prints measured facts about the synthetic UAT data (for docs/implementation/V1_DEMO_DATA_VALIDATION.md).
 * Read-only. Run with DATABASE_URL pointing at the UAT database: `DATABASE_URL=... npx tsx scripts/uat-validate.ts`.
 */
async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
  const organisationId = org.id;
  const today = londonDate();
  const from = addDays(mondayOf(today), -14);
  const to = addDays(mondayOf(today), 28);
  const rows: string[] = [];
  for (const b of UAT_BRANCHES) {
    const branch = await db.branch.findFirstOrThrow({ where: { organisationId, name: b.name } });
    const areas = await db.area.findMany({ where: { organisationId, branchId: branch.id }, select: { id: true, name: true } });
    const areaIds = areas.map((a) => a.id);
    const sus = await db.serviceUser.count({ where: { organisationId, branchId: branch.id, status: "ACTIVE" } });
    const carers = await db.staffMember.count({ where: { organisationId, hrBranchKey: b.hr, employmentStatus: "ACTIVE", areas: { some: {} } } });
    const visits = await db.visit.findMany({ where: { organisationId, areaId: { in: areaIds }, scheduledStart: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } }, select: { scheduledStart: true, status: true, carersRequired: true, assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { id: true, reviewReason: true } } } });
    const perDay = new Map<string, number>();
    for (const v of visits) perDay.set(londonDate(v.scheduledStart), (perDay.get(londonDate(v.scheduledStart)) ?? 0) + 1);
    const counts = [...perDay.values()];
    const unassigned = visits.filter((v) => v.status === "SCHEDULED" && v.assignments.length === 0).length;
    const partial = visits.filter((v) => v.status === "SCHEDULED" && v.carersRequired === 2 && v.assignments.length === 1).length;
    const flagged = visits.filter((v) => v.assignments.some((a) => a.reviewReason)).length;
    const byStatus = visits.reduce<Record<string, number>>((m, v) => ({ ...m, [v.status]: (m[v.status] ?? 0) + 1 }), {});
    rows.push(`${b.name}: areas ${areas.map((a) => a.name).join(" / ")}; service users ${sus}; carers ${carers}; days ${counts.length}; visits ${visits.length}; per day min ${Math.min(...counts)} avg ${(visits.length / counts.length).toFixed(1)} max ${Math.max(...counts)}; unassigned ${unassigned}; partial double-ups ${partial}; flagged for review ${flagged}; by status ${JSON.stringify(byStatus)}`);
  }
  console.log(rows.join("\n"));
  const builds = await db.rotaBuild.findMany({ where: { organisationId }, select: { weekStart: true, status: true, cycleWeek: true }, orderBy: { weekStart: "asc" } });
  console.log("builds:", builds.map((x) => `${x.weekStart.toISOString().slice(0, 10)} wk${x.cycleWeek} ${x.status}`).join(", "));
  const timesheets = await db.timesheet.groupBy({ by: ["status"], where: { organisationId }, _count: true });
  console.log("timesheets:", JSON.stringify(timesheets.map((t) => [t.status, t._count])));
  const clocks = await db.visitClock.count({ where: { organisationId } });
  const open = await db.visit.count({ where: { organisationId, status: "IN_PROGRESS" } });
  console.log(`clock records ${clocks}; visits in progress (no check-out) ${open}`);
  const absences = await db.staffAbsence.findMany({ where: { organisationId }, select: { kind: true, status: true } });
  console.log("absences:", JSON.stringify(absences));
  const alerts = await db.rotaAlert.groupBy({ by: ["kind"], where: { organisationId, resolvedAt: null }, _count: true });
  console.log("open alerts:", JSON.stringify(alerts.map((a) => [a.kind, a._count])));
  const notTest = await db.serviceUser.count({ where: { organisationId, NOT: { reference: { startsWith: "UAT-" } } } });
  console.log(`service users not labelled UAT-: ${notTest}`);
}
main().finally(() => db.$disconnect());

import { db } from "../src/lib/db";
import { addDays, londonDate, mondayOf } from "../src/lib/london";
import { ctxForUser } from "../src/server/auth/session";
import { DEMO_ORG_SLUG } from "../src/server/seed/demo";
import { confirmBuild, previewBuild, publishBuild } from "../src/server/rota/build";
import { listVisits } from "../src/server/rota/queries";
import { monitorBoard, sweepCalls } from "../src/server/rota/monitor";
import { parseFilters, rotaReport } from "../src/server/rota/reports";
import { computeKpis } from "../src/server/reports/kpis";
import { bulkTimesheets, generateTimesheets } from "../src/server/finance/timesheets";
import { prepareInvoiceRun, preparePayRun } from "../src/server/finance/runs";
import { rankCarers } from "../src/server/workforce/eligibility";
import { swapCarers } from "../src/server/rota/swap";
import { transaction as hrTransaction } from "../src/hr/lib/workspace-tx";

/**
 * Measured timings of the heavy server operations at full UAT scale (V1 brief, phase 9). It CHANGES the UAT database
 * (builds a week, prepares runs), so run `npm run uat:data -- restore` afterwards. Refuses any non-UAT database.
 * Run: NODE_OPTIONS=--conditions=react-server DATABASE_URL=<local uat url> npx tsx scripts/uat-perf.ts
 */
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/uat/.test(url.pathname)) throw new Error("Run only against a local UAT database");
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: DEMO_ORG_SLUG } });
  const as = async (email: string) => ctxForUser((await db.user.findUniqueOrThrow({ where: { email } })).id, org.id);
  const coordinator = await as("coordinator@care-solution.demo");
  const manager = await as("manager@care-solution.demo");
  const finance = await as("finance@care-solution.demo");
  const today = londonDate();
  const monday = mondayOf(today);
  const results: [string, number[], string][] = [];
  const time = async <T>(label: string, runs: number, fn: () => Promise<T>, note: (r: T) => string = () => "") => {
    const ms: number[] = [];
    let last: T | undefined;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      last = await fn();
      ms.push(Math.round(performance.now() - t));
    }
    results.push([label, ms, note(last as T)]);
  };
  await time("Daily rota: today, all areas (listVisits)", 3, () => listVisits(coordinator, { date: today }), (r) => `${r.rows.length} visits`);
  await time("Planner: this week, all areas (listVisits, 3,000 cap)", 3, () => listVisits(coordinator, { date: monday, to: addDays(monday, 6) }, 3000), (r) => `${r.rows.length} visits, truncated ${r.truncated}`);
  await time("Call monitor board", 3, () => monitorBoard(coordinator), () => "");
  await time("Rota report: carer attendance, last 2 weeks", 3, () => rotaReport(coordinator, parseFilters({ report: "carers", from: addDays(monday, -14), to: addDays(monday, -1) })), () => "");
  await time("Rota report: visit delivery by day, last 2 weeks", 3, () => rotaReport(coordinator, parseFilters({ report: "delivery", from: addDays(monday, -14), to: addDays(monday, -1) })), () => "");
  await time("Analytics measures (computeKpis), default period", 3, () => computeKpis(manager, {}), () => "");
  await time("Rank carers for one visit (eligibility over all 58 carers)", 3, async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: org.id, status: "SCHEDULED", scheduledStart: { gt: new Date() } } });
    return rankCarers(db, org.id, { start: v.scheduledStart, end: v.scheduledEnd, slot: "PRIMARY", serviceUserId: v.serviceUserId, careTaskIds: [], visitId: v.id });
  }, (r) => `${r.length} carers ranked`);
  await time("Build preview: week +4 (all areas)", 1, () => previewBuild(coordinator, { weekStart: addDays(monday, 28) }), (r) => `${r.visits.length} visits`);
  let buildId = "";
  await time("Build confirm: week +4", 1, async () => { const r = await confirmBuild(coordinator, { weekStart: addDays(monday, 28) }); buildId = r.build.id; return r; }, (r) => `${r.build.visitCount} visits`);
  await time("Publish: week +4 (re-checks every carer on the week)", 1, () => publishBuild(coordinator, buildId), (r) => `${r.published} visits, ${r.carersNotified} carers notified`);
  await time("Call monitoring sweep (whole organisation)", 1, () => sweepCalls({ organisationId: org.id }), () => "");
  await time("Generate timesheets: two weeks ago", 1, () => generateTimesheets(coordinator, addDays(monday, -14)), () => "");
  await time("Submit all timesheets: two weeks ago (bulk)", 1, () => bulkTimesheets(coordinator, addDays(monday, -14), "submit").catch((e: Error) => e.message), (r) => (typeof r === "string" ? r : `${r.done} submitted, ${r.refused.length} refused (lines with exceptions not yet checked)`));
  await time("Approve all timesheets: two weeks ago (bulk)", 1, () => bulkTimesheets(finance, addDays(monday, -14), "approve").catch((e: Error) => e.message), (r) => (typeof r === "string" ? r : `${r.done} approved`));
  await time("Prepare pay run: two weeks ago", 1, () => preparePayRun(finance, addDays(monday, -14)).catch((e: Error) => e.message), (r) => (typeof r === "string" ? r : ""));
  await time("Prepare invoice run: two weeks ago", 1, () => prepareInvoiceRun(finance, addDays(monday, -14)).catch((e: Error) => e.message), (r) => (typeof r === "string" ? r : ""));
  await time("HR save that re-projects 58 carers (one check edited)", 1, () => hrTransaction(org.id, (s) => { const c = s.checks.find((x) => x.required); if (c) c.version++; }), () => "");
  await time("Two-way swap (one pair, eligibility both ways)", 1, async () => {
    const pairs = await db.visitAssignment.findMany({ where: { organisationId: org.id, removedAt: null, slot: "PRIMARY", visit: { status: "SCHEDULED", scheduledStart: { gt: new Date(Date.now() + 8 * 86400000) } } }, take: 2, orderBy: { startsAt: "asc" }, distinct: ["staffId"] });
    return swapCarers(coordinator, { first: { visitId: pairs[0]!.visitId, slot: "PRIMARY" }, second: { visitId: pairs[1]!.visitId, slot: "PRIMARY" }, reason: "Performance measurement", acceptWarnings: true }).catch((e: Error) => e.message);
  }, (r) => (typeof r === "string" ? `refused: ${r.slice(0, 80)}` : "swapped"));
  console.log("| Operation | Timings (ms) | Notes |\n|---|---|---|");
  for (const [l, ms, n] of results) console.log(`| ${l} | ${ms.join(", ")} | ${n} |`);
}
main().finally(() => db.$disconnect());

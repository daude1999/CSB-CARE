import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate, londonMinute, londonToUtc } from "@/lib/london";
import { assignCarer, unassignCarer } from "@/server/rota/assign";
import { swapCarers } from "@/server/rota/swap";
import { cancelVisit, createVisit, moveVisit, reinstateVisit, updateVisit } from "@/server/rota/visits";
import { listVisits } from "@/server/rota/queries";
import { rotaDashboard } from "@/server/rota/dashboard";
import { parseFilters, rotaReport } from "@/server/rota/reports";
import { rankCarers } from "@/server/workforce/eligibility";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * One visit followed through its life, checking after every step that each screen's data source shows the same
 * thing: the Daily Rota and Advanced Rota (listVisits by day), the person's and the carers' schedules (listVisits by
 * person or carer), the Rota Dashboard figures, the delivery report and the audit trail. All of them read the same
 * Visit and VisitAssignment rows, so they must agree exactly.
 */

const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";
let callTypeId = "";
let suId = "";
const day = addDays(londonDate(), 35);
const nextDay = addDays(day, 1);

async function eligible(date: string, minute: number, exclude: string[] = []) {
  const start = londonToUtc(date, minute);
  const r = await rankCarers(db, orgId, { start, end: new Date(start.getTime() + 30 * 60000), slot: "PRIMARY", serviceUserId: suId, careTaskIds: [] });
  return r.filter((x) => x.result.state !== "NOT_ELIGIBLE" && !exclude.includes(x.staff!.id)).map((x) => x.staff!.id);
}

/** Every view's answer for one visit, so a step can assert they all agree. */
async function views(visitId: string, carers: string[]) {
  const ctx = await coordinator();
  const onDay = async (date: string) => (await listVisits(ctx, { date, includeCancelled: true })).rows.find((v) => v.id === visitId);
  const [dayRow, nextRow, person, dash, dashNext, report, ...carerRows] = await Promise.all([
    onDay(day),
    onDay(nextDay),
    listVisits(ctx, { date: day, to: nextDay, serviceUserId: suId, includeCancelled: true }).then((r) => r.rows.find((v) => v.id === visitId)),
    rotaDashboard(ctx, { date: day }),
    rotaDashboard(ctx, { date: nextDay }),
    rotaReport(ctx, parseFilters({ report: "delivery", from: day, to: nextDay })),
    ...carers.map((c) => listVisits(ctx, { date: day, to: nextDay, staffId: c }).then((r) => r.rows.some((v) => v.id === visitId))),
  ]);
  const plannedCol = report.columns.indexOf("Planned");
  const cancelledCol = report.columns.indexOf("Cancelled");
  return {
    dayRow,
    nextRow,
    person,
    dash: dash.calls,
    dashNext: dashNext.calls,
    report: { planned: Number(report.totals?.[plannedCol]), cancelled: Number(report.totals?.[cancelledCol]) },
    carerHas: Object.fromEntries(carers.map((c, i) => [c, carerRows[i]])) as Record<string, boolean>,
  };
}

const audits = (visitId: string) => db.auditLog.findMany({ where: { organisationId: orgId, entityId: visitId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  suId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { reference: "asc" } })).id;
}, 180_000);

describe("one visit, every view", () => {
  it("shows the same visit and the same counts everywhere through create, assign, reassign, move, retime, cancel and reinstate", async () => {
    const ctx = await coordinator();
    const before = await views("none", []);

    // 1. Create a 09:00 visit with nobody on it.
    const created = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: 540, durationMin: 30 });
    const id = created.id;
    expect(await db.visit.count({ where: { id, organisationId: orgId } })).toBe(1);
    let v = await views(id, []);
    expect(v.dayRow?.status).toBe("SCHEDULED");
    expect(v.person?.id).toBe(id);
    expect(v.dash.total).toBe(before.dash.total + 1);
    expect(v.dash.unassigned).toBe(before.dash.unassigned + 1);
    expect(v.dash.due).toBe(before.dash.due + 1);
    expect(v.report.planned).toBe(before.report.planned + 1);
    expect((await audits(id)).map((a) => a.action)).toContain("visit.created");

    // 2. Assign an eligible carer: the unassigned count drops and the carer's schedule has it.
    const [first, second] = await eligible(day, 540);
    expect(first && second).toBeTruthy();
    await assignCarer(ctx, { visitId: id, slot: "PRIMARY", staffId: first!, acceptWarnings: true });
    v = await views(id, [first!, second!]);
    expect(v.dash.unassigned).toBe(before.dash.unassigned);
    expect(v.carerHas[first!]).toBe(true);
    expect(v.carerHas[second!]).toBe(false);
    expect(v.dayRow?.assignments.map((a) => a.staffId)).toEqual([first]);

    // 3. Reassign: the first carer loses it, the second gains it, and there is exactly one live booking.
    await assignCarer(ctx, { visitId: id, slot: "PRIMARY", staffId: second!, acceptWarnings: true });
    v = await views(id, [first!, second!]);
    expect(v.carerHas).toEqual({ [first!]: false, [second!]: true });
    expect(await db.visitAssignment.count({ where: { visitId: id, removedAt: null } })).toBe(1);
    expect(v.person?.assignments.map((a) => a.staffId)).toEqual([second]);
    expect(v.dash.total).toBe(before.dash.total + 1);

    // 4. Move to the next day: it leaves the first day's figures and joins the next day's, carer kept.
    const row = await db.visit.findUniqueOrThrow({ where: { id } });
    await moveVisit(ctx, { visitId: id, slot: "PRIMARY", lockVersion: row.lockVersion, toDate: nextDay, staffId: second!, acceptWarnings: true });
    v = await views(id, [second!]);
    expect(v.dayRow).toBeUndefined();
    expect(v.nextRow?.id).toBe(id);
    expect(v.dash.total).toBe(before.dash.total);
    expect(v.dashNext.total).toBe(before.dashNext.total + 1);
    expect(v.carerHas[second!]).toBe(true);
    expect(v.report.planned).toBe(before.report.planned + 1);

    // 5. Change the time and length: every view shows the new time.
    const moved = await db.visit.findUniqueOrThrow({ where: { id } });
    const start = londonToUtc(nextDay, 600);
    await updateVisit(ctx, id, moved.lockVersion, { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 45 * 60000) });
    v = await views(id, [second!]);
    expect(londonMinute(v.nextRow!.scheduledStart)).toBe(600);
    expect((v.nextRow!.scheduledEnd.getTime() - v.nextRow!.scheduledStart.getTime()) / 60000).toBe(45);
    expect(v.person?.scheduledStart.getTime()).toBe(start.getTime());

    // 6. Cancel: no longer an active visit anywhere, still in the history with its reason.
    await cancelVisit(ctx, id, "Family cancelled: in hospital");
    v = await views(id, [second!]);
    expect(v.nextRow?.status).toBe("CANCELLED");
    expect(v.dashNext.total).toBe(before.dashNext.total);
    expect(v.dashNext.cancelled).toBe(before.dashNext.cancelled + 1);
    expect(v.report.planned).toBe(before.report.planned);
    expect(v.report.cancelled).toBe(before.report.cancelled + 1);
    expect(v.carerHas[second!]).toBe(false);
    const ctxDefault = (await listVisits(ctx, { date: nextDay })).rows.some((r) => r.id === id);
    expect(ctxDefault).toBe(false);
    const cancelAudit = (await audits(id)).find((a) => a.action === "visit.cancelled");
    expect(JSON.stringify(cancelAudit?.data)).toContain("in hospital");

    // 7. Reinstate: back in the counts.
    await reinstateVisit(ctx, id, "Family confirmed after all");
    v = await views(id, [second!]);
    expect(v.nextRow?.status).toBe("SCHEDULED");
    expect(v.dashNext.total).toBe(before.dashNext.total + 1);
    expect(v.dashNext.cancelled).toBe(before.dashNext.cancelled);
  });

  it("keeps both carers' schedules and both visits consistent after a two-way swap, then after removing a carer", async () => {
    const ctx = await coordinator();
    const [a, b] = await eligible(day, 1080);
    const one = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: 1080, durationMin: 30 });
    const two = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: 1200, durationMin: 30 });
    await assignCarer(ctx, { visitId: one.id, slot: "PRIMARY", staffId: a!, acceptWarnings: true });
    await assignCarer(ctx, { visitId: two.id, slot: "PRIMARY", staffId: b!, acceptWarnings: true });
    const dash = (await rotaDashboard(ctx, { date: day })).calls;

    await swapCarers(ctx, { first: { visitId: one.id, slot: "PRIMARY" }, second: { visitId: two.id, slot: "PRIMARY" }, reason: "Carers asked to swap", acceptWarnings: true });
    const oneNow = await views(one.id, [a!, b!]);
    const twoNow = await views(two.id, [a!, b!]);
    expect(oneNow.carerHas).toEqual({ [a!]: false, [b!]: true });
    expect(twoNow.carerHas).toEqual({ [a!]: true, [b!]: false });
    expect(oneNow.dash.total).toBe(dash.total);
    expect(oneNow.dash.unassigned).toBe(dash.unassigned);
    expect((await audits(one.id)).map((x) => x.action)).toContain("visit.swapped");

    await unassignCarer(ctx, { visitId: one.id, slot: "PRIMARY", reason: "Carer called in sick" });
    const after = await views(one.id, [b!]);
    expect(after.carerHas[b!]).toBe(false);
    expect(after.dash.unassigned).toBe(dash.unassigned + 1);
    expect(after.dayRow?.flags.unassignedSlots).toBe(1);
  });
});

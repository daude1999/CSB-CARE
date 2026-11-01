import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonToUtc } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { assignCarer } from "@/server/rota/assign";
import { coverageReport, coverageTimeline, exportCoverage, parseCoverage } from "@/server/rota/coverage";
import { listVisits } from "@/server/rota/queries";
import { parseUnassigned, unassignedBoard } from "@/server/rota/unassigned";
import { coverOptions } from "@/server/rota/unassigned-cover";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Unassigned Visits (live list + Find Cover) and Coverage History, against the real schema with synthetic visits on
 * dates the demo seed does not use, so every figure can be checked by hand.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const PAST = addDays(londonDate(), -40);
const FUTURE = addDays(londonDate(), 20);
let orgId = "";
let managerId = "";
const branch: Record<string, string> = {};
const staff: string[] = [];
let suId = "";
let areaId = "";
let callTypeId = "";
const ids: Record<string, string> = {};

async function visit(key: string, date: string, startMin: number, opts: { status?: "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED" | "IN_PROGRESS" | "NOT_DELIVERED"; carers?: number } = {}) {
  const v = await db.visit.create({
    data: { organisationId: orgId, reference: `T-${key}-${date}`, serviceUserId: suId, callTypeId, areaId, date: dbDate(date), scheduledStart: londonToUtc(date, startMin), scheduledEnd: londonToUtc(date, startMin + 30), carersRequired: opts.carers ?? 1, status: opts.status ?? "SCHEDULED", publishedAt: new Date(), ...(opts.status === "CANCELLED" ? { cancelReason: "In hospital", cancelledAt: new Date() } : {}) },
  });
  ids[key] = v.id;
  return v;
}
async function assign(visitId: string, staffId: string, assignedAt: Date, extra: { slot?: "PRIMARY" | "SECOND"; removedAt?: Date; removeReason?: string } = {}) {
  const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  return db.visitAssignment.create({ data: { organisationId: orgId, visitId, slot: extra.slot ?? "PRIMARY", staffId, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: managerId, assignedAt, removedAt: extra.removedAt ?? null, removedById: extra.removedAt ? managerId : null, removeReason: extra.removeReason ?? null } });
}
async function clock(visitId: string, staffId: string, kind: "IN" | "OUT", date: string, minute: number, supersedesId?: string) {
  return db.visitClock.create({ data: { organisationId: orgId, visitId, staffId, kind, at: londonToUtc(date, minute), method: "OFFICE", recordedById: managerId, reason: supersedesId ? "Carer phoned with the right time" : "Synthetic test clock entered by the office", supersedesId: supersedesId ?? null } });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } });
  orgId = org.id;
  managerId = (await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branch[b.name] = b.id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], areaId: { not: null }, status: "ACTIVE" } });
  suId = su.id;
  areaId = su.areaId!;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId } })).id;
  staff.push(...(await db.staffMember.findMany({ where: { organisationId: orgId, branchId: branch["Tower Hamlets"], employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" }, take: 3 })).map((s) => s.id));
  const startOfPast = londonToUtc(PAST, 0);
  const before = (min: number) => new Date(startOfPast.getTime() + min * 60000);

  // 1. Reassigned 20 minutes before the start after sickness; the replacement attended and completed.
  await visit("re", PAST, 8 * 60, { status: "COMPLETED" });
  await assign(ids.re!, staff[0]!, new Date(startOfPast.getTime() - 3 * 86400000), { removedAt: before(7 * 60 + 40), removeReason: "Sickness absence recorded" });
  await assign(ids.re!, staff[1]!, before(7 * 60 + 40));
  await clock(ids.re!, staff[1]!, "IN", PAST, 8 * 60 + 3);
  await clock(ids.re!, staff[1]!, "OUT", PAST, 8 * 60 + 31);
  // 2. Double-up: each carer's own clocks, one clock-out corrected.
  await visit("du", PAST, 9 * 60, { status: "COMPLETED", carers: 2 });
  await assign(ids.du!, staff[0]!, before(0));
  await assign(ids.du!, staff[2]!, before(0), { slot: "SECOND" });
  await clock(ids.du!, staff[0]!, "IN", PAST, 9 * 60);
  await clock(ids.du!, staff[2]!, "IN", PAST, 9 * 60 + 5);
  const wrong = await clock(ids.du!, staff[0]!, "OUT", PAST, 9 * 60 + 20);
  await clock(ids.du!, staff[0]!, "OUT", PAST, 9 * 60 + 30, wrong.id);
  await clock(ids.du!, staff[2]!, "OUT", PAST, 9 * 60 + 40);
  // 3. Missed, with an investigation. 4. Cancelled. 5. No record at all. 6. Attended, not completed. 7. Not delivered.
  await visit("mi", PAST, 10 * 60, { status: "MISSED" });
  await assign(ids.mi!, staff[0]!, before(0));
  await db.missedCallCase.create({ data: { organisationId: orgId, visitId: ids.mi!, staffId: staff[0]!, serviceUserId: suId, areaId, callTypeId, scheduledStart: londonToUtc(PAST, 600), stage: "INVESTIGATING", escalatedAt: new Date() } });
  await visit("ca", PAST, 11 * 60, { status: "CANCELLED" });
  await visit("nr", PAST, 12 * 60);
  await assign(ids.nr!, staff[1]!, before(0));
  await visit("ip", PAST, 13 * 60, { status: "IN_PROGRESS" });
  await assign(ids.ip!, staff[2]!, before(0));
  await clock(ids.ip!, staff[2]!, "IN", PAST, 13 * 60 + 2);
  await visit("nd", PAST, 14 * 60, { status: "NOT_DELIVERED" });
  await assign(ids.nd!, staff[1]!, before(0));

  // Upcoming: one single visit with nobody, one double-up with one carer.
  await visit("open", FUTURE, 10 * 60);
  await visit("half", FUTURE, 11 * 60, { carers: 2 });
  await assign(ids.half!, staff[0]!, new Date());
}, 240_000);

describe("Coverage History", () => {
  const period = () => parseCoverage({ range: "custom", from: PAST, to: PAST });

  it("reconciles the summary from real records, counting each visit once", async () => {
    const r = await coverageReport(await manager(), period());
    expect(r.summary).toMatchObject({ total: 7, attended: 3, completed: 2, uncovered: 3, missed: 1, notDelivered: 1, noRecord: 1, cancelled: 1, notDue: 0, reassigned: 1, late: 1 });
    expect(r.summary.attended + r.summary.uncovered + r.summary.cancelled + r.summary.notDue).toBe(r.summary.total);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.t.total).toBe(7);
  });

  it("keeps the original carer, the replacement and the late-cover flag apart", async () => {
    const r = await coverageReport(await manager(), { ...period(), view: "late" });
    expect(r.rows.map((x) => x.id)).toEqual([ids.re]);
    const row = r.rows[0]!;
    const names = new Map((await db.staffMember.findMany({ where: { id: { in: staff } } })).map((s) => [s.id, s.displayName]));
    expect(row.original).toEqual([names.get(staff[0]!)]);
    expect(row.current).toEqual([names.get(staff[1]!)]);
    expect(row.attendance.map((a) => a.name)).toEqual([names.get(staff[1]!)]);
    expect(row.lastReplacement).toMatchObject({ reason: "Sickness absence recorded", minutesBefore: 20 });
    // With a 15-minute threshold the same reassignment is not late.
    expect((await coverageReport(await manager(), { ...period(), view: "late", late: 15 })).rows).toHaveLength(0);
  });

  it("shows each double-up carer's own attendance, with the correction in force", async () => {
    const r = await coverageReport(await manager(), { ...period(), q: "T-du" });
    const row = r.rows.find((x) => x.id === ids.du)!;
    expect(row.attendance).toHaveLength(2);
    const first = row.attendance.find((a) => a.corrected)!;
    expect(first.out).not.toBeNull();
    expect(row.actualIn).not.toBeNull();
    expect(row.durationMin).toBe(40);
  });

  it("lists uncovered visits by their specific outcome with the investigation", async () => {
    const r = await coverageReport(await manager(), { ...period(), view: "uncovered" });
    expect(new Set(r.rows.map((x) => x.outcome))).toEqual(new Set(["MISSED", "NOT_DELIVERED", "NO_RECORD"]));
    expect(r.rows.find((x) => x.id === ids.mi)!.investigation).toMatchObject({ stage: "INVESTIGATING", escalated: true });
  });

  it("builds the replacement timeline from stored records only", async () => {
    const t = await coverageTimeline(await manager(), ids.re!);
    const titles = t.items.map((i) => i.title);
    expect(titles.some((x) => x.startsWith("Assigned:"))).toBe(true);
    expect(titles.some((x) => x.includes("removed from the visit"))).toBe(true);
    expect(titles.some((x) => x.startsWith("Replacement assigned:"))).toBe(true);
    expect(titles.filter((x) => x.includes("clocked"))).toHaveLength(2);
    expect(t.items.find((i) => i.title.includes("removed"))!.detail).toBe("Sickness absence recorded");
    const sorted = [...t.items].sort((a, b) => a.at.getTime() - b.at.getTime());
    expect(t.items).toEqual(sorted);
    const du = await coverageTimeline(await manager(), ids.du!);
    expect(du.items.some((i) => i.title.includes("later corrected"))).toBe(true);
  });

  it("compares branches for managers by the service user's branch", async () => {
    const r = await coverageReport(await manager(), period());
    expect(r.compare).not.toBeNull();
    expect(r.compare!.find((b) => b.id === branch["Tower Hamlets"])!.t.total).toBe(7);
    expect(r.compare!.find((b) => b.id === branch.Liverpool)!.t.total).toBe(0);
  });

  it("exports Excel and PDF with the same figures", async () => {
    const x = await exportCoverage(await manager(), { range: "custom", from: PAST, to: PAST }, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Daily", "Visits"]);
    const visits = wb.getWorksheet("Visits")!;
    const refs: string[] = [];
    visits.eachRow((r) => { const v = r.getCell(1).value; if (typeof v === "string" && v.startsWith("T-")) refs.push(v); });
    expect(refs).toHaveLength(7);
    const pdf = await exportCoverage(await manager(), { range: "custom", from: PAST, to: PAST }, "pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("never shows another branch's visits to a branch-limited coordinator, in the page or the export", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
    const c = await coordinator();
    const r = await coverageReport(c, period());
    expect(r.summary.total).toBe(0);
    expect(r.compare).toBeNull();
    // Choosing another branch in a hand-edited link matches nothing.
    expect((await coverageReport(c, { ...period(), branch: branch["Tower Hamlets"] })).summary.total).toBe(0);
    await expect(coverageTimeline(c, ids.re!)).rejects.toBeTruthy();
    const x = await exportCoverage(c, { range: "custom", from: PAST, to: PAST, branch: branch["Tower Hamlets"] }, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as unknown as ArrayBuffer);
    let leaked = 0;
    wb.getWorksheet("Visits")!.eachRow((r) => { const v = r.getCell(1).value; if (typeof v === "string" && v.startsWith("T-")) leaked++; });
    expect(leaked).toBe(0);
    await setMemberBranches(await manager(), m.id, []);
  });
});

describe("Unassigned Visits and Find Cover", () => {
  const f = () => parseUnassigned({ when: "custom", from: FUTURE, to: FUTURE });

  it("lists visits short of a carer once each, and counts empty places separately", async () => {
    const b = await unassignedBoard(await manager(), f());
    expect(b.all.map((i) => i.visit.id).sort()).toEqual([ids.open, ids.half].sort());
    expect(b.summary).toMatchObject({ visits: 2, partial: 1, slots: 2 });
    expect(b.all.find((i) => i.visit.id === ids.half)!.openSlots).toEqual(["SECOND"]);
    expect((await unassignedBoard(await manager(), { ...f(), staffing: "partial" })).all.map((i) => i.visit.id)).toEqual([ids.half]);
    expect((await unassignedBoard(await manager(), { ...f(), carers: "single" })).all.map((i) => i.visit.id)).toEqual([ids.open]);
  });

  it("recommends at most three carers the rules allow, and searches the same list by name", async () => {
    const o = (await coverOptions(await manager(), ids.open!))!;
    expect(o.slot).toBe("PRIMARY");
    expect(o.recommended.length).toBeGreaterThan(0);
    expect(o.recommended.length).toBeLessThanOrEqual(3);
    expect(o.recommended.every((c) => c.state !== "NOT_ELIGIBLE" && c.score !== null)).toBe(true);
    const someone = o.list[o.list.length - 1]!;
    const m = (await coverOptions(await manager(), ids.open!, { q: someone.name.slice(0, 5) }))!;
    expect(m.manual.some((c) => c.id === someone.id)).toBe(true);
    expect(m.manual.every((c) => c.name.toLowerCase().includes(someone.name.slice(0, 5).toLowerCase()))).toBe(true);
    // A carer who cannot do the visit is shown with the reason, never offered as a recommendation.
    const blocked = o.list.find((c) => c.state === "NOT_ELIGIBLE");
    if (blocked) {
      expect(blocked.reasons.length).toBeGreaterThan(0);
      expect(o.recommended.some((c) => c.id === blocked.id)).toBe(false);
    }
  });

  it("re-checks on review and refuses a stale visit version or an unseen warning", async () => {
    const mgr = await manager();
    const o = (await coverOptions(mgr, ids.open!))!;
    const pick = o.list.find((c) => c.state === "REQUIRES_REVIEW") ?? o.recommended[0]!;
    const review = (await coverOptions(mgr, ids.open!, { pick: pick.id }))!;
    expect(review.pick?.candidate.id).toBe(pick.id);
    expect(review.pick!.checks.length).toBeGreaterThan(5);
    await expect(assignCarer(mgr, { visitId: ids.open!, slot: "PRIMARY", staffId: pick.id, acceptWarnings: true, acceptedWarnings: review.pick!.result.warnings.map((w) => w.message), lockVersion: o.visit.lockVersion - 1 })).rejects.toBeInstanceOf(ConflictError);
    if (review.pick!.result.warnings.length) {
      await expect(assignCarer(mgr, { visitId: ids.open!, slot: "PRIMARY", staffId: pick.id, acceptWarnings: true, acceptedWarnings: [], lockVersion: o.visit.lockVersion })).rejects.toThrow(/New warning/);
    }
    const a = await assignCarer(mgr, { visitId: ids.open!, slot: "PRIMARY", staffId: pick.id, acceptWarnings: true, acceptedWarnings: review.pick!.result.warnings.map((w) => w.message), lockVersion: o.visit.lockVersion }, "find-cover");
    expect(a.assignedById).toBe(managerId);
    const ev = await db.visitEvent.findFirstOrThrow({ where: { visitId: ids.open, type: "ASSIGNED" } });
    expect(ev.data).toMatchObject({ source: "find-cover", staffId: pick.id });
    // The Daily Rota reads the same record at once, and the visit leaves the unassigned list.
    const day = await listVisits(mgr, { date: FUTURE });
    expect(day.rows.find((v) => v.id === ids.open)!.assignments.map((x) => x.staffId)).toEqual([pick.id]);
    expect((await unassignedBoard(mgr, f())).all.map((i) => i.visit.id)).toEqual([ids.half]);
  });

  it("fills the missing double-up place and keeps the existing carer; the same person cannot take both places", async () => {
    const mgr = await manager();
    const o = (await coverOptions(mgr, ids.half!))!;
    expect(o.slot).toBe("SECOND");
    const same = o.list.find((c) => c.id === staff[0]);
    expect(same === undefined || same.state === "NOT_ELIGIBLE").toBe(true);
    await expect(assignCarer(mgr, { visitId: ids.half!, slot: "SECOND", staffId: staff[0]!, acceptWarnings: true, lockVersion: o.visit.lockVersion })).rejects.toThrow();
    const pick = o.recommended[0]!;
    await assignCarer(mgr, { visitId: ids.half!, slot: "SECOND", staffId: pick.id, acceptWarnings: true, acceptedWarnings: pick.reasons.length ? (await coverOptions(mgr, ids.half!, { pick: pick.id }))!.pick!.result.warnings.map((w) => w.message) : [], lockVersion: o.visit.lockVersion });
    const live = await db.visitAssignment.findMany({ where: { visitId: ids.half, removedAt: null }, orderBy: { slot: "asc" } });
    expect(live.map((a) => [a.slot, a.staffId])).toEqual([["PRIMARY", staff[0]], ["SECOND", pick.id]]);
  });

  it("keeps a branch-limited coordinator out of other branches' visits and staff", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await setMemberBranches(await manager(), m.id, [branch.Liverpool!]);
    const c = await coordinator();
    const extra = await visit("lpl", FUTURE, 15 * 60);
    expect((await unassignedBoard(c, f())).all.some((i) => i.visit.id === extra.id)).toBe(false);
    expect(await coverOptions(c, extra.id)).toBeNull();
    await expect(assignCarer(c, { visitId: extra.id, slot: "PRIMARY", staffId: staff[1]! })).rejects.toBeInstanceOf(Error);
    const liverpoolVisit = await db.visit.findFirst({ where: { organisationId: orgId, serviceUser: { branchId: branch.Liverpool }, status: "SCHEDULED", scheduledStart: { gt: new Date() } } });
    if (liverpoolVisit) await expect(assignCarer(c, { visitId: liverpoolVisit.id, slot: "SHADOW", staffId: staff[1]! })).rejects.toBeInstanceOf(ForbiddenError);
    await setMemberBranches(await manager(), m.id, []);
  });
});

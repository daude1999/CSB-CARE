import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, londonDayBounds } from "@/lib/london";
import { addVisitNote, listVisitNotes, recordTaskOutcomes } from "@/server/care/visit-record";
import { myVisits } from "@/server/rota/carer";
import { clockMine } from "@/server/rota/attendance";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Task outcomes and visit notes against a real database: the carer's own visit only, once per task, append-only. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ameliaId = "";
const MIN = 60_000;
function at(d: Date, minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(d.getTime() + minutes * MIN));
}
async function ameliaVisitWithTasks(skip = 0) {
  return db.visit.findFirstOrThrow({
    where: { organisationId: orgId, status: "SCHEDULED", publishedAt: { not: null }, scheduledStart: { gt: new Date(Date.now() + 2 * 86400_000) }, tasks: { some: {} }, assignments: { some: { staffId: ameliaId, removedAt: null } } },
    include: { tasks: true },
    orderBy: { scheduledStart: "asc" },
    skip,
  });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
}, 180_000);

afterEach(() => {
  vi.useRealTimers();
});

describe("task outcomes", () => {
  it("needs a clock-in, a reason for anything not done, and records each task once", async () => {
    const v = await ameliaVisitWithTasks();
    const me = await carer();
    const [t1, t2] = v.tasks;
    at(v.scheduledStart, 1);
    await expect(recordTaskOutcomes(me, v.id, [{ visitTaskId: t1!.id, outcome: "DONE" }])).rejects.toThrow(/Clock in/);
    await clockMine(me, v.id, "IN", { nonce: `vr-${v.id}` });
    if (t2) await expect(recordTaskOutcomes(me, v.id, [{ visitTaskId: t2.id, outcome: "REFUSED" }])).rejects.toBeInstanceOf(ValidationError);
    const rows = [{ visitTaskId: t1!.id, outcome: "DONE" as const }, ...(t2 ? [{ visitTaskId: t2.id, outcome: "REFUSED" as const, note: "Declined a shower today" }] : [])];
    expect((await recordTaskOutcomes(me, v.id, rows)).recorded).toBe(rows.length);
    await expect(recordTaskOutcomes(me, v.id, rows)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.visitTaskOutcome.count({ where: { visitId: v.id } })).toBe(rows.length);
    // Outcomes are permanent: the database refuses an edit.
    const o = await db.visitTaskOutcome.findFirstOrThrow({ where: { visitId: v.id } });
    await expect(db.visitTaskOutcome.update({ where: { id: o.id }, data: { outcome: "NOT_DONE" } })).rejects.toThrow();
    // And a second row for the same task and carer is refused by the database too.
    await expect(db.visitTaskOutcome.create({ data: { organisationId: orgId, visitId: v.id, visitTaskId: t1!.id, outcome: "DONE", staffId: ameliaId, recordedById: me.userId } })).rejects.toThrow();
    const mine = (await myVisits(me)).visits.find((x) => x.id === v.id)!;
    expect(mine.tasks.find((t) => t.id === t1!.id)?.outcomes[0]?.outcome).toBe("DONE");
  });

  it("refuses tasks from another visit and visits the carer is not on", async () => {
    const v = await ameliaVisitWithTasks(1);
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, tasks: { some: {} }, assignments: { none: { staffId: ameliaId } } }, include: { tasks: true } });
    const me = await carer();
    await expect(recordTaskOutcomes(me, other.id, [{ visitTaskId: other.tasks[0]!.id, outcome: "DONE" }])).rejects.toBeInstanceOf(NotFoundError);
    at(v.scheduledStart, 1);
    await clockMine(me, v.id, "IN", { nonce: `vr2-${v.id}` });
    await expect(recordTaskOutcomes(me, v.id, [{ visitTaskId: other.tasks[0]!.id, outcome: "DONE" }])).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("visit notes", () => {
  it("lets the carer and the office write notes; a concern raises an exception for the office", async () => {
    const v = await ameliaVisitWithTasks(2);
    await addVisitNote(await carer(), v.id, { text: "Key safe sticks; push the door hard", category: "HANDOVER" });
    const concern = await addVisitNote(await carer(), v.id, { text: "Bruise on left arm, says she fell", category: "CONCERN" });
    await addVisitNote(await coordinator(), v.id, { text: "Daughter rang to confirm the time", category: "GENERAL" });
    await expect(addVisitNote(await carer(), v.id, { text: "x" })).rejects.toBeInstanceOf(ValidationError);
    const alert = await db.rotaAlert.findUniqueOrThrow({ where: { dedupeKey: `concern:${concern.id}` } });
    expect(alert.kind).toBe("CONCERN");
    expect(alert.deadline).not.toBeNull();
    await expect(db.visitNote.update({ where: { id: concern.id }, data: { text: "changed" } })).rejects.toThrow();
    // The handover note shows on the carer's next visits to the same person.
    expect((await myVisits(await carer())).lastHandover.get(v.serviceUserId)?.text).toMatch(/Key safe/);
    const today = londonDate();
    const listed = await listVisitNotes(await coordinator(), { from: londonDayBounds(addDays(today, -1)).start, to: londonDayBounds(today).end, category: "CONCERN" });
    expect(listed.some((n) => n.id === concern.id)).toBe(true);
    expect(listed.every((n) => n.category === "CONCERN")).toBe(true);
  });

  it("does not let a carer write on a visit they are not booked on", async () => {
    const other = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, assignments: { none: { staffId: ameliaId } } } });
    await expect(addVisitNote(await carer(), other.id, { text: "Not my visit at all" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

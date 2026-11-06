import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { acknowledgeInstructions, instructionChange, instructionHistory, myInstructionChanges } from "@/server/care/instructions";
import { updateTemplate } from "@/server/rota/templates";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Carer instruction versions (phase 9): every change kept, carers confirm a change, done visits never rewritten. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ameliaId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  ameliaId = (await myStaff(await carer())).id;
}, 180_000);
afterEach(() => vi.useRealTimers());

describe("instructionChange", () => {
  it("says what changed in plain words, or nothing", () => {
    expect(instructionChange({ notes: "Key safe 1234", tasks: ["Wash"] }, { notes: "Key safe 1234", tasks: ["Wash"] })).toBeNull();
    expect(instructionChange({ notes: null, tasks: ["Wash"] }, { notes: "Use the back door", tasks: ["Wash", "Make tea"] })).toBe("Task added: Make tea. Visit notes changed.");
  });
});

describe("carer instruction versions", () => {
  it("keeps each change as a version, asks booked carers to confirm, and never rewrites visits already done", async () => {
    const c = await coordinator();
    const visit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, templateId: { not: null }, date: { gte: new Date(Date.now() + 86400_000) }, assignments: { some: { staffId: ameliaId, removedAt: null } } }, orderBy: { date: "asc" } });
    const t = await db.visitTemplate.findUniqueOrThrow({ where: { id: visit.templateId! }, include: { tasks: true } });
    const done = await db.visit.findFirst({ where: { templateId: t.id, status: "COMPLETED" }, include: { tasks: true } });
    const doneTasks = done?.tasks.map((x) => x.name).sort() ?? null;
    expect(await myInstructionChanges(await carer())).toEqual([]);
    await updateTemplate(c, t.id, t.version, { serviceUserId: t.serviceUserId, callTypeId: t.callTypeId, areaId: t.areaId, cycleWeeks: t.cycleWeeks, weekdays: t.weekdays, startMinute: t.startMinute, durationMin: t.durationMin, carersRequired: t.carersRequired, preferredStaff1Id: t.preferredStaff1Id, preferredStaff2Id: t.preferredStaff2Id, medicationRequired: t.medicationRequired, effectiveFrom: t.effectiveFrom.toISOString().slice(0, 10), effectiveTo: t.effectiveTo?.toISOString().slice(0, 10) ?? null, taskIds: t.tasks.map((x) => x.careTaskId), runRouteTemplateId: t.runRouteTemplateId, rotaType: t.rotaType, timeLocked: t.timeLocked, alertOnLate: t.alertOnLate, notes: "From Monday: use the side door; the key safe has moved." });
    const versions = await db.careInstructionVersion.findMany({ where: { templateId: t.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1]!.changeSummary).toBe("Visit notes changed.");
    // The carer booked on it is asked to confirm, once.
    const mine = await myInstructionChanges(await carer());
    expect(mine.map((m) => m.id)).toEqual([versions[1]!.id]);
    expect(mine[0]!.notes).toMatch(/side door/);
    let h = await instructionHistory(c, t.id);
    expect(h[0]!.waiting.length).toBeGreaterThan(0);
    await acknowledgeInstructions(await carer(), versions[1]!.id);
    expect(await myInstructionChanges(await carer())).toEqual([]);
    expect((await acknowledgeInstructions(await carer(), versions[1]!.id)).already).toBe(true);
    h = await instructionHistory(c, t.id);
    expect(h[0]!.confirmed.length).toBe(1);
    // Acknowledgements are history; a carer cannot confirm instructions for someone they are not booked with.
    const ack = await db.careInstructionAck.findFirstOrThrow({ where: { versionId: versions[1]!.id } });
    await expect(db.careInstructionAck.update({ where: { id: ack.id }, data: { userId: "x" } })).rejects.toThrow();
    const other = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: orgId, id: { not: t.id }, visits: { none: { assignments: { some: { staffId: ameliaId } } } } } });
    const otherVersion = await db.careInstructionVersion.create({ data: { organisationId: orgId, serviceUserId: other.serviceUserId, templateId: other.id, version: 1, tasks: [], changeSummary: "First instructions for this visit.", effectiveFrom: new Date(), createdById: c.userId } });
    await expect(acknowledgeInstructions(await carer(), otherVersion.id)).rejects.toBeInstanceOf(NotFoundError);
    // A completed visit keeps the tasks it had.
    if (done) expect((await db.visit.findUniqueOrThrow({ where: { id: done.id }, include: { tasks: true } })).tasks.map((x) => x.name).sort()).toEqual(doneTasks);
  });
});

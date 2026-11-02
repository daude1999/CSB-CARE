import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/auth/current", () => ({ getCtx: vi.fn(async () => authMock.ctx), requireCtx: vi.fn(async () => authMock.ctx) }));
import { db } from "@/lib/db";
import { read } from "@/hr/lib/workspace-tx";
import { GET as hrHubGet, POST as hrHubPost } from "@/app/api/hr/hub/route";
import { staffReadinessCheck } from "@/server/workforce/staff-check";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Assign Training and Send Reminder through the HR Hub's own API, as the Checks & Training page calls it: what is
 * stored, what reaches the bell, what never leaves CSB, and what is refused.
 */
let orgId = "";
let carerUserId = "";
let linkedHrId = "";

const post = (body: unknown) =>
  hrHubPost(new Request("http://localhost/api/hr/hub", { method: "POST", headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }));
const hub = async () => (await (await hrHubGet(new Request("http://localhost/api/hr/hub"))).json()) as { signIns: string[]; trainingAssignments: { employee: string; status: string; course: string }[]; employees: { id: string; status: string; name: string }[] };

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const linked = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, userId: { not: null } } });
  carerUserId = linked.userId!;
  linkedHrId = linked.hrEmployeeId;
  authMock.ctx = await ctxFor("manager@care-solution.demo", BROOKFIELD);
}, 180_000);

describe("Assign Training and Send Reminder", () => {
  it("tells the page who has a linked CSB sign-in, by HR id only", async () => {
    const data = await hub();
    expect(data.signIns).toContain(linkedHrId);
    expect(data.signIns.length).toBe(await db.staffMember.count({ where: { organisationId: orgId, userId: { not: null } } }));
  });

  it("assigns a course without changing checks or rota readiness", async () => {
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrEmployeeId: linkedHrId } });
    const before = await staffReadinessCheck(orgId, staff.id);
    const checksBefore = JSON.stringify((await read(orgId)).checks);
    const due = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
    const res = await post({ action: "assign-training", assignment: { employees: [linkedHrId], course: "Dementia awareness", due, assignedTo: "", note: "Booked" } });
    expect(res.status).toBe(200);
    expect((await res.json()).assigned).toHaveLength(1);
    const s = await read(orgId);
    expect(JSON.stringify(s.checks)).toBe(checksBefore);
    expect(s.trainingAssignments!.filter((a) => a.employee === linkedHrId && a.status === "Open")).toHaveLength(1);
    expect(s.tasks!.some((t) => t.employee === linkedHrId && t.type === "Complete training: Dementia awareness")).toBe(true);
    expect((await staffReadinessCheck(orgId, staff.id)).state).toBe(before.state);
    expect((await hub()).trainingAssignments.some((a) => a.employee === linkedHrId && a.course === "Dementia awareness")).toBe(true);
  });

  it("validates input: no people, past date, a missing course", async () => {
    expect((await post({ action: "assign-training", assignment: { employees: [], course: "Fire", due: "2030-01-01" } })).status).toBe(400);
    expect((await post({ action: "assign-training", assignment: { employees: [linkedHrId], course: "Fire safety", due: "2020-01-01" } })).status).toBe(400);
    expect((await post({ action: "assign-training", assignment: { employees: [linkedHrId], course: "", due: "2030-01-01" } })).status).toBe(400);
    expect((await post({ action: "assign-training", assignment: { employees: ["not-a-person"], course: "Fire safety", due: "2030-01-01" } })).status).toBe(404);
  });

  it("sends an in-app reminder to a linked person only, with no e-mail, once a day", async () => {
    const data = await hub();
    const unlinked = data.employees.find((e) => e.status !== "Archived" && !data.signIns.includes(e.id))!;
    const res = await post({ action: "training-reminder", employees: [linkedHrId, unlinked.id] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: string[]; skipped: { name: string; reason: string }[] };
    expect(body.sent).toHaveLength(1);
    expect(body.skipped.map((x) => x.name)).toContain(unlinked.name);
    const notes = await db.notification.findMany({ where: { userId: carerUserId, type: "hr.training_reminder" }, include: { deliveries: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0].organisationId).toBe(orgId);
    expect(notes[0].body).toContain("Dementia awareness");
    expect(notes[0].deliveries).toHaveLength(0);
    expect(await db.backgroundJob.count({ where: { type: "notification.deliver", idempotencyKey: { contains: notes[0].id } } })).toBe(0);
    const again = (await (await post({ action: "training-reminder", employees: [linkedHrId] })).json()) as { sent: string[]; skipped: { reason: string }[] };
    expect(again.sent).toHaveLength(0);
    expect(again.skipped[0].reason).toBe("already reminded today");
    expect(await db.notification.count({ where: { userId: carerUserId, type: "hr.training_reminder" } })).toBe(1);
    expect((await read(orgId)).events.some((e) => e.employee === linkedHrId && e.action.startsWith("Training reminder sent"))).toBe(true);
  });

  it("refuses staff without HR access, and closes an assignment from the record", async () => {
    authMock.ctx = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    expect((await post({ action: "training-reminder", employees: [linkedHrId] })).status).toBe(403);
    authMock.ctx = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const a = (await read(orgId)).trainingAssignments!.find((x) => x.employee === linkedHrId && x.status === "Open")!;
    expect((await post({ action: "close-training", id: a.id, version: a.version, outcome: "Completed" })).status).toBe(200);
    expect((await post({ action: "close-training", id: a.id, version: a.version, outcome: "Completed" })).status).toBe(409);
    const s = await read(orgId);
    expect(s.trainingAssignments!.find((x) => x.id === a.id)!.status).toBe("Completed");
    expect(s.tasks!.find((t) => t.id === a.task)!.status).toBe("Complete");
  });
});

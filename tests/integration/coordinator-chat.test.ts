import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/auth/current", () => ({ getCtx: vi.fn(async () => authMock.ctx), requireCtx: vi.fn(async () => authMock.ctx) }));
import { db } from "@/lib/db";
import { addDays, dbDate, fmtLondonDate, londonDate } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { serviceUserChatContext } from "@/server/care/coordinator/chat";
import { createIntake } from "@/server/care/coordinator/intake";
import { topicOf } from "@/server/care/coordinator/crm-assistant";
import { askCsbCoordinator } from "@/app/csb-coordinator-chat-actions";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * AI CSB Coordinator chat, built-in CRM search (owner's decision, 5 Nov 2026): no AI provider and nothing online.
 * Answers come from the organisation's own records within the employee's access; other organisations' people never
 * appear; nothing is written except the usage audit, which never stores the question.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ownSu = { id: "", reference: "", lastName: "" };
let otherSu = { id: "", reference: "", lastName: "" };
const ask = (question: string, path = "/overview", intakeId: string | null = null) => askCsbCoordinator({ question, intakeId, path, history: [] });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  // No AI provider at all: the built-in search must not need one.
  setAiProviderForTests(null);
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const other = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
  ownSu = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" }, select: { id: true, reference: true, lastName: true } });
  // Synthetic records in another organisation, which must never reach this organisation's chat.
  otherSu = await db.serviceUser.create({ data: { organisationId: other, reference: "SYN-OTHER-01", firstName: "Synthetic", lastName: "Elsewhereton", status: "ACTIVE" }, select: { id: true, reference: true, lastName: true } });
  const m = await manager();
  const yesterday = dbDate(addDays(londonDate(), -1));
  await db.riskAssessment.create({ data: { organisationId: orgId, serviceUserId: ownSu.id, type: "FALLS", title: "Synthetic overdue falls review", hazards: "Synthetic", controls: "Synthetic", level: "HIGH", reviewDue: yesterday, assessedById: m.userId } });
  await db.riskAssessment.create({ data: { organisationId: other, serviceUserId: otherSu.id, type: "FALLS", title: "Other organisation risk", hazards: "Synthetic", controls: "Synthetic", level: "HIGH", reviewDue: yesterday, assessedById: m.userId } });
}, 180_000);

describe("topicOf", () => {
  it("recognises the common office questions", () => {
    const page = { kind: "overview" as const, id: null };
    expect(topicOf("Can you help me upload this council support plan?", page)).toBe("upload");
    expect(topicOf("Which risk assessments still need reviewing?", page)).toBe("risks");
    expect(topicOf("Is this care package ready for rota generation?", page)).toBe("rota-ready");
    expect(topicOf("What is the next step to finish this intake?", { kind: "intake", id: "x" })).toBe("intake");
    expect(topicOf("How do I prepare a rota for this service user?", page)).toBe("rota-how");
    expect(topicOf("Which care plans are awaiting approval?", page)).toBe("care-plans");
    expect(topicOf("How many visits need a carer?", page)).toBe("unassigned");
    expect(topicOf("find Smith", page)).toBe("find");
    expect(topicOf("hello", page)).toBe("help");
  });
});

describe("askCsbCoordinator (built-in CRM search)", () => {
  it("lists overdue risk reviews from this organisation only, and audits without the question", async () => {
    authMock.ctx = await manager();
    const r = await ask("Which risk assessments still need reviewing?");
    expect(r.topic).toBe("risks");
    expect(r.answer).toContain("Synthetic overdue falls review");
    expect(r.answer).not.toContain("Other organisation risk");
    expect(r.links.map((l) => l.href)).toContain("/rota/risks?due=overdue");
    const log = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "coordinator.chat.asked" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(log.data)).not.toContain("risk assessments still");
  });

  it("finds people by name within the organisation, never in another", async () => {
    authMock.ctx = await manager();
    const own = await ask(`find ${ownSu.lastName}`);
    expect(own.links.some((l) => l.href === `/rota/service-users/${ownSu.id}`)).toBe(true);
    const other = await ask(`find ${otherSu.lastName}`);
    expect(other.links.some((l) => l.href.includes(otherSu.id))).toBe(false);
    expect(other.answer).toMatch(/No service user you can see/);
  });

  it("uses the service user open on the page, and refuses one from another organisation", async () => {
    authMock.ctx = await manager();
    const own = await ask("Is this care package ready for rota generation?", `/rota/service-users/${ownSu.id}`);
    expect(own.topic).toBe("rota-ready");
    expect(own.answer).toMatch(/ready (to build the rota|for rota generation yet)/);
    const other = await ask("Is this care package ready for rota generation?", `/rota/service-users/${otherSu.id}`);
    expect(other.answer).not.toContain(otherSu.lastName);
    expect(other.answer).toMatch(/can't see those records/);
    expect(await serviceUserChatContext(await manager(), otherSu.id)).toBeNull();
  });

  it("gives the next step for the intake open on the page", async () => {
    const m = await manager();
    authMock.ctx = m;
    const intake = await createIntake(m, { title: "Synthetic referral for chat" });
    const r = await ask("What is the next step to finish this intake?", `/rota/coordinator/${intake.id}`);
    expect(r.answer).toContain(intake.reference);
    expect(r.answer).toMatch(/Next step: Upload the support plan/);
  });

  it("answers counts for care plans and unassigned visits, with links to the screens", async () => {
    authMock.ctx = await manager();
    const plans = await ask("Which care plans are awaiting approval?");
    expect(plans.answer).toMatch(/awaiting approval/);
    expect(plans.links[0]?.href).toBe("/rota/care-plans?show=review");
    const visits = await ask("How many visits need a carer?");
    expect(visits.links.map((l) => l.href)).toContain("/rota/unassigned");
  });

  it("explains what it can answer when it does not recognise the question", async () => {
    authMock.ctx = await manager();
    expect((await ask("What's the weather like?")).answer).toMatch(/from your CRM records only/);
  });

  it("refuses employees without the Care Coordinator permission, and invalid input", async () => {
    authMock.ctx = await carer();
    await expect(ask("Hello there")).rejects.toThrow();
    authMock.ctx = await manager();
    await expect(ask("x")).rejects.toThrow();
  });
});

describe("askCsbCoordinator: P0 questions (no key)", () => {
  it("recognises the new questions", () => {
    expect(topicOf("Who is unavailable tomorrow?", { kind: "rota", id: null })).toBe("unavailable");
    expect(topicOf("Why can't Sam be booked?", { kind: "visit", id: "x" })).toBe("why-not");
    expect(topicOf("What is missing from this care package?", { kind: "service-user", id: "x" })).toBe("package-gaps");
    expect(topicOf("Which visits are unassigned tomorrow?", { kind: "rota", id: null })).toBe("unassigned");
  });

  it("lists staff absences for tomorrow in this organisation only, and why an absent carer cannot be booked", async () => {
    const m = await manager();
    authMock.ctx = m;
    const tomorrow = addDays(londonDate(), 1);
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrMissing: false, employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" } });
    const otherOrg = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
    const otherStaff = await db.staffMember.findFirst({ where: { organisationId: otherOrg } });
    const day = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00Z`);
    await db.staffAbsence.create({ data: { organisationId: orgId, staffId: staff.id, kind: "SICKNESS", status: "APPROVED", startsAt: day(tomorrow, 0), endsAt: day(addDays(tomorrow, 1), 0), requestedById: m.userId } });
    if (otherStaff) await db.staffAbsence.create({ data: { organisationId: otherOrg, staffId: otherStaff.id, kind: "HOLIDAY", status: "APPROVED", startsAt: day(tomorrow, 0), endsAt: day(addDays(tomorrow, 1), 0), requestedById: m.userId } });
    const r = await ask("Who is unavailable tomorrow?", "/rota");
    expect(r.answer).toContain(`${staff.displayName} (${staff.jobTitle}): sickness`);
    expect(r.answer).toContain(`last day ${fmtLondonDate(tomorrow)}`);
    expect(r.answer).toMatch(/sickness/);
    if (otherStaff) expect(r.answer).not.toContain(otherStaff.displayName);
    expect(r.answer).toMatch(/nobody is moved automatically/);

    const visit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, date: dbDate(tomorrow), status: "SCHEDULED" } });
    const absences = await db.staffAbsence.count();
    const assignments = await db.visitAssignment.count();
    const why = await ask(`Why can't ${staff.displayName} be booked?`, `/rota/visits/${visit.id}`);
    expect(why.answer).toMatch(/cannot be booked on this visit/);
    expect(why.answer).toMatch(/I don't book anyone/);
    expect(why.links[0]?.href).toBe(`/rota/visits/${visit.id}`);
    // Read only.
    expect([await db.staffAbsence.count(), await db.visitAssignment.count()]).toEqual([absences, assignments]);
    // Off a visit page it points to the right screen instead of guessing.
    expect((await ask(`Why can't ${staff.displayName} be booked?`, "/rota")).answer).toMatch(/Open the visit/);
  });

  it("says what is missing from the care package on the person's page, and refuses another organisation's person", async () => {
    authMock.ctx = await manager();
    const r = await ask("What is missing from this care package?", `/rota/service-users/${ownSu.id}`);
    expect(r.answer).toMatch(/active care package|no active care package/);
    expect(r.links[0]?.href).toBe(`/rota/service-users/${ownSu.id}?tab=package`);
    const other = await ask("What is missing from this care package?", `/rota/service-users/${otherSu.id}`);
    expect(other.answer).toMatch(/can't see those records/);
  });

  it("answers unassigned visits for tomorrow", async () => {
    authMock.ctx = await manager();
    const r = await ask("Which visits are unassigned tomorrow?", "/rota");
    expect(r.answer).toMatch(/tomorrow/);
    expect(r.links.map((l) => l.href)).toContain("/rota/unassigned");
  });
});

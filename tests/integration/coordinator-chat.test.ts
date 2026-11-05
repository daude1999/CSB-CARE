import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/auth/current", () => ({ getCtx: vi.fn(async () => authMock.ctx), requireCtx: vi.fn(async () => authMock.ctx) }));
import { db } from "@/lib/db";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { AiUnavailableError, type CoordinatorChatInput, type LlmProvider } from "@/server/ai/provider";
import { coordinatorChatStatus, serviceUserChatContext } from "@/server/care/coordinator/chat";
import { setCoordinatorAi } from "@/server/care/coordinator/intake";
import { askCsbCoordinator } from "@/app/csb-coordinator-chat-actions";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * AI CSB Coordinator chat: the floating panel's server action. It is only "online" when the organisation has switched
 * AI on and a real provider is configured; the page context is re-checked against the employee's own access; failures
 * are reported plainly; nothing is written except the usage audit entry.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let ownSu = { id: "", reference: "" };
let otherSu = { id: "", reference: "", lastName: "" };

/** A stand-in for the Anthropic provider: real conversation support, records what it was given. */
function fakeProvider(answer: (i: CoordinatorChatInput) => Promise<string>): LlmProvider & { calls: CoordinatorChatInput[] } {
  const base = new SimulatedProvider();
  const calls: CoordinatorChatInput[] = [];
  return Object.assign(Object.create(base), { name: "fake", isSimulated: false, calls, coordinateChat: async (i: CoordinatorChatInput) => { calls.push(i); return answer(i); } });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const other = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
  ownSu = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId }, select: { id: true, reference: true } });
  // A synthetic person in another organisation, who must never reach this organisation's chat.
  otherSu = await db.serviceUser.create({ data: { organisationId: other, reference: "SYN-OTHER-01", firstName: "Synthetic", lastName: "Elsewhere", status: "ACTIVE" }, select: { id: true, reference: true, lastName: true } });
}, 180_000);

afterAll(() => setAiProviderForTests(undefined));

describe("status", () => {
  it("is not online until the organisation switches AI on", async () => {
    setAiProviderForTests(fakeProvider(async () => "hi"));
    await db.rotaSettings.updateMany({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    expect(await coordinatorChatStatus(orgId)).toEqual({ online: false, reason: "not-enabled" });
  });
  it("never counts the simulated provider, or no provider, as online", async () => {
    // Switched on the way a manager does it in Rota Settings.
    await setCoordinatorAi(await manager(), true, "Synthetic test: data protection review recorded for the test organisation.");
    setAiProviderForTests(new SimulatedProvider());
    expect(await coordinatorChatStatus(orgId)).toEqual({ online: false, reason: "no-provider" });
    setAiProviderForTests(null);
    expect(await coordinatorChatStatus(orgId)).toEqual({ online: false, reason: "no-provider" });
    setAiProviderForTests(fakeProvider(async () => "hi"));
    expect(await coordinatorChatStatus(orgId)).toEqual({ online: true });
  });
});

describe("askCsbCoordinator", () => {
  it("answers through the configured provider and audits the question without its text", async () => {
    const p = fakeProvider(async () => "Open the Care Coordinator and upload the plan.");
    setAiProviderForTests(p);
    authMock.ctx = await manager();
    const before = await db.auditLog.count({ where: { organisationId: orgId, action: "coordinator.chat.asked" } });
    const r = await askCsbCoordinator({ question: "How do I upload a council support plan?", intakeId: null, path: "/overview", history: [] });
    expect(r).toMatchObject({ status: "answered", answer: "Open the Care Coordinator and upload the plan." });
    expect(JSON.parse(p.calls[0]!.caseContext)).toMatchObject({ page: "overview" });
    const log = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "coordinator.chat.asked" }, orderBy: { createdAt: "desc" } });
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "coordinator.chat.asked" } })).toBe(before + 1);
    expect(JSON.stringify(log.data)).not.toContain("council support plan");
  });

  it("uses the service user open on the page, checked against the employee's own organisation", async () => {
    const p = fakeProvider(async () => "ok");
    setAiProviderForTests(p);
    authMock.ctx = await manager();
    const own = await askCsbCoordinator({ question: "What is missing from this care plan?", intakeId: null, path: `/rota/service-users/${ownSu.id}`, history: [] });
    expect(own.caseUrl).toBe(`/rota/service-users/${ownSu.id}`);
    const ctx = JSON.parse(p.calls[0]!.caseContext);
    expect(ctx).toMatchObject({ page: "service-user", serviceUser: { reference: ownSu.reference } });
    expect(Object.keys(ctx)).not.toContain("medication");

    const other = await askCsbCoordinator({ question: "Tell me about this person", intakeId: null, path: `/rota/service-users/${otherSu.id}`, history: [] });
    expect(other.caseUrl).toBeNull();
    const leaked = p.calls[1]!.caseContext;
    expect(leaked).not.toContain(otherSu.reference);
    expect(leaked).not.toContain(otherSu.lastName);
    expect(await serviceUserChatContext(await manager(), otherSu.id)).toBeNull();
  });

  it("reports a provider failure plainly and changes nothing", async () => {
    setAiProviderForTests(fakeProvider(async () => { throw new AiUnavailableError("down"); }));
    authMock.ctx = await manager();
    const r = await askCsbCoordinator({ question: "Is this package ready for rota generation?", intakeId: null, path: "/rota", history: [] });
    expect(r.status).toBe("unavailable");
    expect(r.answer).toMatch(/temporarily unavailable/);
  });

  it("says so, without calling the model, when AI is not switched on", async () => {
    const p = fakeProvider(async () => "should not be called");
    setAiProviderForTests(p);
    await db.rotaSettings.updateMany({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    authMock.ctx = await manager();
    const r = await askCsbCoordinator({ question: "Hello there", intakeId: null, path: "/overview", history: [] });
    expect(r.status).toBe("not-enabled");
    expect(p.calls).toHaveLength(0);
  });

  it("refuses employees without the Care Coordinator permission", async () => {
    authMock.ctx = await carer();
    await expect(askCsbCoordinator({ question: "Hello there", intakeId: null, path: "/overview", history: [] })).rejects.toThrow();
  });

  it("rejects invalid input", async () => {
    authMock.ctx = await manager();
    await expect(askCsbCoordinator({ question: "x", intakeId: null, history: [] })).rejects.toThrow();
  });
});

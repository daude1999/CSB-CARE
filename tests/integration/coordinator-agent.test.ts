import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/auth/current", () => ({ getCtx: vi.fn(async () => authMock.ctx), requireCtx: vi.fn(async () => authMock.ctx) }));
import { db } from "@/lib/db";
import { setAiProviderForTests } from "@/server/ai";
import { AiUnavailableError, type CoordinatorAgentInput, type LlmProvider } from "@/server/ai/provider";
import { SimulatedProvider } from "@/server/ai/simulated";
import { LIMITS, coordinatorAiUsage, estimateCostUsd } from "@/server/care/coordinator/agent";
import { TOOL_NAMES, executeTool, type ToolState } from "@/server/care/coordinator/agent-tools";
import { uploadFromChat } from "@/server/care/coordinator/chat-upload";
import { createIntake } from "@/server/care/coordinator/intake";
import type { IntakeDigest } from "@/server/care/coordinator/intake-digest";
import { askCsbCoordinator } from "@/app/csb-coordinator-chat-actions";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanCardsPdf } from "../support/coordinator-fixture";

/**
 * AI CSB Coordinator with Claude (owner's brief, 5 Nov 2026), tested with a scripted provider in place of the API so
 * nothing goes online and no key is needed. The scripted "model" calls the real tools through the real executor, so
 * permissions, tenancy, the reading pipeline and the database are all real. Every document is fictional.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

let orgId = "";
type Script = (input: CoordinatorAgentInput) => Promise<string>;
let script: Script = async () => "Hello! I can help with support plans, care plans, risks and rotas.";
const seen: CoordinatorAgentInput[] = [];

/** Behaves like the Anthropic provider's agent loop, minus the network: the script decides which tools to call. */
class ScriptedProvider extends SimulatedProvider implements LlmProvider {
  override name = "anthropic:claude-opus-5-5";
  override isSimulated = false;
  async runCoordinatorAgent(input: CoordinatorAgentInput) {
    seen.push(input);
    const text = await script(input);
    return { text, model: "claude-opus-5-5", usage: { requests: 2, inputTokens: 3000, outputTokens: 400, cacheReadTokens: 1500, cacheWriteTokens: 0 }, truncated: false };
  }
}

const setAi = (on: boolean) => db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: on ? new Date() : null } });
const ask = (question: string, path = "/overview", intakeId: string | null = null) => askCsbCoordinator({ question, intakeId, path, history: [] });
const state = (): ToolState => ({ links: [], wrote: [], calls: [], page: { kind: "other", id: null } });
/** The same file uploaded twice has the same bytes, so each fictional variant is generated once (pdfkit stamps a date). */
const made = new Map<string, Buffer>();
const pdf = async (opts: Parameters<typeof supportPlanCardsPdf>[0] = {}) => {
  const key = JSON.stringify(opts);
  if (!made.has(key)) made.set(key, await supportPlanCardsPdf(opts));
  return [{ name: "Council support plan.pdf", type: "application/pdf", bytes: made.get(key)! }];
};

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  setAiProviderForTests(new ScriptedProvider());
}, 180_000);

afterEach(async () => {
  script = async () => "Hello! I can help with support plans, care plans, risks and rotas.";
  seen.length = 0;
  await setAi(false);
});

describe("when Claude is used", () => {
  it("never calls the model unless the organisation switched AI on, even with a provider configured", async () => {
    authMock.ctx = await coordinator();
    const r = await ask("Hello");
    expect(r.mode).toBe("crm");
    expect(seen).toHaveLength(0);
    expect(r.answer).toMatch(/I answer from your CRM records only/);
  });

  it("answers conversationally once switched on, with the safety rules and only the controlled tools", async () => {
    await setAi(true);
    authMock.ctx = await coordinator();
    const r = await ask("Hello, what can you do?");
    expect(r.mode).toBe("ai");
    expect(r.answer).toMatch(/support plans/);
    const input = seen[0]!;
    expect(input.system).toMatch(/untrusted data/);
    expect(input.system).toMatch(/cannot approve, submit, save to a record, publish/);
    expect(input.maxSteps).toBeLessThanOrEqual(6);
    expect(input.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(input.tools.map((t) => t.name).join(" ")).not.toMatch(/approve|publish|delete|sql|apply|send/);
    for (const t of input.tools) expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    // Usage is audited with tokens and an estimate, never the question or the answer.
    const log = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "coordinator.chat.asked" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ aiUsed: true, model: "claude-opus-5-5", inputTokens: 3000, outputTokens: 400 });
    expect(JSON.stringify(log.data)).not.toMatch(/what can you do|support plans/);
  });

  it("falls back to the CRM answers with a plain reason when the model is not available to the account", async () => {
    await setAi(true);
    authMock.ctx = await coordinator();
    script = async () => { throw new AiUnavailableError('The AI model "claude-x" is not available to this Anthropic account.', "model-unavailable"); };
    const r = await ask("Which risk assessments still need reviewing?");
    expect(r.mode).toBe("crm");
    expect(r.topic).toBe("risks");
    expect(r.notice).toMatch(/not available to this Anthropic account/);
  });

  it("never shows the employee an error: an unexpected failure falls back to the CRM and names the error type, without the key", async () => {
    await setAi(true);
    authMock.ctx = await coordinator();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-123456";
    script = async () => {
      const e = Object.assign(new Error("400 fallbacks: unexpected field (key sk-ant-test-not-real-123456)"), { status: 400 });
      e.name = "BadRequestError";
      throw e;
    };
    const r = await ask("Which risk assessments still need reviewing?");
    expect(r.mode).toBe("crm");
    expect(r.topic).toBe("risks");
    expect(r.notice).toMatch(/Claude couldn't answer this time \(BadRequestError 400: 400 fallbacks: unexpected field/);
    expect(r.notice).not.toMatch(/sk-ant/);
    script = async () => { throw new TypeError("x is undefined"); };
    const t = await ask("Which risk assessments still need reviewing?");
    expect(t.mode).toBe("crm");
    expect(t.notice).toMatch(/\(TypeError\)/);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back when the per-person hourly limit is reached", async () => {
    await setAi(true);
    authMock.ctx = await coordinator();
    const before = LIMITS.perUserPerHour;
    const c = await coordinator();
    const used = await db.auditLog.count({ where: { organisationId: orgId, actorId: c.userId, action: "coordinator.chat.asked", data: { path: ["aiUsed"], equals: true } } });
    LIMITS.perUserPerHour = used + 1;
    try {
      expect((await ask("Hello")).mode).toBe("ai");
      const second = await ask("Hello again");
      expect(second.mode).toBe("crm");
      expect(second.notice).toMatch(/AI messages this hour/);
    } finally {
      LIMITS.perUserPerHour = before;
    }
  });

  it("estimates cost from token counts for the usage report", async () => {
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(6);
    authMock.ctx = await manager();
    const u = await coordinatorAiUsage(await manager());
    expect(u.messages).toBeGreaterThan(0);
    expect(u.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe("support plan attached in the chat (fictional four-visit council plan)", () => {
  let intakeId = "";

  it("starts a draft intake, stores and reads the document, and reports the real extracted results", async () => {
    const c = await coordinator();
    const r = await uploadFromChat(c, { target: "new", intakeId: null, serviceUserId: null, title: "Fictional plan via chat", files: await pdf() });
    intakeId = r.intakeId;
    expect(r).toMatchObject({ created: true, alreadyOnIntake: false, duplicates: [], failed: [] });
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId } });
    expect([doc.readStatus, doc.pageCount, doc.organisationId]).toEqual(["READ", 4, orgId]);
    expect(r.summary).toMatch(/09:00 for 60 min/);
    expect(r.summary).toMatch(/12:00 for 45 min/);
    expect(r.summary).toMatch(/16:30 for 30 min/);
    expect(r.summary).toMatch(/20:00 for 60 min/);
    expect(r.summary).toMatch(/1365 minutes \(22 h 45 min\) a week/);
    expect(r.summary).toMatch(/Kept separate \(not council-funded\): 11:00 60 min, carers service/);
    expect(r.summary).toMatch(/Nothing has been approved/);
    const upload = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "coordinator.document.uploaded", entityId: intakeId } });
    expect(upload.actorId).toBe(c.userId);
  });

  it("does not add, read or charge for the same document twice", async () => {
    const c = await coordinator();
    const again = await uploadFromChat(c, { target: "intake", intakeId, serviceUserId: null, title: null, files: await pdf() });
    expect(again).toMatchObject({ added: [], duplicates: ["Council support plan.pdf"] });
    const elsewhere = await uploadFromChat(c, { target: "new", intakeId: null, serviceUserId: null, title: null, files: await pdf() });
    expect(elsewhere).toMatchObject({ alreadyOnIntake: true, intakeId, created: false });
    expect(await db.careIntakeDocument.count({ where: { intakeId } })).toBe(1);
    expect(await db.careIntake.count({ where: { organisationId: orgId, title: { startsWith: "Support plan from AI chat" } } })).toBe(0);
    // Two identical uploads at the same moment share one upload.
    const fresh = await createIntake(c, { title: "Concurrent upload check" });
    const files = await pdf({ name: "Concurrent Example" });
    await Promise.all([1, 2].map(() => uploadFromChat(c, { target: "intake", intakeId: fresh.id, serviceUserId: null, title: null, files })));
    expect(await db.careIntakeDocument.count({ where: { intakeId: fresh.id } })).toBe(1);
  });

  it("gives Claude source-referenced facts: four visits, 195 minutes a day, nine care plan sections, Frameworki, carers from evidence", async () => {
    const c = await coordinator();
    const r = await executeTool(c, state(), "get_intake", { intakeId });
    expect(r.isError).toBe(false);
    const d = JSON.parse(r.content) as IntakeDigest;
    const council = d.visits.filter((v) => v.fundedBy === "COUNCIL");
    expect(council.map((v) => [v.startTime, v.durationMin, v.days, v.carers])).toEqual([["09:00", 60, "Every day", 1], ["12:00", 45, "Every day", 1], ["16:30", 30, "Every day", 1], ["20:00", 60, "Every day", 1]]);
    expect(council.every((v) => v.source.page && v.source.quote && v.source.checkedAgainstPage)).toBe(true);
    expect(d.hours).toMatchObject({ councilMinutesPerWeek: 1365, councilMinutesPerDayIfDaily: 195, carersServiceMinutesPerWeek: 60, authorisedMinutesPerWeek: 1365, matches: true });
    expect(d.carePlan.map((s) => s.key)).toEqual(["about_me", "communication", "personal_care", "mobility", "nutrition", "medication", "health", "home", "outcomes"]);
    expect(d.carePlan.filter((s) => s.entries > 0 || s.restricted)).toHaveLength(9);
    expect(JSON.stringify(d.person)).toMatch(/1088676/);
    expect(d.risks.some((x) => /fall/i.test(x.title))).toBe(true);
    expect(d.risks.every((x) => x.levelFromDocument === null)).toBe(true); // no risk level is manufactured
    expect(d.nothingSavedYet).toBe(true);
    // Drafts only: no person, no visit template and no live visit exists yet.
    expect(await db.visitTemplate.count({ where: { organisationId: orgId, serviceUser: { lastName: "Example", firstName: "Bea" } } })).toBe(0);
    expect(await db.serviceUser.count({ where: { organisationId: orgId, lastName: "Example", firstName: "Bea" } })).toBe(0);
  });

  it("runs the owner's end-to-end request through the chat and returns the actual CRM results and review link", async () => {
    await setAi(true);
    authMock.ctx = await coordinator();
    script = async (input) => {
      const read = await input.execute("read_documents", { intakeId, retryFailed: false });
      const digest = JSON.parse((await input.execute("get_intake", { intakeId })).content) as IntakeDigest;
      const steps = JSON.parse((await input.execute("get_review_steps", { intakeId })).content) as { nextStep: string };
      expect(JSON.parse(read.content).alreadyRead).toBe(1);
      return `Council visits: ${digest.hours.councilMinutesPerWeek} minutes a week. Next: ${steps.nextStep}`;
    };
    const r = await askCsbCoordinator({ question: "I've uploaded this council support plan. Please process everything and prepare the service user, care plan, risks, care package and rota for review.", intakeId, path: `/rota/coordinator/${intakeId}`, history: [], attached: ["Council support plan.pdf"] });
    expect(r.mode).toBe("ai");
    expect(r.answer).toMatch(/1365 minutes a week/);
    expect(r.answer).toMatch(/fact\(s\) still need the coordinator's check/);
    expect(r.links.some((l) => l.href.startsWith(`/rota/coordinator/${intakeId}`))).toBe(true);
    expect(seen[0]!.message).toMatch(/just attached 1 document/);
    // Nothing was read again (already READ), approved or published.
    expect(await db.careIntake.findUniqueOrThrow({ where: { id: intakeId }, select: { status: true } })).toEqual({ status: "DRAFT" });
    const log = await db.auditLog.findFirstOrThrow({ where: { organisationId: orgId, action: "coordinator.chat.asked" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ tools: ["read_documents", "get_intake", "get_review_steps"], wrote: [] });
  });

  it("flags conflicting package hours instead of changing them", async () => {
    const c = await coordinator();
    const r = await uploadFromChat(c, { target: "new", intakeId: null, serviceUserId: null, title: "Fictional plan, hours conflict", files: await pdf({ hoursPerWeek: "20", name: "Cara Example" }) });
    const d = JSON.parse((await executeTool(c, state(), "get_intake", { intakeId: r.intakeId })).content) as IntakeDigest;
    expect(d.hours).toMatchObject({ councilMinutesPerWeek: 1365, authorisedMinutesPerWeek: 1200, matches: false });
    expect(d.hours.message).toMatch(/165 minutes over/);
    expect(r.summary).toMatch(/165 minutes over/);
  });

  it("reports a document that cannot be read, and says so in the chat without inventing facts", async () => {
    const c = await coordinator();
    const broken = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("this is not really a pdf body")]);
    const r = await uploadFromChat(c, { target: "new", intakeId: null, serviceUserId: null, title: "Unreadable fictional upload", files: [{ name: "Scanned plan.pdf", type: "application/pdf", bytes: broken }] });
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId: r.intakeId } });
    expect(doc.readStatus).toBe("UNREADABLE");
    expect(await db.careIntakeFact.count({ where: { intakeId: r.intakeId } })).toBe(0);
    expect(r.summary).toMatch(/No council-funded visits were found/);
  });

  it("names missing information when sections are absent", async () => {
    const c = await coordinator();
    const empty = await createIntake(c, { title: "Empty fictional intake" });
    const d = JSON.parse((await executeTool(c, state(), "get_intake", { intakeId: empty.id })).content) as IntakeDigest;
    expect(d.missingCarePlanSections).toHaveLength(9);
    expect(d.visits).toHaveLength(0);
    const steps = JSON.parse((await executeTool(c, state(), "get_review_steps", { intakeId: empty.id })).content) as { nextStep: string };
    expect(steps.nextStep).toMatch(/Upload the support plan/);
  });
});

describe("tool permissions and tenancy", () => {
  it("keeps another organisation's intakes and people invisible", async () => {
    const c = await coordinator();
    const own = await createIntake(c, { title: "Tenancy check intake" });
    const o = await otherOrg();
    const r = await executeTool(o, state(), "get_intake", { intakeId: own.id });
    expect(r).toMatchObject({ isError: true });
    expect(r.content).toMatch(/Not found, or not available/);
    const s = await executeTool(o, state(), "search_records", { query: "Tenancy check" });
    expect(JSON.parse(s.content).intakes).toEqual([]);
    const up = uploadFromChat(o, { target: "intake", intakeId: own.id, serviceUserId: null, title: null, files: await pdf({ name: "Tenancy Example" }) });
    await expect(up).rejects.toThrow(/not found/i);
  });

  it("refuses intake tools to roles that cannot run intakes", async () => {
    const k = await carer();
    const r = await executeTool(k, state(), "create_intake", { title: "Should not exist", mode: "NEW", serviceUserId: null });
    expect(r.isError).toBe(true);
    expect(await db.careIntake.count({ where: { title: "Should not exist" } })).toBe(0);
  });

  it("refuses unknown tools and invalid input, and reuses an intake instead of creating a duplicate", async () => {
    const c = await coordinator();
    expect((await executeTool(c, state(), "approve_everything", {})).isError).toBe(true);
    expect((await executeTool(c, state(), "get_intake", { intakeId: "../../etc" })).isError).toBe(true);
    const s1 = state();
    const a = JSON.parse((await executeTool(c, s1, "create_intake", { title: "Chat-started intake", mode: "NEW", serviceUserId: null })).content);
    const b = JSON.parse((await executeTool(c, state(), "create_intake", { title: "Chat-started intake", mode: "NEW", serviceUserId: null })).content);
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, reusedExisting: true, intakeId: a.intakeId });
    expect(s1.wrote).toEqual([{ tool: "create_intake", ref: `CareIntake:${a.intakeId}` }]);
  });
});

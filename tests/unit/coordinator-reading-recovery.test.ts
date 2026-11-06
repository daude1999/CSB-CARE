import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as Schemas from "@/server/ai/schemas";
import { CareDocumentExtractionSchema, type CareDocumentExtraction } from "@/server/ai/schemas";
import { fromWire, schemaComplexity, STRUCTURED_LIMITS, toWire } from "@/server/ai/wire-schema";
import { AnthropicProvider } from "@/server/ai/anthropic";
import { setAiProviderForTests } from "@/server/ai";
import { AiUnavailableError, type CareDocumentExtractionInput, type LlmProvider } from "@/server/ai/provider";
import { SimulatedProvider } from "@/server/ai/simulated";
import { mergeReadings, pageParts, readDocument } from "@/server/care/coordinator/reader";
import type { Reading } from "@/lib/care-coordinator-rules";

/**
 * AI CSB Coordinator, phase 1: a support plan that was uploaded must always end up read, by the AI or, when the AI
 * cannot read it, by CSB's basic reader, with the reason in plain words and nothing invented. All fictional data.
 */

beforeAll(() => {
  process.env.COORDINATOR_READ_RETRY_BASE_MS = "1";
});
afterEach(() => setAiProviderForTests(undefined));

const schemas = Object.entries(Schemas).filter(([name]) => name.endsWith("Schema")) as [string, Parameters<typeof toWire>[0]][];

describe("structured-output schemas the AI service will accept", () => {
  it("the original care document schema is over the API's union limit (the cause of the failed support plan reading)", () => {
    const sent = betaZodOutputFormat(CareDocumentExtractionSchema) as unknown as { schema: unknown };
    expect(schemaComplexity(sent.schema).unions).toBeGreaterThan(STRUCTURED_LIMITS.unions);
  });

  it.each(schemas)("%s is sent within the limits for union and optional parameters", (_name, schema) => {
    const sent = betaZodOutputFormat(toWire(schema) as never) as unknown as { schema: unknown };
    const c = schemaComplexity(sent.schema);
    expect(c.unions).toBeLessThanOrEqual(STRUCTURED_LIMITS.unions);
    expect(c.optional).toBeLessThanOrEqual(STRUCTURED_LIMITS.optional);
  });

  it("turns 'not written' back into null and checks the answer against the real schema", () => {
    const wire = {
      document: { kind: "SUPPORT_PLAN", issuer: "", issuerKind: "COUNCIL", documentDate: "2026-09-01", pageCount: 2 },
      person: [], contacts: [{ kind: "FAMILY", name: "Bea Example", relationship: "", phone: "", email: "", address: "", isEmergency: true, isKeyHolder: false, authority: "", page: 1, quote: "Bea Example", temporal: "CURRENT" }],
      references: [{ type: "COUNCIL_CLIENT", issuer: "Example Council", value: "123", system: "", typeClear: true, page: 1, quote: "Ref 123", temporal: "CURRENT" }],
      carerPreferences: [], carePlan: [], risks: [{ type: "FALLS", title: "Falls", hazard: "Unsteady", whoAffected: "", existingControls: "", level: "", page: 2, quote: "Unsteady", temporal: "CURRENT" }],
      package: [], visits: [], medication: { arrangement: [], items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [], communications: [],
    };
    const back = CareDocumentExtractionSchema.parse(fromWire(CareDocumentExtractionSchema, wire));
    expect(back.document.issuer).toBeNull();
    expect(back.contacts[0]).toMatchObject({ relationship: null, phone: null, authority: null });
    expect(back.references[0]!.system).toBeNull();
    expect(back.risks[0]!.level).toBeNull();
    expect(back.medication.arrangement).toBeNull();
  });
});

describe("AnthropicProvider document reading (SDK replaced, nothing goes online)", () => {
  type Body = { output_config: { format: { schema: unknown } }; max_tokens: number; messages: { content: { type: string; text?: string }[] }[] };
  function provider(stream: (body: Body) => Promise<unknown>) {
    const p = new AnthropicProvider({ apiKey: "test-key-not-real" });
    const client = (p as unknown as { client: { beta: { messages: { stream: (b: Body, o: unknown) => { finalMessage: () => Promise<unknown> } } } } }).client;
    client.beta.messages.stream = (b) => ({ finalMessage: () => stream(b) });
    return p;
  }
  const input: CareDocumentExtractionInput = { pdfBase64: "JVBERi0=", filename: "plan.pdf", categoryLabel: "Council support plan", pageRange: { from: 9, to: 16 } };

  it("streams with room for a long answer, sends a compilable schema and asks only for the pages in range", async () => {
    let seen: Body | null = null;
    const answer = { document: { kind: "SUPPORT_PLAN", issuer: "", issuerKind: "COUNCIL", documentDate: "", pageCount: 20 }, person: [], references: [], contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [], medication: { arrangement: [], items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [], communications: [] };
    const r = await provider(async (b) => { seen = b; return { stop_reason: "end_turn", parsed_output: answer }; }).extractCareDocument(input);
    expect(r.document.issuer).toBeNull();
    expect(seen!.max_tokens).toBeGreaterThanOrEqual(64000);
    expect(schemaComplexity(seen!.output_config.format.schema).unions).toBeLessThanOrEqual(STRUCTURED_LIMITS.unions);
    expect(seen!.messages[0]!.content.find((c) => c.type === "text")!.text).toMatch(/pages 9 to 16 only/);
  });

  it("reports a cut-off answer, a malformed answer and a refused request as plain reasons", async () => {
    await expect(provider(async () => ({ stop_reason: "max_tokens", parsed_output: null })).extractCareDocument(input)).rejects.toMatchObject({ reason: "truncated" });
    await expect(provider(async () => ({ stop_reason: "end_turn", parsed_output: { document: {} } })).extractCareDocument(input)).rejects.toMatchObject({ reason: "invalid-output" });
    const bad = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "Schema is too complex for compilation." } }, "Schema is too complex", new Headers());
    await expect(provider(async () => { throw bad; }).extractCareDocument(input)).rejects.toMatchObject({ reason: "rejected" });
  });
});

// ── The reading pipeline ────────────────────────────────────────────────────

const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? "Support plan\nFull name: Cara Specimen\nDate of birth: 02/03/1941" : i === n - 1 ? "Morning | 08:00-08:45 | Mon-Sun | 2 carers | Tasks: washing, dressing, breakfast" : `Page ${i + 1} narrative text.`));

const emptyReading = (pageCount: number): CareDocumentExtraction => ({
  document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: null, pageCount },
  person: [], references: [], contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [],
  medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [], communications: [],
});

function fakeAi(extract: (i: CareDocumentExtractionInput) => Promise<CareDocumentExtraction>): LlmProvider {
  return Object.assign(new SimulatedProvider(), { name: "test-reader", isSimulated: false, extractCareDocument: vi.fn(extract) });
}
const doc = (n: number) => ({ bytes: Buffer.from("%PDF-1.4 fictional"), filename: "plan.pdf", categoryLabel: "Council support plan", pages: pages(n), aiAllowed: true });

describe("readDocument", () => {
  it("reads a short document in one request and a long one in parts of 8 pages", () => {
    expect(pageParts(6)).toEqual([{ from: 1, to: 6 }]);
    expect(pageParts(20)).toEqual([{ from: 1, to: 8 }, { from: 9, to: 16 }, { from: 17, to: 20 }]);
  });

  it("retries a busy AI service and then uses its reading", async () => {
    let calls = 0;
    const ai = fakeAi(async () => {
      if (++calls < 3) throw new AiUnavailableError("busy", "busy");
      return { ...emptyReading(3), person: [{ field: "firstName", value: "Cara", page: 1, quote: "Full name: Cara Specimen", temporal: "CURRENT" }] };
    });
    setAiProviderForTests(ai);
    const r = await readDocument(doc(3));
    expect(calls).toBe(3);
    expect([r.reader, r.status, r.aiFailure]).toEqual(["ai", "READ", null]);
    expect(r.facts.map((f) => [f.destination, f.origin, f.verification])).toEqual([["person.firstName", "AI", "VERIFIED"]]);
  });

  it("falls back to the basic reader when the AI refuses the request, without retrying, and says why", async () => {
    const ai = fakeAi(async () => { throw new AiUnavailableError("rejected", "rejected"); });
    setAiProviderForTests(ai);
    const r = await readDocument(doc(3));
    expect(ai.extractCareDocument).toHaveBeenCalledTimes(1);
    expect(r.reader).toBe("basic-reader");
    expect(r.aiFailure).toMatchObject({ reason: "rejected", pages: [1, 2, 3] });
    expect(r.status).toBe("PARTLY_READ");
    expect(r.facts.some((f) => f.destination === "visit" && f.origin === "BASIC")).toBe(true);
    expect(r.reading.flags[0]!.text).toMatch(/basic reader because the AI service rejected the request/);
  });

  it("keeps the AI's parts and lets the basic reader read only the part the AI could not", async () => {
    const ai = fakeAi(async (i) => {
      if (i.pageRange?.from === 17) throw new AiUnavailableError("timeout", "timeout");
      // An AI part may mention facts outside its range; only its own pages count, so nothing is doubled.
      return { ...emptyReading(20), person: [{ field: "firstName", value: "Cara", page: 1, quote: "Full name: Cara Specimen", temporal: "CURRENT" }] };
    });
    setAiProviderForTests(ai);
    const r = await readDocument(doc(20));
    expect(r.reader).toBe("ai-and-basic");
    expect(r.parts.map((p) => [p.from, p.to, p.ok])).toEqual([[1, 8, true], [9, 16, true], [17, 20, false]]);
    expect(r.parts[2]!.attempts).toBe(3);
    expect(r.facts.filter((f) => f.destination === "person.firstName")).toHaveLength(1);
    const visit = r.facts.find((f) => f.destination === "visit")!;
    expect([visit.origin, visit.page, (visit.value as { carers: number }).carers]).toEqual(["BASIC", 20, 2]);
    expect(r.aiFailure).toMatchObject({ reason: "timeout", pages: [17, 18, 19, 20] });
    expect(r.reading.flags[0]!.text).toMatch(/^Pages 17-20 were read by CSB's basic reader/);
  });

  it("never uses an AI answer that fails the schema", async () => {
    const ai = fakeAi(async () => ({ nonsense: true }) as unknown as CareDocumentExtraction);
    setAiProviderForTests(ai);
    const r = await readDocument(doc(2));
    expect(ai.extractCareDocument).toHaveBeenCalledTimes(3);
    expect([r.reader, r.aiFailure?.reason]).toEqual(["basic-reader", "invalid-output"]);
  });

  it("uses only the basic reader when the organisation has not switched AI on", async () => {
    const ai = fakeAi(async () => emptyReading(2));
    setAiProviderForTests(ai);
    const r = await readDocument({ ...doc(2), aiAllowed: false });
    expect(ai.extractCareDocument).not.toHaveBeenCalled();
    expect([r.reader, r.aiFailure]).toEqual(["basic-reader", null]);
  });

  it("merges parts by page range", () => {
    const a = { ...emptyReading(16), flags: [{ text: "x", page: 3 }, { text: "y", page: 12 }] } as Reading;
    const b = { ...emptyReading(16), flags: [{ text: "y", page: 12 }] } as Reading;
    const m = mergeReadings([{ range: { from: 1, to: 8 }, reading: a }, { range: { from: 9, to: 16 }, reading: b }], 16);
    expect(m.flags).toEqual([{ text: "x", page: 3 }, { text: "y", page: 12 }]);
    expect(m.document.pageCount).toBe(16);
  });
});

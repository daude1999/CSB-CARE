import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, toUnavailable } from "@/server/ai/anthropic";
import { AiUnavailableError, type CoordinatorAgentInput } from "@/server/ai/provider";

/**
 * The Anthropic agent loop with the SDK client replaced, so nothing goes online: tool calls are run by our executor and
 * returned as tool results, thinking blocks go back unchanged, budgets stop the loop, and SDK errors become plain,
 * key-free reasons (a model the account cannot use is reported as such).
 */
type Create = (body: Record<string, unknown>, opts: Record<string, unknown>) => Promise<unknown>;

function provider(create: Create, retrieve: () => Promise<unknown> = async () => ({ id: "claude-opus-5-5" })) {
  const p = new AnthropicProvider({ apiKey: "test-key-not-real" });
  const client = (p as unknown as { client: { beta: { messages: { create: Create } }; models: { retrieve: () => Promise<unknown> } } }).client;
  client.beta.messages.create = create;
  client.models.retrieve = retrieve;
  return p;
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
const input = (execute: CoordinatorAgentInput["execute"], over: Partial<CoordinatorAgentInput> = {}): CoordinatorAgentInput => ({
  system: "rules", history: [{ role: "assistant", content: "Hello!" }, { role: "user", content: "earlier" }, { role: "assistant", content: "reply" }], message: "Process this support plan",
  tools: [{ name: "get_intake", description: "d", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } }],
  execute, maxSteps: 6, deadlineMs: 50_000, ...over,
});

describe("AnthropicProvider.runCoordinatorAgent", () => {
  it("runs requested tools on our server and returns the final answer with token usage", async () => {
    const bodies: Record<string, unknown>[] = [];
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const create = vi.fn<Create>(async (body) => {
      bodies.push(structuredClone(body));
      return bodies.length === 1
        ? { stop_reason: "tool_use", usage, content: [thinking, { type: "tool_use", id: "t1", name: "get_intake", input: { intakeId: "abc" } }] }
        : { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Four council visits found." }] };
    });
    const execute = vi.fn(async () => ({ content: '{"visits":4}', isError: false }));
    const r = await provider(create).runCoordinatorAgent(input(execute));
    expect(r.text).toBe("Four council visits found.");
    expect(r.usage).toEqual({ requests: 2, inputTokens: 200, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 0 });
    expect(execute).toHaveBeenCalledWith("get_intake", { intakeId: "abc" });
    // The conversation starts with the employee, tools are strict, the system prompt is cached.
    const first = bodies[0]! as { messages: { role: string }[]; tools: { strict: boolean }[]; system: { cache_control: unknown }[]; model: string };
    expect(first.messages[0]!.role).toBe("user");
    expect(first.tools.every((t) => t.strict)).toBe(true);
    expect(first.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(first.model).toBe("claude-opus-5-5");
    // The thinking block is passed back unchanged, followed by our tool result.
    const second = bodies[1]! as { messages: { role: string; content: unknown }[] };
    expect(second.messages.at(-2)!.content).toEqual([thinking, { type: "tool_use", id: "t1", name: "get_intake", input: { intakeId: "abc" } }]);
    expect(second.messages.at(-1)!.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: '{"visits":4}', is_error: false }]);
  });

  it("stops at the step budget and says it was cut short", async () => {
    const create = vi.fn<Create>(async () => ({ stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t", name: "get_intake", input: {} }] }));
    const r = await provider(create).runCoordinatorAgent(input(async () => ({ content: "{}", isError: false }), { maxSteps: 2 }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.truncated).toBe(true);
  });

  it("reports a model the account cannot use, once, without calling the Messages API", async () => {
    const create = vi.fn<Create>();
    const notFound = new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "model" } }, "model not found", new Headers());
    const retrieve = vi.fn(async () => { throw notFound; });
    const p = provider(create, retrieve);
    await expect(p.runCoordinatorAgent(input(async () => ({ content: "{}", isError: false })))).rejects.toMatchObject({ reason: "model-unavailable" });
    await expect(p.runCoordinatorAgent(input(async () => ({ content: "{}", isError: false })))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("treats a refusal as unavailable rather than inventing an answer", async () => {
    const create = vi.fn<Create>(async () => ({ stop_reason: "refusal", usage, content: [] }));
    await expect(provider(create).runCoordinatorAgent(input(async () => ({ content: "{}", isError: false })))).rejects.toMatchObject({ reason: "refused" });
  });

  it("maps SDK errors to plain reasons that never include the key", () => {
    const h = new Headers();
    expect(toUnavailable(new Anthropic.RateLimitError(429, undefined, "rate", h), "m").reason).toBe("busy");
    expect(toUnavailable(new Anthropic.AuthenticationError(401, undefined, "bad key test-key-not-real", h), "m")).toMatchObject({ reason: "auth" });
    expect(toUnavailable(new Anthropic.AuthenticationError(401, undefined, "bad key test-key-not-real", h), "m").message).not.toMatch(/test-key/);
    expect(toUnavailable(new Anthropic.APIConnectionError({ message: "down" }), "m").reason).toBe("unavailable");
    expect(toUnavailable(new Error("x"), "m").reason).toBe("unavailable");
  });
});

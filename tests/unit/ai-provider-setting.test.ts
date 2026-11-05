import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderProblem, aiProviderSetting, getAiProvider } from "@/server/ai";

/**
 * AI_PROVIDER is typed by hand into the hosting dashboard. "Anthropic", " anthropic\n" and '"anthropic"' must all
 * select Claude, and when Claude is not in use the admin is told which setting to fix, never the key itself.
 */
afterEach(() => vi.unstubAllEnvs());

describe("AI_PROVIDER setting", () => {
  it.each(["anthropic", "Anthropic", " anthropic\n", '"anthropic"', "'ANTHROPIC' "])("reads %j as anthropic", (v) => {
    vi.stubEnv("AI_PROVIDER", v);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
    expect(aiProviderSetting()).toBe("anthropic");
    expect(getAiProvider()?.isSimulated).toBeFalsy();
    expect(getAiProvider()?.name).toMatch(/^anthropic:/);
    expect(aiProviderProblem()).toBeNull();
  });

  it("accepts a key or model pasted with spaces or a newline", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "  sk-test-not-real\n");
    vi.stubEnv("ANTHROPIC_MODEL", " claude-opus-5-5 ");
    expect(getAiProvider()?.name).toBe("anthropic:claude-opus-5-5");
  });

  it("says the key is missing, without showing anything secret", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", " ");
    expect(getAiProvider()).toBeNull();
    expect(aiProviderProblem()).toMatch(/ANTHROPIC_API_KEY is empty/);
  });

  it("names the setting to fix for simulated, none, unset and unrecognised values", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
    vi.stubEnv("AI_PROVIDER", "simulated");
    expect(aiProviderProblem()).toMatch(/set to simulated/);
    vi.stubEnv("AI_PROVIDER", "none");
    expect(aiProviderProblem()).toMatch(/set to none/);
    vi.stubEnv("AI_PROVIDER", "");
    expect(aiProviderProblem()).toMatch(/not set \(the API key is present\)/);
    vi.stubEnv("AI_PROVIDER", "claude");
    const msg = aiProviderProblem()!;
    expect(msg).toMatch(/does not recognise/);
    expect(msg).not.toMatch(/sk-test|claude\b/);
  });
});

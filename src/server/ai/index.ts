import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { AnthropicProvider } from "./anthropic";
import { AiUnavailableError, type LlmProvider } from "./provider";
import { SimulatedProvider } from "./simulated";
import { meteredProvider } from "./metering";

let override: LlmProvider | null | undefined;
/** One Anthropic client per process, so its connection pool and the model check are reused between requests. */
let anthropic: { key: string; provider: AnthropicProvider } | null = null;

/**
 * AI_PROVIDER=anthropic | simulated | none. With "none" (or a misconfigured
 * provider) AI features are unavailable and reviewers work manually; the rest
 * of the application keeps working.
 */
/** Hosting dashboards make it easy to type "Anthropic", add a space or paste quotes: read the setting forgivingly. */
export function aiProviderSetting(): string {
  const raw = process.env.AI_PROVIDER;
  if (raw === undefined || raw.trim() === "") return process.env.NODE_ENV === "production" ? "none" : "simulated";
  return raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
}

/**
 * Why no real AI provider is in use, in words an office admin can act on; null when Anthropic is ready. Never
 * includes the key or the raw setting, only which setting needs attention.
 */
export function aiProviderProblem(): string | null {
  const which = aiProviderSetting();
  const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
  if (!process.env.AI_PROVIDER?.trim()) return `AI_PROVIDER is not set${hasKey ? " (the API key is present)" : ""}. Set it to anthropic in the hosting settings and redeploy.`;
  if (which === "anthropic") return hasKey ? null : "AI_PROVIDER is anthropic, but ANTHROPIC_API_KEY is empty for this environment. Add the key for Production in the hosting settings and redeploy.";
  if (which === "simulated") return "AI_PROVIDER is set to simulated. Set it to anthropic in the hosting settings and redeploy.";
  if (which === "none") return "AI_PROVIDER is set to none. Set it to anthropic in the hosting settings and redeploy.";
  return `AI_PROVIDER has a value the platform does not recognise. It must be the single word anthropic${hasKey ? " (the API key is present)" : ""}. Change it in the hosting settings and redeploy.`;
}

export function getAiProvider(): LlmProvider | null {
  if (override !== undefined) return override;
  const which = aiProviderSetting();
  try {
    if (which === "anthropic") {
      const key = createHash("sha256").update(`${process.env.ANTHROPIC_MODEL ?? ""}|${process.env.ANTHROPIC_API_KEY ?? ""}`).digest("hex");
      if (!anthropic || anthropic.key !== key) anthropic = { key, provider: meteredProvider(new AnthropicProvider()) };
      return anthropic.provider;
    }
    // Every request is metered and checked against the organisation's AI allowance (src/server/ai/metering.ts).
    if (which === "simulated") return meteredProvider(new SimulatedProvider());
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "AI provider unavailable");
  }
  return null;
}

export function requireAi(): LlmProvider {
  const p = getAiProvider();
  if (!p) throw new AiUnavailableError();
  return p;
}

export function setAiProviderForTests(p: LlmProvider | null | undefined) {
  override = p;
}

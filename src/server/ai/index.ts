import { createHash } from "node:crypto";
import { logger } from "@/lib/logger";
import { AnthropicProvider } from "./anthropic";
import { AiUnavailableError, type LlmProvider } from "./provider";
import { SimulatedProvider } from "./simulated";

let override: LlmProvider | null | undefined;
/** One Anthropic client per process, so its connection pool and the model check are reused between requests. */
let anthropic: { key: string; provider: AnthropicProvider } | null = null;

/**
 * AI_PROVIDER=anthropic | simulated | none. With "none" (or a misconfigured
 * provider) AI features are unavailable and reviewers work manually; the rest
 * of the application keeps working.
 */
export function getAiProvider(): LlmProvider | null {
  if (override !== undefined) return override;
  const which = process.env.AI_PROVIDER ?? (process.env.NODE_ENV === "production" ? "none" : "simulated");
  try {
    if (which === "anthropic") {
      const key = createHash("sha256").update(`${process.env.ANTHROPIC_MODEL ?? ""}|${process.env.ANTHROPIC_API_KEY ?? ""}`).digest("hex");
      if (!anthropic || anthropic.key !== key) anthropic = { key, provider: new AnthropicProvider() };
      return anthropic.provider;
    }
    if (which === "simulated") return new SimulatedProvider();
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

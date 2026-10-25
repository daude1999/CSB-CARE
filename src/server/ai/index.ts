import { logger } from "@/lib/logger";
import { AnthropicProvider } from "./anthropic";
import { AiUnavailableError, type LlmProvider } from "./provider";
import { SimulatedProvider } from "./simulated";

let override: LlmProvider | null | undefined;

/**
 * AI_PROVIDER=anthropic | simulated | none. With "none" (or a misconfigured
 * provider) AI features are unavailable and reviewers work manually; the rest
 * of the application keeps working.
 */
export function getAiProvider(): LlmProvider | null {
  if (override !== undefined) return override;
  const which = process.env.AI_PROVIDER ?? (process.env.NODE_ENV === "production" ? "none" : "simulated");
  try {
    if (which === "anthropic") return new AnthropicProvider();
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

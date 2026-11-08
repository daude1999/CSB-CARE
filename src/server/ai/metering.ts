import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AiUnavailableError, type LlmProvider } from "./provider";

/**
 * AI usage metering and allowances (Platform Admin Centre → AI Management). Every AI request made through the provider
 * is recorded as metadata only: which organisation, which feature, success or failure, tokens and duration. Never the
 * prompt, the document or the answer.
 *
 * The organisation comes from the request that started the work: server actions run inside runForTenant() (see
 * src/app/action-kit.ts) and background jobs inside the job's organisationId (src/server/jobs/queue.ts). Work with no
 * organisation (regulatory monitoring) is recorded as platform work.
 */
const tenant = new AsyncLocalStorage<{ organisationId: string | null }>();
const tokens = new AsyncLocalStorage<{ input: number; output: number }>();

export function runForTenant<T>(organisationId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return tenant.run({ organisationId: organisationId ?? null }, fn);
}
export const currentTenant = () => tenant.getStore()?.organisationId ?? null;

/** Called by the Anthropic provider after each API response, so tokens are counted for the request in progress. */
export function noteAiTokens(usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined) {
  const t = tokens.getStore();
  if (!t || !usage) return;
  t.input += usage.input_tokens ?? 0;
  t.output += usage.output_tokens ?? 0;
}

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

async function setting(key: string): Promise<number | null> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return typeof row?.value === "number" ? row.value : null;
}

/**
 * Refuses an AI request the organisation is not licensed for, or that would go over its monthly allowance, its monthly
 * spending limit or the platform-wide ceiling. Callers already handle AiUnavailableError (they fall back or explain).
 */
export async function checkAiAllowance(organisationId: string | null) {
  const since = monthStart();
  const ceiling = await setting("ai.platformMonthlyRequests");
  if (ceiling !== null && (await db.aiUsageEvent.count({ where: { createdAt: { gte: since } } })) >= ceiling)
    throw new AiUnavailableError("The platform's monthly AI allowance has been reached. Evantix support can raise it.", "not-licensed");
  if (!organisationId) return;
  const [ent, sub] = await Promise.all([
    db.tenantModuleEntitlement.findUnique({ where: { organisationId_moduleKey: { organisationId, moduleKey: "AI_COORDINATOR" } } }),
    db.customerSubscription.findFirst({ where: { organisationId, isCurrent: true }, select: { aiRequestsPerMonth: true } }),
  ]);
  if (ent && !ent.enabled) throw new AiUnavailableError("AI is not included in this organisation's subscription. Contact Evantix support to add it.", "not-licensed");
  const limits = (ent?.limits ?? {}) as { monthlyRequests?: number; monthlySpendPence?: number };
  const allowance = typeof limits.monthlyRequests === "number" ? limits.monthlyRequests : (sub?.aiRequestsPerMonth ?? null);
  if (allowance !== null || typeof limits.monthlySpendPence === "number") {
    const used = await db.aiUsageEvent.aggregate({ where: { organisationId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } });
    if (allowance !== null && used._count._all >= allowance) throw new AiUnavailableError(`This organisation has used its ${allowance} AI requests for this month. Evantix support can raise the allowance.`, "not-licensed");
    if (typeof limits.monthlySpendPence === "number") {
      const [inP, outP] = await Promise.all([setting("ai.inputPencePerMillionTokens"), setting("ai.outputPencePerMillionTokens")]);
      if (inP !== null && outP !== null) {
        const spent = ((used._sum.inputTokens ?? 0) * inP + (used._sum.outputTokens ?? 0) * outP) / 1_000_000;
        if (spent >= limits.monthlySpendPence) throw new AiUnavailableError("This organisation has reached its monthly AI spending limit. Evantix support can raise it.", "not-licensed");
      }
    }
  }
}

async function record(e: { organisationId: string | null; feature: string; provider: string; success: boolean; errorReason: string | null; input: number; output: number; durationMs: number }) {
  try {
    await db.aiUsageEvent.create({ data: { organisationId: e.organisationId, feature: e.feature, provider: e.provider.split(":")[0]!, model: e.provider.includes(":") ? e.provider.split(":").slice(1).join(":") : null, success: e.success, errorReason: e.errorReason, inputTokens: e.input, outputTokens: e.output, durationMs: e.durationMs } });
  } catch (err) {
    // Metering must never break the feature itself.
    logger.warn({ err: (err as Error).message }, "AI usage not recorded");
  }
}

/** Wraps a provider so every AI method call is checked against allowances and recorded. Other properties pass through. */
export function meteredProvider<P extends LlmProvider>(p: P): P {
  return new Proxy(p, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string" || prop === "constructor" || prop === "checkModel") return value;
      return async (...args: unknown[]) => {
        const organisationId = currentTenant();
        await checkAiAllowance(organisationId);
        const started = Date.now();
        const counter = { input: 0, output: 0 };
        try {
          const result = await tokens.run(counter, () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
          // The coordinator agent reports its own usage across its loop.
          const u = result && typeof result === "object" && "usage" in result ? (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage : undefined;
          if (u && !counter.input && !counter.output) {
            counter.input = u.inputTokens ?? 0;
            counter.output = u.outputTokens ?? 0;
          }
          await record({ organisationId, feature: prop, provider: target.name, success: true, errorReason: null, input: counter.input, output: counter.output, durationMs: Date.now() - started });
          return result;
        } catch (e) {
          await record({ organisationId, feature: prop, provider: target.name, success: false, errorReason: e instanceof AiUnavailableError ? e.reason : "error", input: counter.input, output: counter.output, durationMs: Date.now() - started });
          throw e;
        }
      };
    },
  });
}

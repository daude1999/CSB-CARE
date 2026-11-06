import { z } from "zod/v4";

/**
 * The shape sent to the AI service for structured output, kept apart from the schemas we validate against.
 *
 * Why: the API compiles every structured-output schema into a grammar and refuses ("Schema is too complex for
 * compilation", HTTP 400) a schema with more than 16 parameters that use a union (anyOf, or "type": [x, "null"]) or
 * more than 24 optional parameters. Every `.nullable()` field is a union. The care document schema had 32 of them, so
 * every AI reading of a support plan was refused before the model saw the document (the failure seen on 5-6 Nov 2026).
 *
 * The wire form says "not written" without unions:
 *  - a nullable or optional string becomes a required string, with "" for "not written";
 *  - a nullable enum gets an extra "" option;
 *  - a nullable object or array becomes an array holding at most one item;
 *  - an optional array or boolean becomes required (an empty array, or false, for "not written").
 * fromWire() turns the answer back into the real shape, which is then validated with the original schema, so every
 * constraint (page numbers, minimum durations and so on) is still checked on our own server.
 */

type Any = z.ZodType;
const NOT_WRITTEN = 'Use "" (an empty string) when the document does not give it.';

function wireOf(s: Any, outerDescription?: string): Any {
  const desc = outerDescription ?? s.description;
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    const inner = s.unwrap() as Any;
    const base = inner instanceof z.ZodOptional || inner instanceof z.ZodNullable ? (inner.unwrap() as Any) : inner;
    const d = desc ?? inner.description ?? base.description;
    if (base instanceof z.ZodString) return z.string().describe([d, NOT_WRITTEN].filter(Boolean).join(" "));
    if (base instanceof z.ZodEnum) return z.enum(["", ...(base.options as string[])] as [string, ...string[]]).describe([d, NOT_WRITTEN].filter(Boolean).join(" "));
    if (base instanceof z.ZodBoolean) return z.boolean().describe(d ?? "");
    if (base instanceof z.ZodArray) return wireOf(base, d);
    if (base instanceof z.ZodObject) return z.array(wireOf(base)).describe([d, "An empty list when the document does not give it; otherwise exactly one item."].filter(Boolean).join(" "));
    // Numbers and anything else keep their union: none of our schemas has one, and the complexity test would show it.
    return s;
  }
  if (s instanceof z.ZodObject) {
    const shape: Record<string, Any> = {};
    for (const [k, v] of Object.entries(s.shape as Record<string, Any>)) shape[k] = wireOf(v);
    const o = z.object(shape);
    return desc ? o.describe(desc) : o;
  }
  if (s instanceof z.ZodArray) {
    const a = z.array(wireOf(s.element as Any));
    return desc ? a.describe(desc) : a;
  }
  return s;
}

const cache = new WeakMap<Any, Any>();
export function toWire<T extends Any>(schema: T): Any {
  let w = cache.get(schema);
  if (!w) {
    w = wireOf(schema);
    cache.set(schema, w);
  }
  return w;
}

/** Turns an answer in the wire shape back into the original shape (not yet validated). */
export function fromWire(s: Any, value: unknown): unknown {
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    const nullable = s instanceof z.ZodNullable || (s.unwrap() as Any) instanceof z.ZodNullable;
    const inner = s.unwrap() as Any;
    const base = inner instanceof z.ZodOptional || inner instanceof z.ZodNullable ? (inner.unwrap() as Any) : inner;
    const empty = nullable ? null : undefined;
    if (base instanceof z.ZodString || base instanceof z.ZodEnum) return typeof value === "string" && value.trim() === "" ? empty : value === undefined ? empty : value;
    if (base instanceof z.ZodObject) {
      const first = Array.isArray(value) ? value[0] : value;
      return first == null ? empty : fromWire(base, first);
    }
    if (value === undefined || value === null) return empty;
    return fromWire(base, value);
  }
  if (s instanceof z.ZodObject && value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    const shape = s.shape as Record<string, Any>;
    for (const [k, v] of Object.entries(shape)) {
      const r = fromWire(v, (value as Record<string, unknown>)[k]);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  if (s instanceof z.ZodArray && Array.isArray(value)) return value.map((x) => fromWire(s.element as Any, x));
  return value;
}

/**
 * Counts what the API limits in a JSON schema: parameters with a union type, and optional parameters.
 * Limits (structured outputs, Nov 2026): 16 union parameters and 24 optional parameters per request.
 */
export const STRUCTURED_LIMITS = { unions: 16, optional: 24 } as const;
export function schemaComplexity(jsonSchema: unknown) {
  let unions = 0;
  let optional = 0;
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    if (o.properties && typeof o.properties === "object") {
      const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
      for (const [k, v] of Object.entries(o.properties as Record<string, Record<string, unknown>>)) {
        if (!req.has(k)) optional++;
        if (v && (v.anyOf || Array.isArray(v.type))) unions++;
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(jsonSchema);
  return { unions, optional };
}

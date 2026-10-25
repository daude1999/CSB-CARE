import { createHash } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Normalise text for comparison: unify whitespace, quotes and dashes, strip
 * zero-width characters. The original content is always stored separately.
 */
export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Looser form used to decide whether a quote appears in a text. */
export function canonicalForMatch(input: string): string {
  return normaliseText(input).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function textContains(haystack: string, needle: string): boolean {
  const n = canonicalForMatch(needle);
  if (n.length < 8) return false;
  return canonicalForMatch(haystack).includes(n);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

import { CareDocumentExtractionSchema } from "@/server/ai/schemas";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError, TRANSIENT_AI_REASONS, type AiUnavailableReason, type LlmProvider } from "@/server/ai/provider";
import { basicRead, quoteOnPage, readingToFacts, type FactSeed, type Reading } from "@/lib/care-coordinator-rules";
import { classifyReferenceContext, findFrameworki, frameworkiReferences, FRAMEWORKI } from "@/lib/reference-numbers";

/**
 * Reading one uploaded document for the AI Care Coordinator.
 *
 *  - The PDF's text layer is always extracted on our own server, page by page, and kept with the document so every
 *    fact can be checked against its page later. Scanned pages have no text and are reported as unreadable.
 *  - With the organisation's Care Coordinator AI switch on and an AI provider that can read documents, the PDF is sent
 *    to the provider and must come back in CareDocumentExtractionSchema. A long document is read in page ranges (in
 *    parallel), so facts on later pages are never lost to the length of one answer. Every quote is then checked against
 *    the page text: a fact whose quote is not on the page is kept but marked UNVERIFIED for the coordinator to check
 *    against the original. Otherwise the basic reader (labelled lines, no AI, nothing leaves the server) is used.
 *  - A failed AI reading is retried (busy, timeout, a cut-off answer) a bounded number of times, then the pages it could
 *    not read are read by the basic reader, so an upload always ends with whatever could safely be read and a plain
 *    reason. Nothing is invented for the pages neither reader could read.
 *  - Document content is untrusted. It is never logged, never executed, and only ever stored as page text and facts.
 */

export async function pdfPages(bytes: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t) => String(t ?? ""));
}

/**
 * Tower Hamlets Frameworki numbers are also found on our own server from the page text, so the AI cannot miss or
 * reword one. A Frameworki number's type is only clear when the words beside it say so; the AI's own confidence never
 * settles it.
 */
export function withFrameworki(reading: Reading, pages: string[]): Reading {
  const refs = (reading.references ?? []).map((r) => {
    if (!findFrameworki(r.quote ?? "").some((m) => m.value === r.value.trim())) return r;
    const c = classifyReferenceContext(r.quote);
    return { ...r, system: r.system ?? FRAMEWORKI, typeClear: c.clear && c.type === r.type };
  });
  for (const f of frameworkiReferences(pages, reading.document.issuer)) {
    if (refs.some((r) => r.value.trim() === f.value)) continue;
    refs.push({ type: f.type, typeClear: f.typeClear, issuer: f.issuer, system: f.system, value: f.value, page: f.page, quote: f.quote, temporal: "CURRENT" });
  }
  return { ...reading, references: refs };
}

/** How long documents are read in one request, and in how many parts at once. */
export const READ_LIMITS = {
  /** Up to this many pages are read in one request; longer documents are read in parts. */
  singleRequestPages: 10,
  partPages: 8,
  concurrency: 3,
  /** Tries per part, for failures that may pass (busy, timeout, a cut-off or malformed answer). */
  attempts: 3,
} as const;

/** The whole AI reading must finish within this, so the basic reader and saving still fit in the request. */
const budgetMs = () => Math.max(20_000, Number(process.env.COORDINATOR_READ_BUDGET_MS) || 210_000);
const retryBaseMs = () => Math.max(0, Number(process.env.COORDINATOR_READ_RETRY_BASE_MS ?? 2_000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plain words for each failure, safe to show and store: never the key, the document or the provider's own text. */
export const READ_FAILURE_TEXT: Record<AiUnavailableReason, string> = {
  "not-configured": "the AI service is not set up on this server",
  "model-unavailable": "the AI model set on the server is not available to this account",
  auth: "the AI service did not accept the server's API key",
  busy: "the AI service was busy",
  refused: "the AI service declined to read it",
  timeout: "the AI service took too long",
  unavailable: "the AI service could not be reached",
  rejected: "the AI service rejected the request",
  "invalid-output": "the AI answer did not have the expected shape",
  truncated: "the AI answer was too long and was cut off",
};

export type ReadPart = { from: number; to: number; ok: boolean; attempts: number; reason: AiUnavailableReason | null };
type OutcomeFact = FactSeed & { verification: "VERIFIED" | "UNVERIFIED"; check: string | null; origin: "AI" | "BASIC" };

export interface ReadOutcome {
  /** Who read it: the AI, CSB's basic reader, or the AI with the basic reader covering pages the AI could not read. */
  reader: "ai" | "basic-reader" | "ai-and-basic";
  providerName: string | null;
  reading: Reading;
  facts: OutcomeFact[];
  status: "READ" | "PARTLY_READ" | "UNREADABLE";
  /** Set when the AI was meant to read the document and some or all of it could not be read by the AI. */
  aiFailure: { reason: AiUnavailableReason; text: string; pages: number[] } | null;
  parts: ReadPart[];
}

/** Splits 1..n into page ranges: one range for a short document, parts of READ_LIMITS.partPages otherwise. */
export function pageParts(n: number): { from: number; to: number }[] {
  if (n <= READ_LIMITS.singleRequestPages) return [{ from: 1, to: Math.max(1, n) }];
  const out: { from: number; to: number }[] = [];
  for (let from = 1; from <= n; from += READ_LIMITS.partPages) out.push({ from, to: Math.min(n, from + READ_LIMITS.partPages - 1) });
  return out;
}

const asUnavailable = (e: unknown) => (e instanceof AiUnavailableError ? e : new AiUnavailableError("The AI service could not answer just now.", "unavailable"));

/** One part, tried up to READ_LIMITS.attempts times with growing waits, never past the deadline. */
async function readPart(provider: LlmProvider, input: { bytes: Buffer; filename: string; categoryLabel: string }, range: { from: number; to: number } | undefined, deadline: number) {
  let attempts = 0;
  for (;;) {
    attempts++;
    const remaining = deadline - Date.now();
    if (remaining < 10_000) throw Object.assign(new AiUnavailableError("The AI service took too long.", "timeout"), { attempts });
    try {
      const raw = await provider.extractCareDocument!({ pdfBase64: input.bytes.toString("base64"), filename: input.filename, categoryLabel: input.categoryLabel, pageRange: range, timeoutMs: Math.min(remaining, 170_000) });
      const parsed = CareDocumentExtractionSchema.safeParse(raw);
      if (!parsed.success) throw new AiUnavailableError("The AI answer did not have the expected shape.", "invalid-output");
      return { reading: parsed.data as Reading, attempts };
    } catch (e) {
      const err = asUnavailable(e);
      if (!TRANSIENT_AI_REASONS.has(err.reason) || attempts >= READ_LIMITS.attempts) throw Object.assign(err, { attempts });
      const wait = Math.round(retryBaseMs() * 3 ** (attempts - 1) * (0.8 + Math.random() * 0.4));
      if (deadline - Date.now() - wait < 15_000) throw Object.assign(err, { attempts });
      await sleep(wait);
    }
  }
}

const inRange = (page: number, r: { from: number; to: number }) => page >= r.from && page <= r.to;
function dedupe<T>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = JSON.stringify(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Joins the parts of one reading. Each part keeps only what it found on its own pages, so nothing is counted twice. */
export function mergeReadings(parts: { range: { from: number; to: number }; reading: Reading }[], pageCount: number): Reading {
  const pick = <T extends { page: number }>(get: (r: Reading) => T[] | undefined) => dedupe(parts.flatMap((p) => (get(p.reading) ?? []).filter((x) => inRange(x.page, p.range))));
  const arrangement = parts.map((p) => p.reading.medication.arrangement).find((a, i) => a && inRange(a.page, parts[i]!.range)) ?? null;
  return {
    document: { ...parts[0]!.reading.document, pageCount },
    person: pick((r) => r.person),
    references: pick((r) => r.references),
    contacts: pick((r) => r.contacts),
    carerPreferences: pick((r) => r.carerPreferences),
    carePlan: pick((r) => r.carePlan),
    risks: pick((r) => r.risks),
    package: pick((r) => r.package),
    visits: pick((r) => r.visits),
    medication: { arrangement, items: pick((r) => r.medication.items), allergies: pick((r) => r.medication.allergies) },
    incidents: pick((r) => r.incidents),
    skin: pick((r) => r.skin),
    flags: pick((r) => r.flags),
    missing: dedupe(parts.flatMap((p) => p.reading.missing)),
    unreadable: pick((r) => r.unreadable),
    communications: pick((r) => r.communications),
  };
}

/** The basic reader on some pages only; page numbers stay as in the document. */
function basicReadPages(pages: string[], only: Set<number>): Reading {
  const r = basicRead(pages.map((t, i) => (only.has(i + 1) ? t : "")));
  return { ...r, unreadable: r.unreadable.filter((u) => only.has(u.page)), flags: r.flags.filter((f) => !f.page || only.has(f.page)) };
}

function checkFacts(reading: Reading, pages: string[], origin: "AI" | "BASIC"): OutcomeFact[] {
  return readingToFacts(reading).map((f) => {
    // The basic reader copies whole lines from the page, so what it finds is on the page.
    if (origin === "BASIC") return { ...f, verification: "VERIFIED" as const, check: null, origin };
    const pageText = f.page ? pages[f.page - 1] : undefined;
    if (quoteOnPage(pageText, f.quote)) return { ...f, verification: "VERIFIED" as const, check: null, origin };
    const check = !pageText?.trim() ? `Page ${f.page ?? "?"} is scanned, so the quote could not be checked. Compare with the original.` : `The quote was not found on page ${f.page ?? "?"}. Compare with the original before approving.`;
    return { ...f, verification: "UNVERIFIED" as const, check, origin };
  });
}

const pageList = (ps: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    let j = i;
    while (j + 1 < ps.length && ps[j + 1] === ps[j]! + 1) j++;
    out.push(i === j ? `${ps[i]}` : `${ps[i]}-${ps[j]}`);
    i = j;
  }
  return out.join(", ");
};

/**
 * Reads one document. Never throws because the AI failed: whatever the AI could not read (all of it, or some parts of
 * a long document) is read by CSB's basic reader instead, the reason is returned in plain words, and the document can
 * be read again later from the stored original.
 */
export async function readDocument(input: { bytes: Buffer; filename: string; categoryLabel: string; pages: string[]; aiAllowed: boolean }): Promise<ReadOutcome> {
  const provider = getAiProvider();
  const useAi = input.aiAllowed && !!provider?.extractCareDocument && !provider.isSimulated;
  const n = input.pages.length;
  const blank = input.pages.filter((p) => !p.trim()).length;
  if (!useAi) {
    const reading = basicRead(input.pages);
    const status: ReadOutcome["status"] = n && blank === n ? "UNREADABLE" : blank || reading.unreadable.length ? "PARTLY_READ" : "READ";
    return { reader: "basic-reader", providerName: null, reading, facts: checkFacts(reading, input.pages, "BASIC"), status, aiFailure: null, parts: [] };
  }

  const ranges = n ? pageParts(n) : [undefined];
  const deadline = Date.now() + budgetMs();
  const results: ({ range: { from: number; to: number }; reading: Reading; attempts: number } | { range: { from: number; to: number }; error: AiUnavailableError; attempts: number })[] = [];
  const queue = ranges.map((r, i) => ({ r, i }));
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const range = next.r ?? { from: 1, to: Math.max(1, n) };
      try {
        // A short document is sent whole, without a page range.
        const got = await readPart(provider!, input, ranges.length > 1 ? next.r : undefined, deadline);
        results[next.i] = { range, reading: got.reading, attempts: got.attempts };
      } catch (e) {
        const err = asUnavailable(e);
        results[next.i] = { range, error: err, attempts: (e as { attempts?: number }).attempts ?? 1 };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_LIMITS.concurrency, ranges.length) }, worker));

  const parts: ReadPart[] = results.map((x) => ({ ...x.range, ok: "reading" in x, attempts: x.attempts, reason: "error" in x ? x.error.reason : null }));
  const good = results.filter((x): x is Extract<(typeof results)[number], { reading: Reading }> => "reading" in x);
  const failed = results.filter((x): x is Extract<(typeof results)[number], { error: AiUnavailableError }> => "error" in x);
  const failedPages = failed.flatMap((x) => Array.from({ length: x.range.to - x.range.from + 1 }, (_, k) => x.range.from + k)).filter((p) => p <= Math.max(1, n));
  const reason = failed[0]?.error.reason ?? null;
  const aiFailure = reason ? { reason, text: READ_FAILURE_TEXT[reason], pages: failedPages } : null;

  let reading: Reading;
  let facts: OutcomeFact[];
  let reader: ReadOutcome["reader"];
  if (!good.length) {
    // The AI read nothing: the basic reader reads the whole document.
    reading = basicRead(input.pages);
    facts = checkFacts(reading, input.pages, "BASIC");
    reader = "basic-reader";
  } else {
    const ai = withFrameworki(mergeReadings(good, Math.max(1, n)), input.pages);
    facts = checkFacts(ai, input.pages, "AI");
    reading = ai;
    reader = "ai";
    if (failed.length) {
      const basic = basicReadPages(input.pages, new Set(failedPages));
      facts = [...facts, ...checkFacts(basic, input.pages, "BASIC")];
      reading = { ...ai, flags: [...ai.flags, ...basic.flags], missing: ai.missing, unreadable: [...ai.unreadable, ...basic.unreadable] };
      reader = "ai-and-basic";
    }
  }
  if (aiFailure) {
    const where = good.length ? `Pages ${pageList(aiFailure.pages)} were` : "This document was";
    reading = { ...reading, flags: [{ text: `${where} read by CSB's basic reader because ${aiFailure.text}. Only labelled lines and timetable rows are picked up that way, so check those pages against the original, or press Read again to try the AI again.`, page: good.length ? aiFailure.pages[0]! : 0 }, ...reading.flags] };
  }
  const status: ReadOutcome["status"] = n && blank === n && !good.length ? "UNREADABLE" : blank || reading.unreadable.length || failed.length ? "PARTLY_READ" : "READ";
  return { reader, providerName: good.length ? provider!.name : null, reading, facts, status, aiFailure, parts };
}

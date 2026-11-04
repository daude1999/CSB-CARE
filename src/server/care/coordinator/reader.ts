import { CareDocumentExtractionSchema } from "@/server/ai/schemas";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError } from "@/server/ai/provider";
import { basicRead, quoteOnPage, readingToFacts, type FactSeed, type Reading } from "@/lib/care-coordinator-rules";

/**
 * Reading one uploaded document for the AI Care Coordinator.
 *
 *  - The PDF's text layer is always extracted on our own server, page by page, and kept with the document so every
 *    fact can be checked against its page later. Scanned pages have no text and are reported as unreadable.
 *  - With the organisation's Care Coordinator AI switch on and an AI provider that can read documents, the PDF is sent
 *    to the provider and must come back in CareDocumentExtractionSchema. Every quote is then checked against the page
 *    text: a fact whose quote is not on the page is kept but marked UNVERIFIED for the coordinator to check against the
 *    original. Otherwise the basic reader (labelled lines, no AI, nothing leaves the server) is used.
 *  - Document content is untrusted. It is never logged, never executed, and only ever stored as page text and facts.
 */

export async function pdfPages(bytes: Buffer): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t) => String(t ?? ""));
}

export interface ReadOutcome {
  reader: "ai" | "basic-reader";
  providerName: string | null;
  reading: Reading;
  facts: (FactSeed & { verification: "VERIFIED" | "UNVERIFIED"; check: string | null })[];
  status: "READ" | "PARTLY_READ" | "UNREADABLE";
}

export async function readDocument(input: { bytes: Buffer; filename: string; categoryLabel: string; pages: string[]; aiAllowed: boolean }): Promise<ReadOutcome> {
  const provider = getAiProvider();
  const useAi = input.aiAllowed && !!provider?.extractCareDocument && !provider.isSimulated;
  let reading: Reading;
  let reader: ReadOutcome["reader"] = "basic-reader";
  if (useAi) {
    let raw: unknown;
    try {
      raw = await provider!.extractCareDocument!({ pdfBase64: input.bytes.toString("base64"), filename: input.filename, categoryLabel: input.categoryLabel });
    } catch (e) {
      if (e instanceof AiUnavailableError) throw e;
      throw new AiUnavailableError("The document could not be read by the AI service just now. Try again, or add the facts by hand.");
    }
    const parsed = CareDocumentExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new AiUnavailableError("The AI reading did not have the expected shape, so it was not used. Try again, or add the facts by hand.");
    reading = parsed.data as Reading;
    reader = "ai";
  } else {
    reading = basicRead(input.pages);
  }
  const facts = readingToFacts(reading).map((f) => {
    const pageText = f.page ? input.pages[f.page - 1] : undefined;
    if (reader === "basic-reader") return { ...f, verification: "VERIFIED" as const, check: null };
    if (quoteOnPage(pageText, f.quote)) return { ...f, verification: "VERIFIED" as const, check: null };
    const check = !pageText?.trim() ? `Page ${f.page ?? "?"} is scanned, so the quote could not be checked. Compare with the original.` : `The quote was not found on page ${f.page ?? "?"}. Compare with the original before approving.`;
    return { ...f, verification: "UNVERIFIED" as const, check };
  });
  const blank = input.pages.filter((p) => !p.trim()).length;
  const status: ReadOutcome["status"] = input.pages.length && blank === input.pages.length && reader === "basic-reader" ? "UNREADABLE" : blank || reading.unreadable.length ? "PARTLY_READ" : "READ";
  return { reader, providerName: reader === "ai" ? provider!.name : null, reading, facts, status };
}

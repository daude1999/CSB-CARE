import { textContains } from "@/lib/text";
import type { Section } from "../sources/extract";

export interface CitationCheck {
  verified: boolean;
  sectionRef: string | null;
  note: string;
}

/** A citation is verified only if the quote appears verbatim (after normalisation) in the stored source text. */
export function verifyQuote(quote: string, sections: Section[], claimedRef?: string | null): CitationCheck {
  if (!quote || quote.trim().length < 8) return { verified: false, sectionRef: claimedRef ?? null, note: "Quote too short to verify" };
  const claimed = claimedRef ? sections.find((s) => s.ref === claimedRef) : undefined;
  if (claimed && (textContains(claimed.text, quote) || textContains(claimed.heading, quote))) return { verified: true, sectionRef: claimed.ref, note: "Quote found in the cited section" };
  const elsewhere = sections.find((s) => textContains(s.text, quote));
  if (elsewhere) return { verified: true, sectionRef: elsewhere.ref, note: claimedRef ? `Quote found in section "${elsewhere.ref}", not the cited "${claimedRef}"` : "Quote found in source" };
  return { verified: false, sectionRef: claimedRef ?? null, note: "Quote NOT found in the stored source version; treat as unsupported" };
}

import { XMLParser } from "fast-xml-parser";
import { normaliseText } from "@/lib/text";
import { parseDate, type SourceAdapter } from "./types";

/**
 * legislation.gov.uk (https://www.legislation.gov.uk/developer). Each provision is
 * available as Crown Legislation Markup Language (CLML) XML at <uri>/data.xml.
 * Licence: Open Government Licence v3.0.
 * Config: { provisions: [{ uri: "/uksi/2014/2936/regulation/13", title: "Regulation 13 ..." }] }
 *
 * Note: revised legislation may have "outstanding effects" not yet applied by the
 * editorial team; the adapter records the dc:modified date and any
 * "UnappliedEffects" count so reviewers can see that caveat.
 */

const BASE = process.env.LEGISLATION_BASE_URL ?? "https://www.legislation.gov.uk";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", preserveOrder: false });

function collectText(node: unknown, out: string[], skip = new Set(["ukm:Metadata", "Metadata", "Contents", "Commentaries", "CommentaryRef"])) {
  if (node == null) return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out, skip));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith("@") || skip.has(k)) continue;
      if (k === "Pnumber" || k === "Number") out.push(`\n(${typeof v === "object" ? (v as Record<string, unknown>)["#text"] ?? "" : v}) `);
      collectText(v, out, skip);
      if (["P", "P1", "P2", "P3", "Para", "Text", "Title"].includes(k)) out.push("\n");
    }
  }
}

export function clmlToText(xml: string): { text: string; modified: Date | null; unappliedEffects: number; title: string | null } {
  const doc = parser.parse(xml);
  const leg = doc.Legislation ?? doc;
  const meta = leg["ukm:Metadata"] ?? {};
  const modified = parseDate(meta["dc:modified"]);
  const title = typeof meta["dc:title"] === "string" ? meta["dc:title"] : null;
  const effects = meta["ukm:UnappliedEffects"]?.["ukm:UnappliedEffect"];
  const unappliedEffects = Array.isArray(effects) ? effects.length : effects !== undefined ? 1 : 0;
  const out: string[] = [];
  collectText(leg.Primary ?? leg.Secondary ?? leg, out);
  return { text: normaliseText(out.join(" ").replace(/ +\n/g, "\n")), modified, unappliedEffects, title };
}

export const legislationAdapter: SourceAdapter = {
  method: "LEGISLATION_GOV_UK",
  retrievesFullContent: true,
  async discover(source) {
    const cfg = source.config as { provisions?: { uri: string; title: string }[] };
    return (cfg.provisions ?? []).map((p) => ({
      externalId: p.uri,
      url: `${BASE}${p.uri}`,
      title: p.title,
      documentType: "legislation_provision",
      locator: { uri: p.uri },
    }));
  },
  async retrieve(_source, doc, ctx) {
    const res = await ctx.http.get(`${BASE}${doc.locator.uri as string}/data.xml`, { Accept: "application/xml" });
    const parsed = clmlToText(res.text());
    return {
      title: parsed.title ?? doc.title,
      url: doc.url,
      contentType: "application/xml",
      raw: res.body,
      sections: [{ ref: String(doc.locator.uri), heading: doc.title, text: parsed.text }],
      modifiedAt: parsed.modified,
      legalStatus: "LEGISLATION",
      documentType: "legislation_provision",
      metadata: { unappliedEffects: parsed.unappliedEffects, licence: "Open Government Licence v3.0" },
    };
  },
};

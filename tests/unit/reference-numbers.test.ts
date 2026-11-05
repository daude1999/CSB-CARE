import { describe, expect, it } from "vitest";
import { basicRead, readingToFacts } from "@/lib/care-coordinator-rules";
import { classifyReferenceContext, findFrameworki, frameworkiReferences, issuerShort, referenceSearchValues, referenceTitle, storedSpellings } from "@/lib/reference-numbers";

// Fictional identifiers only.

describe("Frameworki recognition", () => {
  it.each([
    ["Frameworki 9900176", "9900176"],
    ["LBTH Frameworki 9900176", "9900176"],
    ["Frameworki: 9900176", "9900176"],
    ["lbth   FRAMEWORKI    9900176", "9900176"],
    ["Frameworki ID: 0099017", "0099017"],
    ["Client: Ada Fictional (LBTH Frameworki 0099017)", "0099017"],
  ])("reads %s", (text, value) => {
    expect(findFrameworki(text).map((m) => m.value)).toEqual([value]);
  });

  it("keeps leading zeroes and the exact wording, and ignores the label without a number", () => {
    const [m] = findFrameworki("Person's LBTH Frameworki 0000412 (see page 2)");
    expect(m).toMatchObject({ value: "0000412", lbth: true, quote: "Person's LBTH Frameworki 0000412 (see page 2)" });
    expect(findFrameworki("Recorded on Frameworki by the social worker")).toEqual([]);
  });

  it("finds the page and issuer, once per number", () => {
    const refs = frameworkiReferences(["Tower Hamlets Council\nSupport plan", "Name: Ada\nLBTH Frameworki 9900176\nAgain: Frameworki 9900176"], "Tower Hamlets Council");
    expect(refs).toEqual([{ type: "COUNCIL_CLIENT", typeClear: false, issuer: "Tower Hamlets Council", system: "Frameworki", value: "9900176", page: 2, quote: "LBTH Frameworki 9900176" }]);
  });
});

describe("classification from the words around the number", () => {
  it("is clear only when the context says what the number identifies", () => {
    expect(classifyReferenceContext("Client Frameworki ID 9900176")).toEqual({ type: "COUNCIL_CLIENT", clear: true });
    expect(classifyReferenceContext("Care package Frameworki 9900176")).toEqual({ type: "COUNCIL_PACKAGE", clear: true });
    expect(classifyReferenceContext("Framework contract Frameworki 9900176")).toEqual({ type: "COUNCIL_FRAMEWORK", clear: true });
  });
  it("never treats the word Frameworki as a framework, and asks when unclear or contradictory", () => {
    expect(classifyReferenceContext("LBTH Frameworki 9900176")).toEqual({ type: "COUNCIL_CLIENT", clear: false });
    expect(classifyReferenceContext("Client package Frameworki 9900176")).toEqual({ type: "COUNCIL_CLIENT", clear: false });
  });
});

describe("the basic reader (support plan text)", () => {
  const pages = ["Tower Hamlets Council - Adult Social Care\nSupport Plan\nFull name: Ada Fictional", "LBTH Frameworki 0099017\nPackage reference: PO-55501\nReference: Frameworki 0099017"];
  it("proposes the Frameworki number as an unclear reference on its page, and never as the care package reference", () => {
    const r = basicRead(pages);
    expect(r.references).toHaveLength(1);
    expect(r.references[0]).toMatchObject({ value: "0099017", page: 2, system: "Frameworki", typeClear: false, issuer: "Tower Hamlets Council" });
    expect(r.package.map((p) => [p.field, p.value])).toEqual([["reference", "PO-55501"]]);
    const fact = readingToFacts(r).find((f) => f.destination === "externalReference")!;
    expect(fact.value).toEqual({ type: "COUNCIL_CLIENT", issuer: "Tower Hamlets Council", value: "0099017", system: "Frameworki", typeUnclear: true });
    expect(fact.label).toBe("Tower Hamlets – Frameworki (type to confirm)");
    expect(fact.note).toMatch(/does not say what this number identifies/);
  });
});

describe("labels and search", () => {
  it("titles a reference by issuer and system", () => {
    expect(issuerShort("Tower Hamlets Council")).toBe("Tower Hamlets");
    expect(referenceTitle({ type: "COUNCIL_CLIENT", issuer: "Tower Hamlets Council", systemLabel: "Frameworki" })).toBe("Tower Hamlets – Frameworki");
    expect(referenceTitle({ type: "COUNCIL_PACKAGE", issuer: "Example Council", systemLabel: null })).toBe("Council package reference");
  });
  it("turns labelled searches into the bare number, and NHS numbers into both spellings", () => {
    expect(referenceSearchValues("Frameworki 0099017")).toEqual(["Frameworki 0099017", "0099017"]);
    expect(referenceSearchValues("LBTH Frameworki: 0099017")).toContain("0099017");
    expect(referenceSearchValues("0099017")).toEqual(["0099017"]);
    expect(referenceSearchValues("999 000 0009")).toEqual(expect.arrayContaining(["999 000 0009", "9990000009"]));
    expect(storedSpellings("NHS", "9990000009")).toEqual(["9990000009", "999 000 0009"]);
    expect(storedSpellings("COUNCIL_CLIENT", " 0099017 ")).toEqual(["0099017"]);
  });
});

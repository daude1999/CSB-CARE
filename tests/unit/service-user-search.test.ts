import { describe, expect, it } from "vitest";
import { cleanSearch, mayBeExternalReference, nameTerms, postcodeSpellings, referenceSpellings } from "@/lib/service-user-search";
import { referenceSearchValues } from "@/lib/reference-numbers";

describe("reading a service-user search entry", () => {
  it("tidies spacing and splits a full name into words", () => {
    expect(cleanSearch("  Fatuma   Ali ")).toBe("Fatuma Ali");
    expect(nameTerms("Fatuma  Ali")).toEqual(["Fatuma", "Ali"]);
    expect(nameTerms("   ")).toEqual([]);
  });

  it("understands short spellings of CSB and SU numbers", () => {
    expect(referenceSpellings("csb 159")).toContain("CSB-000159");
    expect(referenceSpellings("CSB159")).toContain("CSB-000159");
    expect(referenceSpellings("CSB-000159")).toEqual(["CSB-000159"]);
    expect(referenceSpellings("su 159")).toContain("SU-159");
    expect(referenceSpellings("Fatuma")).toEqual(["Fatuma"]);
  });

  it("adds the usual space to a postcode typed without one", () => {
    expect(postcodeSpellings("e14ab")).toContain("E1 4AB");
    expect(postcodeSpellings("E14 9XY")).toEqual(["E14 9XY", "E14 9XY".toUpperCase()].filter((v, i, a) => a.indexOf(v) === i));
    expect(postcodeSpellings("Fatuma")).toEqual(["Fatuma"]);
  });

  it("only entries with a digit are looked up in the reference register", () => {
    expect(mayBeExternalReference("Fatuma Ali")).toBe(false);
    expect(mayBeExternalReference("1088676")).toBe(true);
    expect(mayBeExternalReference("Frameworki 1088676")).toBe(true);
  });

  it("labelled Frameworki and NHS entries are also tried as the bare number", () => {
    expect(referenceSearchValues("Frameworki 1088676")).toContain("1088676");
    expect(referenceSearchValues("LBTH Frameworki: 1088676")).toContain("1088676");
    expect(referenceSearchValues("NHS 943 476 5919")).toContain("9434765919");
  });
});

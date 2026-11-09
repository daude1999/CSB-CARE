import { describe, expect, it } from "vitest";
import { exceptionSeverity, factKey, safetyOf, triage, type TriageFact } from "@/lib/coordinator-triage";

/** CSB AI's sorting rules (owner's brief of 7 Nov 2026, section 7): routine, repeat, follow-up, material, safety. */
let n = 0;
const fact = (p: Partial<TriageFact> & Pick<TriageFact, "destination" | "value">): TriageFact => ({
  id: `f${++n}`, section: p.destination.startsWith("person.") ? "PERSONAL" : p.destination === "contact" ? "CONTACTS" : p.destination === "visit" ? "VISITS" : p.destination.startsWith("package.") ? "PACKAGE" : p.destination.startsWith("careplan.") ? "CARE_PLAN" : p.destination.startsWith("medication") ? "MEDICATION" : "PERSONAL",
  label: p.destination, position: n, sourceDocumentId: "d1", sourcePage: 1, quote: "q", verification: "VERIFIED", temporal: "CURRENT", origin: "AI", conflict: null, existingValue: null, decision: "PENDING", appliedAt: null, ...p,
});
const docs = [{ id: "d1", name: "Plan", documentDate: "2026-11-01", sensitive: false }, { id: "d2", name: "Older letter", documentDate: "2026-01-01", sensitive: false }];
const kinds = (facts: TriageFact[], mode = "NEW") => triage({ mode, facts, docs }).map((o) => [o.kind, "exception" in o && o.exception ? o.exception.severity : null]);

describe("triage", () => {
  it("consolidates the same contact repeated three times into one", () => {
    const c = { kind: "NEXT_OF_KIN", name: "Mary Specimen", phone: "0200 000 0202" };
    expect(kinds([fact({ destination: "contact", value: c }), fact({ destination: "contact", value: { ...c, kind: "FAMILY" } }), fact({ destination: "contact", value: { ...c, phone: "02000000202" } })])).toEqual([["ROUTINE", null], ["DUPLICATE", null], ["DUPLICATE", null]]);
  });

  it("saves a preferred language and a care need without a day, without raising anything", () => {
    expect(kinds([fact({ destination: "person.firstLanguage", value: "English" }), fact({ destination: "careplan.home", value: { support: "Support to declutter and organise items around his property" } })])).toEqual([["ROUTINE", null], ["ROUTINE", null]]);
  });

  it("asks for identity review when two dates of birth differ, never picking one", () => {
    const out = triage({ mode: "NEW", docs, facts: [fact({ destination: "person.dateOfBirth", value: "1938-05-14" }), fact({ destination: "person.dateOfBirth", value: "1938-05-15", sourceDocumentId: "d2" })] });
    expect(out.map((o) => o.kind)).toEqual(["WAIT", "WAIT"]);
    expect(out.every((o) => o.kind === "WAIT" && o.identity)).toBe(true);
    expect(out[0]!.kind === "WAIT" && out[0]!.exception?.severity).toBe("REVIEW");
  });

  it("uses the newest document for an ordinary field and keeps the older value for reference", () => {
    expect(kinds([fact({ destination: "package.startDate", value: "2026-11-10" }), fact({ destination: "package.startDate", value: "2026-02-01", sourceDocumentId: "d2" })])).toEqual([["ROUTINE", null], ["NOT_USED", null]]);
  });

  it("raises an undated disagreement once, as material", () => {
    const d = [{ id: "d1", name: "A", documentDate: null, sensitive: false }, { id: "d2", name: "B", documentDate: null, sensitive: false }];
    const out = triage({ mode: "NEW", docs: d, facts: [fact({ destination: "package.minutesPerWeek", value: 1485 }), fact({ destination: "package.minutesPerWeek", value: 1488, sourceDocumentId: "d2" })] });
    expect(out.filter((o) => o.kind === "WAIT" && o.exception).length).toBe(1);
  });

  it("sets up a temporary visit and adds a non-blocking follow-up for its end date", () => {
    expect(kinds([fact({ destination: "visit", value: { weekdays: [2], startTime: "15:00", durationMin: 45, carers: 1, fundedBy: "COUNCIL" }, conflict: "The document says this visit is temporary but gives no end date. Confirm the end date with the commissioner." })])).toEqual([["ROUTINE", "FOLLOW_UP"]]);
  });

  it("does not save words that are not on the page, and keeps historical details out of the current record", () => {
    expect(kinds([fact({ destination: "person.phone", value: "0200", verification: "UNVERIFIED", conflict: "The quote was not found on page 1. Compare with the original before approving." }), fact({ destination: "person.addressLine1", value: "Old Street", temporal: "HISTORICAL" })])).toEqual([["WAIT", "FOLLOW_UP"], ["NOT_USED", null]]);
  });

  it("routes medication to reconciliation and proposes changes to care already arranged", () => {
    expect(kinds([fact({ destination: "medication.item", value: { name: "Furosemide", dose: "40mg" } })])[0]![0]).toBe("ROUTINE");
    expect(kinds([fact({ destination: "visit", value: { weekdays: [1], startTime: "08:00", durationMin: 30, carers: 1, fundedBy: "COUNCIL" } }), fact({ destination: "visit", value: { weekdays: [2], startTime: "09:00", durationMin: 30, carers: 1, fundedBy: "COUNCIL" } })], "EXISTING")).toEqual([["WAIT", "REVIEW"], ["WAIT", null]]);
  });

  it("changes nothing for a supporting document except safety", () => {
    expect(kinds([fact({ destination: "person.phone", value: "0200 000 0001" }), fact({ destination: "careplan.home", value: { support: "Safeguarding concern: neighbour has been taking his money" } })], "DOCUMENT")).toEqual([["WAIT", "URGENT"]]);
  });

  it("leaves people's decisions alone", () => {
    expect(triage({ mode: "NEW", docs, facts: [fact({ destination: "person.phone", value: "1", decision: "REJECTED" }), fact({ destination: "person.town", value: "London", decision: "APPROVED" })] })).toEqual([]);
  });
});

describe("safety", () => {
  it("escalates a current safeguarding concern, reviews a past one, and ignores a stated absence", () => {
    expect(safetyOf("His nephew has been using his bank card. Safeguarding referral to be considered.", "CURRENT")?.severity).toBe("URGENT");
    expect(safetyOf("Possible financial abuse by a relative", "CURRENT")?.severity).toBe("URGENT");
    expect(safetyOf("A safeguarding enquiry in 2019 was closed", "HISTORICAL")?.severity).toBe("REVIEW");
    expect(safetyOf("No safeguarding concerns", "CURRENT")).toBeNull();
  });
  it("records DNACPR as unverified, never as a decision", () => {
    const s = safetyOf("Family say there is a DNACPR in place", "CURRENT")!;
    expect([s.severity, s.category]).toEqual(["REVIEW", "DNACPR"]);
    expect(s.description).toMatch(/No DNACPR status has been recorded/);
  });
  it("gives older items their category's usual severity", () => {
    expect(exceptionSeverity({ severity: null, category: "PACKAGE_HOURS" })).toBe("REVIEW");
    expect(exceptionSeverity({ severity: null, category: "FUNDING" })).toBe("FOLLOW_UP");
    expect(exceptionSeverity({ severity: "INFO", category: "MISSING_INFO" })).toBe("INFO");
  });
  it("keys visits and references so only true repeats match", () => {
    expect(factKey({ destination: "visit", value: { weekdays: [1, 2], startTime: "08:00", durationMin: 60, carers: 2, fundedBy: "COUNCIL" } })).toBe(factKey({ destination: "visit", value: { weekdays: [2, 1], startTime: "08:00", durationMin: 60, carers: 2, fundedBy: "COUNCIL" } }));
    expect(factKey({ destination: "visit", value: { weekdays: [1], startTime: "08:00", durationMin: 60, carers: 2, fundedBy: "COUNCIL" } })).not.toBe(factKey({ destination: "visit", value: { weekdays: [1], startTime: "08:00", durationMin: 45, carers: 2, fundedBy: "COUNCIL" } }));
  });
});

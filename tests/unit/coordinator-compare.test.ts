import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { factChange, isRoutine } from "@/server/care/coordinator/compare";

/** Field-by-field comparison of a revised plan with the record. */
const base = { section: "PERSONAL", conflict: null, verification: "VERIFIED" };
const templates = [{ id: "t1", weekdays: [1, 2, 3, 4, 5], startMinute: 540, durationMin: 45, carersRequired: 1 }];

describe("factChange", () => {
  it("tells new, unchanged and changed details apart", () => {
    expect(factChange({ ...base, destination: "person.postcode", value: "E1 1AA", existingValue: null }, [], [])).toBe("NEW");
    expect(factChange({ ...base, destination: "person.postcode", value: "e1  1aa", existingValue: "E1 1AA" }, [], [])).toBe("UNCHANGED");
    expect(factChange({ ...base, destination: "person.postcode", value: "E2 2BB", existingValue: "E1 1AA" }, [], [])).toBe("CHANGED");
  });
  it("marks details the documents disagree about as conflicting", () => {
    expect(factChange({ ...base, destination: "person.phone", value: "1", existingValue: null, conflict: 'Letter (page 2) says "2".' }, [], [])).toBe("CONFLICTING");
  });
  it("compares visits with the repeating visits on record", () => {
    const v = (over: object) => ({ ...base, section: "VISITS", destination: "visit", existingValue: null, value: { weekdays: [1, 2], startTime: "09:00", durationMin: 45, carers: 1, ...over } });
    expect(factChange(v({}), templates, [])).toBe("UNCHANGED");
    expect(factChange(v({ durationMin: 30 }), templates, [])).toBe("CHANGED");
    expect(factChange(v({ startTime: "13:00" }), templates, [])).toBe("NEW");
  });
  it("knows contacts already on record", () => {
    expect(factChange({ ...base, section: "CONTACTS", destination: "contact", existingValue: null, value: { name: "Sam Example" } }, [], ["sam example"])).toBe("UNCHANGED");
  });
});

describe("isRoutine", () => {
  it("accepts unchanged values and verified new personal details only", () => {
    const f = { ...base, destination: "person.phone", value: "1", existingValue: null };
    expect(isRoutine(f, "UNCHANGED")).toBe(true);
    expect(isRoutine(f, "NEW")).toBe(true);
    expect(isRoutine({ ...f, verification: "UNVERIFIED" }, "NEW")).toBe(false);
    expect(isRoutine({ ...f, section: "CARE_PLAN" }, "NEW")).toBe(false);
    expect(isRoutine({ ...f, section: "MEDICATION" }, "UNCHANGED")).toBe(false);
    expect(isRoutine(f, "CHANGED")).toBe(false);
    expect(isRoutine(f, "CONFLICTING")).toBe(false);
  });
});

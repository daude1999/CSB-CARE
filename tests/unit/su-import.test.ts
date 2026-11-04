import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { draftFromExtraction, emptyDraft, guessCallType, hoursToMinutes, importDraftSchema, importSummary, weeklyTotals } from "@/server/care/su-import";
import type { SupportPlanExtraction } from "@/server/ai/schemas";

/** Set up from support plan: the pure mapping from a timetable to templates, weekly totals and the draft checks. */

const CALL_TYPES = [
  { id: "bed", name: "Bed call" },
  { id: "lunch", name: "Lunch call" },
  { id: "morning", name: "Morning call" },
  { id: "sit", name: "Sitting service" },
  { id: "tea", name: "Tea call" },
];

const f = (value: string, page = 1) => ({ value, page });

function extraction(): SupportPlanExtraction {
  return {
    person: { firstName: f("Test"), lastName: f("Person"), dateOfBirth: f("1944-01-01"), gender: f("Female"), nhsNumber: null, addressLine1: f("Flat 1 Example House"), addressLine2: f("Example Street"), town: f("London"), postcode: f("E1 1AA"), phone: f("07000 000000"), firstLanguage: f("Somali", 2), accessNotes: f("Lift: yes. Can open the door unaided.", 2), communicationNeeds: null, councilReference: f("1000001") },
    contacts: [
      { kind: "NEXT_OF_KIN", name: "Daughter Example", relationship: "Daughter", phone: "0200 000 0000", altPhone: null, address: "Flat 1 Example House", isEmergency: false, isKeyHolder: true, page: 3 },
      { kind: "OTHER", name: "Friend Example", relationship: "Friend", phone: "07000 000001", altPhone: null, address: null, isEmergency: true, isKeyHolder: false, page: 2 },
      { kind: "GP", name: "Dr Example", relationship: "GP", phone: null, altPhone: null, address: "Example Health Centre", isEmergency: false, isKeyHolder: false, page: 4 },
    ],
    package: { funder: f("Example Council"), startDate: f("2026-09-30", 8), endDate: f("2026-11-10", 8), hoursPerWeek: f("3.5", 7), costPerWeek: f("£81.06", 7), requirements: f("All visits single handed", 5) },
    visits: [
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "09:00", durationMinutes: 60, carers: 1, tasks: "Personal care, meal preparation and prompt with medication", fundedBy: "COUNCIL", medicationPrompt: true, isNew: false, pages: [8] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "12:00", durationMinutes: 45, carers: 1, tasks: "Meal preparation, prompt with medication if required", fundedBy: "COUNCIL", medicationPrompt: true, isNew: false, pages: [8] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "16:30", durationMinutes: 30, carers: 1, tasks: "NEW SERVICE: teatime snack, continence care, prompt with medication as required", fundedBy: "COUNCIL", medicationPrompt: true, isNew: true, pages: [8, 9] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "20:00", durationMinutes: 60, carers: 1, tasks: "Bedtime routine", fundedBy: "COUNCIL", medicationPrompt: false, isNew: false, pages: [9] },
      { weekdays: [3], startTime: "11:00", durationMinutes: 60, carers: 1, tasks: "Food shopping", fundedBy: "CARERS_SERVICE", medicationPrompt: false, isNew: false, pages: [9] },
      { weekdays: [1], startTime: "12:45", durationMinutes: 60, carers: 1, tasks: "Clean the bedroom, kitchen, bathroom and hallway; laundry", fundedBy: "CARERS_SERVICE", medicationPrompt: false, isNew: false, pages: [9, 10] },
    ],
    flags: [{ text: "Evening visit given as 19:30 in the narrative and 20:00 in the timetable", pages: [6, 9] }],
    unreadable: [],
  };
}

describe("hours and minutes", () => {
  it("converts the council's decimal hours to minutes", () => {
    expect(hoursToMinutes("1")).toBe(60);
    expect(hoursToMinutes("0.75")).toBe(45);
    expect(hoursToMinutes("0.5")).toBe(30);
    expect(hoursToMinutes(3.5)).toBe(210);
    expect(hoursToMinutes("")).toBeNull();
    expect(hoursToMinutes("0")).toBeNull();
  });

  it("adds up weekly minutes by who funds each row", () => {
    const t = weeklyTotals(extraction().visits.map((v) => ({ weekdays: v.weekdays, durationMin: v.durationMinutes, carers: v.carers, fundedBy: v.fundedBy })));
    expect(t.COUNCIL).toBe(420 + 315 + 210 + 420);
    expect(t.CARERS_SERVICE).toBe(120);
    expect(t.total).toBe(1485);
    expect(t.carerMinutes).toBe(1485);
    // Repeated days count once, and a double-up counts twice for carer minutes.
    expect(weeklyTotals([{ weekdays: [1, 1, 2], durationMin: 30, carers: 2, fundedBy: "OTHER" }])).toMatchObject({ OTHER: 60, total: 60, carerMinutes: 120 });
  });
});

describe("call type guess", () => {
  it("picks by time of day, and a sitting or domestic type for shopping and cleaning rows", () => {
    expect(guessCallType("09:00", "Personal care", CALL_TYPES)).toBe("morning");
    expect(guessCallType("12:00", "Meal preparation", CALL_TYPES)).toBe("lunch");
    expect(guessCallType("16:30", "Teatime snack", CALL_TYPES)).toBe("tea");
    expect(guessCallType("20:00", "Bedtime routine", CALL_TYPES)).toBe("bed");
    expect(guessCallType("11:00", "Food shopping", CALL_TYPES)).toBe("sit");
    expect(guessCallType("12:45", "Clean the bedroom and laundry", CALL_TYPES)).toBe("sit");
    // Falls back to the first type rather than nothing, so the office can change it.
    expect(guessCallType("nonsense", "x", CALL_TYPES)).toBe("bed");
    expect(guessCallType("09:00", "x", [])).toBe("");
  });
});

describe("draft from a reading", () => {
  it("keeps every timetable row with its pages, task text and funding, and marks temporary rows from the package start", () => {
    const d = draftFromExtraction(extraction(), CALL_TYPES, ["plan.pdf", "letter.pdf"]);
    expect(d.person).toMatchObject({ firstName: "Test", lastName: "Person", dateOfBirth: "1944-01-01", postcode: "E1 1AA", councilReference: "1000001", carerGenderPreference: "ANY" });
    expect(d.contacts).toHaveLength(3);
    expect(d.contacts[0]).toMatchObject({ kind: "NEXT_OF_KIN", isKeyHolder: true, isEmergency: false, sourcePage: 3 });
    expect(d.contacts[1]).toMatchObject({ isEmergency: true });
    expect(d.package).toMatchObject({ funderName: "Example Council", startDate: "2026-09-30", endDate: "2026-11-10", commissionedMinutesPerWeek: 210 });
    expect(d.package.requirements).toContain("All visits single handed");
    expect(d.visits).toHaveLength(6);
    expect(d.visits[2]).toMatchObject({ startTime: "16:30", durationMin: 30, callTypeId: "tea", medicationPrompt: true, effectiveFrom: "2026-09-30", sourcePages: [8, 9] });
    expect(d.visits[3]).toMatchObject({ startTime: "20:00", callTypeId: "bed", medicationPrompt: false });
    expect(d.visits[4]).toMatchObject({ weekdays: [3], fundedBy: "CARERS_SERVICE", callTypeId: "sit" });
    expect(d.visits[0]!.effectiveFrom).not.toBe("2026-09-30");
    expect(d.documents).toEqual([
      { fileIndex: 0, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "plan", markSensitive: false },
      { fileIndex: 1, section: "OTHER", category: "OTHER_SUPPORTING", name: "letter", markSensitive: false },
    ]);
    expect(d.flags).toEqual(["Evening visit given as 19:30 in the narrative and 20:00 in the timetable (page 6, 9)"]);
    expect(d.careActiveFrom).toBe("2026-09-30");
  });

  it("ignores dates and times the reading got into the wrong shape instead of guessing", () => {
    const x = extraction();
    x.person.dateOfBirth = f("01/01/1944");
    x.package.startDate = f("30th September");
    x.visits[0]!.startTime = "9am";
    const d = draftFromExtraction(x, CALL_TYPES, ["plan.pdf"]);
    expect(d.person.dateOfBirth).toBeUndefined();
    expect(d.visits[0]!.startTime).toBe("");
    expect(d.package.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives an empty draft for typing in, with the files already listed", () => {
    const d = emptyDraft(["Support plan.pdf"]);
    expect(d.visits).toEqual([]);
    expect(d.documents[0]).toMatchObject({ section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "Support plan" });
  });
});

describe("draft checks", () => {
  it("refuses rows without days, a bad time, or an end before the start", () => {
    const d = draftFromExtraction(extraction(), CALL_TYPES, ["plan.pdf"]);
    expect(importDraftSchema.safeParse(d).success).toBe(true);
    expect(importDraftSchema.safeParse({ ...d, visits: [{ ...d.visits[0], weekdays: [] }] }).success).toBe(false);
    expect(importDraftSchema.safeParse({ ...d, visits: [{ ...d.visits[0], startTime: "9" }] }).success).toBe(false);
    expect(importDraftSchema.safeParse({ ...d, visits: [{ ...d.visits[0], effectiveFrom: "2026-10-10", effectiveTo: "2026-10-01" }] }).success).toBe(false);
    expect(importDraftSchema.safeParse({ ...d, person: { ...d.person, firstName: "" } }).success).toBe(false);
    expect(importDraftSchema.safeParse({ ...d, documents: [{ ...d.documents[0], name: "x" }] }).success).toBe(false);
  });

  it("summarises the gap between the timetable and the commissioned minutes", () => {
    const d = draftFromExtraction(extraction(), CALL_TYPES, ["plan.pdf"]);
    const s = importSummary(d);
    expect(s.COUNCIL).toBe(1365);
    expect(s.commissioned).toBe(210);
    expect(s.gap).toBe(1365 - 210);
    expect(importSummary({ ...d, package: { ...d.package, commissionedMinutesPerWeek: null } }).gap).toBeNull();
  });
});

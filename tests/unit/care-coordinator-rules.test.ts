import { describe, expect, it } from "vitest";
import { basicRead, classifyText, destinationSchema, displayValue, parseValue, parseVisitLine, quoteOnPage, reconcileHours, toIso } from "@/lib/care-coordinator-rules";
import { formDefaults, formSpec, valueFromForm } from "@/lib/care-coordinator-forms";

/** Pure rules of the AI Care Coordinator. Every name and number here is invented. */

describe("reading documents without AI", () => {
  it("classifies by the letterhead, not by an 'NHS number' line in a council plan", () => {
    const council = classifyText("Example Borough Council - Adult Social Care\nSupport Plan\nDate of plan: 15/09/2026\nNHS number: 999 000 0001");
    expect([council.kind, council.issuerKind, council.documentDate]).toEqual(["SUPPORT_PLAN", "COUNCIL", "2026-09-15"]);
    const nhs = classifyText("Example Hospitals NHS Foundation Trust\nHospital Discharge Summary\nDate of discharge: 20/08/2026");
    expect([nhs.kind, nhs.issuerKind]).toEqual(["DISCHARGE_LETTER", "NHS"]);
  });

  it("reads timetable rows, keeping family support apart from commissioned visits", () => {
    expect(parseVisitLine("Morning | 09:00-10:00 | Mon-Sun | 1 carer | Tasks: Assist with full wash; Help to dress")).toMatchObject({ label: "Morning", startTime: "09:00", durationMinutes: 60, weekdays: [1, 2, 3, 4, 5, 6, 7], carers: 1, fundedBy: "COUNCIL", tasks: ["Assist with full wash", "Help to dress"] });
    expect(parseVisitLine("Shopping | 11:00-12:00 | Wednesday | 1 carer | family support | Tasks: Food shopping")).toMatchObject({ weekdays: [3], fundedBy: "CARERS_SERVICE" });
    expect(parseVisitLine("Hours per week: 22.75")).toBeNull();
  });

  it("never copies a key safe code, and flags it instead", () => {
    const r = basicRead(["Full name: Ada Fictional\nKey safe code: 1234\nPostcode: E1 0ZZ"]);
    expect(JSON.stringify(r)).not.toContain("1234");
    expect(r.flags.some((f) => /key safe/i.test(f.text))).toBe(true);
  });

  it("checks quotes against the page, ignoring spacing and curly quotes", () => {
    expect(quoteOnPage("Ada  washes her face’s edge", "ada washes her face's edge")).toBe(true);
    expect(quoteOnPage("Something else", "Ada washes")).toBe(false);
    expect(quoteOnPage("", "Ada")).toBe(false);
  });

  it("turns UK dates into ISO and refuses impossible ones", () => {
    expect([toIso("30/12/2026"), toIso("2026-12-30"), toIso("31/02/2026")]).toEqual(["2026-12-30", "2026-12-30", null]);
  });
});

describe("commissioned hours", () => {
  const visits = [
    { weekdays: [1, 2, 3, 4, 5, 6, 7], durationMin: 60, carers: 1, fundedBy: "COUNCIL" as const },
    { weekdays: [1, 2, 3, 4, 5, 6, 7], durationMin: 45, carers: 1, fundedBy: "COUNCIL" as const },
    { weekdays: [1, 2, 3, 4, 5, 6, 7], durationMin: 30, carers: 1, fundedBy: "COUNCIL" as const },
    { weekdays: [1, 2, 3, 4, 5, 6, 7], durationMin: 60, carers: 1, fundedBy: "COUNCIL" as const },
    { weekdays: [3], durationMin: 60, carers: 1, fundedBy: "CARERS_SERVICE" as const },
  ];
  it("adds 195 minutes a day to 1,365 a week and leaves family support out", () => {
    const r = reconcileHours(visits, 1365);
    expect([r.COUNCIL, r.CARERS_SERVICE, r.matches]).toEqual([1365, 60, true]);
  });
  it("flags a difference and never adjusts it", () => {
    const r = reconcileHours(visits, 1485);
    expect([r.matches, r.gap]).toEqual([false, -120]);
    expect(r.message).toMatch(/120 minutes short/);
  });
});

describe("destinations and plain edit forms", () => {
  it("refuses a destination that is not part of the profile", () => {
    expect(destinationSchema("person.keySafeCode")).toBeNull();
    expect(parseValue("ServiceUser.notes", "x")).toEqual({ ok: false, error: "This destination is not part of the Service User profile" });
  });

  it("rebuilds a visit from labelled form fields, with no JSON", () => {
    const fd = new FormData();
    fd.set("v_label", "Tea");
    for (const d of ["1", "2", "3", "4", "5", "6", "7"]) fd.append("v_weekdays", d);
    fd.set("v_startTime", "16:30");
    fd.set("v_durationMin", "30");
    fd.set("v_carers", "1");
    fd.set("v_fundedBy", "COUNCIL");
    fd.set("v_tasks", "Prepare snack\nPrompt medication\n");
    fd.set("v_medicationPrompt", "on");
    const parsed = parseValue("visit", valueFromForm("visit", fd));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && displayValue("visit", parsed.value)).toBe("Tea · 16:30–17:00 · 30 min · Every day · 1 carer · 2 tasks");
  });

  it("shows validation messages a coordinator understands", () => {
    const fd = new FormData();
    fd.set("v_value", "12345");
    expect(parseValue("person.nhsNumber", valueFromForm("person.nhsNumber", fd))).toEqual({ ok: false, error: "An NHS number has 10 digits" });
    const risk = new FormData();
    risk.set("v_type", "FALLS");
    risk.set("v_title", "Falls");
    risk.set("v_hazard", "short");
    expect(parseValue("risk", valueFromForm("risk", risk))).toMatchObject({ ok: false, error: expect.stringMatching(/hazard/) });
  });

  it("fills the edit form from the stored value and has a form for every destination", () => {
    expect(formDefaults("contact", { kind: "GP", name: "Dr Example", isEmergency: true })).toMatchObject({ kind: "GP", name: "Dr Example", isEmergency: true, phone: "" });
    for (const d of ["person.firstName", "contact", "preference.gender", "careplan.mobility", "risk", "package.minutesPerWeek", "visit", "medication.item", "medication.arrangement", "incident.history", "bodymap.history"]) expect(formSpec(d).length).toBeGreaterThan(0);
  });
});

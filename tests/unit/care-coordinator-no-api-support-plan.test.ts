import { describe, expect, it } from "vitest";
import { basicRead, readingToFacts, reconcileHours } from "@/lib/care-coordinator-rules";

/**
 * Fully fictional test data: same *shape* as a complex council package,
 * never any actual person's identifying information or care records.
 */
const pages = [
  [
    "Sample Borough Council — Adult Social Care",
    "Support Plan",
    "Full name: Test Fictional",
    "Date of birth: 01/02/1945",
    "Address: 10 Test Street, Exampleton, E1 1AA",
    "Frameworki client reference: 1088676",
    "Funder: Sample Borough Council",
    "Package start: 01/11/2026",
    "Package end: 30/12/2026",
    "Hours per week: 22.75",
    "Staffing: Single-handed visits",
  ].join("\n"),
  [
    "About me",
    "Wishes to stay in their own home.",
    "Communication",
    "Prefers clear spoken information.",
    "Personal care",
    "Needs help with washing and dressing.",
    "Mobility",
    "Uses a walking frame and needs support standing.",
    "Nutrition and hydration",
    "Needs assistance preparing meals.",
    "Medication support",
    "Prompting is documented, but staff must check the current medicines.",
    "Health and wellbeing",
    "Needs monitoring by authorised care professionals.",
    "Home environment",
    "Prefers familiar surroundings.",
    "Outcomes",
    "Remain as independent as possible.",
  ].join("\n"),
  [
    "Timetable",
    "Morning call",
    "Start time: 09:00",
    "Duration: 1 hour",
    "Frequency: Daily",
    "Carers: 1",
    "Tasks: Assist with washing; Help with dressing",
    "Lunchtime visit",
    "Start time: 12:00",
    "Duration: 45 minutes",
    "Days: Mon-Sun",
    "Staff required: 1",
    "Tasks: Prepare lunch",
    "Shopping visit",
    "Start time: 11:00",
    "Duration: 60 minutes",
    "Days: Wednesday",
    "Carers: 1",
    "Provided by: Family",
    "Tasks: Shopping",
  ].join("\n"),
  [
    "Timetable continued",
    "Teatime call",
    "Start time: 16:30",
    "Duration: 30 minutes",
    "Days: Every day",
    "Carers: 1",
    "Tasks: Prepare tea",
    "Evening visit",
    "Start time: 20:00",
    "Duration: 1 hour",
    "Days: Daily",
    "Number of carers: 1",
    "Tasks: Help with bedtime",
  ].join("\n"),
];

describe("no-API council support plan parser", () => {
  it("extracts supported heading-based sections without fabricating clinical instructions", () => {
    const r = basicRead(pages);
    expect(new Set(r.carePlan.map(s=>s.section)).size).toBe(9);
    expect(r.carePlan.find(c=>c.section==="personal_care")?.support).toContain("washing");
    expect(r.carePlan.find(c=>c.section==="outcomes")?.outcome).toContain("independent");
    expect(r.risks).toHaveLength(0); // none explicitly evidenced in this fictional plan
    expect(r.missing.filter(s=>s.startsWith("Care plan section"))).toHaveLength(0);
  });

  it("extracts four council visits across continued pages and keeps family care separate", () => {
    const r=basicRead(pages);
    const council=r.visits.filter(v=>v.fundedBy==="COUNCIL");
    expect(council.map(v=>[v.startTime,v.durationMinutes,v.page])).toEqual([
      ["09:00",60,3],["12:00",45,3],["16:30",30,4],["20:00",60,4],
    ]);
    expect(r.visits.find(v=>v.label==="Shopping")?.fundedBy).toBe("CARERS_SERVICE");
    const totals=reconcileHours(readingToFacts(r).filter(f=>f.destination==="visit").map(f=>f.value as {weekdays:number[];durationMin:number;carers:number;fundedBy:"COUNCIL"|"CARERS_SERVICE"|"OTHER"}),1365);
    expect(totals.matches).toBe(true);
    expect(totals.COUNCIL).toBe(1365);
    expect(r.flags.filter(f=>/do not activate rota/i.test(f.text))).toHaveLength(0);
  });

  it("holds incomplete timetable blocks and never invents visit staffing", () => {
    const r=basicRead([
      "Sample Borough Council\nSupport Plan\nHours per week: 1",
      "Timetable\nMorning call\nStart time: 09:00\nDuration: 60 minutes\nDays: Daily\nTasks: Assist with washing",
    ]);
    expect(r.visits).toHaveLength(0);
    expect(r.flags.some(f=>/Incomplete visit details/.test(f.text))).toBe(true);
    expect(r.flags.some(f=>/do not activate rota/i.test(f.text))).toBe(true);
  });

  it("flags missing care-plan sections rather than inventing content", () => {
    const r=basicRead(["Sample Borough Council\nSupport Plan\nPersonal care: Assistance with dressing is recorded."]);
    expect(r.carePlan).toHaveLength(1);
    expect(r.missing.some(m=>m.includes("Medication support"))).toBe(true);
  });
});

// ── Edge cases for the visit-card layout (all fictional) ─────────────────────

const plan = (...cards: string[][]) => [
  "Sample Borough Council\nSupport Plan\nHours per week: 22.75",
  ["Timetable", ...cards.flat()].join("\n"),
];
const card = (head: string, f: Record<string, string>) => [head, ...Object.entries(f).map(([k, v]) => `${k}: ${v}`)];
const std = { "Start time": "09:00", Duration: "60 minutes", Days: "Daily", Carers: "1", Tasks: "Assist with washing" };

describe("no-API reader: mandatory acceptance checks", () => {
  it("keeps every fact's quote word for word on its source page", async () => {
    const { quoteOnPage } = await import("@/lib/care-coordinator-rules");
    const facts = readingToFacts(basicRead(pages));
    expect(facts.length).toBeGreaterThan(15);
    for (const f of facts) expect(quoteOnPage(pages[(f.page ?? 1) - 1], f.quote), `${f.destination} on page ${f.page}`).toBe(true);
  });

  it("keeps identifier types separate and never treats a Frameworki number as the package reference", () => {
    const facts = readingToFacts(basicRead(pages));
    const refs = facts.filter((f) => f.destination === "externalReference");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.value).toMatchObject({ type: "COUNCIL_CLIENT", value: "1088676", system: "Frameworki" });
    expect(facts.some((f) => f.destination === "package.reference")).toBe(false);
  });

  it("never invents a risk, a risk level or a section, and says what is not documented", () => {
    const r = basicRead([pages[0]!, pages[2]!, pages[3]!]);
    expect(r.risks).toHaveLength(0);
    expect(r.carePlan).toHaveLength(0);
    expect(r.missing.filter((m) => m.startsWith("Care plan section"))).toHaveLength(9);
  });
});

describe("no-API reader: edge cases", () => {
  it("contradictory pages: the same visit with a different duration is flagged, not merged", () => {
    const r = basicRead([
      "Sample Borough Council\nSupport Plan",
      ["Timetable", ...card("Morning call", std)].join("\n"),
      ["Timetable continued", ...card("Morning call", { ...std, Duration: "45 minutes" })].join("\n"),
    ]);
    expect(r.visits.map((v) => [v.page, v.durationMinutes])).toEqual([[2, 60], [3, 45]]);
    expect(r.flags.some((f) => /Pages 2 and 3 describe the Morning visit differently/.test(f.text))).toBe(true);
  });

  it("overnight visits keep their start and full length across midnight", () => {
    const r = basicRead(plan(card("Night sit", { ...std, "Start time": "22:00", Duration: "9 hours" })));
    expect(r.visits.map((v) => [v.label, v.startTime, v.durationMinutes])).toEqual([["Night sit", "22:00", 540]]);
    const range = basicRead(["Sample Borough Council\nSupport Plan\nNight | 22:00-07:00 | Mon-Sun | 1 carer | Tasks: Night support"]);
    expect(range.visits[0]).toMatchObject({ startTime: "22:00", durationMinutes: 540 });
  });

  it("discontinued services are history: flagged, not counted and not proposed as a current visit", () => {
    const r = basicRead(plan(card("Morning call", std), card("Lunchtime visit", { ...std, "Start time": "12:00", Status: "Discontinued from 01/10/2026" })));
    expect(r.visits.find((v) => v.label === "Lunchtime")?.temporal).toBe("HISTORICAL");
    expect(r.flags.some((f) => /Lunchtime visit on page 2 is marked "Discontinued/.test(f.text))).toBe(true);
    // 420 current council minutes against 1,365 stated: the mismatch is flagged, nothing is adjusted.
    expect(r.flags.some((f) => /totals 420 minutes per week, but source states 1365/.test(f.text))).toBe(true);
    expect(readingToFacts(r).find((f) => f.label === "Lunchtime")?.temporal).toBe("HISTORICAL");
  });

  it("funding ambiguity keeps the visit out of the council total and asks a manager", () => {
    const r = basicRead(plan(card("Morning call", { ...std, "Funded by": "Council / CHC (to be confirmed)" })));
    expect(r.visits[0]!.fundedBy).toBe("OTHER");
    expect(r.flags.some((f) => /funding is unclear/.test(f.text))).toBe(true);
    const nhs = basicRead(plan(card("Morning call", { ...std, "Funded by": "NHS Continuing Healthcare" })));
    expect(nhs.visits[0]!.fundedBy).toBe("OTHER");
    const agency = basicRead(plan(card("Morning call", { ...std, "Provided by": "Care Solution Bureau" })));
    expect(agency.visits[0]!.fundedBy).toBe("COUNCIL");
    expect(agency.flags.filter((f) => /funding|funded/.test(f.text))).toHaveLength(0);
  });

  it("supports up to 20 carers and flags a request above 20 instead of silently capping it", () => {
    const twenty = basicRead(plan(card("Morning call", { ...std, Carers: "20" })));
    expect(twenty.visits[0]!.carers).toBe(20);
    expect(twenty.flags.some((f) => /at most 20 carers/.test(f.text))).toBe(false);
    const many = basicRead(plan(card("Morning call", { ...std, Carers: "25" })));
    expect(many.flags.some((f) => /asks for 25 carers/.test(f.text))).toBe(true);
  });

  it("a double-up is one hour of visit time and two hours of carer time", () => {
    const r = basicRead(plan(card("Morning call", { ...std, Carers: "2" })));
    const totals = reconcileHours(readingToFacts(r).filter((f) => f.destination === "visit").map((f) => f.value as { weekdays: number[]; durationMin: number; carers: number; fundedBy: "COUNCIL" | "CARERS_SERVICE" | "OTHER" }), 420);
    expect([totals.COUNCIL, totals.carerMinutes, totals.matches]).toEqual([420, 840, true]);
  });

  it("a visit card's end date and staffing stay with the visit, never the package", () => {
    const r = basicRead(plan(card("Teatime call", { ...std, "Start time": "16:30", Status: "Temporary", "End date": "10/11/2026", "Number of carers": "1" })));
    expect(r.visits[0]).toMatchObject({ startTime: "16:30", endDate: "10/11/2026" });
    expect(r.package.map((p) => p.field)).toEqual(["hoursPerWeek"]);
    const temp = basicRead(plan(card("Teatime call", { ...std, Status: "Temporary" })));
    expect(temp.flags.some((f) => /temporary but no end date/.test(f.text))).toBe(true);
  });

  it("partially unreadable files: blank pages are reported and the rest is still read", () => {
    const r = basicRead([pages[0]!, "", pages[2]!, "   "]);
    expect(r.unreadable.map((u) => u.page)).toEqual([2, 4]);
    expect(r.visits.filter((v) => v.fundedBy === "COUNCIL").map((v) => v.startTime)).toEqual(["09:00", "12:00"]);
  });
});

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

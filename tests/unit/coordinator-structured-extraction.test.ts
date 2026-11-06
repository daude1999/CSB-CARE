import { describe, expect, it } from "vitest";
import { CARE_PLAN_TOPICS, basicRead, displayValue, parseValue, readingToFacts, type Reading } from "@/lib/care-coordinator-rules";
import { formSpec, valueFromForm } from "@/lib/care-coordinator-forms";
import { toWire, schemaComplexity, STRUCTURED_LIMITS } from "@/server/ai/wire-schema";
import { CareDocumentExtractionSchema } from "@/server/ai/schemas";
import { z } from "zod/v4";

/** Phase 2 of the AI CSB Coordinator: care plan topics, risk mitigation, visit details. Every name here is invented. */

function emptyReading(): Reading {
  return {
    document: { kind: "SUPPORT_PLAN", issuer: "Example Borough Council", issuerKind: "COUNCIL", documentDate: "2026-10-01", pageCount: 3 },
    person: [], references: [], contacts: [], carerPreferences: [], carePlan: [], risks: [], package: [], visits: [],
    medication: { arrangement: null, items: [], allergies: [] }, incidents: [], skin: [], flags: [], missing: [], unreadable: [], communications: [],
  };
}
const at = { page: 2, quote: "As written on the page", temporal: "CURRENT" as const };

describe("care plan topics", () => {
  it("every topic lands in one of the nine existing care plan sections", () => {
    for (const t of Object.values(CARE_PLAN_TOPICS)) expect(["about_me", "communication", "personal_care", "mobility", "nutrition", "medication", "health", "home", "outcomes"]).toContain(t.section);
  });

  it("the topic decides the section and the label, and preferences are kept", () => {
    const r = emptyReading();
    r.carePlan.push({ section: "home", topic: "TOILETING_CONTINENCE", canDo: "Uses the toilet with a frame", support: "Help at night", how: "Leave the commode within reach", preferences: "Female carer for personal care", outcome: null, clarify: null, ...at });
    const [f] = readingToFacts(r);
    expect(f).toMatchObject({ section: "CARE_PLAN", destination: "careplan.personal_care", label: "Toileting and continence" });
    expect(f!.value).toMatchObject({ topic: "TOILETING_CONTINENCE", preferences: "Female carer for personal care" });
    expect(displayValue(f!.destination, f!.value)).toContain("Preferences: Female carer for personal care");
  });

  it("an older reading with no topic keeps its section", () => {
    const r = emptyReading();
    r.carePlan.push({ section: "mobility", canDo: null, support: "Walks with a frame", how: null, outcome: null, clarify: null, ...at });
    expect(readingToFacts(r)[0]).toMatchObject({ destination: "careplan.mobility", label: "Mobility and moving" });
  });

  it("the basic reader recognises the new headings with their topics", () => {
    const r = basicRead(["Support Plan\nToileting: Needs prompting every two hours\nSleep: Settles at 22:00, no night support\nCultural needs: Prefers halal meals\nHousehold: Help with laundry weekly\nIn an emergency: Call the daughter first"]);
    const byTopic = Object.fromEntries(r.carePlan.map((c) => [c.topic, c.section]));
    expect(byTopic).toMatchObject({ TOILETING_CONTINENCE: "personal_care", SLEEP_NIGHT: "health", CULTURE_RELIGION: "about_me", HOUSEHOLD: "home", EMERGENCY: "home" });
  });

  it("the edit form offers only that section's topics and a preferences field", () => {
    const spec = formSpec("careplan.personal_care");
    const topic = spec.find((f) => f.name === "topic");
    expect(topic?.options?.map(([k]) => k)).toEqual(["", "PERSONAL_CARE", "WASHING_DRESSING", "TOILETING_CONTINENCE"]);
    expect(spec.some((f) => f.name === "preferences")).toBe(true);
    const fd = new FormData();
    fd.set("v_topic", "WASHING_DRESSING");
    fd.set("v_support", "Full wash at the sink");
    fd.set("v_preferences", "Shower on Sundays");
    const parsed = parseValue("careplan.personal_care", valueFromForm("careplan.personal_care", fd));
    expect(parsed).toMatchObject({ ok: true, value: { topic: "WASHING_DRESSING", preferences: "Shower on Sundays" } });
  });
});

describe("risks", () => {
  it("mitigation becomes the recommended actions, and assessor gaps become open questions", () => {
    const r = emptyReading();
    r.risks.push({ type: "FALLS", title: "Falls at night", hazard: "Has fallen twice getting up to the toilet at night", whoAffected: "The person", existingControls: "Pendant alarm", mitigation: "Sensor light on the landing", assessmentGaps: "No falls assessment date is given", level: null, ...at });
    const v = readingToFacts(r)[0]!.value as Record<string, unknown>;
    expect(v).toMatchObject({ recommendedActions: "Sensor light on the landing", levelIsProvisional: true });
    expect(v.openQuestions).toContain("For a qualified assessor: No falls assessment date is given");
    expect(v.openQuestions).toContain("The assessor must set one");
    expect(displayValue("risk", v)).toContain("Mitigation: Sensor light on the landing");
  });
});

describe("visits", () => {
  it("keeps the type, instructions, start date and temporary status, and notes a missing end date", () => {
    const r = emptyReading();
    r.visits.push({ label: "Morning", weekdays: [1, 2, 3, 4, 5], startTime: "08:00", durationMinutes: 45, carers: 2, tasks: ["Hoist transfer"], fundedBy: "COUNCIL", medicationPrompt: false, endDate: null, startDate: "03/11/2026", visitType: "Personal care", instructions: "Two carers for the hoist", temporary: true, ...at });
    const [f] = readingToFacts(r);
    expect(f!.value).toMatchObject({ carers: 2, visitType: "Personal care", instructions: "Two carers for the hoist", temporary: true, effectiveFrom: "2026-11-03", effectiveTo: null });
    expect(f!.note).toMatch(/temporary but gives no end date/);
  });

  it("a visit with an end date counts as temporary without a note", () => {
    const r = emptyReading();
    r.visits.push({ label: "Lunch", weekdays: [6, 7], startTime: "12:30", durationMinutes: 30, carers: 1, tasks: [], fundedBy: "COUNCIL", medicationPrompt: false, endDate: "30/11/2026", ...at });
    const [f] = readingToFacts(r);
    expect(f!.value).toMatchObject({ temporary: true, effectiveTo: "2026-11-30" });
    expect(f!.note).toBeUndefined();
  });

  it("the visit form takes the new fields", () => {
    const fd = new FormData();
    fd.set("v_label", "Tea");
    fd.set("v_weekdays", "1");
    fd.set("v_startTime", "17:00");
    fd.set("v_durationMin", "30");
    fd.set("v_carers", "1");
    fd.set("v_fundedBy", "COUNCIL");
    fd.set("v_visitType", "Meal preparation");
    fd.set("v_instructions", "Leave a drink within reach");
    fd.set("v_temporary", "on");
    expect(parseValue("visit", valueFromForm("visit", fd))).toMatchObject({ ok: true, value: { visitType: "Meal preparation", instructions: "Leave a drink within reach", temporary: true } });
  });
});

describe("the extended schema still fits the API limits", () => {
  it("stays within the union and optional parameter limits", () => {
    const c = schemaComplexity(z.toJSONSchema(toWire(CareDocumentExtractionSchema)));
    expect(c.unions).toBeLessThanOrEqual(STRUCTURED_LIMITS.unions);
    expect(c.optional).toBeLessThanOrEqual(STRUCTURED_LIMITS.optional);
  });
});

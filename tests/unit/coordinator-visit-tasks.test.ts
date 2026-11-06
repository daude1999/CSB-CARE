import { describe, expect, it } from "vitest";
import { durationCheck, isMedicationTask, splitTaskText, TASK_NAME_MAX, visitTasks } from "@/server/care/coordinator/visit-tasks";

/** Visit-specific carer tasks from a timetable: short tasks, medication held back, too-short visits flagged. */
describe("splitting timetable task text", () => {
  it("splits a long paragraph into short tasks in the order written, without duplicates", () => {
    const out = splitTaskText(["Support with personal care including a strip wash. Help to dress; prepare breakfast and a hot drink\n- Empty commode", "help to dress"]);
    expect(out).toEqual(["Support with personal care including a strip wash", "Help to dress", "Prepare breakfast and a hot drink", "Empty commode"]);
  });

  it("splits a long comma list and never makes a task longer than the limit", () => {
    const long = "Assist with getting out of bed using the frame, wash face and hands at the sink, apply barrier cream to sacrum as directed by the district nurse team and record in the daily notes";
    const out = splitTaskText([long]);
    expect(out.length).toBeGreaterThan(1);
    for (const t of out) expect(t.length).toBeLessThanOrEqual(TASK_NAME_MAX);
  });
});

describe("medication tasks", () => {
  it("holds back anything about medicines for authorisation", () => {
    expect(isMedicationTask("Prompt morning medication from the blister pack")).toBe(true);
    expect(isMedicationTask("Apply eye drops")).toBe(true);
    expect(isMedicationTask("Prepare lunch")).toBe(false);
    expect(visitTasks(["Prepare lunch; prompt medication; wash up"])).toEqual({ tasks: ["Prepare lunch", "Wash up"], heldMedication: ["Prompt medication"] });
  });
});

describe("visit length", () => {
  it("flags tasks that plainly need more time than the visit has", () => {
    expect(durationCheck(["Shower", "Help to dress", "Prepare breakfast"], 30)).toEqual({ needed: 40, fits: false });
    expect(durationCheck(["Prepare a sandwich", "Check the person is safe"], 15)).toEqual({ needed: 10, fits: true });
  });
});

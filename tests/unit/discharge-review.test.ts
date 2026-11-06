import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assessDischarge } from "@/server/care/discharge-review";

describe("assessDischarge", () => {
  it("sorts what the letter says into the checklist", () => {
    const a = assessDischarge(["Walks with a frame. Follow-up clinic in 2 weeks."], [{ section: "MEDICATION", label: "Paracetamol 1g", text: "Paracetamol 1g four times a day" }]);
    expect(a.urgent).toBe(false);
    expect(a.checks.find((c) => c.key === "medication")?.finding).toMatch(/Paracetamol/);
    expect(a.checks.find((c) => c.key === "mobility")?.finding).toMatch(/Mentioned/);
    expect(a.checks.find((c) => c.key === "appointments")?.finding).toMatch(/Mentioned/);
    expect(a.checks.every((c) => c.outcome === null)).toBe(true);
  });
  it("marks urgent issues with their reasons", () => {
    const a = assessDischarge(["Grade 3 pressure ulcer on the heel. Started on insulin. DNACPR in place."], []);
    expect(a.urgent).toBe(true);
    expect(a.urgentReasons).toEqual(expect.arrayContaining(["Pressure damage mentioned", "High-risk medicine mentioned", "End of life or resuscitation decision mentioned"]));
  });
});

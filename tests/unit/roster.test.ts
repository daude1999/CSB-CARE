import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { chipTone, dayShade } from "@/server/rota/roster";

describe("roster colours", () => {
  it("colours each visit by its state, with drafts apart from published visits", () => {
    expect(chipTone({ status: "SCHEDULED", published: true, review: false })).toBe("ok");
    expect(chipTone({ status: "SCHEDULED", published: false, review: false })).toBe("draft");
    expect(chipTone({ status: "SCHEDULED", published: true, review: true })).toBe("review");
    expect(chipTone({ status: "SCHEDULED", published: true, review: false, empty: true })).toBe("empty");
    expect(chipTone({ status: "COMPLETED", published: true, review: true })).toBe("done");
    expect(chipTone({ status: "IN_PROGRESS", published: true, review: false })).toBe("active");
    expect(chipTone({ status: "MISSED", published: true, review: false })).toBe("missed");
    expect(chipTone({ status: "NOT_DELIVERED", published: true, review: false })).toBe("missed");
    expect(chipTone({ status: "CANCELLED", published: false, review: true })).toBe("cancelled");
  });
});

describe("roster day shading", () => {
  const day = "2026-11-04"; // a Wednesday
  const at = (iso: string) => new Date(iso);
  it("shades approved leave, sickness and requested leave, naming part days", () => {
    expect(dayShade(day, [{ kind: "HOLIDAY", status: "APPROVED", startsAt: at("2026-11-02T00:00:00Z"), endsAt: at("2026-11-07T00:00:00Z") }], [])).toEqual({ tone: "leave", label: "Holiday" });
    expect(dayShade(day, [{ kind: "SICKNESS", status: "APPROVED", startsAt: at("2026-11-04T00:00:00Z"), endsAt: at("2026-11-05T00:00:00Z") }], [])?.tone).toBe("sick");
    expect(dayShade(day, [{ kind: "HOLIDAY", status: "REQUESTED", startsAt: at("2026-11-04T00:00:00Z"), endsAt: at("2026-11-05T00:00:00Z") }], [])?.tone).toBe("requested");
    expect(dayShade(day, [{ kind: "TRAINING", status: "APPROVED", startsAt: at("2026-11-04T09:00:00Z"), endsAt: at("2026-11-04T13:00:00Z") }], [])?.label).toBe("Training 09:00–13:00");
  });
  it("shades unavailable time from the working pattern for that weekday only", () => {
    const pattern = [{ kind: "UNAVAILABLE" as const, weekday: 3, startMinute: 0, endMinute: 1440, effectiveFrom: at("2026-01-01T00:00:00Z"), effectiveTo: null }];
    expect(dayShade(day, [], pattern)).toEqual({ tone: "unavailable", label: "Unavailable" });
    expect(dayShade("2026-11-05", [], pattern)).toBeNull();
    expect(dayShade(day, [], [{ ...pattern[0]!, startMinute: 600, endMinute: 720 }])?.label).toBe("Unavailable 10:00–12:00");
  });
  it("lets an absence win over the working pattern, and shows nothing on a normal day", () => {
    const pattern = [{ kind: "UNAVAILABLE" as const, weekday: 3, startMinute: 0, endMinute: 1440, effectiveFrom: at("2026-01-01T00:00:00Z"), effectiveTo: null }];
    expect(dayShade(day, [{ kind: "SICKNESS", status: "APPROVED", startsAt: at("2026-11-04T00:00:00Z"), endsAt: at("2026-11-05T00:00:00Z") }], pattern)?.tone).toBe("sick");
    expect(dayShade(day, [], [])).toBeNull();
  });
});

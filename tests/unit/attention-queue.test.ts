import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ACT_NOW_HOURS, attentionGroup, groupAttention, missedWarnings, type AttentionGroup } from "@/server/rota/attention-queue";

/** Visits Needing Attention's grouping and order: the pure part of the queue. */
const now = new Date("2026-11-02T12:00:00Z"); // 12:00 in London (GMT)
const H = 3600_000;
const at = (hours: number) => new Date(now.getTime() + hours * H);

describe("attention queue grouping", () => {
  it("puts an unassigned visit starting within four hours (or already started) in Act now", () => {
    expect(attentionGroup({ type: "unassigned", start: at(ACT_NOW_HOURS), pressing: false }, now)).toBe("now");
    expect(attentionGroup({ type: "unassigned", start: at(-0.5), pressing: false }, now)).toBe("now");
    expect(attentionGroup({ type: "unassigned", start: at(ACT_NOW_HOURS + 0.1), pressing: false }, now)).toBe("today");
    expect(attentionGroup({ type: "unassigned", start: at(26), pressing: false }, now)).toBe("week");
  });

  it("puts overdue or high-risk missed calls in Act now, and the rest by their date", () => {
    expect(attentionGroup({ type: "missed", start: at(-50), pressing: true }, now)).toBe("now");
    expect(attentionGroup({ type: "missed", start: at(-3), pressing: false }, now)).toBe("today");
    expect(attentionGroup({ type: "missed", start: at(-30), pressing: false }, now)).toBe("week");
  });

  it("groups communication by when it is due, overdue first", () => {
    expect(attentionGroup({ type: "comms", start: at(30), dueAt: at(-1), pressing: true }, now)).toBe("now");
    expect(attentionGroup({ type: "comms", start: at(30), dueAt: at(3), pressing: false }, now)).toBe("today");
    expect(attentionGroup({ type: "comms", start: at(30), dueAt: at(30), pressing: false }, now)).toBe("week");
  });

  it("orders groups Act now, Later today, This week, then by priority and start time, and leaves out empty groups", () => {
    const item = (reference: string, group: AttentionGroup, rank: number, hours: number) => ({ reference, group, rank, start: at(hours) });
    const out = groupAttention([item("d", "week", 0, 40), item("c", "now", 1, 1), item("a", "now", 0, 3), item("b", "now", 0, 2), item("e", "week", 0, 30)]);
    expect(out.map((g) => g.group)).toEqual(["now", "week"]);
    expect(out[0]!.items.map((i) => i.reference)).toEqual(["b", "a", "c"]);
    expect(out[1]!.items.map((i) => i.reference)).toEqual(["e", "d"]);
  });

  it("words a missed call's warnings in the register's order", () => {
    expect(missedWarnings({ overdue: true, highRisk: true, escalatedAt: now, repeatCount: 3, coordinatorId: null })).toEqual(["past investigation deadline", "high-risk", "escalated", "carer missed 3 recently", "no coordinator"]);
    expect(missedWarnings({ overdue: false, highRisk: false, escalatedAt: null, repeatCount: 0, coordinatorId: "u" })).toEqual([]);
  });
});

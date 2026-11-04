import { describe, expect, it } from "vitest";
import { scoreCriterion, scoreReadiness, type CriterionInput } from "@/server/cqc/scoring";
import { CQC_CRITERIA_V1 } from "../../prisma/seed-data/cqc-framework";

const c = (over: Partial<CriterionInput> & { id: string }): CriterionInput => ({ keyQuestion: "SAFE", essential: false, result: "MET", verifiedEvidence: 1, overdueActions: 0, ...over });

describe("internal CQC readiness scoring (CSB-READINESS-1)", () => {
  it("scores Met with verified evidence 100, and halves it without verified evidence", () => {
    expect(scoreCriterion(c({ id: "a" })).score).toBe(100);
    expect(scoreCriterion(c({ id: "a", verifiedEvidence: 0 })).score).toBe(50);
    expect(scoreCriterion(c({ id: "a", result: "PARTIALLY_MET" })).score).toBe(50);
    expect(scoreCriterion(c({ id: "a", result: "NOT_MET" })).score).toBe(0);
  });

  it("deducts 10 per overdue action, at most 30, never below zero", () => {
    expect(scoreCriterion(c({ id: "a", overdueActions: 2 })).score).toBe(80);
    expect(scoreCriterion(c({ id: "a", overdueActions: 9 })).score).toBe(70);
    expect(scoreCriterion(c({ id: "a", result: "PARTIALLY_MET", verifiedEvidence: 0, overdueActions: 5 })).score).toBe(0);
  });

  it("leaves Not applicable out of every figure and shows unassessed areas explicitly", () => {
    const r = scoreReadiness([c({ id: "a" }), c({ id: "b", result: "NOT_APPLICABLE" }), c({ id: "c", result: null })]);
    expect(r.byQuestion.SAFE.applicable).toBe(2);
    expect(r.byQuestion.SAFE.notApplicable).toBe(1);
    expect(r.byQuestion.SAFE.notAssessed).toBe(1);
    // 1 of 2 assessed is below the 75% needed, so the figure is held back as low confidence.
    expect(r.byQuestion.SAFE.score).toBeNull();
    expect(r.byQuestion.SAFE.confidence).toBe("LOW");
    expect(r.byQuestion.SAFE.provisional).toBe(100);
  });

  it("shows Not assessed when nothing is assessed, and never a percentage", () => {
    const r = scoreReadiness([c({ id: "a", result: null }), c({ id: "b", result: null, keyQuestion: "CARING" })]);
    expect(r.overall.confidence).toBe("NOT_ASSESSED");
    expect(r.overall.score).toBeNull();
    expect(r.byQuestion.EFFECTIVE.confidence).toBe("NOT_ASSESSED");
  });

  it("holds back the overall score unless every key question is confidently scored", () => {
    const kqs = ["SAFE", "EFFECTIVE", "CARING", "RESPONSIVE", "WELL_LED"] as const;
    const full = kqs.map((k, i) => c({ id: `x${i}`, keyQuestion: k }));
    expect(scoreReadiness(full).overall.score).toBe(100);
    const missingCaring = [...full.filter((x) => x.keyQuestion !== "CARING"), c({ id: "y", keyQuestion: "CARING", result: null })];
    const r = scoreReadiness(missingCaring);
    expect(r.overall.score).toBeNull();
    expect(r.overall.confidence).toBe("LOW");
  });

  it("separates evidence coverage from compliance and flags essential gaps", () => {
    const r = scoreReadiness([c({ id: "a", essential: true, verifiedEvidence: 0 }), c({ id: "b", result: "NOT_MET" })]);
    expect(r.overall.evidenceCoverage).toBe(0.5);
    expect(r.overall.score).toBe(25);
    expect(r.criteria.find((x) => x.id === "a")!.essentialGap).toBe(true);
  });

  it("is deterministic", () => {
    const input = [c({ id: "a" }), c({ id: "b", result: "PARTIALLY_MET", verifiedEvidence: 0 })];
    expect(scoreReadiness(input)).toEqual(scoreReadiness(input));
  });
});

describe("framework v1 mapping", () => {
  it("covers the five key questions with unique codes and the owner's checklist", () => {
    const codes = CQC_CRITERIA_V1.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
    const per = (k: string) => CQC_CRITERIA_V1.filter((x) => x.keyQuestion === k).length;
    expect([per("SAFE"), per("EFFECTIVE"), per("CARING"), per("RESPONSIVE"), per("WELL_LED")]).toEqual([12, 9, 9, 11, 15]);
    for (const x of CQC_CRITERIA_V1) {
      expect(x.regulations.length).toBeGreaterThan(0);
      expect(x.qualityStatement.length).toBeGreaterThan(3);
    }
  });
});

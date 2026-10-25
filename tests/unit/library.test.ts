import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../prisma/seed-data/templates";
import { REQUIREMENTS } from "../../prisma/seed-data/library/requirements";
import { SOURCES } from "../../prisma/seed-data/sources";
import { CATEGORIES } from "@/server/seed/base";

describe("starter policy library", () => {
  it("covers the main policy domains with unique references and known categories", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(TEMPLATES.map((t) => t.ref)).size).toBe(TEMPLATES.length);
    const categories = new Set(CATEGORIES.map(([code]) => code));
    for (const t of TEMPLATES) expect(categories.has(t.category), `${t.ref} category ${t.category}`).toBe(true);
    for (const code of ["SAFEGUARDING", "MEDICINES", "IPC", "CONSENT", "COMPLAINTS", "HEALTH_SAFETY", "DATA_PROTECTION", "RECRUITMENT", "WHISTLEBLOWING", "INCIDENTS", "END_OF_LIFE", "FOOD"]) {
      expect(TEMPLATES.some((t) => t.category === code), code).toBe(true);
    }
  });

  it("gives every policy full structured content, one local section and regulatory links", () => {
    for (const t of TEMPLATES) {
      const keys = t.sections.map((s) => s.key);
      expect(new Set(keys).size, t.ref).toBe(keys.length);
      expect(t.sections.filter((s) => s.isLocal), t.ref).toHaveLength(1);
      expect(keys.filter((k) => k === "procedure" || k.startsWith("procedure.")).length, t.ref).toBeGreaterThanOrEqual(2);
      for (const k of ["purpose", "scope", "responsibilities", "statement", "records", "training", "monitoring", "framework", "review"]) expect(keys, `${t.ref} ${k}`).toContain(k);
      expect(t.links.some((l) => l.requirement.startsWith("REQ-")), t.ref).toBe(true);
      expect(t.links.some((l) => l.requirement.startsWith("CQC-QS-")), t.ref).toBe(true);
      for (const l of t.links) expect(keys, `${t.ref} link ${l.requirement}`).toContain(l.section);
    }
  });

  it("builds a chronological version history ending in the current content", () => {
    for (const t of TEMPLATES) {
      expect(t.versions.length, t.ref).toBeGreaterThanOrEqual(2);
      const ages = t.versions.map((v) => v.publishedMonthsAgo);
      expect([...ages].sort((a, b) => b - a), t.ref).toEqual(ages);
      expect(new Set(ages).size, t.ref).toBe(ages.length);
      expect(t.versions.at(-1)!.sections).toEqual(t.sections);
      expect(t.versions[0]!.sections.some((s) => s.key === "framework"), t.ref).toBe(false);
    }
  });

  it("only references requirements whose sources exist, and keeps excerpts as summaries", () => {
    const sourceKeys = new Set(SOURCES.map((s) => s.key));
    expect(new Set(REQUIREMENTS.map((r) => r.ref)).size).toBe(REQUIREMENTS.length);
    for (const r of REQUIREMENTS) expect(sourceKeys.has(r.source), `${r.ref} source ${r.source}`).toBe(true);
    expect(REQUIREMENTS.filter((r) => r.ref.startsWith("CQC-QS-"))).toHaveLength(34);
  });

  it("keeps the safeguarding referral timescale in exactly one section (the demo change depends on it)", () => {
    const saf = TEMPLATES.find((t) => t.ref === "EVX-SAF-001")!;
    expect(saf.sections.filter((s) => /\b(48|24) hours\b/.test(s.body)).map((s) => s.key)).toEqual(["procedure.reporting"]);
  });
});

import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../prisma/seed-data/templates";
import { REQUIREMENTS } from "../../prisma/seed-data/library/requirements";
import { SOURCES } from "../../prisma/seed-data/sources";
import { CATEGORIES, CORE_REFS } from "@/server/seed/base";

const POLICY_TYPES = ["POLICY", "PROCEDURE", "GUIDANCE"];
const policies = TEMPLATES.filter((t) => POLICY_TYPES.includes(t.docType));
const resources = TEMPLATES.filter((t) => !POLICY_TYPES.includes(t.docType));

describe("starter policy library", () => {
  it("covers the main policy domains with unique references and known categories", () => {
    expect(policies.length).toBeGreaterThanOrEqual(120);
    expect(resources.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TEMPLATES.map((t) => t.ref)).size).toBe(TEMPLATES.length);
    const categories = new Set(CATEGORIES.map(([code]) => code));
    for (const t of TEMPLATES) expect(categories.has(t.category), `${t.ref} category ${t.category}`).toBe(true);
    for (const code of ["SAFEGUARDING", "MEDICINES", "IPC", "CONSENT", "COMPLAINTS", "HEALTH_SAFETY", "DATA_PROTECTION", "RECRUITMENT", "WHISTLEBLOWING", "INCIDENTS", "END_OF_LIFE", "FOOD", "DEMENTIA", "LEARNING_DISABILITY", "MENTAL_HEALTH", "HOME_CARE", "SUPPORTED_LIVING", "CARE_HOMES"]) {
      expect(TEMPLATES.some((t) => t.category === code), code).toBe(true);
    }
  });

  it("includes every kind of document", () => {
    for (const type of ["POLICY", "PROCEDURE", "GUIDANCE", "FORM", "TEMPLATE", "CHECKLIST", "RISK_ASSESSMENT", "AUDIT_TOOL"]) expect(TEMPLATES.some((t) => t.docType === type), type).toBe(true);
  });

  it("gives every policy full structured content, one local section and regulatory links", () => {
    for (const t of policies) {
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

  it("gives every resource instructions, a local section and its parent policies", () => {
    const refs = new Set(TEMPLATES.map((t) => t.ref));
    for (const t of resources) {
      const keys = t.sections.map((s) => s.key);
      expect(new Set(keys).size, t.ref).toBe(keys.length);
      expect(t.sections.filter((s) => s.isLocal), t.ref).toHaveLength(1);
      for (const k of ["purpose", "use", "related", "review"]) expect(keys, `${t.ref} ${k}`).toContain(k);
      const related = t.sections.find((s) => s.key === "related")!.body;
      for (const ref of related.match(/EVX-[A-Z]+-\d+/g) ?? []) expect(refs.has(ref), `${t.ref} related ${ref}`).toBe(true);
      expect(t.versions, t.ref).toHaveLength(1);
      if (t.docType === "AUDIT_TOOL") expect(t.auditQuestions?.length ?? 0, t.ref).toBeGreaterThanOrEqual(5);
      for (const l of t.links) expect(keys, `${t.ref} link ${l.requirement}`).toContain(l.section);
    }
  });

  it("cites national guidance from the monitored sources", () => {
    const known = new Set(REQUIREMENTS.map((r) => r.ref));
    for (const t of TEMPLATES) for (const l of t.links) expect(known.has(l.requirement), `${t.ref} ${l.requirement}`).toBe(true);
    const cited = new Set(TEMPLATES.flatMap((t) => t.links.map((l) => l.requirement)).filter((r) => r.startsWith("GDN-")));
    expect(cited.size).toBeGreaterThanOrEqual(50);
    const automated = new Set(SOURCES.filter((s) => s.coverage === "AUTOMATED").map((s) => s.key));
    expect(REQUIREMENTS.some((r) => r.ref.startsWith("GDN-") && automated.has(r.source))).toBe(true);
  });

  it("has a core subset for fast tests that exists in the library", () => {
    for (const ref of CORE_REFS) expect(TEMPLATES.some((t) => t.ref === ref), ref).toBe(true);
  });

  it("builds a chronological version history ending in the current content", () => {
    for (const t of policies) {
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
    const elsewhere = TEMPLATES.filter((t) => t.ref !== "EVX-SAF-001" && t.sections.some((s) => /\b48 hours\b/.test(s.body))).map((t) => t.ref);
    expect(elsewhere).toEqual([]);
  });
});

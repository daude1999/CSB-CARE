import { describe, expect, it } from "vitest";
import { canonicalForMatch, normaliseText, sha256, stableStringify, textContains } from "@/lib/text";
import { changeRatio, diffSections, phraseSubstitutions } from "@/server/changes/diff";
import { classifyChanges, suggestCategories } from "@/server/changes/classify";
import { sectionsToText } from "@/server/sources/extract";

describe("normalisation and hashing", () => {
  it("produces a stable hash regardless of whitespace, quote style and line endings", () => {
    const a = sectionsToText([{ ref: "a", heading: "Rules", text: "Providers  must “notify”\r\nthe team." }]);
    const b = sectionsToText([{ ref: "a", heading: "Rules", text: 'Providers must "notify"\nthe team.' }]);
    expect(sha256(a)).toBe(sha256(b));
  });
  it("changes the hash when meaningful content changes", () => {
    expect(sha256(normaliseText("within 48 hours"))).not.toBe(sha256(normaliseText("within 24 hours")));
  });
  it("stableStringify orders keys", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  it("matches quotes after canonicalisation but rejects fragments", () => {
    expect(textContains("Providers must notify the team, within 24 hours.", "providers must NOTIFY the team within 24 hours")).toBe(true);
    expect(textContains("abc", "ab")).toBe(false);
    expect(canonicalForMatch("A—B")).toBe("a b");
  });
});

describe("section diff", () => {
  const prev = [
    { ref: "intro", heading: "Intro", text: "Hello." },
    { ref: "rules", heading: "Rules", text: "Providers must notify within 48 hours. Keep records." },
    { ref: "old", heading: "Old", text: "Removed later." },
  ];
  const next = [
    { ref: "intro", heading: "Intro", text: "Hello." },
    { ref: "rules", heading: "Rules", text: "Providers must notify within 24 hours. Keep records." },
    { ref: "new", heading: "New", text: "Brand new section." },
  ];
  it("detects additions, deletions and modifications", () => {
    const d = diffSections(prev, next);
    expect(d.map((c) => [c.ref, c.kind])).toEqual([
      ["rules", "modified"],
      ["new", "added"],
      ["old", "removed"],
    ]);
    const rules = d.find((c) => c.ref === "rules")!;
    expect(rules.addedSentences).toEqual(["Providers must notify within 24 hours."]);
    expect(rules.removedSentences).toEqual(["Providers must notify within 48 hours."]);
  });
  it("reports no changes for identical content", () => {
    expect(diffSections(prev, prev)).toEqual([]);
  });
  it("finds phrase substitutions", () => {
    const subs = phraseSubstitutions(["Providers must notify within 48 hours."], ["Providers must notify within 24 hours."]);
    expect(subs[0]).toMatchObject({ from: "48 hours", to: "24 hours" });
  });
  it("measures change ratio", () => {
    expect(changeRatio("a b c d", "a b c d")).toBe(0);
    expect(changeRatio("a b c d", "w x y z")).toBe(1);
    expect(changeRatio("one two three four five six seven eight nine ten", "one two three four five six seven eight nine eleven")).toBeLessThan(0.2);
  });
});

describe("classification", () => {
  it("treats formatting-only changes as editorial", () => {
    const d = diffSections([{ ref: "a", heading: "A", text: "Providers must notify." }], [{ ref: "a", heading: "A", text: "providers must notify" }]);
    expect(classifyChanges(d, { isNewDocument: false }).classification).toBe("EDITORIAL");
  });
  it("treats page furniture as editorial", () => {
    const d = diffSections([{ ref: "a", heading: "A", text: "Last updated 1 May." }], [{ ref: "a", heading: "A", text: "Last updated 2 June." }]);
    expect(classifyChanges(d, { isNewDocument: false }).classification).toBe("EDITORIAL");
  });
  it("flags obligation and time-limit changes as potentially substantive", () => {
    const d = diffSections([{ ref: "a", heading: "A", text: "Providers must notify within 48 hours." }], [{ ref: "a", heading: "A", text: "Providers must notify within 24 hours." }]);
    const c = classifyChanges(d, { isNewDocument: false });
    expect(c.classification).toBe("POTENTIALLY_SUBSTANTIVE");
    expect(c.urgency).toBe("HIGH");
  });
  it("marks unexplained wording changes as uncertain", () => {
    const d = diffSections([{ ref: "a", heading: "A", text: "This page explains our approach to care." }], [{ ref: "a", heading: "A", text: "This page describes our approach to care." }]);
    expect(classifyChanges(d, { isNewDocument: false }).classification).toBe("UNCERTAIN");
  });
  it("suggests categories from text", () => {
    expect(suggestCategories("controlled drugs and medicines storage")).toContain("MEDICINES");
  });
});

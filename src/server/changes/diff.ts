import { diffWords } from "diff";
import { canonicalForMatch, normaliseText, splitSentences, truncate } from "@/lib/text";
import type { Section } from "../sources/extract";

export interface SectionChange {
  ref: string;
  heading: string;
  kind: "added" | "removed" | "modified";
  before: string;
  after: string;
  addedSentences: string[];
  removedSentences: string[];
  editorialOnly: boolean;
}

const MAX = 6000;

/** Section-aware comparison of two source versions. */
export function diffSections(prev: Section[], next: Section[]): SectionChange[] {
  const prevMap = new Map(prev.map((s) => [s.ref, s]));
  const nextMap = new Map(next.map((s) => [s.ref, s]));
  const changes: SectionChange[] = [];
  for (const s of next) {
    const old = prevMap.get(s.ref);
    if (!old) {
      changes.push({ ref: s.ref, heading: s.heading, kind: "added", before: "", after: truncate(s.text, MAX), addedSentences: splitSentences(s.text), removedSentences: [], editorialOnly: false });
      continue;
    }
    if (normaliseText(old.text) === normaliseText(s.text) && old.heading === s.heading) continue;
    const before = new Set(splitSentences(old.text).map(canonicalForMatch));
    const after = new Set(splitSentences(s.text).map(canonicalForMatch));
    const addedSentences = splitSentences(s.text).filter((x) => !before.has(canonicalForMatch(x)));
    const removedSentences = splitSentences(old.text).filter((x) => !after.has(canonicalForMatch(x)));
    changes.push({
      ref: s.ref,
      heading: s.heading,
      kind: "modified",
      before: truncate(old.text, MAX),
      after: truncate(s.text, MAX),
      addedSentences,
      removedSentences,
      editorialOnly: canonicalForMatch(old.text) === canonicalForMatch(s.text),
    });
  }
  for (const s of prev) {
    if (!nextMap.has(s.ref)) {
      changes.push({ ref: s.ref, heading: s.heading, kind: "removed", before: truncate(s.text, MAX), after: "", addedSentences: [], removedSentences: splitSentences(s.text), editorialOnly: false });
    }
  }
  return changes;
}

export interface WordDiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function wordDiff(a: string, b: string): WordDiffPart[] {
  return diffWords(a, b).map((p) => ({ value: p.value, added: p.added || undefined, removed: p.removed || undefined }));
}

/** Proportion of words changed between two texts (0 = identical, 1 = fully rewritten). */
export function changeRatio(a: string, b: string): number {
  let same = 0;
  let add = 0;
  let rem = 0;
  for (const p of diffWords(a, b)) {
    const n = p.value.split(/\s+/).filter(Boolean).length;
    if (p.added) add += n;
    else if (p.removed) rem += n;
    else same += n;
  }
  const changed = Math.max(add, rem);
  const denom = same + changed;
  return denom ? changed / denom : 0;
}

/** Pairs removed and added sentences and returns short phrase substitutions (e.g. "48 hours" → "24 hours"). */
export function phraseSubstitutions(removed: string[], added: string[]): { from: string; to: string; removedSentence: string; addedSentence: string }[] {
  const subs: { from: string; to: string; removedSentence: string; addedSentence: string }[] = [];
  for (const r of removed) {
    let best: { s: string; score: number } | null = null;
    for (const a of added) {
      const rw = new Set(canonicalForMatch(r).split(" "));
      const aw = canonicalForMatch(a).split(" ");
      const overlap = aw.filter((w) => rw.has(w)).length / Math.max(aw.length, rw.size);
      if (overlap > 0.5 && (!best || overlap > best.score)) best = { s: a, score: overlap };
    }
    if (!best) continue;
    const parts = diffWords(r, best.s);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const q = parts[i + 1];
      if (p.removed && q?.added) {
        // Widen to include a following unit word (e.g. "48" + " hours") for safer matching.
        const tail = parts[i + 2] && !parts[i + 2]!.added && !parts[i + 2]!.removed ? (parts[i + 2]!.value.match(/^\s*[A-Za-z0-9]+/)?.[0] ?? "") : "";
        subs.push({ from: `${p.value}${tail}`.trim(), to: `${q.value}${tail}`.trim(), removedSentence: r, addedSentence: best.s });
        i++;
      }
    }
  }
  return subs;
}

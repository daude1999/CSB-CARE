import { canonicalForMatch, splitSentences, truncate } from "@/lib/text";
import { phraseSubstitutions } from "../changes/diff";
import { suggestCategories, suggestServiceTypes } from "../changes/classify";
import type { AssistantInput, CareSummaryInput, ChangeAnalysisInput, ImpactInput, LlmProvider, RevisionInput } from "./provider";
import type { AssistantAnswer, CareSummaryOutput, ChangeAnalysis, ImpactAssessmentOutput, RevisionDraftOutput } from "./schemas";

/**
 * Deterministic stand-in for an LLM, used in demos, tests and when no AI
 * provider is configured. Every output is labelled SIMULATED. It only ever
 * quotes text that exists in its input, so citation verification still applies.
 */

const LABEL = "[SIMULATED, rule-based output, not an AI or legal assessment] ";
const OBLIGATION = /\b(must|shall|required?|within \d+|no later than|should|notify|report)\b/i;

function words(s: string) {
  return new Set(canonicalForMatch(s).split(" ").filter((w) => w.length > 3));
}

function overlap(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const CARE_THEMES = [
  { label: "eating, drinking or appetite", section: "eating and drinking", re: /\b(eat|ate|appetite|meal|breakfast|lunch|dinner|drink|fluid|food)\w*/i },
  { label: "falls, unsteadiness or mobility", section: "mobility and moving", re: /\b(fall|fell|fallen|unsteady|wobbly|mobility|walking|frame|transfer)\w*/i },
  { label: "skin, redness or soreness", section: "personal care", re: /\b(skin|red|redness|sore|pressure|bruis|rash)\w*/i },
  { label: "confusion, memory or mood", section: "health and wellbeing", re: /\b(confus|forget|memory|low mood|upset|tearful|anxious|agitat)\w*/i },
  { label: "pain", section: "health and wellbeing", re: /\b(pain|ache|hurt)\w*/i },
  { label: "refused or declined support", section: "about me", re: /\b(refus|declin|did not want)\w*/i },
] as const;

export class SimulatedProvider implements LlmProvider {
  name = "simulated";
  isSimulated = true;

  async analyseChange(input: ChangeAnalysisInput): Promise<ChangeAnalysis> {
    const added = input.changes.flatMap((c) => c.addedSentences.map((s) => ({ ref: c.ref, s })));
    const removed = input.changes.flatMap((c) => c.removedSentences.map((s) => ({ ref: c.ref, s })));
    const subs = phraseSubstitutions(removed.map((r) => r.s), added.map((a) => a.s));
    const obligation = [...added, ...removed].some((x) => OBLIGATION.test(x.s));
    const text = [...added, ...removed].map((x) => x.s).join(" ");
    return {
      whatChanged: LABEL + (subs.length ? `Wording changed: ${subs.map((s) => `"${s.from}" → "${s.to}"`).join("; ")}.` : `${added.length} sentence(s) added and ${removed.length} removed across ${input.changes.length} section(s).`),
      previousPosition: removed.length ? truncate(removed.map((r) => r.s).join(" "), 600) : "No previous wording (new content).",
      newPosition: added.length ? truncate(added.map((a) => a.s).join(" "), 600) : "Content removed.",
      whyItMatters: obligation
        ? "Changed text uses obligation or reporting language, which may alter what providers are expected to do."
        : "No obligation language detected; the change may be editorial but a reviewer should confirm.",
      classification: obligation ? "POTENTIALLY_SUBSTANTIVE" : "UNCERTAIN",
      urgency: obligation && subs.length ? "HIGH" : "MEDIUM",
      potentiallyAffectedPolicyRefs: input.candidatePolicies.map((p) => ({ policyRef: p.ref, reason: "Linked through the requirements register or text similarity" })),
      affectedServiceTypes: suggestServiceTypes(text, input.serviceTypes),
      affectedCategories: suggestCategories(text),
      needsHumanVerification: [
        "Confirm the change is substantive and not a correction of an earlier error",
        "Confirm the effective date of the new wording from the official source",
        "Confirm whether the change applies to each service type",
      ],
      supportingExcerpts: [
        ...removed.slice(0, 2).map((r) => ({ side: "previous" as const, sectionRef: r.ref, quote: r.s })),
        ...added.slice(0, 2).map((a) => ({ side: "current" as const, sectionRef: a.ref, quote: a.s })),
      ],
      confidence: obligation ? 0.55 : 0.3,
      uncertainty: "Simulated analysis uses keyword rules only and cannot interpret legal meaning.",
    };
  }

  async assessImpact(input: ImpactInput): Promise<ImpactAssessmentOutput> {
    const added = input.change.changes.flatMap((c) => c.addedSentences.map((s) => ({ ref: c.ref, s })));
    const removed = input.change.changes.flatMap((c) => c.removedSentences.map((s) => ({ ref: c.ref, s })));
    const editable = input.policy.sections.filter((s) => !s.locked);
    const linked = input.requirements.map((r) => r.sectionKey).filter((k): k is string => !!k && editable.some((s) => s.key === k));
    const subs = phraseSubstitutions(removed.map((r) => r.s), added.map((a) => a.s));
    const bySub = editable.filter((s) => subs.some((x) => s.body.includes(x.from))).map((s) => s.key);
    const byOverlap = editable
      .map((s) => ({ key: s.key, score: Math.max(0, ...added.map((a) => overlap(a.s, s.body))) }))
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.key);
    const affected = [...new Set([...bySub, ...linked, ...byOverlap.slice(0, 1)])];
    const svc = input.change.serviceTypes;
    const applies = !svc.length || !input.policy.serviceTypes.length || svc.some((s) => input.policy.serviceTypes.includes(s));
    const obligation = added.filter((a) => OBLIGATION.test(a.s));
    const recommend = applies && affected.length > 0 && (obligation.length > 0 || bySub.length > 0);
    return {
      applicability: applies ? "APPLIES" : "DOES_NOT_APPLY",
      outcome: !applies ? "NO_REVISION_NEEDED" : recommend ? "REVISION_RECOMMENDED" : "UNCERTAIN",
      urgency: recommend && subs.length ? "HIGH" : "MEDIUM",
      rationale:
        LABEL +
        (!applies
          ? "The change targets service types this policy does not cover."
          : recommend
            ? `Policy section(s) ${affected.join(", ")} repeat or depend on wording that changed${subs.length ? ` (${subs.map((s) => `"${s.from}" → "${s.to}"`).join("; ")})` : ""}.`
            : "No policy wording was found that clearly depends on the changed text."),
      affectedSectionKeys: affected,
      citations: (obligation.length ? obligation : added).slice(0, 3).map((a) => ({ sectionRef: a.ref, quote: a.s, supportsSectionKey: affected[0] ?? null })),
      needsVerification: ["Check the official source for transitional arrangements and the effective date", "Confirm local procedures remain accurate"],
    };
  }

  async draftRevision(input: RevisionInput): Promise<RevisionDraftOutput> {
    const added = input.change.changes.flatMap((c) => c.addedSentences.map((s) => ({ ref: c.ref, s })));
    const removed = input.change.changes.flatMap((c) => c.removedSentences.map((s) => ({ ref: c.ref, s })));
    const subs = phraseSubstitutions(removed.map((r) => r.s), added.map((a) => a.s));
    const edits: RevisionDraftOutput["edits"] = [];
    for (const key of input.assessment.affectedSectionKeys) {
      const section = input.policy.sections.find((s) => s.key === key);
      if (!section || section.locked) continue;
      let body = section.body;
      const used: typeof subs = [];
      for (const sub of subs) {
        if (body.includes(sub.from)) {
          body = body.split(sub.from).join(sub.to);
          used.push(sub);
        }
      }
      if (used.length) {
        edits.push({
          operation: "modify",
          sectionKey: key,
          heading: null,
          newBody: body,
          insertAfterKey: null,
          rationale: `${LABEL}Replaces ${used.map((u) => `"${u.from}" with "${u.to}"`).join(", ")} to match the current source wording.`,
          citations: used.map((u) => ({ sectionRef: added.find((a) => a.s === u.addedSentence)?.ref ?? "", quote: u.addedSentence })),
        });
        continue;
      }
      const best = added.filter((a) => OBLIGATION.test(a.s)).sort((a, b) => overlap(b.s, section.body) - overlap(a.s, section.body))[0];
      if (best) {
        edits.push({
          operation: "modify",
          sectionKey: key,
          heading: null,
          newBody: `${section.body}\n\nThe current guidance states: "${best.s}"`,
          insertAfterKey: null,
          rationale: `${LABEL}Adds the new source statement verbatim for a reviewer to adapt into local wording.`,
          citations: [{ sectionRef: best.ref, quote: best.s }],
        });
      }
    }
    return {
      summary: LABEL + (edits.length ? `Proposed ${edits.length} minimal edit(s) to ${edits.map((e) => e.sectionKey).join(", ")}.` : "No safe edit could be proposed; manual drafting required."),
      edits,
      conflicts: [],
      uncertainties: ["Simulated drafting does not interpret context; a qualified reviewer must check the amended wording."],
    };
  }

  async answer(input: AssistantInput): Promise<AssistantAnswer> {
    const top = input.chunks.slice(0, 4);
    const quote = (t: string) => splitSentences(t)[0] ?? truncate(t, 200);
    const lines = [
      ...input.facts.map((f) => `• ${f}`),
      ...top.map((c) => `• ${c.heading} (${c.legalStatus.replace(/_/g, " ").toLowerCase()}): "${truncate(quote(c.text), 240)}" [${c.id}]`),
    ];
    return {
      answer: LABEL + (lines.length ? `Relevant material found:\n${lines.join("\n")}` : "I could not find material in your policies or monitored sources that answers this question."),
      citations: top.map((c) => ({ chunkId: c.id, quote: quote(c.text) })),
      evidenceGaps: top.length ? ["Simulated assistant lists retrieved material; it does not interpret it."] : ["No matching documents were retrieved."],
    };
  }
  /**
   * Rule-based Care Summary: groups the records by plain keyword themes and counts them. It never interprets what a
   * record means; every sentence cites the records it counted, and every sentence starts with the SIMULATED label.
   */
  async summariseCare(input: CareSummaryInput): Promise<CareSummaryOutput> {
    const L = "[SIMULATED, rule-based] ";
    const r = input.records;
    const of = (kind: string) => r.filter((x) => x.kind === kind);
    const ids = (xs: { sid: string }[]) => xs.slice(0, 12).map((x) => x.sid);
    const summary: CareSummaryOutput["summary"] = [];
    for (const kind of [...new Set(r.map((x) => x.kind))]) {
      const xs = of(kind);
      summary.push({ text: `${L}${xs.length} ${kind.toLowerCase()} ${xs.length === 1 ? "record" : "records"} between ${input.from} and ${input.to}.`, sources: ids(xs) });
    }
    const changes: CareSummaryOutput["changes"] = [];
    const nextActions: CareSummaryOutput["nextActions"] = [];
    for (const t of CARE_THEMES) {
      const xs = r.filter((x) => t.re.test(x.text));
      if (xs.length < 2) continue;
      changes.push({ text: `${L}${xs.length} records mention ${t.label}.`, sources: ids(xs) });
      nextActions.push({ text: `${L}Consider reviewing the ${t.section} section of the care plan against these records.`, sources: ids(xs) });
    }
    const open = r.filter((x) => /\b(open|investigating|overdue|not done|refused|not given)\b/i.test(x.text) && x.kind !== "Visit note");
    const concerns = open.length ? [{ text: `${L}${open.length} ${open.length === 1 ? "record is" : "records are"} recorded as open, overdue, refused or not done.`, sources: ids(open) }] : [];
    const gaps = [
      "Simulated summary counts keyword matches; it does not read or interpret the records.",
      ...(of("Visit note").length ? [] : ["No visit notes were written in this period."]),
    ];
    return { summary, changes, concerns, nextActions, gaps };
  }
}

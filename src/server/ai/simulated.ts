import { canonicalForMatch, splitSentences, truncate } from "@/lib/text";
import { phraseSubstitutions } from "../changes/diff";
import { suggestCategories, suggestServiceTypes } from "../changes/classify";
import type { AssistantInput, BodyMapRecommendationInput, CareSummaryInput, ChangeAnalysisInput, ImpactInput, LlmProvider, RevisionInput } from "./provider";
import type { AssistantAnswer, BodyMapRecommendationOutput, CareSummaryOutput, ChangeAnalysis, ImpactAssessmentOutput, RevisionDraftOutput } from "./schemas";

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

  /**
   * Rule-based stand-in for body map recommendations: it looks only at which kinds of record exist and the structured
   * fields of the observation. It never reads meaning into free text. Every suggestion is labelled SIMULATED.
   */
  async recommendBodyMap(input: BodyMapRecommendationInput): Promise<BodyMapRecommendationOutput> {
    const L = "[SIMULATED] ";
    const o = input.observation;
    const of = (kind: string) => input.records.filter((r) => r.kind === kind);
    const ids = (xs: { sid: string }[]) => xs.slice(0, 6).map((x) => x.sid);
    const policies = of("Approved policy");
    const recs: BodyMapRecommendationOutput["recommendations"] = [];
    const facts = [`${o.category} recorded on ${o.area} on ${o.observedOn}.`, `Pain or discomfort: ${o.pain.toLowerCase()}.`];
    if (o.status === "OPEN" && !o.followUpOn) {
      recs.push({ category: "OBSERVATION_FOLLOW_UP", title: `${L}Consider setting a follow-up review`, explanation: "No follow-up date is recorded for this open observation.", suggestedAction: "Consider creating a follow-up task so the area is looked at again.", actionKind: "FOLLOW_UP", facts: [...facts, "Follow-up date: none set."], sources: ["O1"] });
    } else if (o.status === "OPEN" && o.followUpOn && o.followUpOn < input.today) {
      recs.push({ category: "OBSERVATION_FOLLOW_UP", title: `${L}Make sure the responsible manager knows the review is overdue`, explanation: `The follow-up date (${o.followUpOn}) has passed and the observation is still open.`, suggestedAction: "Consider assigning a manager review.", actionKind: "MANAGER_REVIEW", facts: [`Follow-up date: ${o.followUpOn}.`, "Status: open."], sources: ["O1"] });
    }
    const earlier = of("Earlier observation");
    if (earlier.length) {
      recs.push({ category: "HISTORICAL_COMPARISON", title: `${L}Review earlier observations of the same area`, explanation: `${earlier.length} earlier ${earlier.length === 1 ? "observation was" : "observations were"} recorded on ${o.area}. Compare the recorded sizes and descriptions; photographs must be compared by a person.`, suggestedAction: "Open the History tab and compare the recorded measurements side by side.", actionKind: null, facts: earlier.slice(0, 4).map((e) => `${e.date}: ${e.text}`), sources: ids(earlier) });
    }
    const plan = of("Care plan section");
    if (plan.length) {
      recs.push({ category: "CARE_PLAN_REVIEW", title: `${L}Consider whether the care plan needs review`, explanation: `${plan.length} section${plan.length === 1 ? "" : "s"} of the current care plan ${plan.length === 1 ? "covers" : "cover"} skin, pressure or personal care. A manager may want to check ${plan.length === 1 ? "it" : "them"} against this observation.`, suggestedAction: "Consider requesting a care plan review.", actionKind: "CARE_PLAN_REVIEW", facts: plan.slice(0, 3).map((p) => p.text.slice(0, 140)), sources: ids(plan) });
    }
    const risks = of("Risk assessment");
    if (risks.length) {
      recs.push({ category: "RISK_REVIEW", title: `${L}Consider risk assessment review`, explanation: "The observation may warrant a review of the existing skin-integrity or related risk assessment.", suggestedAction: "Consider requesting a risk assessment review.", actionKind: "RISK_REVIEW", facts: risks.slice(0, 3).map((r) => r.text.slice(0, 140)), sources: [...ids(risks), "O1"] });
    } else {
      recs.push({ category: "RISK_REVIEW", title: `${L}Check whether a risk assessment covers this concern`, explanation: "No active skin-integrity or related risk assessment was found for this person.", suggestedAction: "Consider asking a manager whether a risk assessment is needed.", actionKind: "RISK_REVIEW", facts: ["No active risk assessment about skin, pressure or falls was found."], sources: ["O1"] });
    }
    if (!o.incidentDecision) {
      const incidents = of("Incident");
      recs.push({ category: "INCIDENT_SAFEGUARDING", title: `${L}Ask an authorised manager to assess whether an incident report is needed`, explanation: `A manager has not yet recorded whether an incident report is needed.${incidents.length ? ` ${incidents.length} incident${incidents.length === 1 ? " is" : "s are"} already recorded for this person; check whether one covers this.` : ""} Whether the safeguarding procedure applies is for the manager to decide.`, suggestedAction: "Consider requesting an incident assessment.", actionKind: "INCIDENT_ASSESSMENT", facts: ["Incident decision: not yet recorded."], sources: ["O1", ...ids(incidents), ...ids(policies.filter((p) => /safeguard|incident/i.test(p.text)))] });
    }
    const meds = of("Medication site");
    const noSite = of("Topical medicine without a site");
    if (meds.length) {
      recs.push({ category: "MEDICATION_REVIEW", title: `${L}Check the recorded application-site instructions`, explanation: "A topical medicine or patch is documented for this area. Check the recorded instructions; any change is for a qualified professional.", suggestedAction: "Consider assigning a manager review of the application-site instructions.", actionKind: "MANAGER_REVIEW", facts: meds.map((m) => m.text.slice(0, 140)), sources: ids(meds) });
    }
    if (noSite.length) {
      recs.push({ category: "MEDICATION_REVIEW", title: `${L}Application site not recorded`, explanation: `${noSite.length} topical medicine${noSite.length === 1 ? " has" : "s have"} no documented application site.`, suggestedAction: "Consider asking an authorised manager to record where it is applied.", actionKind: "MANAGER_REVIEW", facts: noSite.map((m) => m.text.slice(0, 140)), sources: ids(noSite) });
    }
    const gaps = ["Simulated suggestions follow fixed rules about which records exist; they do not read or interpret what was written.", ...input.limits];
    return { recommendations: recs, gaps };
  }
}

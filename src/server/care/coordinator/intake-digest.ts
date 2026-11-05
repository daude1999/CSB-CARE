import {
  ACCEPTED, INTAKE_STATUS, PLAN_SECTION_KEYS, PLAN_SECTION_LABEL, dayList, reconcileHours, sectionLabel, type IntakeSection,
} from "@/lib/care-coordinator-rules";
import type { FundedBy } from "@/lib/su-import-rules";
import type { IntakeView } from "./intake";

/**
 * What the AI CSB Coordinator says about one care intake, worked out from the saved intake (getIntake) only. Pure: no
 * database, no AI. getIntake has already hidden restricted facts from employees without serviceUser.sensitive, and
 * this keeps them hidden (a hidden fact is counted, never shown).
 *
 * Proposed facts (still waiting for the coordinator) and decided facts are kept apart, and nothing here says that a
 * person approved anything unless the intake records that decision.
 */

type Fact = IntakeView["facts"][number];
type VisitValue = { label?: string; weekdays: number[]; startTime: string; durationMin: number; carers: number; fundedBy: FundedBy; tasks?: string[] };

const REJECTED = new Set(["REJECTED", "DUPLICATE"]);
const cut = (s: string | null | undefined, n = 400) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const source = (f: Fact, docs: Map<string, string>) => ({
  document: f.sourceDocumentId ? (docs.get(f.sourceDocumentId) ?? "document") : f.origin === "MANUAL" ? "added by hand" : null,
  page: f.sourcePage,
  quote: cut(f.quote, 240),
  checkedAgainstPage: f.verification === "VERIFIED",
});

export function intakeDigest(view: IntakeView) {
  const docs = new Map(view.documents.map((d) => [d.id, d.name]));
  const live = view.facts.filter((f) => !REJECTED.has(f.decision));
  const shown = live.filter((f) => !f.hidden);
  const hiddenCount = live.length - shown.length;
  const status = view.intake.status as keyof typeof INTAKE_STATUS;

  // Visits: every proposed or accepted row, with where it came from. Funding is kept apart, never merged.
  const visits = shown
    .filter((f) => f.destination === "visit" && f.value)
    .map((f) => ({ v: f.value as VisitValue, f }))
    .map(({ v, f }) => ({
      label: v.label ?? null, startTime: v.startTime, durationMin: v.durationMin, days: dayList(v.weekdays), weekdays: v.weekdays, carers: v.carers, fundedBy: v.fundedBy,
      decision: f.decisionLabel, conflict: f.conflict, source: source(f, docs),
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const minutesFact = shown.find((f) => f.destination === "package.minutesPerWeek");
  const authorised = minutesFact && minutesFact.value !== null ? Number(minutesFact.value) : null;
  const hours = reconcileHours(visits.map((v) => ({ weekdays: v.weekdays, durationMin: v.durationMin, carers: v.carers, fundedBy: v.fundedBy })), Number.isFinite(authorised) ? authorised : null);
  const councilVisitsPerDay = visits.filter((v) => v.fundedBy === "COUNCIL" && v.weekdays.length === 7);

  // Care plan: which of the nine sections have something from the documents, and which have nothing yet.
  const planFacts = shown.filter((f) => f.destination.startsWith("careplan."));
  const carePlan = PLAN_SECTION_KEYS.map((key) => {
    const fs = planFacts.filter((f) => f.destination === `careplan.${key}`);
    return { section: PLAN_SECTION_LABEL[key], key, entries: fs.length, restricted: live.some((f) => f.hidden && f.destination === `careplan.${key}`), drafts: fs.slice(0, 3).map((f) => ({ text: cut(f.display, 500), decision: f.decisionLabel, source: source(f, docs) })) };
  });
  const risks = shown.filter((f) => f.destination === "risk").map((f) => {
    const v = (f.value ?? {}) as { title?: string; type?: string; level?: string | null; levelIsProvisional?: boolean; openQuestions?: string | null };
    return { title: v.title ?? f.label, type: v.type ?? null, levelFromDocument: v.level && v.levelIsProvisional === false ? v.level : null, openQuestions: cut(v.openQuestions ?? null, 300), decision: f.decisionLabel, source: source(f, docs) };
  });
  const person = shown.filter((f) => f.destination.startsWith("person.") || f.destination === "contact" || f.destination === "externalReference" || f.destination.startsWith("preference.")).map((f) => ({ field: f.label, value: cut(f.display, 200), decision: f.decisionLabel, conflict: f.conflict, source: source(f, docs) }));
  const pkg = shown.filter((f) => f.destination.startsWith("package.")).map((f) => ({ field: f.label, value: cut(f.display, 300), decision: f.decisionLabel, conflict: f.conflict, source: source(f, docs) }));

  const findings = view.documents.flatMap((d) => d.findings.map((x) => ({ document: d.name, kind: x.kind, text: cut(x.text, 300), page: x.page })));
  const conflicts = shown.filter((f) => f.conflict).map((f) => ({ field: f.label, section: sectionLabel(f.section), conflict: cut(f.conflict, 300) }));
  const missingPlan = carePlan.filter((c) => !c.entries && !c.restricted).map((c) => c.section);

  return {
    intake: { id: view.intake.id, reference: view.intake.reference, title: view.intake.title, status: INTAKE_STATUS[status] ?? status, mode: view.intake.mode, person: view.person ? { name: view.person.name, reference: view.person.reference } : null },
    documents: view.documents.map((d) => ({ name: d.name, category: d.categoryLabel, pages: d.pageCount, read: d.readStatus, note: cut(d.readNote, 200) })),
    counts: {
      facts: live.length, waitingForCoordinator: live.filter((f) => f.decision === "PENDING").length, needsClarification: live.filter((f) => f.decision === "CLARIFY").length,
      accepted: live.filter((f) => ACCEPTED.has(f.decision)).length, restrictedHidden: hiddenCount, checkedAgainstPage: live.filter((f) => f.verification === "VERIFIED").length,
    },
    person, carePlan, missingCarePlanSections: missingPlan, risks, carePackage: pkg,
    visits: visits.map(({ weekdays: _w, ...v }) => v),
    hours: {
      councilMinutesPerWeek: hours.COUNCIL, carersServiceMinutesPerWeek: hours.CARERS_SERVICE, otherMinutesPerWeek: hours.OTHER,
      councilMinutesPerDayIfDaily: councilVisitsPerDay.length === visits.filter((v) => v.fundedBy === "COUNCIL").length && councilVisitsPerDay.length ? councilVisitsPerDay.reduce((n, v) => n + v.durationMin, 0) : null,
      authorisedMinutesPerWeek: hours.authorised, matches: hours.matches, message: hours.message,
    },
    conflicts, findings: findings.slice(0, 25),
    sections: view.sections.filter((s) => s.total > 0).map((s) => ({ section: sectionLabel(s.key as IntakeSection), facts: s.total, open: s.open, accepted: s.accepted, managerDecision: s.status, savedToRecord: s.applyStatus })),
    nothingSavedYet: !view.sections.some((s) => s.applyStatus === "DONE"),
  };
}
export type IntakeDigest = ReturnType<typeof intakeDigest>;

const mins = (n: number) => `${n} minutes${n >= 60 ? ` (${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ""})` : ""}`;

/** The same digest as plain sentences, for the chat when no AI is used. Facts only, with the next step. */
export function digestText(d: IntakeDigest): string {
  const council = d.visits.filter((v) => v.fundedBy === "COUNCIL");
  const other = d.visits.filter((v) => v.fundedBy !== "COUNCIL");
  const lines = [
    `Intake ${d.intake.reference} (${d.intake.title}) is at: ${d.intake.status}.`,
    `Documents: ${d.documents.map((x) => `${x.name} (${x.pages ?? "?"} pages, ${x.read.toLowerCase().replace("_", " ")})`).join("; ") || "none yet"}.`,
    `Facts read: ${d.counts.facts}, of which ${d.counts.waitingForCoordinator} ${d.counts.waitingForCoordinator === 1 ? "is" : "are"} waiting for your check${d.counts.restrictedHidden ? ` and ${d.counts.restrictedHidden} ${d.counts.restrictedHidden === 1 ? "is" : "are"} restricted (a registered manager reviews ${d.counts.restrictedHidden === 1 ? "it" : "them"})` : ""}.`,
    council.length ? `Council-funded visits found: ${council.map((v) => `${v.startTime} for ${v.durationMin} min (${v.days}, page ${v.source.page ?? "?"})`).join("; ")}.` : "No council-funded visits were found.",
    other.length ? `Kept separate (not council-funded): ${other.map((v) => `${v.startTime} ${v.durationMin} min, ${v.fundedBy === "CARERS_SERVICE" ? "carers service / family" : "other funding"}`).join("; ")}.` : "",
    `Council visits add up to ${mins(d.hours.councilMinutesPerWeek)} a week. ${d.hours.message}`,
    `Care plan sections with content: ${d.carePlan.filter((c) => c.entries).map((c) => c.section).join(", ") || "none"}.${d.missingCarePlanSections.length ? ` Nothing found yet for: ${d.missingCarePlanSections.join(", ")}.` : ""}`,
    d.risks.length ? `Risk drafts: ${d.risks.map((r) => r.title).join("; ")} (risk levels are set by a person, not read in).` : "No risk drafts were proposed.",
    d.conflicts.length ? `Conflicts to resolve: ${d.conflicts.slice(0, 4).map((c) => `${c.field}: ${c.conflict}`).join(" | ")}` : "",
    d.findings.filter((f) => f.kind !== "UNREADABLE").length ? `Flags and missing information: ${d.findings.filter((f) => f.kind !== "UNREADABLE").slice(0, 5).map((f) => f.text).join(" | ")}` : "",
    "Nothing has been approved, saved to a service user's record or put on the rota. Check each fact against its page, then submit the intake to a manager.",
  ];
  return lines.filter(Boolean).join("\n\n");
}

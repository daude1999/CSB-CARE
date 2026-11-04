import { daysBetween, fromDbDate } from "@/lib/london";

/**
 * What the Care Package card and tab show, worked out from the structured records only: the package's own fields,
 * the person's repeating visit templates, the coverage calculation and open review items. The package's free-text
 * requirements are never read here, so nothing is inferred from imported narrative.
 */

/** Review-item categories that belong to the care package (funding, hours, scheduling questions). Clinical items
 *  (medication, incident history, skin) stay on the intake and their own restricted records. */
export const PACKAGE_QUERY_CATEGORIES = ["FUNDING", "PACKAGE_HOURS", "MISSING_INFO"] as const;

/** A planned week within this many minutes of the commissioned week counts as matching (same rule as before). */
export const COVERAGE_TOLERANCE_MIN = 30;

/** A time-limited package is flagged this many days before it ends. */
export const ENDING_SOON_DAYS = 28;

export interface CoverageFigures { planned: number; plannedCarerMinutes: number; commissioned: number | null; difference: number | null; templates: number }

/** Minutes as hours, to two decimal places at most: 1488 → "24.8", 1485 → "24.75", 600 → "10". */
export function hoursText(minutes: number) {
  return String(Number((minutes / 60).toFixed(2)));
}

export function hoursPerWeek(minutes: number | null) {
  return minutes === null ? null : `${hoursText(minutes)} hours/week`;
}

export type CoverageState = "NOT_RECORDED" | "MATCHES" | "OVER" | "UNDER";

/** Compares like with like: planned visit time against commissioned time, and planned carer time against it separately. */
export function coverageState(c: CoverageFigures) {
  const visit = compare(c.planned, c.commissioned);
  const carer = compare(c.plannedCarerMinutes, c.commissioned);
  return { visit, carer, hasDoubleUps: c.plannedCarerMinutes !== c.planned };
}

function compare(planned: number, commissioned: number | null): { state: CoverageState; difference: number | null } {
  if (commissioned === null) return { state: "NOT_RECORDED", difference: null };
  const difference = planned - commissioned;
  if (Math.abs(difference) <= COVERAGE_TOLERANCE_MIN) return { state: "MATCHES", difference };
  return { state: difference > 0 ? "OVER" : "UNDER", difference };
}

interface PackageRecord {
  reference: string | null;
  status: "ACTIVE" | "ENDED";
  commissionedMinutesPerWeek: number | null;
  startDate: Date;
  endDate: Date | null;
  funder: { name: string } | null;
}
interface TemplateRecord { startMinute: number; effectiveTo: Date | null; callType: { name: string } }

export interface CarePackageSummary {
  reference: string | null;
  status: "ACTIVE" | "ENDED";
  commissionedMinutesPerWeek: number | null;
  startDate: Date;
  endDate: Date | null;
  /** Only a funder linked by finance. A name written in imported notes is never shown here. */
  funderName: string | null;
  scheduledCalls: string[];
  recurringVisits: number;
  attention: string[];
}

/**
 * The Overview card's view model. Only structured fields go in; the requirements text is deliberately not part of it.
 * `templates` are the person's enabled templates; ones that ended before today are left out.
 */
export function carePackageSummary(input: { pkg: PackageRecord | null; coverage: CoverageFigures | null; templates: TemplateRecord[]; openQueries: number; today: string }): CarePackageSummary | null {
  const { pkg, coverage, today } = input;
  if (!pkg) return null;
  const current = input.templates.filter((t) => !t.effectiveTo || fromDbDate(t.effectiveTo) >= today).sort((a, b) => a.startMinute - b.startMinute);
  const scheduledCalls = [...new Set(current.map((t) => t.callType.name))];
  return {
    reference: pkg.reference?.trim() || null,
    status: pkg.status,
    commissionedMinutesPerWeek: pkg.commissionedMinutesPerWeek,
    startDate: pkg.startDate,
    endDate: pkg.endDate,
    funderName: pkg.funder?.name ?? null,
    scheduledCalls,
    recurringVisits: current.length,
    attention: attentionFor(pkg, coverage, input.openQueries, today),
  };
}

/** Short warnings, each backed by a stored value: never by words found in the requirements text. */
export function attentionFor(pkg: PackageRecord, coverage: CoverageFigures | null, openQueries: number, today: string) {
  const out: string[] = [];
  if (pkg.commissionedMinutesPerWeek === null) out.push("Commissioned hours are not recorded");
  else if (coverage && coverage.templates > 0) {
    const v = coverageState(coverage).visit;
    if (v.state === "OVER" || v.state === "UNDER") out.push(`Planned visits are ${hoursText(Math.abs(v.difference!))} hours a week ${v.state === "OVER" ? "over" : "under"} the commissioned hours`);
  }
  if (pkg.status === "ACTIVE" && pkg.endDate) {
    const end = fromDbDate(pkg.endDate);
    const days = daysBetween(today, end);
    if (days < 0) out.push("The package end date has passed but it is still active");
    else if (days <= ENDING_SOON_DAYS) out.push(`Time-limited: ends in ${days === 0 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`}`);
  }
  if (openQueries > 0) out.push(`${openQueries} package ${openQueries === 1 ? "query" : "queries"} to review`);
  return out;
}

/** Long requirements text opens collapsed on the full tab; it is still shown in full, every character. */
export function isLongText(text: string) {
  return text.length > 600 || text.split("\n").length > 8;
}

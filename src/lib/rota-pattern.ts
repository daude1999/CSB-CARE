/** Plain-language labels for a recurring template's pattern (cycle weeks and weekdays). Pure, so they are unit-tested. */

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const list = (items: (string | number)[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * The cycle weeks a template runs in, as staff say it: "All Weeks", "Week 2", "Weeks 1 and 3". Weeks beyond the
 * organisation's current cycle length are never built, so they are left out; a template left with none says so.
 */
export function patternLabel(cycleWeeks: number[], cycleLength: number) {
  const weeks = [...new Set(cycleWeeks)].filter((w) => w >= 1 && w <= cycleLength).sort((a, b) => a - b);
  if (!weeks.length) return "Not in the current cycle";
  if (cycleLength === 1) return "Every week";
  if (weeks.length === cycleLength) return "All Weeks";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${list(weeks)}`;
}

/** The weekdays a template runs on: "Every day", "Weekdays (Mon–Fri)", "Weekends", or "Mon, Wed and Fri". */
export function weekdaysLabel(weekdays: number[]) {
  const days = [...new Set(weekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const key = days.join("");
  if (key === "1234567") return "Every day";
  if (key === "12345") return "Weekdays (Mon–Fri)";
  if (key === "67") return "Weekends";
  return list(days.map((d) => SHORT[d - 1]!));
}

/** Carers planned against carers needed on a template. One template is one row, however many carers it needs. */
export function templateCoverage(t: { carersRequired: number; preferredStaff1Id: string | null; preferredStaff2Id: string | null }) {
  const required = Math.max(1, t.carersRequired);
  const filled = [t.preferredStaff1Id, required > 1 ? t.preferredStaff2Id : null].filter(Boolean).length;
  const state = filled >= required ? "full" : filled === 0 ? "none" : "part";
  return { filled, required, state } as const;
}

/** "45m", "1h 30m". */
export function durationLabel(minutes: number) {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

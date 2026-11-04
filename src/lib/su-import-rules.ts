import { parseHhmm } from "@/lib/london";

/** Pure rules for "Set up from support plan", shared by the server and the wizard (no database, no secrets). */

export const FUNDED_BY = { COUNCIL: "Council", CARERS_SERVICE: "Carers service (informal carer's plan)", OTHER: "Other" } as const;
export type FundedBy = keyof typeof FUNDED_BY;

/** Weekly minutes from the visit rows, split by who funds them. */
export function weeklyTotals(visits: { weekdays: number[]; durationMin: number; carers: number; fundedBy: FundedBy }[]) {
  const out = { COUNCIL: 0, CARERS_SERVICE: 0, OTHER: 0, total: 0, carerMinutes: 0 };
  for (const v of visits) {
    const days = new Set(v.weekdays).size;
    const mins = days * v.durationMin;
    out[v.fundedBy] += mins;
    out.total += mins;
    out.carerMinutes += mins * v.carers;
  }
  return out;
}

/** Decimal hours as councils write them ("0.75", "1", "1.00") to minutes. */
export function hoursToMinutes(hours: string | number) {
  const h = typeof hours === "number" ? hours : Number(String(hours).trim());
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.round(h * 60);
}

/** The call type whose name best fits a visit, by its start time and what the row says. The office can change it. */
export function guessCallType(start: string, tasks: string, callTypes: { id: string; name: string }[]) {
  const minute = parseHhmm(start);
  const lower = tasks.toLowerCase();
  const find = (...words: string[]) => callTypes.find((c) => words.some((w) => c.name.toLowerCase().includes(w)));
  if (/\b(shopping|domestic|clean|laundry|sitting|companion)\b/.test(lower)) {
    const special = find("sitting", "domestic", "shopping");
    if (special) return special.id;
  }
  const byTime = minute === null ? null : minute < 11 * 60 ? find("morning", "breakfast") : minute < 14 * 60 ? find("lunch", "midday") : minute < 18 * 60 ? find("tea", "afternoon") : find("bed", "evening", "night");
  return byTime?.id ?? callTypes[0]?.id ?? "";
}


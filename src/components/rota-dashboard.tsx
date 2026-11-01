import { fmtLondonDate } from "@/lib/london";

/** "Saturday 31st October 2026": the long date shown at the top of the Rota Dashboard and the Daily Rota. */
export const ordinalDate = (iso: string) => {
  const d = Number(iso.slice(8, 10));
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${fmtLondonDate(iso, { weekday: "long" })} ${d}${suffix} ${fmtLondonDate(iso, { month: "long", year: "numeric" })}`;
};

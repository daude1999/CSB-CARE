import { fmtLondonDate } from "@/lib/london";

/**
 * The Overview's "This week" chart: visits completed on each of the last seven days, one navy bar a day with its
 * count above and the day below; today (so far) is the pale bar. With no visits at all it says "No visits yet".
 */
export function WeekBars({ days }: { days: { date: string; value: number }[] }) {
  if (days.every((d) => d.value === 0)) {
    return <p className="text-[13.5px] text-[var(--hb-ink-3)]" data-testid="reporting-no-visits">No visits yet</p>;
  }
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <ul className="hb-ov-week" data-testid="reporting-bars">
      {days.map((d, i) => (
        <li key={d.date} data-today={i === days.length - 1 ? "" : undefined}>
          <b className="tabular-nums">{d.value}</b>
          <span className="hb-ov-wb"><span className="ovx-bar" style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }} /></span>
          <small>{fmtLondonDate(d.date, { weekday: "short" })}</small>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Overview Reporting tile's chart: visits completed on each of the last seven days, as small white bars, with today
 * (so far) at half strength. With no visits at all it says "No visits yet" instead of a row of flat bars.
 */
export function WeekBars({ days }: { days: { date: string; value: number }[] }) {
  if (days.every((d) => d.value === 0)) {
    return <span className="ovx-soft absolute right-5 top-[64px] text-[13px] font-medium" data-testid="reporting-no-visits">No visits yet</span>;
  }
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <span aria-hidden="true" className="absolute right-5 top-[64px] flex h-[70px] items-end gap-[7px]" data-testid="reporting-bars">
      {days.map((d, i) => (
        <span key={d.date} className={`ovx-bar w-[10px] ${i === days.length - 1 ? "opacity-50" : ""}`} style={{ height: `${Math.max(6, (d.value / max) * 100)}%` }} />
      ))}
    </span>
  );
}

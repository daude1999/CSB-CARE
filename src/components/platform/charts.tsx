/**
 * Small server-rendered charts for the Admin Centre. Plain SVG, no client script: every chart carries a text summary
 * for screen readers, and the figures it draws are the same counted figures shown beside it.
 */

type Point = { day: string; value: number };

const fmtDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A compact sparkline of daily bars for an indicator. */
export function Sparkbars({ points, label, tone = "violet" }: { points: Point[]; label: string; tone?: "violet" | "rose" | "navy" }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 120;
  const h = 28;
  const gap = 1;
  const bw = (w - gap * (points.length - 1)) / points.length;
  const fill = { violet: "#7c3aed", rose: "#c2410c", navy: "#1f2d57" }[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${label}: ${points.reduce((a, p) => a + p.value, 0)} over ${points.length} days`} className="block shrink-0">
      {points.map((p, i) => {
        const bh = p.value ? Math.max(2, (p.value / max) * h) : 1;
        return <rect key={p.day} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={0.75} fill={p.value ? fill : "#dfe3ec"} opacity={p.value ? 0.85 : 1} />;
      })}
    </svg>
  );
}

/** A daily bar chart with two series side by side (e.g. sign-ins and failed sign-ins), with a date axis. */
export function DailyChart({ series, height = 168 }: { series: { label: string; points: Point[]; color: string }[]; height?: number }) {
  const days = series[0]?.points ?? [];
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const niceMax = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const w = 720;
  const padL = 30;
  const padB = 22;
  const plotH = height - padB - 6;
  const slot = (w - padL) / Math.max(1, days.length);
  const bw = Math.max(2, (slot - 3) / series.length);
  const ticks = [0, niceMax / 2, niceMax];
  const summary = series.map((s) => `${s.label}: ${s.points.reduce((a, p) => a + p.value, 0)}`).join(", ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${w} ${height}`} className="block h-auto w-full" role="img" aria-label={`Last ${days.length} days. ${summary}.`}>
        {ticks.map((t) => {
          const y = 6 + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={w} y1={y} y2={y} stroke="#eef0f5" />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="#7a8294">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
            </g>
          );
        })}
        {days.map((d, i) => (
          <g key={d.day}>
            {series.map((s, si) => {
              const v = s.points[i]?.value ?? 0;
              const bh = v ? Math.max(2, (v / niceMax) * plotH) : 0;
              return v ? <rect key={s.label} x={padL + i * slot + 1.5 + si * bw} y={6 + plotH - bh} width={bw - 0.5} height={bh} rx={1} fill={s.color}><title>{`${fmtDay(d.day)}: ${v} ${s.label.toLowerCase()}`}</title></rect> : null;
            })}
            {i % 7 === 0 || i === days.length - 1 ? <text x={padL + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#7a8294">{fmtDay(d.day)}</text> : null}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-[#5b6478]">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} />
            {s.label} <span className="tabular-nums text-[#26304a]">{s.points.reduce((a, p) => a + p.value, 0)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** A thin progress bar with a label, used for setup progress and allowance use. */
export function Progress({ value, max, label, tone = "violet" }: { value: number; max: number; label: string; tone?: "violet" | "amber" | "rose" | "green" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = { violet: "bg-[#6d28d9]", amber: "bg-[#d97706]", rose: "bg-[#b42335]", green: "bg-[#17824a]" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-[#eceef4]">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

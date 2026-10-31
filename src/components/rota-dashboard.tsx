import type { ReactNode } from "react";
import Link from "@/components/link";
import { fmtLondonDate } from "@/lib/london";

/** Building blocks of the Rota Dashboard. Server components; no client state. */

export const ordinalDate = (iso: string) => {
  const d = Number(iso.slice(8, 10));
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${fmtLondonDate(iso, { weekday: "long" })} ${d}${suffix} ${fmtLondonDate(iso, { month: "long", year: "numeric" })}`;
};

const KPI_TONE = {
  lavender: { bg: "bg-[#f3f0fc]", ring: "bg-[#e4dcf8] text-[#6b3fd0]", pct: "text-[#5a3aa8]" },
  green: { bg: "bg-[#ebf7ef]", ring: "bg-[#d3eedc] text-[#1c8a4a]", pct: "text-[#1c7a43]" },
  amber: { bg: "bg-[#fdf4e3]", ring: "bg-[#fbe5bd] text-[#c27a06]", pct: "text-[#8a5a00]" },
  red: { bg: "bg-[#fdeeee]", ring: "bg-[#f9d5d5] text-[#c8323a]", pct: "text-[#a3242c]" },
  orange: { bg: "bg-[#fdf1e7]", ring: "bg-[#fbdcc2] text-[#d0631a]", pct: "text-[#a14b0f]" },
} as const;
export type KpiTone = keyof typeof KPI_TONE;

export function KpiCard({ label, value, extra, icon, tone, href, title, testId }: { label: string; value: number; extra?: ReactNode; icon: ReactNode; tone: KpiTone; href: string; title?: string; testId?: string }) {
  const t = KPI_TONE[tone];
  return (
    <Link href={href} title={title} data-testid={testId} className={`group flex min-w-0 items-center gap-4 rounded-[10px] px-4 py-3 no-underline transition-shadow hover:shadow-[0_1px_6px_rgba(16,24,40,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6b3fd0] ${t.bg}`}>
      <span aria-hidden className={`flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full ${t.ring}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-semibold text-[#0b1530]">{label}</span>
        <span className="flex items-baseline gap-3">
          <span data-value className="text-[32px] font-bold leading-[1.1] tabular-nums text-[#0b1530]">{value.toLocaleString("en-GB")}</span>
          {extra ? <span className={`text-[14px] font-medium tabular-nums ${t.pct}`}>{extra}</span> : null}
        </span>
      </span>
    </Link>
  );
}

export function DashPanel({ title, icon, id, aside, children, className = "" }: { title: string; icon: ReactNode; id: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white px-5 py-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2.5">
        <span aria-hidden className="text-[#6b3fd0]">{icon}</span>
        <h2 id={id} className="text-[18.5px] font-bold text-[#0b1530]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function AttentionRow({ icon, tone, title, text, count, href }: { icon: ReactNode; tone: "red" | "amber" | "lavender" | "orange"; title: string; text: string; count: number; href: string }) {
  const ring = { red: "bg-[#fdeeee] text-[#c8323a]", amber: "bg-[#fdf4e3] text-[#c27a06]", lavender: "bg-[#f3f0fc] text-[#6b3fd0]", orange: "bg-[#fdf1e7] text-[#d0631a]" }[tone];
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-[8px] px-2 py-[3px] no-underline hover:bg-[#f7f7fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6b3fd0]">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${ring}`}>{icon}</span>
        <span className="min-w-0 flex-1 leading-[17px]">
          <span className="block text-[14.5px] font-semibold text-[#0b1530]">{title}</span>
          <span className="block truncate text-[13px] text-slate-600">{text}</span>
        </span>
        <span className={`text-[15px] font-semibold tabular-nums ${count ? "text-[#0b1530]" : "text-slate-400"}`}>{count}</span>
        <span aria-hidden className="text-slate-500">›</span>
      </Link>
    </li>
  );
}

export function StaffRow({ icon, tone, label, value, href }: { icon: ReactNode; tone: "green" | "blue" | "red" | "amber"; label: string; value: number; href: string }) {
  const ring = { green: "bg-[#ebf7ef] text-[#1c8a4a]", blue: "bg-[#e8f0fc] text-[#1d5fd0]", red: "bg-[#fdeeee] text-[#c8323a]", amber: "bg-[#fdf4e3] text-[#c27a06]" }[tone];
  return (
    <li className="border-b border-[#eef0f3] last:border-b-0">
      <Link href={href} className="flex items-center gap-3 px-1 py-[5px] no-underline hover:bg-[#f7f7fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6b3fd0]">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${ring}`}>{icon}</span>
        <span className="flex-1 text-[14.5px] font-medium text-[#0b1530]">{label}</span>
        <span className="pr-2 text-[19px] font-bold tabular-nums text-[#0b1530]">{value}</span>
      </Link>
    </li>
  );
}

/** Horizontal bars, one per mutually exclusive state. Widths are shares of the total, so they reconcile. */
export function StateBars({ rows, total }: { rows: { label: string; value: number; colour: string; href: string }[]; total: number }) {
  return (
    <ul className="space-y-[2px]">
      {rows.map((r) => {
        const share = total ? r.value / total : 0;
        return (
          <li key={r.label}>
            <Link href={r.href} className="grid grid-cols-[96px_minmax(0,1fr)_96px] items-center gap-3 rounded-[4px] py-1 no-underline hover:bg-[#f7f7fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6b3fd0]" title={`${r.label}: ${r.value} of ${total} visits`}>
              <span className="text-[14px] text-[#0b1530]">{r.label}</span>
              <span className="h-[18px] rounded-[3px] bg-transparent">
                <span className="block h-full rounded-[3px]" style={{ width: `${Math.max(share * 100, r.value ? 2.5 : 0)}%`, background: r.colour }} />
              </span>
              <span className="text-right text-[14px] tabular-nums text-[#0b1530]">{r.value} ({total ? (share * 100).toFixed(1) : "0.0"}%)</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const COV = { full: "#1f9d4c", partial: "#2f7de1", none: "#f2a516" } as const;

/** Seven stacked bars (fully staffed, partly staffed, unassigned); each bar opens that day's Daily Rota. */
export function CoverageChart({ days, hrefFor }: { days: { date: string; full: number; partial: number; none: number; total: number; notBuilt: boolean }[]; hrefFor: (date: string) => string }) {
  const max = Math.max(10, ...days.map((d) => d.total));
  const step = max <= 50 ? 10 : max <= 100 ? 20 : max <= 250 ? 40 : 100;
  const top = Math.ceil(max / step) * step;
  const H = 112;
  const W = 780;
  const left = 40;
  const colW = (W - left) / 7;
  const y = (v: number) => H - (v / top) * H + 8;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 50}`} className="h-auto w-full" role="img" aria-label="Visit coverage for the next seven days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#344054">{t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * colW + colW * 0.16;
          const w = colW * 0.68;
          let acc = 0;
          const segs = (["full", "partial", "none"] as const).map((k) => {
            const h = (d[k] / top) * H;
            const seg = { k, y: y(acc + d[k]), h };
            acc += d[k];
            return seg;
          });
          const label = `${fmtLondonDate(d.date, { weekday: "short", day: "numeric", month: "short" })}: ${d.notBuilt ? "rota not built" : `${d.total} visits, ${d.full} fully staffed, ${d.partial} partly staffed, ${d.none} unassigned`}`;
          return (
            <a key={d.date} href={hrefFor(d.date)} aria-label={label}>
              <title>{label}</title>
              <rect x={x - 4} y={0} width={w + 8} height={H + 8} fill="transparent" />
              {d.notBuilt ? (
                <>
                  <rect x={x} y={y(top * 0.35)} width={w} height={0.35 * H} fill="none" stroke="#c4c9d2" strokeDasharray="4 3" />
                  <text x={x + w / 2} y={y(top * 0.17)} textAnchor="middle" fontSize="11" fill="#667085">Not built</text>
                </>
              ) : (
                segs.map((s) => (s.h > 0 ? <rect key={s.k} x={x} y={s.y} width={w} height={s.h} fill={COV[s.k]} rx={s.k === "none" || (s.k === "partial" && !d.none) || (s.k === "full" && !d.none && !d.partial) ? 3 : 0} /> : null))
              )}
              <text x={x + w / 2} y={H + 26} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0b1530">{fmtLondonDate(d.date, { weekday: "short" })}</text>
              <text x={x + w / 2} y={H + 43} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0b1530">{fmtLondonDate(d.date, { day: "numeric", month: "short" })}</text>
            </a>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap justify-center gap-5 text-[13px] text-[#0b1530]">
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ background: COV.full }} />Fully staffed</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ background: COV.partial }} />Partly staffed</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ background: COV.none }} />Unassigned</span>
      </figcaption>
    </figure>
  );
}

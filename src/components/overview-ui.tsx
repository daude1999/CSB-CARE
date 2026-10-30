"use client";
import { useEffect, useId, useState } from "react";
import { CaretDown, Info, X } from "@phosphor-icons/react";

export interface ChartSeries {
  key: string;
  label: string;
  /** Oldest first. */
  days: { date: string; value: number }[];
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

/** The Reporting card's chart: the last seven days of one measure, chosen from the measures this person may see. */
export function OverviewChart({ series, colour }: { series: ChartSeries[]; colour: string }) {
  const [key, setKey] = useState(series[0]?.key);
  const id = useId();
  const current = series.find((s) => s.key === key) ?? series[0];
  if (!current) return <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">Charts appear here for people with rota or staff sign-off access.</p>;
  const max = Math.max(4, ...current.days.map((d) => d.value));
  const top = Math.ceil(max / 4) * 4;
  const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];
  const total = current.days.reduce((n, d) => n + d.value, 0);
  return (
    <figure className="flex h-full flex-col px-3 pb-1.5 pt-2">
      <div className="flex justify-end">
        <label htmlFor={id} className="sr-only">Measure</label>
        <span className="relative">
          <select id={id} value={current.key} onChange={(e) => setKey(e.target.value)} className="h-[24px] appearance-none rounded-[5px] border border-[#dfe3ea] bg-white pl-2 pr-6 text-[11px] text-[#1b2533]">
            {series.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <CaretDown size={10} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-2 top-[7px] text-[#3a4658]" />
        </span>
      </div>
      <figcaption className="sr-only">{current.label}, last 7 days: {current.days.map((d) => `${dayLabel(d.date)} ${d.value}`).join(", ")}. Total {total}.</figcaption>
      <div aria-hidden="true" className="relative mt-1 flex min-h-0 flex-1 pl-6">
        <div className="absolute inset-y-0 left-0 flex w-5 flex-col justify-between pb-[16px] text-right text-[9px] leading-none text-[#7a8494]">
          {ticks.map((t) => <span key={t}>{Math.round(t)}</span>)}
        </div>
        <div className="flex flex-1 items-end justify-around gap-2 border-b border-[#e6e9ef] pb-0">
          {current.days.map((d) => (
            <div key={d.date} className="flex h-full flex-1 flex-col justify-end">
              <div className="mx-auto w-full max-w-[26px] rounded-t-[2px]" style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 2 : 0, background: colour }} title={`${dayLabel(d.date)}: ${d.value}`} />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex justify-around gap-2 pl-6 pt-1 text-[9.5px] text-[#7a8494]">
        {current.days.map((d) => <span key={d.date} className="flex-1 text-center">{dayLabel(d.date)}</span>)}
      </div>
    </figure>
  );
}

const KEY = "csb.overview.banner.dismissed";

/** The note at the foot of the Overview. Dismissing it is remembered on this device only. */
export function OverviewBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      setShown(localStorage.getItem(KEY) !== "1");
    } catch {
      setShown(true);
    }
  }, []);
  if (!shown) return null;
  return (
    <aside className="flex items-start gap-3 rounded-[10px] border border-[#cfe0f7] bg-[#eef5fe] px-4 py-3">
      <Info size={26} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-[#1565c0]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[#0b1530]">Each module is its own workspace</p>
        <p className="mt-0.5 text-[12.5px] text-[#3a4658]">Open a module above for its full set of pages, records and workflows. This overview is a snapshot across your organisation.</p>
      </div>
      <button
        type="button"
        onClick={() => {
          setShown(false);
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* Storage can be blocked; the note simply returns next time. */
          }
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#1b2533] hover:bg-black/5"
        aria-label="Dismiss this note"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

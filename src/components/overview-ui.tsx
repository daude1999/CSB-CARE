"use client";
import { useEffect, useId, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowsOutCardinal, CaretDown, DotsSixVertical, Info, X } from "@phosphor-icons/react";

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
  const step = Math.ceil(max / 4 / 5) * 5 || 1;
  const top = step * 4;
  const ticks = [4, 3, 2, 1, 0].map((n) => n * step);
  const total = current.days.reduce((n, d) => n + d.value, 0);
  const last = current.days.length - 1;
  return (
    <figure className="relative flex h-full flex-col bg-white px-3 pb-1.5 pt-[38px]">
      <div className="absolute inset-x-3 top-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-medium text-[#5f6b7a]">Last 7 days · <span className="text-[#0b1530]">{total}</span></span>
        <label htmlFor={id} className="sr-only">Measure</label>
        <span className="relative">
          <select id={id} value={current.key} onChange={(e) => setKey(e.target.value)} className="h-[24px] appearance-none rounded-[6px] border border-[#dfe3ea] bg-white pl-2.5 pr-6 text-[11px] font-medium text-[#1b2533] shadow-[0_1px_2px_rgb(11_21_48/0.06)]">
            {series.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <CaretDown size={10} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-2 top-[7px] text-[#3a4658]" />
        </span>
      </div>
      <figcaption className="sr-only">{current.label}, last 7 days: {current.days.map((d) => `${dayLabel(d.date)} ${d.value}`).join(", ")}. Total {total}. Today is so far.</figcaption>
      <div aria-hidden="true" className="relative min-h-0 flex-1">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 flex items-center gap-1.5" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
            <span className="w-5 text-right text-[9px] leading-none text-[#8a93a3]">{t}</span>
            <span className={`h-px flex-1 ${t === 0 ? "bg-[#d9dee6]" : "bg-[#eef1f5]"}`} />
          </div>
        ))}
        <div className="absolute inset-y-0 left-[26px] right-0 flex items-end justify-around">
          {current.days.map((d, i) => (
            <div key={d.date} className="flex h-full w-[7%] flex-col justify-end" title={`${dayLabel(d.date)}: ${d.value}${i === last ? " (today so far)" : ""}`}>
              <div className="w-full rounded-t-[4px]" style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 3 : 0, background: colour, opacity: i === last ? 0.45 : 1 }} />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="ml-[26px] flex justify-around pt-1 text-[9.5px] leading-[11px] text-[#7a8494]">
        {current.days.map((d, i) => <span key={d.date} className="w-[7%] whitespace-nowrap text-center">{i === last ? "Today" : dayLabel(d.date)}</span>)}
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

export interface ArrangeItem {
  key: string;
  name: string;
  node: React.ReactNode;
}

/**
 * The module boxes. In arrange mode (?arrange=1) each box can be dragged, or moved with its arrow buttons from the
 * keyboard, and the order is saved to the member's own account. The attention panel always stays last.
 */
export function ModuleGrid({ items, arranging, saveAction, after }: { items: ArrangeItem[]; arranging: boolean; saveAction: (fd: FormData) => Promise<void>; after: React.ReactNode }) {
  const [order, setOrder] = useState(items.map((i) => i.key));
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const byKey = new Map(items.map((i) => [i.key, i] as const));
  const shown = arranging ? order.map((k) => byKey.get(k)).filter((i): i is ArrangeItem => Boolean(i)) : items;

  const move = (key: string, to: number) => {
    const from = order.indexOf(key);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, key);
    setOrder(next);
    setAnnounce(`${byKey.get(key)?.name} moved to position ${to + 1} of ${order.length}.`);
  };

  return (
    <>
      {arranging ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-[#9db9e6] bg-[#f3f8ff] px-4 py-2.5 sm:flex-row sm:items-center" data-testid="arrange-bar">
          <p className="flex-1 text-[13px] text-[#1b2533]"><span className="font-semibold">Arrange your modules.</span> Drag a box to a new place, or use its arrow buttons. Only you see this order.</p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={saveAction}>
              <input type="hidden" name="back" value="/overview?arrange=1" />
              <input type="hidden" name="reset" value="1" />
              <button type="submit" className="h-[32px] rounded-[7px] px-3 text-[13px] font-medium text-[#1b2533] hover:bg-black/5">Standard order</button>
            </form>
            <a href="/overview" className="flex h-[32px] items-center rounded-[7px] border border-[#d5dbe5] bg-white px-3 text-[13px] font-medium text-[#1b2533] hover:bg-[#fafbfc]">Cancel</a>
            <form action={saveAction}>
              <input type="hidden" name="back" value="/overview?arrange=1" />
              <input type="hidden" name="order" value={order.join(",")} />
              <button type="submit" className="h-[32px] rounded-[7px] bg-[#1565c0] px-3.5 text-[13px] font-semibold text-white hover:bg-[#11589f]">Save order</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="-mb-1 flex justify-end">
          <a href="/overview?arrange=1" className="flex items-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[12px] font-medium text-[#3a4658] hover:bg-black/5" data-testid="arrange-modules">
            <ArrowsOutCardinal size={14} aria-hidden="true" />Rearrange modules
          </a>
        </div>
      )}
      <p aria-live="polite" className="sr-only">{announce}</p>
      <div className="grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
        {shown.map((item, i) =>
          arranging ? (
            <div
              key={item.key}
              data-testid={`arrange-${item.key}`}
              draggable
              onDragStart={(e) => {
                setDragging(item.key);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.key);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging && dragging !== item.key) move(dragging, order.indexOf(item.key));
              }}
              onDrop={(e) => e.preventDefault()}
              className={`relative flex cursor-grab flex-col rounded-[12px] bg-[#eaf1fb] p-1.5 outline-dashed outline-2 outline-offset-2 active:cursor-grabbing ${dragging === item.key ? "opacity-50 outline-[#1565c0]" : "outline-[#9db9e6]"}`}
            >
              <div className="flex items-center gap-1 px-1 pb-1.5">
                <span className="flex flex-1 items-center gap-1.5 text-[12px] font-medium text-[#3a4658]"><DotsSixVertical size={16} weight="bold" aria-hidden="true" />Drag to move · position {i + 1}</span>
                <button type="button" onClick={() => move(item.key, i - 1)} disabled={i === 0} aria-label={`Move ${item.name} earlier`} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#d5dbe5] bg-white text-[#1b2533] hover:bg-[#f3f5f9] disabled:opacity-40">
                  <ArrowLeft size={14} weight="bold" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(item.key, i + 1)} disabled={i === shown.length - 1} aria-label={`Move ${item.name} later`} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#d5dbe5] bg-white text-[#1b2533] hover:bg-[#f3f5f9] disabled:opacity-40">
                  <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <div inert className="flex flex-1 flex-col [&>*]:flex-1">{item.node}</div>
            </div>
          ) : (
            <div key={item.key} className="flex flex-col [&>*]:flex-1">{item.node}</div>
          ),
        )}
        {after}
      </div>
    </>
  );
}

"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp, DotsThreeVertical, Funnel, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "@/components/link";

export interface DashColumn {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
}
export interface DashRow {
  key: string;
  /** Text the search box matches. */
  text: string;
  /** Sort keys by column key (ISO dates and zero-padded numbers sort as text). */
  sort?: Record<string, string>;
  /** The value the filter menu matches. */
  filter?: string;
  cells: ReactNode[];
}

/**
 * A compact dashboard table: search, one filter, sortable headings and pages of five. The rows arrive from the server
 * already limited to what the member may see; this only narrows, orders and pages them in the browser.
 */
export function DashTable({ label, columns, rows, empty, filterLabel, filters, menu, pageSize = 5, initialSort }: { label: string; columns: DashColumn[]; rows: DashRow[]; empty: string; filterLabel?: string; filters?: { value: string; label: string }[]; menu?: { label: string; href: string }[]; pageSize?: number; initialSort?: { key: string; dir: "asc" | "desc" } }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => (!needle || r.text.toLowerCase().includes(needle)) && (!filter || r.filter === filter));
    if (sort) {
      const m = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => m * (a.sort?.[sort.key] ?? "").localeCompare(b.sort?.[sort.key] ?? ""));
    }
    return out;
  }, [rows, q, filter, sort]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * pageSize, current * pageSize);
  const from = shown.length ? (current - 1) * pageSize + 1 : 0;
  const nums = pageNumbers(current, pages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3.5 pb-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search {label}</span>
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={`Search ${label}…`} className="h-9 w-full rounded-[7px] border border-[#d0d5dd] bg-white pl-8 pr-2 text-[13.5px] text-[#101828] placeholder:text-[#667085]" />
        </label>
        {filters?.length ? (
          <label className="relative">
            <span className="sr-only">{filterLabel ?? "Filter"}</span>
            <Funnel size={17} aria-hidden className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${filter ? "text-[#5b2bb5]" : "text-[#344054]"}`} />
            <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} title={filterLabel} className={`h-9 w-9 cursor-pointer appearance-none rounded-[7px] border bg-white text-transparent ${filter ? "border-[#5b2bb5] bg-[#f4effc]" : "border-[#d0d5dd]"}`}>
              <option value="">All</option>
              {filters.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
        ) : null}
        {menu?.length ? (
          <details className="relative">
            <summary aria-label={`More options for ${label}`} className="flex h-9 w-7 cursor-pointer list-none items-center justify-center rounded-[7px] text-[#344054] hover:bg-slate-100 [&::-webkit-details-marker]:hidden"><DotsThreeVertical size={20} weight="bold" aria-hidden /></summary>
            <ul className="absolute right-0 z-30 mt-1 w-[200px] rounded-[8px] border border-[#e4e7ec] bg-white py-1 text-[13.5px] shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              {menu.map((m) => <li key={m.href}><Link href={m.href} className="block px-3 py-1.5 text-[#101828] no-underline hover:bg-slate-50">{m.label}</Link></li>)}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]" aria-describedby={`${id}-n`}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-y border-[#eaecf0] bg-[#f9fafb] text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined} className={`whitespace-nowrap px-1.5 py-[7px] text-[12.5px] font-semibold text-[#101828] first:pl-3.5 ${c.className ?? ""}`}>
                    {c.sortable ? (
                      <button type="button" onClick={() => setSort(active && sort!.dir === "asc" ? { key: c.key, dir: "desc" } : { key: c.key, dir: "asc" })} className="inline-flex items-center gap-1 hover:text-[#5b2bb5]">
                        {c.label}
                        <span aria-hidden className="flex flex-col leading-none text-[#98a2b3]">
                          <CaretUp size={8} weight="fill" className={active && sort!.dir === "asc" ? "text-[#5b2bb5]" : ""} />
                          <CaretDown size={8} weight="fill" className={active && sort!.dir === "desc" ? "text-[#5b2bb5]" : ""} />
                        </span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.key} className="border-b border-[#f2f4f7] last:border-0 hover:bg-[#fafafc]">
                {r.cells.map((cell, i) => <td key={i} className={`whitespace-nowrap px-1.5 py-[6px] text-[#101828] first:pl-3.5 ${columns[i]?.className ?? ""}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!slice.length ? <p className="px-3.5 py-6 text-center text-[13.5px] text-[#667085]">{q || filter ? "Nothing matches." : empty}</p> : null}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[#f2f4f7] px-3.5 py-2">
        <p id={`${id}-n`} className="text-[12.5px] text-[#344054]" aria-live="polite">Showing {from} to {from ? from + slice.length - 1 : 0} of {shown.length} entries</p>
        {pages > 1 ? (
          <nav aria-label={`${label} pages`} className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous page" className="flex h-7 w-7 items-center justify-center rounded text-[#344054] hover:bg-slate-100 disabled:opacity-40"><CaretLeft size={14} weight="bold" aria-hidden /></button>
            {nums.map((n, i) => n === null ? <span key={`gap-${i}`} className="px-1 text-[12.5px] text-[#667085]">…</span> : (
              <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === current ? "page" : undefined} className={`h-7 min-w-7 rounded-[6px] border px-1.5 text-[12.5px] tabular-nums ${n === current ? "border-[#5b2bb5] bg-[#5b2bb5] font-semibold text-white" : "border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50"}`}>{n}</button>
            ))}
            <button type="button" onClick={() => setPage(current + 1)} disabled={current === pages} aria-label="Next page" className="flex h-7 w-7 items-center justify-center rounded text-[#344054] hover:bg-slate-100 disabled:opacity-40"><CaretRight size={14} weight="bold" aria-hidden /></button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

/** Page buttons: the first three, then the last, with a gap marker, as in "1 2 3 … 29"; around the current page in between. */
function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, null, pages];
  if (current >= pages - 2) return [1, null, pages - 2, pages - 1, pages];
  return [1, null, current, null, pages];
}

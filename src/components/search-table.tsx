"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A small table with a search box that filters its rows as you type, for the dashboard's people and reminder lists.
 * The rows come from the server already permission-checked; this only hides rows that do not match.
 */
export function SearchTable({ label, columns, rows, empty, max = 400 }: { label: string; columns: string[]; rows: { key: string; text: string; cells: ReactNode[] }[]; empty: string; max?: number }) {
  const [q, setQ] = useState("");
  const id = useId();
  const needle = q.trim().toLowerCase();
  const shown = (needle ? rows.filter((r) => r.text.toLowerCase().includes(needle)) : rows).slice(0, max);
  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <label htmlFor={id} className="text-[13.5px] font-medium">Search:</label>
        <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} className="input w-44 py-1" aria-label={`Search ${label}`} />
      </div>
      <div className="relative max-h-[340px] min-w-0 overflow-auto rounded border border-slate-200">
        <table className="table text-[13.5px]">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-[1] bg-white"><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {shown.map((r) => <tr key={r.key}>{r.cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
          </tbody>
        </table>
        {!shown.length ? <p className="px-3 py-4 text-center text-[13.5px] text-slate-500">{needle ? "Nothing matches your search." : empty}</p> : null}
      </div>
      <p className="mt-1.5 text-[12.5px] text-slate-500" aria-live="polite">Showing {shown.length} of {rows.length}</p>
    </div>
  );
}

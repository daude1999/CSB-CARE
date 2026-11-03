"use client";
import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type FilterFn, type SortingState } from "@tanstack/react-table";
import { CaretDown, CaretUp, CaretUpDown, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "@/components/link";

export type RequirementRow = {
  id: string;
  ref: string;
  title: string;
  exactReference: string;
  source: string;
  legalStatus: string;
  applicability: string;
  verification: string;
  policies: number;
  evidence: number;
  openActions: number;
  simulated: boolean;
};

const LEGAL: Record<string, string> = {
  LEGISLATION: "Legislation",
  STATUTORY_GUIDANCE: "Statutory guidance",
  REGULATOR_GUIDANCE: "Regulator guidance",
  ADVISORY_GUIDANCE: "Advisory guidance",
  BEST_PRACTICE: "Good practice",
  INTERNAL_POLICY: "Internal policy",
};

const VERIFY: Record<string, { label: string; tone: string }> = {
  VERIFIED: { label: "Checked against source", tone: "green" },
  UNVERIFIED: { label: "Not yet verified", tone: "amber" },
  NEEDS_REVIEW: { label: "Needs review", tone: "red" },
};

const anyText: FilterFn<RequirementRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const r = row.original;
  return [r.ref, r.title, r.exactReference, r.source].some((v) => v.toLowerCase().includes(q));
};

const col = createColumnHelper<RequirementRow>();

/**
 * The Requirements Register: requirement, source, applicability, the organisation's linked policies, evidence and
 * open actions. Instant search, a legal-status filter and sortable columns.
 */
export function RequirementsTable({ rows, initialQuery = "" }: { rows: RequirementRow[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "ref", desc: false }]);

  const data = useMemo(() => (status ? rows.filter((r) => r.legalStatus === status) : rows), [rows, status]);
  const counts = useMemo(() => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.legalStatus]: (acc[r.legalStatus] ?? 0) + 1 }), {}), [rows]);

  const columns = useMemo(
    () => [
      col.accessor("ref", {
        header: "Requirement",
        cell: (c) => {
          const r = c.row.original;
          const v = VERIFY[r.verification] ?? VERIFY.UNVERIFIED!;
          return (
            <div className="min-w-[18rem] max-w-[440px]">
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/requirements/${r.id}`} className="pc-strong">{r.title}</Link>
                {r.simulated ? <span className="pc-badge" data-tone="purple">Simulated</span> : null}
              </span>
              <span className="pc-sub">{r.ref} · {r.exactReference} · <span className={v.tone === "green" ? "text-[#067647]" : v.tone === "red" ? "text-[#b42318]" : "text-[#b54708]"}>{v.label}</span></span>
            </div>
          );
        },
      }),
      col.accessor("source", { header: "Source", cell: (c) => <span className="block max-w-[200px] truncate" title={c.getValue()}>{c.getValue()}</span> }),
      col.accessor("applicability", {
        header: "Applicability",
        cell: (c) => (
          <span className="block max-w-[220px]">
            <span className="block truncate" title={c.getValue()}>{c.getValue()}</span>
            <span className="pc-sub">{LEGAL[c.row.original.legalStatus] ?? c.row.original.legalStatus}</span>
          </span>
        ),
      }),
      col.accessor("policies", { header: "Linked policies", sortDescFirst: true, cell: (c) => <span className={c.getValue() ? "font-semibold text-[#101828]" : "text-[#b54708]"}>{c.getValue() || "None"}</span> }),
      col.accessor("evidence", { header: "Evidence", sortDescFirst: true, cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
      col.accessor("openActions", { header: "Open actions", sortDescFirst: true, cell: (c) => <span className={`tabular-nums ${c.getValue() ? "font-semibold text-[#b54708]" : ""}`}>{c.getValue()}</span> }),
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: query },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    globalFilterFn: anyText,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const shown = table.getRowModel().rows;

  return (
    <section aria-label="Requirements register" className="pc-panel">
      <div className="pc-toolbar">
        <label className="pc-search">
          <MagnifyingGlass size={17} className="shrink-0" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search requirements" aria-label="Search requirements" />
        </label>
        <label className="pc-select">
          <span>Legal status</span>
          <b aria-hidden="true">{status ? LEGAL[status] : "All"}</b>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Legal status">
            <option value="">All ({rows.length})</option>
            {Object.entries(LEGAL).filter(([k]) => counts[k]).map(([k, label]) => <option key={k} value={k}>{label} ({counts[k]})</option>)}
          </select>
        </label>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="pc-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-[#101828]">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <CaretUp size={11} weight="bold" /> : dir === "desc" ? <CaretDown size={11} weight="bold" /> : <CaretUpDown size={11} className="text-[#98a2b3]" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>{r.getVisibleCells().map((c) => <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length ? <p className="pc-empty">No requirements match.</p> : null}
      <div className="pc-foot"><span>Showing {shown.length} of {rows.length}</span><span className="pc-note">Linked policies, evidence and open actions are your organisation&apos;s own.</span></div>
    </section>
  );
}

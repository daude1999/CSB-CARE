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
  verification: string;
  lastVerified: string | null;
  policies: number;
  auditQuestions: number;
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

const VERIFY: Record<string, { label: string; dot: string; text: string }> = {
  VERIFIED: { label: "Checked against source", dot: "bg-emerald-600", text: "text-emerald-800" },
  UNVERIFIED: { label: "Not yet verified", dot: "border-2 border-amber-600", text: "text-amber-800" },
  NEEDS_REVIEW: { label: "Needs review", dot: "bg-rose-600", text: "text-rose-700" },
};

const anyText: FilterFn<RequirementRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const r = row.original;
  return [r.ref, r.title, r.exactReference, r.source].some((v) => v.toLowerCase().includes(q));
};

const col = createColumnHelper<RequirementRow>();

/** The requirements register: instant search, legal-status filter and sortable columns. */
export function RequirementsTable({ rows, initialQuery = "" }: { rows: RequirementRow[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "ref", desc: false }]);
  const maxPolicies = Math.max(1, ...rows.map((r) => r.policies));

  const data = useMemo(() => (status ? rows.filter((r) => r.legalStatus === status) : rows), [rows, status]);
  const counts = useMemo(() => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.legalStatus]: (acc[r.legalStatus] ?? 0) + 1 }), {}), [rows]);

  const columns = useMemo(
    () => [
      col.accessor("ref", {
        header: "Ref",
        cell: (c) => <Link href={`/requirements/${c.row.original.id}`} className="whitespace-nowrap font-mono text-xs">{c.getValue()}</Link>,
      }),
      col.accessor("title", {
        header: "Requirement",
        cell: (c) => (
          <div className="min-w-[16rem]">
            <Link href={`/requirements/${c.row.original.id}`} className="font-medium text-navy-900 no-underline hover:underline hover:decoration-teal-400 hover:decoration-2">{c.getValue()}</Link>
            {c.row.original.simulated ? <span className="ml-2 rounded-[3px] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-violet-700 ring-1 ring-inset ring-violet-200">Simulated</span> : null}
            <div className="mt-0.5 text-xs text-slate-500">{c.row.original.exactReference}</div>
            <div className="text-[11px] text-slate-400">{c.row.original.source}</div>
          </div>
        ),
      }),
      col.accessor("legalStatus", { header: "Legal status", cell: (c) => <span className="whitespace-nowrap text-xs text-slate-700">{LEGAL[c.getValue()] ?? c.getValue()}</span> }),
      col.accessor("verification", {
        header: "Verification",
        cell: (c) => {
          const v = VERIFY[c.getValue()] ?? VERIFY.UNVERIFIED!;
          return (
            <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs ${v.text}`}>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${v.dot}`} />
              {v.label}
              {c.row.original.lastVerified ? <span className="text-slate-400">· {c.row.original.lastVerified}</span> : null}
            </span>
          );
        },
      }),
      col.accessor("policies", {
        header: "Coverage",
        sortDescFirst: true,
        cell: (c) => (
          <div className="w-36">
            <div className="flex items-baseline justify-between text-xs"><span className="text-slate-700">{c.getValue()} {c.getValue() === 1 ? "policy" : "policies"}</span><span className="text-slate-400">{c.row.original.auditQuestions} audit Qs</span></div>
            <div className="mt-1 h-1 rounded-full bg-slate-200"><div className={`h-full rounded-full ${c.getValue() ? "bg-navy-900" : ""}`} style={{ width: `${(c.getValue() / maxPolicies) * 100}%` }} /></div>
          </div>
        ),
      }),
    ],
    [maxPolicies],
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
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-300">
        <div className="-mb-px flex gap-5 overflow-x-auto" role="group" aria-label="Legal status">
          {[["", "All", rows.length] as const, ...Object.entries(LEGAL).filter(([k]) => counts[k]).map(([k, label]) => [k, label, counts[k]!] as const)].map(([k, label, n]) => (
            <button key={k || "all"} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={`shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium ${status === k ? "border-navy-900 text-navy-900" : "border-transparent text-slate-500 hover:text-navy-900"}`}>
              {label}<span className="ml-1.5 font-mono text-xs font-normal text-slate-400">{n}</span>
            </button>
          ))}
        </div>
        <label className="mb-2 flex items-center gap-2">
          <MagnifyingGlass size={16} className="text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-56 border-0 border-b border-transparent bg-transparent px-1 py-1 text-sm placeholder:text-slate-400 focus:border-navy-900 focus:outline-hidden focus:ring-0" placeholder="Filter by ref, title or source" aria-label="Search requirements" />
        </label>
      </div>
      <p className="mb-1 font-serif text-[15px] text-slate-700">{shown.length} of {rows.length} requirements</p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-[0.08em] hover:text-navy-900">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <CaretUp size={11} weight="bold" /> : dir === "desc" ? <CaretDown size={11} weight="bold" /> : <CaretUpDown size={11} className="text-slate-300" />}
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
      {!shown.length ? <p className="mt-6 font-serif italic text-slate-500">No requirements match.</p> : null}
    </div>
  );
}

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
  training: number;
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
        cell: (c) => <Link href={`/requirements/${c.row.original.id}`} className="whitespace-nowrap text-[13px]">{c.getValue()}</Link>,
      }),
      col.accessor("title", {
        header: "Requirement",
        cell: (c) => (
          <div className="min-w-[16rem]">
            <Link href={`/requirements/${c.row.original.id}`} className="font-medium">{c.getValue()}</Link>
            {c.row.original.simulated ? <span className="ml-2 rounded-full bg-violet-50 px-2.5 py-0.5 text-[12px] text-violet-700">Simulated</span> : null}
            <div className="mt-0.5 text-[12.5px] text-slate-600">{c.row.original.exactReference}</div>
            <div className="text-[12px] text-slate-500">{c.row.original.source}</div>
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
          <div className="w-44">
            <div className="flex items-baseline justify-between text-xs"><span className="text-slate-700">{c.getValue()} {c.getValue() === 1 ? "policy" : "policies"}</span><span className="text-slate-500">{c.row.original.auditQuestions} audit Qs · {c.row.original.training} training</span></div>
            <div className="mt-1 h-[6px] rounded-full bg-slate-200"><div className={`h-full rounded-full ${c.getValue() ? "bg-[#3289f8]" : ""}`} style={{ width: `${(c.getValue() / maxPolicies) * 100}%` }} /></div>
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
      <div className="flex gap-[6px] overflow-x-auto px-2 pt-1" role="group" aria-label="Legal status">
        {[["", "All", rows.length] as const, ...Object.entries(LEGAL).filter(([k]) => counts[k]).map(([k, label]) => [k, label, counts[k]!] as const)].map(([k, label, n]) => (
          <button key={k || "all"} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={`flex h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-t-[4px] border border-b-0 px-4 text-[14.5px] text-navy-900 ${status === k ? "border-slate-300 bg-white font-semibold" : "border-transparent bg-[#e3e7ed] hover:bg-white"}`}>
            {label}<span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-slate-200 px-1.5 text-[12px] font-medium text-slate-700">{n}</span>
          </button>
        ))}
      </div>
      <div className="panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-slate-700">{shown.length} of {rows.length} requirements</p>
        <label className="flex h-[36px] items-center gap-2 rounded-[4px] border border-slate-300 bg-white px-2.5">
          <MagnifyingGlass size={18} className="shrink-0 text-slate-600" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-full w-60 bg-transparent text-[14px] placeholder:text-slate-500 focus:outline-none" placeholder="Filter by ref, title or source" aria-label="Search requirements" />
        </label>
      </div>
      <div className="relative overflow-x-auto">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-navy-900">
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
      {!shown.length ? <p className="py-6 text-center text-[15px] text-slate-600">No requirements match.</p> : null}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { AutoSubmitForm } from "@/components/auto-submit";

/**
 * The Daily Rota's list-screen pieces (buttons, filter selects, sortable headers, pager), shared so the Daily Rota and
 * its sister screens (Unassigned Visits, Coverage History) look and behave the same.
 */

export const BTN = "flex h-10 items-center gap-2 rounded-[8px] px-4 text-[14.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
export const BTN_PRIMARY = `${BTN} bg-[#5b2bb5] text-white hover:bg-[#4c2398]`;
export const BTN_SECONDARY = `${BTN} border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50`;
export const SEL = "h-10 w-full appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px] text-[#101828]";
export const PANEL = "min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
export const TH = "whitespace-nowrap px-2.5 py-2.5 text-left text-[13.5px] font-semibold text-[#101828]";
export const TD = "px-2.5 py-2";
export const MENU = "absolute right-0 z-40 mt-1 rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.14)]";
export const SUMMARY_BTN = "flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-4 text-[14.5px] font-semibold text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden";

export function FilterSelect({ name, label, value, children }: { name: string; label: string; value: string; children: ReactNode }) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select name={name} aria-label={label} defaultValue={value} className={SEL}>{children}</select>
      <CaretDown size={15} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#344054]" />
    </label>
  );
}

export function SortHead({ active, dir, href, children, className = "" }: { active: boolean; dir: "asc" | "desc"; href: string; children: ReactNode; className?: string }) {
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`${TH} ${className}`}>
      <Link href={href} className="inline-flex items-center gap-1 text-inherit no-underline hover:text-[#5b2bb5]">
        {children}{active ? (dir === "asc" ? <CaretUp size={11} weight="fill" aria-hidden /> : <CaretDown size={11} weight="fill" aria-hidden />) : null}
      </Link>
    </th>
  );
}

/** "Showing 1 to 25 of 80 …", page links and rows per page, as on the Daily Rota. */
export function ListFooter({ total, page, pages, per, noun, href, hidden, testId }: { total: number; page: number; pages: number; per: number; noun: string; href: (page: number | undefined) => string; hidden: ReactNode; testId?: string }) {
  const shown = Math.max(0, Math.min(per, total - (page - 1) * per));
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#eaecf0] px-3.5 py-3">
      <p data-testid={testId} data-total={total} className="text-[14px] text-[#344054]" aria-live="polite">Showing {total ? (page - 1) * per + 1 : 0} to {(page - 1) * per + shown} of {total} {noun}{total === 1 ? "" : "s"}</p>
      {pages > 1 ? (
        <nav aria-label={`${noun} pages`} className="flex items-center gap-1">
          {page > 1 ? <Link href={href(page - 1 === 1 ? undefined : page - 1)} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretLeft size={14} weight="bold" aria-hidden /></Link> : null}
          {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => (
            <span key={n} className="flex items-center gap-1">
              {i && n - arr[i - 1]! > 1 ? <span className="px-0.5 text-[#667085]">…</span> : null}
              <Link href={href(n === 1 ? undefined : n)} aria-current={n === page ? "page" : undefined} className={`flex h-8 min-w-8 items-center justify-center rounded-[6px] border px-2 text-[13px] tabular-nums no-underline ${n === page ? "border-[#5b2bb5] bg-[#5b2bb5] font-semibold text-white" : "border-[#e4e7ec] bg-white text-[#101828] hover:bg-slate-50"}`}>{n}</Link>
            </span>
          ))}
          {page < pages ? <Link href={href(page + 1)} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded text-[#344054] hover:bg-slate-100"><CaretRight size={14} weight="bold" aria-hidden /></Link> : null}
        </nav>
      ) : null}
      <AutoSubmitForm label="Rows per page" className="ml-auto flex items-center gap-3">
        {hidden}
        <label htmlFor={`per-${noun}`} className="text-[14px] text-[#344054]">Rows per page</label>
        <span className="relative"><select id={`per-${noun}`} name="per" defaultValue={String(per)} className="h-10 appearance-none rounded-[8px] border border-[#d0d5dd] bg-white pl-3 pr-8 text-[14px]">{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select><CaretDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" /></span>
      </AutoSubmitForm>
    </div>
  );
}

/** Builds links that keep every current parameter and change some. Empty values are dropped. */
export function linker(base: string, params: Record<string, string | undefined>) {
  const url = (extra: Record<string, string | undefined> = {}) => {
    const s = new URLSearchParams(Object.entries({ ...params, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const hiddenExcept = (skip: string[]) => Object.entries(params).filter(([k, v]) => v && !skip.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return { url, hiddenExcept };
}

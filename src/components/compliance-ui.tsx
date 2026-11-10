import type { ReactNode } from "react";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";
import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

/**
 * Building blocks for the Policy & Compliance look (owner's brief of 3 Nov 2026 and its six mockups). Styles live in
 * globals.css under the `pc-` prefix. These are layout pieces only; every figure they show is passed in by the page.
 */

export type Crumb = { label: string; href?: string };

/** The Policy & Compliance page header: the shared module band (src/components/module-header-band.tsx), then the tabs. */
export function PcHeader({ title, subtitle, actions, crumbs, tabs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Crumb[]; tabs?: ReactNode }) {
  return <ModuleHeader title={title} description={subtitle} actions={actions} tabs={tabs} crumbs={(crumbs ?? []).filter((c) => c.label !== "Policy & Compliance")} />;
}

/** Underlined tabs with an optional count pill. `active` is the key of the page on screen. */
export function PcTabs({ label, items, active, testId }: { label: string; items: { key: string; label: string; href: string; count?: number }[]; active: string; testId?: string }) {
  return (
    <nav aria-label={label} className="pc-tabs tabs-line" data-testid={testId}>
      {items.map((t) => (
        <Link key={t.key} href={t.href} className="pc-tab tab-line" aria-current={t.key === active ? "page" : undefined}>
          {t.label}
          {t.count !== undefined ? <span className="pc-count">{t.count}<span className="sr-only"> items</span></span> : null}
        </Link>
      ))}
    </nav>
  );
}

export type PcTone = "green" | "amber" | "red" | "blue" | "purple" | "grey";

/** A status pill. Green done, amber due or partial, red overdue or high, blue in progress, purple awaiting approval or simulated, grey draft or closed. */
export function PcBadge({ tone, children, title }: { tone: PcTone; children: ReactNode; title?: string }) {
  return <span className="pc-badge" data-tone={tone} title={title}>{children}</span>;
}

const ICON_TONE: Record<"purple" | "green" | "amber" | "red" | "blue", string> = {
  purple: "bg-module/[.08] text-module",
  green: "bg-[#ecfdf3] text-[#067647]",
  amber: "bg-[#fffaeb] text-[#b54708]",
  red: "bg-[#fef3f2] text-[#b42318]",
  blue: "bg-[#eff8ff] text-[#175cd3]",
};
const VALUE_TONE = { default: "text-[#101828]", green: "text-[#067647]", red: "text-[#b42318]", amber: "text-[#b54708]" } as const;

/** A key figure: label, number, note. Links to the list it was counted from when `href` is given. */
export function PcFigure({ label, value, note, href, icon, iconTone = "purple", valueTone = "default", testId }: { label: string; value: number | string; note?: ReactNode; href?: string; icon?: ReactNode; iconTone?: keyof typeof ICON_TONE; valueTone?: keyof typeof VALUE_TONE; testId?: string }) {
  const body = (
    <>
      {icon ? <span aria-hidden="true" className={`pc-figure-icon ${ICON_TONE[iconTone]}`}>{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="pc-figure-label">{label}</span>
        <span className={`pc-figure-value ${VALUE_TONE[valueTone]}`}>{value}</span>
        {note ? <span className="pc-figure-note">{note}</span> : null}
      </span>
      {href ? <span aria-hidden="true" className="text-[#98a2b3]">↗</span> : null}
    </>
  );
  return href ? <Link href={href} className="pc-figure" data-testid={testId}>{body}</Link> : <div className="pc-figure" data-testid={testId}>{body}</div>;
}

/** A search box for a GET filter form. */
export function PcSearch({ name = "q", defaultValue, placeholder, label }: { name?: string; defaultValue?: string; placeholder: string; label?: string }) {
  return (
    <label className="pc-search">
      <MagnifyingGlass size={17} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">{label ?? placeholder}</span>
      <input type="search" name={name} defaultValue={defaultValue} placeholder={placeholder} />
    </label>
  );
}

/** "Showing x of y" with Previous and Next. `href(page)` builds each page's address. */
export function PcFoot({ shown, total, page = 1, pages = 1, href, children }: { shown: number; total: number; page?: number; pages?: number; href?: (page: number) => string; children?: ReactNode }) {
  return (
    <div className="pc-foot">
      <span>Showing {shown} of {total}</span>
      {children}
      {href && pages > 1 ? (
        <span className="flex items-center gap-2">
          {page > 1 ? <Link href={href(page - 1)} className="pc-btn-secondary pc-btn-sm"><CaretLeft size={13} aria-hidden="true" />Previous</Link> : <span className="pc-btn-secondary pc-btn-sm opacity-50" aria-disabled="true"><CaretLeft size={13} aria-hidden="true" />Previous</span>}
          <span className="text-[13px]">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(page + 1)} className="pc-btn-secondary pc-btn-sm">Next<CaretRight size={13} aria-hidden="true" /></Link> : <span className="pc-btn-secondary pc-btn-sm opacity-50" aria-disabled="true">Next<CaretRight size={13} aria-hidden="true" /></span>}
        </span>
      ) : null}
    </div>
  );
}

/** Wraps a wide table so it scrolls sideways on small screens instead of the page. */
export function PcTableWrap({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="min-w-0 overflow-x-auto xl:overflow-visible" role={label ? "region" : undefined} aria-label={label} tabIndex={label ? 0 : undefined}>{children}</div>;
}

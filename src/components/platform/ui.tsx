import type { ReactNode } from "react";
import { CaretRight, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { DrawerShell } from "@/components/drawer-shell";

/**
 * The Evantix Platform Admin Centre design system. Every Admin Centre screen is built from these primitives and the
 * `px-*` colour tokens in tailwind.config.ts, so type, spacing, borders and status colours stay the same everywhere:
 * navy navigation, white workspaces on a light grey page, purple for interaction, and semantic colours only for real
 * states.
 */

// ───────────────────────────── Buttons

import { btn, pxDanger, pxGhost, pxLink, pxPrimary, pxSecondary, pxSm } from "./buttons";
export { pxDanger, pxGhost, pxLink, pxPrimary, pxSecondary, pxSm };

// ───────────────────────────── Page structure

/** Page title block: compact title, one line of context, actions on the right. */
export function PxHeader({ title, description, actions, crumbs, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[]; meta?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[20rem]">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-meta text-px-muted">
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-1">
                <Link href={c.href} className="text-px-muted no-underline hover:text-px-accent hover:underline">{c.label}</Link>
                <CaretRight size={11} aria-hidden="true" className="text-px-faint" />
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-title font-semibold leading-7 tracking-[-0.01em] text-px-ink">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-body leading-5 text-px-muted">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-px-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A bordered white section with an optional header row. `flush` removes the body padding for tables and lists. */
export function PxPanel({ title, actions, children, className = "", id, description, flush = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; description?: ReactNode; flush?: boolean }) {
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={`min-w-0 scroll-mt-24 rounded-[10px] border border-px-line bg-white ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-px-divider px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-body font-semibold leading-5 text-px-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-meta leading-[18px] text-px-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 text-meta">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "px-4 py-3"}>{children}</div>
    </section>
  );
}

/** A two-column page body: main content and a narrower aside. */
export function Split({ children, aside, asideWidth = 360 }: { children: ReactNode; aside: ReactNode; asideWidth?: number }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_var(--aside)]" style={{ ["--aside" as string]: `${asideWidth}px` }}>
      <div className="min-w-0 space-y-4">{children}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  );
}

// ───────────────────────────── Status

const PILL: Record<string, string> = {
  ACTIVE: "ok", TRIAL: "accent", SUSPENDED: "danger", CLOSED: "neutral", CANCELLED: "neutral", REQUESTED: "warn", DECLINED: "neutral", REVOKED: "neutral", EXPIRED: "neutral",
  active: "ok", used: "neutral", expired: "neutral", revoked: "neutral", waiting: "warn", accepted: "ok", ok: "ok", warn: "warn", fail: "danger",
  SUCCEEDED: "ok", QUEUED: "info", RUNNING: "info", FAILED: "warn", DEAD: "danger",
};
const PILL_TEXT: Record<string, string> = { ok: "OK", warn: "Attention", fail: "Failing", DEAD: "Given up" };
const TONE_CLS = {
  ok: "bg-px-ok-bg text-px-ok", warn: "bg-px-warn-bg text-px-warn", danger: "bg-px-danger-bg text-px-danger", neutral: "bg-px-neutral-bg text-px-neutral", accent: "bg-px-accent-soft text-px-accent-strong", info: "bg-px-info-bg text-px-info",
} as const;
const DOT_CLS = { ok: "bg-[#1f9254]", warn: "bg-[#d48806]", danger: "bg-px-danger-strong", neutral: "bg-[#9aa2b1]", accent: "bg-px-focus", info: "bg-[#2f6fc0]" } as const;
type ToneKey = keyof typeof TONE_CLS;

/** A status badge for a record state (ACTIVE, TRIAL, SUSPENDED…): a dot and a label in the state's semantic colour. */
export function Pill({ value, label }: { value: string; label?: string }) {
  const tone = (PILL[value] ?? "neutral") as ToneKey;
  const text = label ?? PILL_TEXT[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-caption font-medium leading-4 ${TONE_CLS[tone]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_CLS[tone]}`} />
      {text}
    </span>
  );
}

const TONE_MAP = { rose: "danger", amber: "warn", slate: "neutral", green: "ok", violet: "accent", blue: "info" } as const;
/** A small label in one of the semantic tones (for events and flags that are not record states). */
export function Tone({ tone, children }: { tone: keyof typeof TONE_MAP; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[5px] px-1.5 py-[1px] text-caption font-medium leading-[18px] ${TONE_CLS[TONE_MAP[tone]]}`}>{children}</span>;
}

/** Labels a figure that is not measured from records. */
export function NotConfigured({ children = "Not configured" }: { children?: ReactNode }) {
  return <span className="inline-flex items-center rounded-[5px] border border-dashed border-[#c9cedb] px-1.5 py-[1px] text-caption font-medium text-px-muted">{children}</span>;
}

// ───────────────────────────── Figures

/** A row of a few key figures in one bordered strip (never a grid of separate cards). */
export function MetricStrip({ children, label, cols = 4 }: { children: ReactNode; label: string; cols?: 3 | 4 | 5 | 6 }) {
  const lg = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols];
  return <section aria-label={label} className={`mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-px-line bg-px-divider ${lg}`}>{children}</section>;
}

/** One figure in a MetricStrip (also exported as Indicator for older pages). */
export function Indicator({ label, value, note, href, alert, className = "" }: { label: string; value: ReactNode; note?: ReactNode; href?: string; alert?: boolean; className?: string }) {
  const body = (
    <>
      <span className="block text-meta font-medium text-px-muted">{label}</span>
      <span className={`mt-1 block text-title font-semibold leading-7 tabular-nums tracking-[-0.01em] ${alert ? "text-px-danger" : "text-px-ink"}`}>{value}</span>
      {note ? <span className="mt-0.5 block text-caption leading-4 text-px-subtle">{note}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className={`block min-w-0 bg-white px-4 py-3 no-underline transition-colors hover:bg-px-hover ${className}`}>{body}</Link>
  ) : (
    <div className={`min-w-0 bg-white px-4 py-3 ${className}`}>{body}</div>
  );
}
export const Metric = Indicator;

// ───────────────────────────── Tables

/** The standard data table: sticky-looking header row, aligned cells, horizontal scroll inside the panel only. */
export function Table({ head, children, empty, label, minWidth = 640, align }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; label?: string; minWidth?: number; align?: ("left" | "right")[] }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-body" style={{ minWidth }} aria-label={label}>
        <thead>
          <tr className="border-b border-px-divider bg-px-field text-caption font-medium uppercase tracking-[0.04em] text-px-muted">
            {head.map((h, i) => <th key={i} scope="col" className={`whitespace-nowrap px-4 py-2 font-medium first:pl-4 ${align?.[i] === "right" ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-px-row [&>tr:last-child]:border-0 [&>tr:hover]:bg-px-hover [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-middle">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-body text-px-muted">{children}</p>;
}

/** An empty state that says what the area is for and what to do next. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-body font-medium text-px-ink">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-meta leading-5 text-px-muted">{children}</p> : null}
      {action ? <div className="mt-3 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** The search and filter bar above a table. Filters live in the URL so a table returns to the same view. */
export function Toolbar({ children, label, clearHref, active }: { children: ReactNode; label: string; clearHref?: string; active?: boolean }) {
  return (
    <form method="get" role="search" aria-label={label} className="flex flex-wrap items-end gap-2 border-b border-px-divider px-4 py-3">
      {children}
      <div className="flex items-center gap-1.5">
        <button className={`${pxSecondary} ${pxSm}`}>Apply</button>
        {clearHref && active ? <Link href={clearHref} className={`${pxGhost} ${pxSm}`}>Clear</Link> : null}
      </div>
    </form>
  );
}

/** A labelled control for a Toolbar. */
export function Filter({ label, children, grow = false }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <label className={grow ? "min-w-[200px] flex-1 basis-[220px]" : "min-w-[140px] basis-[160px]"}>
      <span className="mb-1 block text-caption font-medium uppercase tracking-[0.04em] text-px-muted">{label}</span>
      {children}
    </label>
  );
}

// ───────────────────────────── Navigation inside a page

/** Tabs for a record workspace (client, settings). Links keep the state in the URL. */
export function Tabs({ items, label = "Client sections" }: { items: { href: string; label: string; active: boolean; count?: number }[]; label?: string }) {
  return (
    <nav aria-label={label} className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-px-line px-1 [scrollbar-width:none]">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={`relative -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-body no-underline transition-colors ${t.active ? "border-px-accent font-medium text-px-ink" : "border-transparent text-px-muted hover:border-px-line hover:text-px-ink"}`}>
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-px-row px-1.5 text-caption tabular-nums text-px-muted">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

// ───────────────────────────── Detail layouts

export function KeyValues({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  const c = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${c}`}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-caption font-medium text-px-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-body text-px-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label-value rows for a side panel: label left, value right, divided. */
export function DetailRows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="-my-1 divide-y divide-px-row">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-2 text-body">
          <dt className="shrink-0 text-px-muted">{k}</dt>
          <dd className="min-w-0 text-right text-px-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A settings row: what the setting is and what it does on the left, the control on the right. */
export function SettingsRow({ label, help, children, htmlFor }: { label: ReactNode; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-px-row py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:gap-8">
      <div className="min-w-0">
        {htmlFor ? <label htmlFor={htmlFor} className="text-body font-medium text-px-ink">{label}</label> : <p className="text-body font-medium text-px-ink">{label}</p>}
        {help ? <p className="mt-0.5 text-meta leading-[18px] text-px-muted">{help}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A destructive or sensitive action folded behind a summary, so it is never one accidental click. */
export function Confirm({ label, children, tone = "default", small = false }: { label: string; children: ReactNode; tone?: "default" | "danger"; small?: boolean }) {
  return (
    <details className="group">
      <summary className={`${tone === "danger" ? `${btn} border-[#f0c4c9] bg-white text-px-danger hover:border-px-danger-strong hover:bg-px-danger-bg` : pxSecondary} ${small ? pxSm : ""} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{label}</summary>
      <div className="mt-2 rounded-[8px] border border-px-line bg-px-field p-3">{children}</div>
    </details>
  );
}

// ───────────────────────────── Side panel

/** A URL-driven side panel for focused editing, so the page behind (and its filters) stays put. */
export function PxDrawer({ closeHref, title, description, children, id = "px-drawer-title" }: { closeHref: string; title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <DrawerShell closeHref={closeHref} labelledBy={id} step={title}>
      <div className="px-scope flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-px-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={id} tabIndex={-1} data-autofocus className="text-lead font-semibold text-px-ink outline-none">{title}</h2>
            {description ? <p className="mt-0.5 text-meta leading-[18px] text-px-muted">{description}</p> : null}
          </div>
          <Link href={closeHref} scroll={false} aria-label="Close" className="rounded-[6px] p-1.5 text-px-muted hover:bg-px-row hover:text-px-ink"><X size={16} aria-hidden="true" /></Link>
        </div>
        <div data-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </DrawerShell>
  );
}

// ───────────────────────────── Formatting and form fields

export function fmtBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function fmtMoney(pence: number | null | undefined, currency = "GBP") {
  if (pence === null || pence === undefined) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);
}

export function fmtNumber(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat("en-GB").format(n);
}

export function PasswordField({ label = "Your password, to confirm" }: { label?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="password" name="confirmPassword" autoComplete="current-password" required className="input" />
    </label>
  );
}

export function ReasonField({ label = "Reason", required = true }: { label?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name="reason" required={required} minLength={5} maxLength={500} className="input" placeholder="Recorded in the audit log" />
    </label>
  );
}

export function Back({ value }: { value: string }) {
  return <input type="hidden" name="back" value={value} />;
}

// ───────────────────────────── Feedback, paging and return links

/** The ?ok= / ?error= message after an action, in the Admin Centre's style. */
export function PxFlash({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : null;
  if (!error && !ok) return null;
  return (
    <div role={error ? "alert" : "status"} className={`flash mb-4 flex items-start gap-2.5 rounded-[8px] border px-3.5 py-2.5 text-body ${error ? "border-[#f2c4c9] bg-px-danger-bg text-px-danger" : "border-[#bfe3cd] bg-px-ok-bg text-px-ok"}`}>
      <span aria-hidden="true" className={`mt-[6px] h-2 w-2 shrink-0 rounded-full ${error ? "bg-px-danger-strong" : "bg-[#1f9254]"}`} />
      <span>{error ?? ok}</span>
    </div>
  );
}

/** Page links under a table. Keeps every filter in the URL. */
export function PxPagination({ page, pageSize, total, base, params = {}, noun = "result" }: { page: number; pageSize: number; total: number; base: string; params?: Record<string, string | undefined>; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter(([, v]) => v) as [string, string][]);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-px-divider px-4 py-2.5 text-meta text-px-muted">
      <span className="tabular-nums">{total ? `${from}–${to} of ${total} ${noun}${total === 1 ? "" : "s"}` : `No ${noun}s`}</span>
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-1.5">
          {page > 1 ? <Link href={href(page - 1)} className={`${pxSecondary} ${pxSm}`}>Previous</Link> : <span className={`${pxSecondary} ${pxSm} pointer-events-none opacity-40`} aria-hidden="true">Previous</span>}
          <span className="px-1 tabular-nums">Page {page} of {pages}</span>
          {page < pages ? <Link href={href(page + 1)} className={`${pxSecondary} ${pxSm}`}>Next</Link> : <span className={`${pxSecondary} ${pxSm} pointer-events-none opacity-40`} aria-hidden="true">Next</span>}
        </nav>
      ) : null}
    </div>
  );
}

/** A return link carried in ?back= so a detail page goes back to the same filtered list. Only Admin Centre paths. */
export function returnTo(value: string | undefined, fallback: string) {
  return value && /^\/platform-admin(?:[/?#]|$)/.test(value) && !value.includes("\\") ? value : fallback;
}

/** The current list URL (path plus its filters), for ?back= on links to detail pages. */
export function listUrl(base: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return q ? `${base}?${q}` : base;
}

import Link from "@/components/link";
import { isValidElement, type ReactNode } from "react";
import { ModuleHeader } from "@/components/module-header-band";

/**
 * Every inner page opens with the module's header band (src/components/module-header-band.tsx): breadcrumb, title,
 * a one-line description and the page's actions; the page's tabs sit under it.
 */
export function PageHeader({ title, subtitle, actions, tabs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: string | null; tabs?: ReactNode }) {
  return <ModuleHeader title={title} description={subtitle} actions={actions} tabs={tabs} />;
}

/** A white panel on the grey canvas, titled like "My Reading List" on the dashboard. */
export function Panel({ title, actions, children, className = "", label }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`panel ${className}`}>
      {title || actions ? (
        <div className={title ? "panel-head" : "mb-3 flex flex-wrap items-center justify-between gap-3"}>
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ClearCare status tints (owner's design of 12 Nov 2026): red, amber, green and neutral pills; blue and violet kept for
// the few states that already used them.
const TONES = {
  slate: "bg-cc-neutral-bg text-cc-neutral",
  teal: "bg-[#e5effa] text-[#1d4f91]",
  navy: "bg-navy-900 text-white",
  amber: "bg-cc-amber-bg text-cc-amber",
  rose: "bg-cc-red-bg text-cc-red",
  green: "bg-cc-green-bg text-cc-green",
  violet: "bg-violet-50 text-violet-700",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-caption font-semibold leading-4 ${TONES[tone]}`}>
      {/* Sentence case on screen; the text itself stays as written. */}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}

export function SimulatedBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="violet" title="Simulated demonstration data. Not a real regulatory update.">
      Simulated
    </Badge>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "slate", UNDER_REVIEW: "amber", CHANGES_REQUESTED: "rose", APPROVED: "teal", SCHEDULED: "teal", PUBLISHED: "green", SUPERSEDED: "slate", ARCHIVED: "slate", REJECTED: "rose",
  NEWLY_DETECTED: "amber", AWAITING_CLASSIFICATION: "amber", POTENTIALLY_SUBSTANTIVE: "rose", EDITORIAL_OR_IMMATERIAL: "slate", UNDER_REVIEW_CHANGE: "amber", CONFIRMED_RELEVANT: "teal", CONFIRMED_NOT_APPLICABLE: "slate", IMPACT_ASSESSMENT_COMPLETED: "teal", POLICY_REVISION_REQUIRED: "rose", NO_POLICY_REVISION_REQUIRED: "green", CLOSED: "slate",
  PROPOSED: "amber", CONFIRMED_REVISION_REQUIRED: "rose", CONFIRMED_NO_REVISION: "green", DISMISSED: "slate",
  OK: "green", DEGRADED: "amber", FAILING: "rose", NEVER_CHECKED: "slate", DISABLED: "slate",
  QUEUED: "slate", RUNNING: "teal", SUCCEEDED: "green", FAILED: "amber", DEAD: "rose", CANCELLED: "slate", PARTIAL: "amber",
  OPEN: "amber", IN_PROGRESS: "teal", COMPLETED: "teal", VERIFIED: "green",
  LOW: "slate", MEDIUM: "amber", HIGH: "rose", URGENT: "rose", CRITICAL: "rose",
  AUTOMATED: "green", MANUAL_REVIEW_ONLY: "slate",
  VERIFIED_REQ: "green", UNVERIFIED: "amber", NEEDS_REVIEW: "rose",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

/** The page's sections as underline tabs (one tab style for every module), with an optional count. */
export function SegmentNav({ items, label, alert = false }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[]; label: string; alert?: boolean }) {
  return (
    <nav aria-label={label} className="tabs-line mb-3">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined} className="tab-line">
          {i.label}
          {i.count !== undefined ? <span className={`flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-caption font-medium ${alert && i.count ? "bg-status-missed text-white" : "bg-slate-100 text-slate-700"}`}>{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  const isTable = isValidElement(children) && children.type === "table";
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className={title ? "panel-head" : "mb-3 flex flex-wrap items-center justify-between gap-3"}>
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {isTable ? (
        <>
          <p className="mb-2 px-1 text-xs text-slate-400 md:hidden">Swipe sideways to view all columns.</p>
          <div className="relative min-w-0 overflow-x-auto">{children}</div>
        </>
      ) : children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-lead text-slate-600">{children}</p>;
}

const RINGS = {
  navy: "border-[#4a7fc9] text-[#2f5fa3]",
  rose: "border-[#e4544f] text-[#c3332c]",
  amber: "border-[#e3934a] text-[#b35e14]",
  green: "border-[#3fae6a] text-[#1c7a43]",
  violet: "border-[#6d5fc0] text-[#4a3d9c]",
} as const;

/** The dashboard's key-figure card: the number in a coloured ring, a label and a short note. */
export function Stat({ label, value, href, tone = "navy", hint }: { label: string; value: number | string; href?: string; tone?: keyof typeof RINGS; hint?: string }) {
  const body = (
    <>
      <span className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border-2 px-1 text-lead ${RINGS[tone]}`}>{value}</span>
      <span className="min-w-0">
        <span className="block text-lead leading-[19px] text-slate-900 sm:text-subtitle sm:leading-[22px]">{label}</span>
        {hint ? <span className="hidden text-body leading-[18px] text-slate-600 sm:block">{hint}</span> : null}
      </span>
    </>
  );
  const cls = "flex min-h-[66px] items-center gap-2.5 rounded-panel border border-cc-line bg-white py-2 pl-2.5 pr-3 sm:gap-[13px] sm:pl-[13px] sm:pr-4 no-underline transition-colors duration-[120ms]";
  return href ? <Link href={href} className={`${cls} hover:border-cc-control`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A row of key figures, as on the dashboard. */
export function StatRow({ children, label = "Key figures" }: { children: ReactNode; label?: string }) {
  return <section aria-label={label} className="mb-3 grid grid-cols-2 gap-2 sm:gap-[13px] xl:grid-cols-4">{children}</section>;
}

export function Flash({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : null;
  if (!error && !ok) return null;
  return (
    <div role={error ? "alert" : "status"} className={`flash mb-3 rounded-[10px] border px-4 py-3 text-body ${error ? "border-[#f6c9bf] bg-cc-red-bg text-cc-red" : "border-cc-sidebar-line bg-cc-green-bg text-cc-green"}`}>
      {error ?? ok}
    </div>
  );
}

export function Pagination({ page, pageSize, total, base, params = {} }: { page: number; pageSize: number; total: number; base: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 px-1 text-xs text-slate-500">{total} result(s)</p>;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${q}`;
  };
  return (
    <div className="mt-3 flex items-center justify-between px-1 text-sm">
      <span className="text-slate-500">
        Page {page} of {pages} · {total} result(s)
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="btn-secondary" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="btn-secondary" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export function fmtDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return withTime
    ? date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

import Link from "@/components/link";
import { isValidElement, type ReactNode } from "react";
import { Info } from "@phosphor-icons/react/dist/ssr";
import { TitleBar } from "@/components/title-bar";

/**
 * Every inner page opens like the dashboard: the navy title bar, then a white strip
 * with a one-line explanation on the left and the page's actions on the right.
 */
export function PageHeader({ title, subtitle, actions, back = "/", tabs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: string | null; tabs?: ReactNode }) {
  return (
    <>
      <TitleBar title={title} back={back ?? undefined} />
      {tabs}
      {subtitle || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-b-[3px] bg-white px-[15px] py-2.5">
          {subtitle ? <p className="flex min-w-0 max-w-4xl flex-1 basis-[18rem] items-start gap-1.5 text-[13px] leading-5 text-slate-600"><Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" /><span>{subtitle}</span></p> : <span />}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : <div className="mb-3" />}
    </>
  );
}

/** A white panel on the grey canvas, titled like "My Reading List" on the dashboard. */
export function Panel({ title, actions, children, className = "", label }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`panel ${className}`}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-[17px]">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700",
  teal: "bg-[#e3effb] text-[#1d4f91]",
  navy: "bg-navy-900 text-white",
  amber: "bg-[#fdf0d8] text-[#8a5a00]",
  rose: "bg-[#fde1e3] text-[#a3242c]",
  green: "bg-[#dff3e7] text-[#1c7a43]",
  violet: "bg-violet-50 text-violet-700",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-normal leading-4 ${TONES[tone]}`}>
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

/** Folder tabs above a panel, the same shape as the area tabs on My Policies. */
export function SegmentNav({ items, label, alert = false }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[]; label: string; alert?: boolean }) {
  return (
    <nav aria-label={label} className="flex gap-[6px] overflow-x-auto px-2 pt-1">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined} className={`flex h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-t-[4px] border border-b-0 px-4 text-[14.5px] text-navy-900 no-underline transition-colors duration-[120ms] ${i.active ? "border-slate-300 bg-white font-semibold" : "border-transparent bg-[#e3e7ed] hover:bg-white"}`}>
          {i.label}
          {i.count !== undefined ? <span className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-medium ${alert && i.count ? "bg-[#f06a4d] text-white" : "bg-slate-200 text-slate-700"}`}>{i.count}</span> : null}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-[17px]">{title}</h2> : <span />}
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
  return <p className="px-4 py-6 text-center text-[15px] text-slate-600">{children}</p>;
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
      <span className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border-2 px-1 text-[16px] ${RINGS[tone]}`}>{value}</span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-[19px] text-slate-900 sm:text-[18px] sm:leading-[22px]">{label}</span>
        {hint ? <span className="hidden text-[13.5px] leading-[18px] text-slate-600 sm:block">{hint}</span> : null}
      </span>
    </>
  );
  const cls = "flex min-h-[66px] items-center gap-2.5 rounded-[3px] bg-white py-2 pl-2.5 pr-3 sm:gap-[13px] sm:pl-[13px] sm:pr-4 no-underline shadow-[0_0_0_1px_#eef1f3] transition-shadow duration-[120ms]";
  return href ? <Link href={href} className={`${cls} hover:shadow-[0_0_0_1px_#c4cfdd]`}>{body}</Link> : <div className={cls}>{body}</div>;
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
    <div role={error ? "alert" : "status"} className={`flash mb-3 rounded-[3px] border-l-4 px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
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

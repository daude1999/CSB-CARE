import Link from "@/components/link";
import { isValidElement, type ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-navy-900 pb-4">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
  navy: "bg-navy-900 text-white ring-navy-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-[3px] px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.06em] ring-1 ring-inset ${TONES[tone]}`}>
      {children}
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

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  const isTable = isValidElement(children) && children.type === "table";
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-slate-200 pb-3">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {isTable ? (
        <>
          <p className="mb-2 px-1 text-xs text-slate-400 md:hidden">Swipe sideways to view all columns.</p>
          <div className="min-w-0 overflow-x-auto rounded-lg">{children}</div>
        </>
      ) : children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border-l-2 border-slate-300 py-2 pl-4 font-serif text-[15px] italic text-slate-500">{children}</div>;
}

export function Stat({ label, value, href, tone = "navy", hint }: { label: string; value: number | string; href?: string; tone?: "navy" | "rose" | "amber" | "green"; hint?: string }) {
  const color = { navy: "text-navy-900", rose: "text-rose-700", amber: "text-amber-700", green: "text-emerald-700" }[tone];
  const body = (
    <div className="h-full border-t-2 border-navy-900 bg-white px-4 pb-4 pt-3 transition hover:border-teal-400">
      <div className="eyebrow">{label}</div>
      <div className={`figure mt-2 text-4xl ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Flash({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const ok = typeof searchParams.ok === "string" ? searchParams.ok : null;
  if (!error && !ok) return null;
  return (
    <div role={error ? "alert" : "status"} className={`mb-4 rounded-md border-l-4 px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {error ?? ok}
    </div>
  );
}

export function Pagination({ page, pageSize, total, base, params = {} }: { page: number; pageSize: number; total: number; base: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-slate-400">{total} result(s)</p>;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${q}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
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

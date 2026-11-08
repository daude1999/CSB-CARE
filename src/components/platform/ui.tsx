import type { ReactNode } from "react";
import Link from "@/components/link";

/**
 * Building blocks of the Evantix Platform Admin Centre: the same type, inputs and buttons as the CSB platform (so it
 * belongs to the same software family), with the Admin Centre's navy and purple accents.
 */
export function PxHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[22rem]">
        {crumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-[12.5px] text-[#5b6478]">
            {crumbs.map((c, i) => (
              <span key={c.href} className="flex items-center gap-1">
                {i ? <span aria-hidden="true">/</span> : null}
                <Link href={c.href} className="text-[#5b6478] no-underline hover:text-[#5b21b6] hover:underline">{c.label}</Link>
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-[22px] font-semibold leading-7 text-[#0f1b3d]">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[13.5px] leading-5 text-[#5b6478]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PxPanel({ title, actions, children, className = "", id, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; description?: ReactNode }) {
  return (
    <section id={id} aria-label={typeof title === "string" ? title : undefined} className={`min-w-0 rounded-[8px] border border-[#e4e7ef] bg-white ${className}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0f5] px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold text-[#0f1b3d]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[12.5px] text-[#5b6478]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

const PILL: Record<string, string> = {
  ACTIVE: "bg-[#e6f6ed] text-[#17663a]",
  TRIAL: "bg-[#efe9fe] text-[#5b21b6]",
  SUSPENDED: "bg-[#fde8e8] text-[#a11d2b]",
  CLOSED: "bg-[#eceef2] text-[#46505f]",
  CANCELLED: "bg-[#eceef2] text-[#46505f]",
  REQUESTED: "bg-[#fff3d6] text-[#8a5300]",
  DECLINED: "bg-[#eceef2] text-[#46505f]",
  REVOKED: "bg-[#eceef2] text-[#46505f]",
  EXPIRED: "bg-[#eceef2] text-[#46505f]",
  active: "bg-[#e6f6ed] text-[#17663a]",
  used: "bg-[#eceef2] text-[#46505f]",
  expired: "bg-[#eceef2] text-[#46505f]",
  revoked: "bg-[#eceef2] text-[#46505f]",
  waiting: "bg-[#fff3d6] text-[#8a5300]",
  accepted: "bg-[#e6f6ed] text-[#17663a]",
  ok: "bg-[#e6f6ed] text-[#17663a]",
  warn: "bg-[#fff3d6] text-[#8a5300]",
  fail: "bg-[#fde8e8] text-[#a11d2b]",
};
const PILL_TEXT: Record<string, string> = { ok: "OK", warn: "Attention", fail: "Failing" };

export function Pill({ value, label }: { value: string; label?: string }) {
  const text = label ?? PILL_TEXT[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[2px] text-[12px] font-medium leading-4 ${PILL[value] ?? "bg-[#eceef2] text-[#46505f]"}`}>{text}</span>;
}

export function Tone({ tone, children }: { tone: "rose" | "amber" | "slate" | "green" | "violet"; children: ReactNode }) {
  const cls = { rose: "bg-[#fde8e8] text-[#a11d2b]", amber: "bg-[#fff3d6] text-[#8a5300]", slate: "bg-[#eceef2] text-[#46505f]", green: "bg-[#e6f6ed] text-[#17663a]", violet: "bg-[#efe9fe] text-[#5b21b6]" }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-[2px] text-[12px] font-medium leading-4 ${cls}`}>{children}</span>;
}

/** Labels a figure that is not measured from records. */
export function NotConfigured({ children = "Not configured" }: { children?: ReactNode }) {
  return <span className="inline-flex items-center rounded-[4px] border border-dashed border-[#c5cad6] px-1.5 py-[1px] text-[12px] text-[#5b6478]">{children}</span>;
}

/** One indicator in the dashboard's summary grid: label, value and a short note on where it comes from. */
export function Indicator({ label, value, note, href, alert }: { label: string; value: ReactNode; note?: ReactNode; href?: string; alert?: boolean }) {
  const body = (
    <>
      <span className="block text-[12.5px] text-[#5b6478]">{label}</span>
      <span className={`mt-0.5 block text-[20px] font-semibold tabular-nums leading-7 ${alert ? "text-[#a11d2b]" : "text-[#0f1b3d]"}`}>{value}</span>
      {note ? <span className="block text-[12px] leading-4 text-[#7a8294]">{note}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block min-w-0 px-4 py-3 no-underline hover:bg-[#f7f5ff] focus-visible:bg-[#f7f5ff]">{body}</Link>
  ) : (
    <div className="min-w-0 px-4 py-3">{body}</div>
  );
}

export function Table({ head, children, empty, label }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; label?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]" aria-label={label}>
        <thead>
          <tr className="border-b border-[#eef0f5] text-[12px] uppercase tracking-[0.02em] text-[#5b6478]">
            {head.map((h, i) => <th key={i} scope="col" className="px-4 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-[#f1f2f6] [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13.5px] text-[#5b6478]">{children}</p>;
}

export function Tabs({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label="Client sections" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-[#e4e7ef] px-1">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] no-underline ${t.active ? "border-[#6d28d9] font-medium text-[#3b1a86]" : "border-transparent text-[#46505f] hover:text-[#3b1a86]"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12.5px] text-[#5b6478]">{k}</dt>
          <dd className="break-words text-[14px] text-[#0f1b3d]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A destructive or sensitive action folded behind a summary, so it is never one accidental click. */
export function Confirm({ label, children, tone = "default" }: { label: string; children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <details className="group">
      <summary className={`inline-flex cursor-pointer list-none items-center rounded-[6px] border-[1.5px] px-3 py-[5px] text-[13.5px] ${tone === "danger" ? "border-[#b42335] text-[#a11d2b] hover:bg-[#fff5f5]" : "border-[#c5cad6] text-[#26304a] hover:border-[#6d28d9] hover:text-[#3b1a86]"}`}>{label}</summary>
      <div className="mt-2 rounded-[6px] border border-[#e4e7ef] bg-[#fafbfd] p-3">{children}</div>
    </details>
  );
}

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
      <input name="reason" required={required} minLength={5} maxLength={500} className="input" />
    </label>
  );
}

export function Back({ value }: { value: string }) {
  return <input type="hidden" name="back" value={value} />;
}

/** The Admin Centre's primary (purple) and secondary buttons. */
export const pxPrimary = "btn border-[1.5px] border-[#5b21b6] bg-[#5b21b6] text-white hover:border-[#4c1d95] hover:bg-[#4c1d95] hover:text-white";
export const pxSecondary = "btn border-[1.5px] border-[#c5cad6] bg-white text-[#26304a] hover:border-[#5b21b6] hover:text-[#3b1a86]";
export const pxDanger = "btn border-[1.5px] border-[#b42335] bg-[#b42335] text-white hover:bg-[#8f1b2a] hover:text-white";

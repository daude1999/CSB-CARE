import type { ReactNode } from "react";
import { ArrowsLeftRight, FastForward, Hammer, Repeat, Rows, Warning, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";

/** Shared look for the template screens: Daily Templates, Advanced Templates and the Template Details panel. */

export const PURPLE = "#5b2bb5";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";

/** Page heading with the module icon, as on the Daily Rota. */
export function TemplatesHeading({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3.5">
      <span aria-hidden className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[10px] bg-[#efeafc] text-[#5b2bb5]"><Repeat size={26} weight="bold" /></span>
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold leading-tight text-[#101828]">{title}</h1>
        <p className="text-[14.5px] text-[#475467]">{subtitle}</p>
      </div>
    </div>
  );
}

/**
 * The three connected template views (Daily Templates, Advanced Templates, Build Rota) with Roll Forward on the far
 * right. Roll Forward only opens the existing preview; nothing is copied until the coordinator confirms there.
 */
export function TemplatesTabs({ active, canBuild }: { active: "daily" | "advanced"; canBuild: boolean }) {
  const tabs = [
    { key: "daily", href: "/rota/templates", label: "Daily Templates", icon: <Rows size={18} weight="bold" aria-hidden /> },
    { key: "advanced", href: "/rota/templates/planner", label: "Advanced Templates", icon: <ArrowsLeftRight size={18} weight="bold" aria-hidden /> },
    { key: "build", href: "/rota/build", label: "Build Rota", icon: <Hammer size={18} weight="bold" aria-hidden /> },
  ] as const;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[#e4e7ec] pb-3">
      <nav aria-label="Template views" className="flex flex-wrap rounded-[10px] border border-[#d0d5dd] bg-white p-1">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Link key={t.key} href={t.href} aria-current={on ? "page" : undefined} className={`flex h-9 items-center gap-2 rounded-[7px] px-3.5 text-[14.5px] font-semibold no-underline ${FOCUS} ${on ? "bg-[#5b2bb5] text-white" : "text-[#344054] hover:bg-[#f4f1fd] hover:text-[#5b2bb5]"}`}>
              {t.icon}{t.label}
            </Link>
          );
        })}
      </nav>
      {canBuild ? (
        <Link href="/rota/build?roll=1" data-testid="roll-forward" title="Copy a built week into future weeks as drafts. You preview first, then confirm." className={`ml-auto flex h-10 items-center gap-2 rounded-[8px] border-[1.5px] border-[#5b2bb5] bg-white px-4 text-[14.5px] font-semibold text-[#5b2bb5] no-underline hover:bg-[#f4f1fd] ${FOCUS}`}>
          <FastForward size={18} weight="fill" aria-hidden />Roll Forward
        </Link>
      ) : null}
    </div>
  );
}

/** A connected row of purple-selected choices (cycle weeks, weekdays). */
export function ChoiceGroup({ label, items }: { label: string; items: { href: string; label: ReactNode; title?: string; active: boolean; marker?: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex min-w-0 max-w-full overflow-x-auto">
      <ul className="flex overflow-hidden rounded-[8px] border border-[#d0d5dd] bg-white">
        {items.map((it, i) => (
          <li key={i} className={i ? "border-l border-[#d0d5dd]" : ""}>
            <Link href={it.href} title={it.title} aria-current={it.active ? "true" : undefined} className={`relative flex h-10 items-center whitespace-nowrap px-3.5 text-[14px] font-semibold no-underline ${FOCUS} ${it.active ? "bg-[#5b2bb5] text-white" : "text-[#344054] hover:bg-[#f4f1fd] hover:text-[#5b2bb5]"}`}>
              {it.label}
              {it.marker ? <span aria-hidden className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${it.active ? "bg-white" : "bg-[#5b2bb5]"}`} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Carers planned against carers needed: green when full, amber when part-staffed, red when nobody is planned. */
export function CoverageBadge({ filled, required }: { filled: number; required: number }) {
  const tone = filled >= required ? "bg-[#e7f6ec] text-[#14713a]" : filled === 0 ? "bg-[#fdecec] text-[#b42318] ring-1 ring-[#f7c1bd]" : "bg-[#fdf3d8] text-[#8a5a00]";
  const words = filled >= required ? "fully staffed" : filled === 0 ? "no carer planned" : "partly staffed";
  return <span title={`${filled} of ${required} carer${required === 1 ? "" : "s"} planned: ${words}`} className={`inline-flex items-center rounded-[6px] px-2 py-0.5 text-[13px] font-semibold tabular-nums ${tone}`}>{filled}/{required}<span className="sr-only"> carers, {words}</span></span>;
}

export function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ec] px-2 py-0.5 text-[13px] font-semibold text-[#14713a]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />Enabled</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[13px] font-semibold text-[#475467]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />Disabled</span>;
}

/** The right-hand inspector frame: title, close link, body. Only rendered when a template is chosen. */
export function DetailsPanel({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  return (
    <aside aria-label={title} className="rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <div className="flex items-center justify-between border-b border-[#eaecf0] px-4 py-3">
        <h2 className="text-[16px] font-bold text-[#101828]">{title}</h2>
        <Link href={closeHref} scroll={false} aria-label={`Close ${title}`} className={`flex h-8 w-8 items-center justify-center rounded-[6px] text-[#475467] hover:bg-slate-100 ${FOCUS}`}><X size={18} weight="bold" aria-hidden /></Link>
      </div>
      {children}
    </aside>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Warnings" className="space-y-1 rounded-[8px] border border-[#fbe1a6] bg-[#fffaeb] px-3 py-2 text-[13.5px] text-[#7a4b00]">
      {items.map((w) => <li key={w} className="flex gap-1.5"><Warning size={16} weight="fill" aria-hidden className="mt-0.5 shrink-0 text-[#dc8b06]" />{w}</li>)}
    </ul>
  );
}

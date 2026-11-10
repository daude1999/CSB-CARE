import type { ReactNode } from "react";
import { CalendarDots, FastForward, Stack, Warning, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";

/**
 * Shared look for the template screens (Daily Templates, Advanced Templates, Template Details), built to the owner's
 * approved Daily Templates image of 1 Nov 2026.
 */

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module";

/**
 * The header row: calendar icon, title and subtitle on the left; the three connected template views next to it; Roll
 * Forward outlined on the far right. Roll Forward only opens the existing preview; nothing is copied until the
 * coordinator confirms there, and it is shown only to people who may build rotas.
 */
export function TemplatesHeader({ title, subtitle, active, canBuild }: { title: string; subtitle: ReactNode; active: "daily" | "advanced"; canBuild: boolean }) {
  const tabs = [
    { key: "daily", href: "/rota/templates", label: "Daily Templates", icon: <CalendarDots size={20} weight="bold" aria-hidden /> },
    { key: "advanced", href: "/rota/templates/planner", label: "Advanced Templates", icon: <CalendarDots size={20} aria-hidden /> },
    { key: "build", href: "/rota/build", label: "Build Rota", icon: <Stack size={20} weight="fill" aria-hidden /> },
  ] as const;
  return (
    <ModuleHeader
      title={title}
      description={subtitle}
      actions={canBuild ? (
        <Link href="/rota/build?roll=1" data-testid="roll-forward" title="Copy a built week into future weeks as drafts. You preview first, then confirm." className="mh-btn mh-btn-primary">
          <FastForward size={20} weight="fill" aria-hidden />Roll Forward
        </Link>
      ) : null}
      tabs={
        <nav aria-label="Template views" className="tabs-line">
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined} className="tab-line [&_svg]:h-[18px] [&_svg]:w-[18px]">
              {t.icon}{t.label}
            </Link>
          ))}
        </nav>
      }
    />
  );
}

/** Separate pill buttons, the selected one filled purple (cycle weeks). */
export function ChoiceGroup({ label, items }: { label: string; items: { href: string; label: ReactNode; title?: string; active: boolean; marker?: boolean }[] }) {
  return (
    <nav aria-label={label} className="min-w-0 max-w-full overflow-x-auto">
      <ul className="flex gap-1.5 p-0.5">
        {items.map((it, i) => (
          <li key={i}>
            <Link href={it.href} title={it.title} aria-current={it.active ? "true" : undefined} className={`relative flex h-[44px] min-w-[92px] items-center min-[1600px]:min-w-[112px] justify-center whitespace-nowrap rounded-[10px] px-4 text-[15.5px] font-bold no-underline ${FOCUS} ${it.active ? "bg-module text-white shadow-[0_2px_6px_rgba(91,43,181,0.35)]" : "bg-white text-[#101828] shadow-[0_1px_3px_rgba(16,24,40,0.12)] hover:text-module"}`}>
              {it.label}
              {it.marker ? <span aria-hidden className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${it.active ? "bg-white" : "bg-module"}`} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Carers planned against carers needed: green when full, amber when part-staffed, red when nobody is planned. */
export function CoverageBadge({ filled, required, icon }: { filled: number; required: number; icon?: ReactNode }) {
  const tone = filled >= required ? "bg-[#e3f5e8] text-[#15803d]" : filled === 0 ? "bg-[#fdecec] text-[#b42318] ring-1 ring-[#f7c1bd]" : "bg-[#fdf3d8] text-[#8a5a00]";
  const words = filled >= required ? "fully staffed" : filled === 0 ? "no carer planned" : "partly staffed";
  return <span title={`${filled} of ${required} carer${required === 1 ? "" : "s"} planned: ${words}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[14px] font-bold tabular-nums ${tone}`}>{icon}{filled}/{required}<span className="sr-only"> carers, {words}</span></span>;
}

/** A template is Active (built into rotas) or Inactive (skipped by Build Rota until reactivated). */
export function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e3f5e8] px-2.5 py-0.5 text-[14px] font-semibold text-[#15803d]"><span aria-hidden className="h-2 w-2 rounded-full bg-current" />Active</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f2f4f7] px-2.5 py-0.5 text-[14px] font-semibold text-[#475467]"><span aria-hidden className="h-2 w-2 rounded-full bg-current" />Inactive</span>;
}

/** The right-hand inspector frame: calendar icon, title, close button, body. Only rendered when a template is chosen. */
export function DetailsPanel({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  return (
    <aside aria-label={title} className="rounded-[12px] border border-[#eaecf0] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <div className="flex items-center gap-2.5 border-b border-[#eaecf0] px-4 py-3.5">
        <CalendarDots size={22} weight="bold" aria-hidden className="text-module" />
        <h2 className="mr-auto text-[17px] font-bold text-module">{title}</h2>
        <Link href={closeHref} scroll={false} aria-label={`Close ${title}`} className={`flex h-8 w-8 items-center justify-center rounded-[6px] text-module hover:bg-module/[.08] ${FOCUS}`}><X size={20} weight="bold" aria-hidden /></Link>
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

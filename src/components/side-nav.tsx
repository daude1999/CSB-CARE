"use client";
import Link from "@/components/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";

export type SideNavItem = { href: string; label: string };
export type SideNavSection = { label: string; icon: React.ReactNode; items: SideNavItem[]; action?: SideNavItem };

/** Matches a nav href against the current path and query, so "/policies" and "/policies?tab=templates" are told apart. */
function useIsActive() {
  const path = usePathname();
  const params = useSearchParams();
  return (href: string) => {
    const [base, query] = href.split("?");
    if (base === "/") return path === "/";
    if (!path.startsWith(base!)) return false;
    const want = new URLSearchParams(query ?? "");
    if (!query) return !params.get("tab");
    return [...want].every(([k, v]) => params.get(k) === v);
  };
}

/** The application sidebar: single-page rows, and sections that open to show their pages. */
export function SideNav({ sections }: { sections: SideNavSection[] }) {
  const isActive = useIsActive();
  const row = "flex min-h-[46px] items-center gap-3 border-t border-white/10 px-4 text-[14.5px] font-medium text-white no-underline hover:bg-white/[0.06] hover:text-white";
  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Main">
      {sections.map((s) => {
        const only = s.items.length === 1 && !s.action ? s.items[0]! : null;
        if (only) {
          const active = isActive(only.href);
          return (
            <Link key={s.label} href={only.href} aria-current={active ? "page" : undefined} className={`${row} ${active ? "bg-navy-700" : ""}`}>
              <span aria-hidden="true" className="text-teal-200">{s.icon}</span>
              {s.label}
            </Link>
          );
        }
        const open = s.items.some((i) => isActive(i.href)) || (s.action ? isActive(s.action.href) : false);
        return (
          <details key={s.label} open={open} className="group border-t border-white/10 first:border-t-0 open:bg-navy-700">
            <summary className="flex min-h-[46px] cursor-pointer list-none items-center gap-3 px-4 text-[14.5px] font-medium text-white hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-teal-200">{s.icon}</span>
              {s.label}
              <CaretDown size={13} weight="bold" aria-hidden="true" className="ml-auto opacity-80 transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-px px-3 pb-3">
              {s.items.map((i) => {
                const active = isActive(i.href);
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`rounded-full px-3.5 py-[7px] text-[13.5px] no-underline ${active ? "self-start bg-navy-950 font-medium text-white hover:text-white" : "text-teal-50 hover:bg-white/[0.08] hover:text-white"}`}>
                    {i.label}
                  </Link>
                );
              })}
              {s.action ? (
                <Link href={s.action.href} className="mt-2.5 rounded-full border border-teal-200 px-3 py-1.5 text-center text-[12.5px] font-medium text-white no-underline hover:bg-white/10 hover:text-white">
                  {s.action.label}
                </Link>
              ) : null}
            </div>
          </details>
        );
      })}
    </nav>
  );
}

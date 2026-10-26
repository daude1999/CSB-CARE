"use client";
import Link from "@/components/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretDown, LockSimple } from "@phosphor-icons/react";

export type SideNavItem = { href: string; label: string };
export type SideNavSection = { label: string; icon: React.ReactNode; items: SideNavItem[]; action?: SideNavItem; locked?: boolean };

/** Matches a nav href against the current path and query, so "/policies" and "/policies?tab=templates" are told apart. */
function useIsActive() {
  const path = usePathname();
  const params = useSearchParams();
  return (href: string) => {
    const [base, query] = href.split("?");
    if (base === "/") return path === "/";
    if (!path.startsWith(base!)) return false;
    if (!query) return !params.get("tab");
    return [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v);
  };
}

/** The application sidebar: single-page rows, and sections that open to show their pages. */
export function SideNav({ sections }: { sections: SideNavSection[] }) {
  const isActive = useIsActive();
  const row = "flex h-[52px] items-center gap-3 whitespace-nowrap border-b border-white/[0.08] pl-1.5 pr-4 text-[16.5px] text-white no-underline hover:bg-white/[0.06] hover:text-white";
  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Main">
      {sections.map((s) => {
        const only = s.items.length === 1 && !s.action ? s.items[0]! : null;
        if (only) {
          const active = isActive(only.href);
          return (
            <Link key={s.label} href={only.href} aria-current={active ? "page" : undefined} className={`${row} ${active ? "bg-navy-700" : ""}`}>
              <span aria-hidden="true" className="flex w-[28px] justify-center">{s.icon}</span>
              {s.label}
              {s.locked ? <span title="Locked module" className="ml-auto flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#f0a92e] text-navy-950"><LockSimple size={14} weight="fill" aria-label="Locked" /></span> : null}
            </Link>
          );
        }
        const open = s.items.some((i) => isActive(i.href)) || (s.action ? isActive(s.action.href) : false);
        return (
          <details key={s.label} open={open} className="group border-b border-white/[0.08] open:bg-navy-700 open:pb-[18px]">
            <summary className="flex h-[52px] cursor-pointer list-none items-center gap-3 whitespace-nowrap pl-1.5 pr-4 text-[16.5px] text-white hover:bg-white/[0.06] group-open:h-[40px] [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="flex w-[28px] justify-center">{s.icon}</span>
              {s.label}
              <CaretDown size={12} weight="bold" aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col pl-[25px] pr-3 pt-1">
              {s.items.map((i) => {
                const active = isActive(i.href);
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`text-[15px] text-white no-underline hover:text-teal-200 ${active ? "-ml-[13px] my-[3px] self-start rounded-full bg-navy-950 px-[13px] leading-[26px] hover:text-white" : "leading-[32px]"}`}>
                    {i.label}
                  </Link>
                );
              })}
            </div>
            {s.action ? (
              <>
                <hr className="mx-[20px] mb-[18px] mt-3 border-0 border-t border-white/25" />
                <Link href={s.action.href} className="mx-2.5 block h-[26px] rounded-full border-[1.5px] border-teal-100 text-center text-[14px] leading-[23px] text-white no-underline hover:bg-white/10 hover:text-white">
                  {s.action.label}
                </Link>
              </>
            ) : null}
          </details>
        );
      })}
    </nav>
  );
}

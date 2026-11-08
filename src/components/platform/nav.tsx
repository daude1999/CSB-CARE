"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { useEffect, useRef } from "react";

export interface NavGroup {
  title: string;
  items: { href: string; label: string; exact?: boolean }[];
}

/** The Admin Centre's grouped sidebar. Marks the open page; on phones it sits inside a disclosure that closes after a choice. */
export function PlatformNav({ groups, mobile = false }: { groups: NavGroup[]; mobile?: boolean }) {
  const path = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (mobile && ref.current) ref.current.open = false;
  }, [path, mobile]);
  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));
  const list = (
    <nav aria-label="Platform administration" className="space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8f9bbd]">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = isActive(i.href, i.exact);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative block rounded-[6px] px-3 py-[6px] text-[13.5px] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c4b5fd] ${active ? "bg-[#1f2d57] font-medium text-white before:absolute before:left-0 before:top-[7px] before:h-[18px] before:w-[3px] before:rounded-full before:bg-[#a78bfa]" : "text-[#c9d1e6] hover:bg-[#18244a] hover:text-white"}`}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  if (!mobile) return list;
  return (
    <details ref={ref} className="lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[6px] border border-white/20 px-3 py-1.5 text-[13.5px] text-white">Menu</summary>
      <div className="absolute inset-x-0 top-full z-40 max-h-[75vh] overflow-y-auto bg-[#0f1b3d] px-3 py-4 shadow-xl">{list}</div>
    </details>
  );
}

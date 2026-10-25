"use client";
import Link from "@/components/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, icon, children, compact = false }: { href: string; icon?: React.ReactNode; children: React.ReactNode; compact?: boolean }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  if (compact) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm no-underline ${active ? "bg-navy-900 text-white hover:text-white" : "text-slate-700 hover:bg-slate-100 hover:text-navy-900"}`}>
        {icon}
        {children}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 py-[7px] pl-5 pr-3 text-[13.5px] no-underline transition-colors ${active ? "bg-white/6 text-white hover:text-white" : "text-slate-400 hover:bg-white/3 hover:text-white"}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-1 left-0 w-[3px] rounded-r ${active ? "bg-teal-400" : "bg-transparent"}`} />
      <span aria-hidden="true" className={active ? "text-teal-400" : "text-slate-500 group-hover:text-slate-300"}>{icon}</span>
      {children}
    </Link>
  );
}

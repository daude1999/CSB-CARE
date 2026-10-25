"use client";
import Link from "@/components/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, icon, children, large = false }: { href: string; icon?: React.ReactNode; children: React.ReactNode; large?: boolean }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 pl-5 pr-3 no-underline ${large ? "min-h-[46px] py-2 text-[15px]" : "py-[7px] text-[13.5px]"} transition-colors ${active ? "bg-white/[0.06] text-white hover:text-white" : "text-slate-400 hover:bg-white/[0.03] hover:text-white"}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-1 left-0 w-[3px] rounded-r ${active ? "bg-teal-400" : "bg-transparent"}`} />
      <span aria-hidden="true" className={active ? "text-teal-400" : "text-slate-500 group-hover:text-slate-300"}>{icon}</span>
      {children}
    </Link>
  );
}

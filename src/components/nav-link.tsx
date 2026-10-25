"use client";
import Link from "@/components/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className={`block rounded-lg px-3 py-2 text-sm no-underline ${active ? "bg-teal-50 text-teal-800 md:bg-navy-800 md:text-white" : "text-slate-700 hover:bg-slate-100 md:text-slate-300 md:hover:bg-navy-900 md:hover:text-white"}`}>
      {active ? <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-teal-500 align-middle md:bg-teal-400" /> : null}
      {children}
    </Link>
  );
}

"use client";
import Link from "@/components/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className={`block rounded-lg px-3 py-2 text-sm no-underline ${active ? "bg-navy-800 text-white" : "text-slate-300 hover:bg-navy-900 hover:text-white"}`}>
      {active ? <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-teal-400 align-middle" /> : null}
      {children}
    </Link>
  );
}

"use client";
import { usePathname, useSearchParams } from "next/navigation";

/** The page frame: every page runs edge to edge on white. Inner pages sit on the grey canvas the dashboard uses under its title bar. */
export function MainArea({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const wide = path === "/" || (path === "/policies" && [...params.keys()].every((k) => k === "area"));
  return <main className="w-full flex-1 bg-white px-4 pb-4 pt-3">{wide ? children : <div className="page-canvas">{children}</div>}</main>;
}

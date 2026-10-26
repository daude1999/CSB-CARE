"use client";
import { usePathname, useSearchParams } from "next/navigation";

/** The page frame: the dashboard and My Policies run edge to edge on white, every other page keeps the centred reading width. */
export function MainArea({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const wide = path === "/" || (path === "/policies" && [...params.keys()].every((k) => k === "area"));
  return <main className={wide ? "w-full flex-1 bg-white px-4 pb-4 pt-3" : "mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-10"}>{children}</main>;
}

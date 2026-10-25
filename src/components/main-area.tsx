"use client";
import { usePathname } from "next/navigation";

/** The page frame: the dashboard runs edge to edge on white, every other page keeps the centred reading width. */
export function MainArea({ children }: { children: React.ReactNode }) {
  const wide = usePathname() === "/";
  return <main className={wide ? "w-full flex-1 bg-white px-4 pb-4 pt-3" : "mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-10"}>{children}</main>;
}

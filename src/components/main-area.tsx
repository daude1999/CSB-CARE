"use client";
import { usePathname } from "next/navigation";

/**
 * The page frame. The Policy Library draws its own full-width workspace (hero and card) from the approved design;
 * every other page runs edge to edge on white, inner pages on the grey canvas the dashboard uses under its title bar.
 */
export function MainArea({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/policies") return <main className="w-full min-w-0 flex-1">{children}</main>;
  const wide = path === "/";
  return <main className="w-full flex-1 bg-white px-4 pb-4 pt-3">{wide ? children : <div className="page-canvas">{children}</div>}</main>;
}

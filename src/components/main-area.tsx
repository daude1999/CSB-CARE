"use client";
import { usePathname } from "next/navigation";
import { portalById, portalForPath } from "@/lib/portals";

/**
 * The page frame. The Policy Library draws its own full-width workspace (hero and card) from the approved design;
 * every other page runs edge to edge on white, inner pages on the grey canvas the dashboard uses under its title bar.
 */
export function MainArea({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // Each portal's pages carry its module colour (page title bars use it), so a module looks the same as its Overview tile.
  const style = { "--module": portalById(portalForPath(path)).colour } as React.CSSProperties;
  if (path === "/policies" || path === "/overview") return <main style={style} className="w-full min-w-0 flex-1">{children}</main>;
  const wide = path === "/";
  return <main style={style} className="w-full min-w-0 flex-1 bg-white px-4 pb-4 pt-3">{wide ? children : <div className="page-canvas">{children}</div>}</main>;
}

"use client";
import { usePathname, useSearchParams } from "next/navigation";

/** Matches a nav href against the current path and query, so "/policies" covers every Policy Library view and "/" only the dashboard. */
export function useIsActive() {
  const path = usePathname();
  const params = useSearchParams();
  return (href: string) => {
    const [base, query] = href.split("?");
    if (base === "/") return path === "/";
    if (path !== base && !path.startsWith(`${base}/`)) return false;
    if (!query) return true;
    return [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v);
  };
}

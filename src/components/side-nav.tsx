"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { isActiveHref } from "@/lib/navigation";

/** Matches a nav href against the current path and query, so "/policies" covers every Policy Library view and "/" only the dashboard. */
export function useIsActive() {
  const path = usePathname();
  const params = useSearchParams();
  return (href: string) => isActiveHref(href, path, params);
}

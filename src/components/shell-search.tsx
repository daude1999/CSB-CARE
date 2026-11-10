"use client";
import { usePathname } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";
import Link from "@/components/link";
import { HUB_SEARCH_EVENT, isHubPath } from "@/lib/portals";

/** Phones: the search opens from an icon so it never squeezes the top bar. */
const PHONE_ICON = "flex h-9 w-9 items-center justify-center rounded-full text-[#5b2bb5] no-underline hover:bg-[#5b2bb5]/10 hover:text-[#5b2bb5] sm:hidden";

/**
 * The top bar's search, centred in the space between the history arrows and the alerts, help and profile controls.
 * On HR pages it opens the HR Hub's own search; on rostering pages it searches service users, team members and visit
 * references; everywhere else it searches the policy library. Ctrl+K / ⌘K opens the command bar
 * (src/components/command-bar.tsx) on every page.
 */
export function ShellSearch() {
  const path = usePathname();
  if (isHubPath(path)) {
    const open = () => window.dispatchEvent(new Event(HUB_SEARCH_EVENT));
    return (
      <div className="flex min-w-0 flex-1 justify-end sm:justify-center">
        <button type="button" onClick={open} className="shell-search hidden w-full max-w-[780px] text-left sm:flex" aria-label="Search people or documents">
          <MagnifyingGlass size={19} weight="bold" aria-hidden="true" className="shrink-0 text-[#5b2bb5]" />
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#667085]">Search people or documents…</span>
        </button>
        <button type="button" onClick={open} className={PHONE_ICON} aria-label="Search people or documents">
          <MagnifyingGlass size={21} weight="bold" aria-hidden="true" />
        </button>
      </div>
    );
  }
  const rota = path === "/rota" || path.startsWith("/rota/");
  const action = rota ? "/rota/search" : "/policies";
  const label = rota ? "Search rostering" : "Search policies";
  return (
    <div className="flex min-w-0 flex-1 justify-end sm:justify-center">
      <form action={action} method="get" role="search" className="hidden w-full min-w-0 max-w-[780px] sm:block">
        <label htmlFor="global-search" className="shell-search">
          <MagnifyingGlass size={19} weight="bold" aria-hidden="true" className="shrink-0 text-[#5b2bb5]" />
          <span className="sr-only">{label}</span>
          <input id="global-search" name="q" type="search" placeholder={rota ? "Search service users, staff, references..." : "Search policies, categories, keywords…"} className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-[#0b1530] placeholder:text-[#667085] focus:outline-none" />
        </label>
      </form>
      <Link href={action} className={PHONE_ICON} aria-label={label} title={label}>
        <MagnifyingGlass size={21} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

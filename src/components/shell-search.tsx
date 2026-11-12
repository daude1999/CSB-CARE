"use client";
import { usePathname } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";
import Link from "@/components/link";
import { HUB_SEARCH_EVENT, isHubPath } from "@/lib/portals";

/** Phones: the search opens from an icon so it never squeezes the top bar. */
const PHONE_ICON = "flex h-9 w-9 items-center justify-center rounded-full text-cc-brand no-underline hover:bg-cc-green-bg hover:text-cc-brand sm:hidden";

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
      <div className="flex min-w-0 flex-1 justify-end sm:min-w-[200px] sm:justify-center">
        <button type="button" onClick={open} className="shell-search hidden w-full max-w-[780px] text-left sm:flex" aria-label="Search people or documents">
          <MagnifyingGlass size={19} weight="bold" aria-hidden="true" className="shrink-0 text-cc-muted" />
          <span className="min-w-0 flex-1 truncate text-body text-cc-muted">Search people or documents…</span>
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
    <div className="flex min-w-0 flex-1 justify-end sm:min-w-[200px] sm:justify-center">
      <form action={action} method="get" role="search" className="hidden w-full min-w-[200px] max-w-[780px] sm:block">
        <label htmlFor="global-search" className="shell-search">
          <MagnifyingGlass size={19} weight="bold" aria-hidden="true" className="shrink-0 text-cc-muted" />
          <span className="sr-only">{label}</span>
          <input id="global-search" name="q" type="search" placeholder={rota ? "Search service users, staff, references..." : "Search policies, categories, keywords…"} className="h-full min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-cc-muted focus:outline-none" />
        </label>
      </form>
      <Link href={action} className={PHONE_ICON} aria-label={label} title={label}>
        <MagnifyingGlass size={21} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

"use client";
import { usePathname } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { HUB_SEARCH_EVENT, isHubPath } from "@/lib/portals";
import { SearchShortcut } from "@/components/portal-switcher";

const KBD = "hidden rounded-[4px] border border-[#dcd9d2] bg-white px-1.5 text-[10.5px] leading-[18px] text-[#3a4b5e] lg:inline";

/**
 * The top bar's search. On HR pages it searches people and documents through the HR Hub's own search (which also
 * answers Ctrl+K / ⌘K there); on rostering pages it searches service users, team members and visit references;
 * everywhere else it searches the policy library.
 */
export function ShellSearch() {
  const path = usePathname();
  if (isHubPath(path)) {
    const open = () => window.dispatchEvent(new Event(HUB_SEARCH_EVENT));
    return (
      <>
        <div className="hidden min-w-0 flex-1 sm:block sm:max-w-[776px]">
          <button type="button" onClick={open} className="shell-search w-full text-left" aria-label="Search people or documents">
            <MagnifyingGlass size={17} aria-hidden="true" className="shrink-0 text-[#3a4b5e]" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#5f6b7a]">Search people or documents…</span>
            <kbd className={KBD}>⌘ K</kbd>
          </button>
        </div>
        {/* Phones: the same search from an icon, so it never squeezes the top bar. */}
        <button type="button" onClick={open} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-[#0b1530] hover:bg-black/5 sm:hidden" aria-label="Search people or documents">
          <MagnifyingGlass size={21} aria-hidden="true" />
        </button>
      </>
    );
  }
  const rota = path === "/rota" || path.startsWith("/rota/");
  return (
    <form action={rota ? "/rota/search" : "/policies"} method="get" role="search" className="hidden min-w-0 flex-1 sm:block sm:max-w-[776px]">
      <label htmlFor="global-search" className="shell-search">
        <MagnifyingGlass size={17} aria-hidden="true" className="shrink-0 text-[#3a4b5e]" />
        <span className="sr-only">{rota ? "Search rostering" : "Search policies"}</span>
        <input id="global-search" name="q" type="search" placeholder={rota ? "Search rostering (e.g. service user, team member, reference)…" : "Search policies, categories, keywords…"} className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-[#0b1530] placeholder:text-[#5f6b7a] focus:outline-none" />
        <kbd className={KBD}>⌘ K</kbd>
      </label>
      <SearchShortcut targetId="global-search" />
    </form>
  );
}

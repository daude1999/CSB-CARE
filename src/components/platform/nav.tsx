"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { useEffect, useRef } from "react";
import { Buildings, CreditCard, GearSix, List, SquaresFour, Pulse, UsersThree, X, type Icon } from "@phosphor-icons/react";
import { locate, WORKSPACES, type WorkspaceIcon } from "./nav-config";

const ICONS: Record<WorkspaceIcon, Icon> = { overview: SquaresFour, clients: Buildings, accounts: UsersThree, billing: CreditCard, operations: Pulse, settings: GearSix };

/**
 * The six Admin Centre workspaces. Full labels on desktop, an icon rail on tablets (labels stay available to screen
 * readers and as tooltips) and a drawer on phones. `badges` adds a count to a workspace (e.g. support requests).
 */
export function PlatformNav({ mobile = false, badges = {} }: { mobile?: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const { workspace } = locate(path);
  useEffect(() => {
    if (mobile && ref.current) ref.current.open = false;
  }, [path, mobile]);
  const list = (rail: boolean) => (
    <ul className="space-y-0.5">
      {WORKSPACES.map((w) => {
        const active = w.key === workspace.key;
        const Ico = ICONS[w.icon];
        const badge = badges[w.key] ?? 0;
        return (
          <li key={w.key}>
            <Link
              href={w.href}
              aria-current={active ? "page" : undefined}
              title={rail ? w.label : undefined}
              className={`group relative flex items-center gap-3 rounded-[7px] text-body no-underline transition-colors ${rail ? "justify-center px-0 py-2.5 lg:justify-start lg:px-3 lg:py-[7px]" : "px-3 py-[9px]"} ${active ? "bg-px-nav-active font-medium text-white" : "text-px-nav-text hover:bg-px-nav-hover hover:text-white"}`}
            >
              {active ? <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[#a78bfa]" /> : null}
              <Ico size={18} weight={active ? "fill" : "regular"} className={active ? "text-[#c4b5fd]" : "text-px-nav-muted group-hover:text-px-nav-text"} aria-hidden="true" />
              <span className={rail ? "sr-only lg:not-sr-only lg:flex-1 lg:truncate" : "flex-1 truncate"}>{w.label}</span>
              {badge ? <span className={`rounded-full bg-px-focus px-1.5 text-micro font-semibold leading-[18px] text-white ${rail ? "absolute right-1.5 top-1 lg:static" : ""}`} aria-label={`${badge} waiting`}>{badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  if (!mobile) return <nav aria-label="Admin Centre workspaces">{list(true)}</nav>;
  return (
    <details ref={ref} className="group/menu md:hidden">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-[7px] text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden" aria-label="Open menu">
        <List size={20} className="group-open/menu:hidden" aria-hidden="true" />
        <X size={20} className="hidden group-open/menu:block" aria-hidden="true" />
      </summary>
      <div className="fixed inset-x-0 bottom-0 top-[56px] z-40 overflow-y-auto bg-px-nav px-3 py-4">
        <nav aria-label="Admin Centre workspaces">{list(false)}</nav>
        <div className="mt-4 border-t border-white/10 pt-3">
          {WORKSPACES.find((w) => w.key === workspace.key)?.pages.map((p) => (
            <Link key={p.href} href={p.href} className="block rounded-[6px] px-3 py-2 text-body text-px-nav-text no-underline hover:bg-px-nav-hover hover:text-white">{p.label}</Link>
          ))}
        </div>
      </div>
    </details>
  );
}

/** The open workspace's pages, as a tab bar at the top of the workspace. Hidden on a record's own workspace. */
export function WorkspaceTabs() {
  const path = usePathname();
  const { workspace, page } = locate(path);
  if (!page) return null;
  return (
    <div className="border-b border-px-line bg-white px-4 lg:px-8">
      <div className="mx-auto flex max-w-[1440px] items-end gap-6">
        <p className="hidden shrink-0 py-3 text-meta font-semibold text-px-ink xl:block">{workspace.label}</p>
        <span aria-hidden="true" className="mb-3 hidden h-4 w-px bg-px-line xl:block" />
        <nav aria-label={`${workspace.label} pages`} className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
          {workspace.pages.map((p) => {
            const active = p.href === page.href;
            return (
              <Link key={p.href} href={p.href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-2.5 py-3 text-body no-underline transition-colors ${active ? "border-px-accent font-medium text-px-ink" : "border-transparent text-px-muted hover:text-px-ink"}`}>
                {p.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

"use client";
import Link from "@/components/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CaretDown, List, SignOut, Swap, X } from "@phosphor-icons/react";
import { portalForPath, type Portal } from "@/lib/portals";
import { useIsActive } from "@/components/side-nav";

export type ShellItem = { href: string; label: string; icon: React.ReactNode; planned?: boolean; /** Starts a labelled group of pages in the sidebar. */ group?: string };
export type ShellPortal = Portal & { icon: React.ReactNode };
export type ShellPerson = { name: string; initials: string; role: string };
export type ShellOrganisation = { name: string; branch: string | null; options: { id: string; name: string }[]; currentId: string | null };

/** A portal with its own look (the HR Hub) loads as a fresh page so the two style sheets never mix. */
function PortalAnchor({ portal, className, current, style, children }: { portal: ShellPortal; className: string; current: boolean; style?: React.CSSProperties; children: React.ReactNode }) {
  const props = { className, style, "data-portal-home": "", "aria-current": current ? ("page" as const) : undefined };
  return portal.separateApp ? <a href={portal.home} {...props}>{children}</a> : <Link href={portal.home} {...props}>{children}</Link>;
}

/** Every portal this person may open, with the current portal's pages listed underneath it. */
/** The order of the approved design; a portal missing from the list keeps its place at the end. */
const ORDER = ["overview", "policy", "rota", "hr", "reporting", "admin"];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

function PortalNav({ portals, items }: { portals: ShellPortal[]; items: Partial<Record<string, ShellItem[]>> }) {
  const path = usePathname();
  const ordered = [...portals].sort((a, b) => rank(a.id) - rank(b.id));
  const isActive = useIsActive();
  const currentId = portalForPath(path);
  // Only the most specific matching entry is highlighted, so "/rota" (Today) is not lit on "/rota/visits".
  const activeHref = Object.values(items).flatMap((x) => x ?? []).filter((i) => !i.planned && isActive(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="shell-scroll min-h-0 flex-1 overflow-y-auto px-[10px] pb-[12px]">
      <ul data-testid="portal-switcher" className="space-y-[3px]">
        {ordered.map((p) => {
          const current = p.id === currentId;
          const pages = current ? (items[p.id] ?? []) : [];
          return (
            <li key={p.id}>
              <PortalAnchor portal={p} current={current && path === p.home} className={`shell-portal relative ${current ? "shell-portal-current" : ""}`} style={current ? { background: p.colour } : undefined}>
                <span aria-hidden="true" className="absolute bottom-[10px] left-0 top-[10px] w-[3px] rounded-full" style={{ background: p.colour, opacity: current ? 0 : 1 }} />
                <span aria-hidden="true" className="flex w-[20px] shrink-0 justify-center">{p.icon}</span>
                <span className={`min-w-0 truncate ${p.planned ? "text-white/70" : ""}`}>{p.name}</span>
                {p.planned ? <span className="ml-auto shrink-0 text-[10px] text-white/60">Planned</span> : null}
              </PortalAnchor>
              {pages.length ? (
                <ul className="relative mb-[8px] ml-[8px] mt-[4px] space-y-px border-l border-white/[0.14] pl-[6px]">
                  {pages.map((i) => {
                    const heading = i.group ? <li key={`g-${i.group}`} aria-hidden="true" className="px-[7px] pb-[2px] pt-[9px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/50 first:pt-[2px]">{i.group}</li> : null;
                    const row = renderItem(i);
                    return heading ? [heading, row] : row;
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );

  function renderItem(i: ShellItem) {
                    if (i.planned)
                      return (
                        <li key={i.label} className="shell-page cursor-default text-white/45">
                          <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
                          <span className="min-w-0 truncate">{i.label}</span>
                          <span className="ml-auto shrink-0 text-[10px]">Planned</span>
                        </li>
                      );
                    const active = i.href === activeHref;
                    return (
                      <li key={i.href}>
                        <Link href={i.href} aria-current={active ? "page" : undefined} className={`shell-page ${active ? "shell-page-active" : ""}`}>
                          <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
                          <span className="min-w-0 truncate">{i.label}</span>
                        </Link>
                      </li>
                    );
  }
}

/** The organisation card: switching is offered only when the person belongs to more than one organisation. */
function OrganisationCard({ org, switchAction }: { org: ShellOrganisation; switchAction: (fd: FormData) => Promise<void> }) {
  const place = org.branch ? `${org.name} · ${org.branch}` : org.name;
  const shown = org.branch ?? org.name;
  if (org.options.length < 2) {
    return (
      <div className="flex items-center gap-3 rounded-[8px] border border-white/[0.16] px-3 py-2.5">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 text-white/90"><Swap size={14} /></span>
        <span className="min-w-0">
          <span className="block text-[12.5px] text-white/70">Organisation</span>
          <span className="line-clamp-2 block text-[12.5px] leading-[16px] text-white" title={place}>{shown}<span className="sr-only">, {org.name}</span></span>
        </span>
      </div>
    );
  }
  return (
    <details className="group relative rounded-[8px] border border-white/[0.16]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 text-white/90"><Swap size={14} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-white/70">Switch Organisation</span>
          <span className="line-clamp-2 block text-[12.5px] leading-[16px] text-white" title={place}>{shown}<span className="sr-only">, {org.name}</span></span>
        </span>
        <CaretDown size={12} weight="bold" aria-hidden="true" className="text-white/80 transition-transform group-open:rotate-180" />
      </summary>
      <form action={switchAction} className="space-y-2 border-t border-white/[0.12] px-3 pb-3 pt-2">
        <label className="sr-only" htmlFor="shell-org">Organisation</label>
        <select id="shell-org" name="organisationId" defaultValue={org.currentId ?? ""} className="w-full rounded-[6px] border border-white/25 bg-[#0c2a44] px-2 py-1.5 text-[13px] text-white">
          {org.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button type="submit" className="w-full rounded-[6px] bg-white/[0.12] py-1.5 text-[13px] text-white hover:bg-white/20">Switch</button>
      </form>
    </details>
  );
}

function SidebarBody({ portals, items, org, person, switchAction, signOutAction, logo }: SidebarProps) {
  return (
    <>
      <div className="shrink-0 px-[18px] pb-5 pt-[18px]">
        <Link href="/overview" aria-label="CSB All in One Platform home" className="block w-fit no-underline">{logo}</Link>
        <p className="mt-2 text-[14px] leading-tight text-white">Care Solution Bureau CIC</p>
      </div>
      <PortalNav portals={portals} items={items} />
      <div className="shrink-0 space-y-3 border-t border-white/[0.08] px-3 pb-4 pt-3">
        {org ? <OrganisationCard org={org} switchAction={switchAction} /> : null}
        <div className="flex items-center gap-3 px-1">
          <span aria-hidden="true" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/[0.92] text-[13px] font-semibold text-[#092135]">{person.initials}</span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] text-white" data-testid="current-user">{person.name}</span>
            <span className="block truncate text-[12.5px] text-white/70">{person.role}</span>
          </span>
        </div>
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left text-[14px] text-white hover:bg-white/[0.08]">
            <SignOut size={18} aria-hidden="true" />Sign out
          </button>
        </form>
      </div>
    </>
  );
}

type SidebarProps = {
  portals: ShellPortal[];
  items: Partial<Record<string, ShellItem[]>>;
  org: ShellOrganisation | null;
  person: ShellPerson;
  switchAction: (fd: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
  logo: React.ReactNode;
};

/** The application sidebar from the approved design: portals, the current portal's pages, organisation and account. */
export function ShellSidebar(props: SidebarProps) {
  return (
    <div className="shell-sidebar hidden w-[212px] shrink-0 md:block">
      <aside className="sticky top-0 flex h-screen flex-col">
        <SidebarBody {...props} />
      </aside>
    </div>
  );
}

/** Phones and small tablets: the same sidebar, opened from a menu button as a dialog. */
export function MobileMenu(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-[6px] text-[#0b1530] hover:bg-black/5 md:hidden" aria-label="Open menu" aria-haspopup="dialog">
        <List size={22} aria-hidden="true" />
      </button>
      <dialog ref={dialog} onClose={() => setOpen(false)} aria-label="Menu" className="m-0 h-full max-h-none w-[280px] max-w-[85vw] p-0 backdrop:bg-black/40">
        <div className="shell-sidebar flex h-full flex-col">
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
          {open ? <SidebarBody {...props} /> : null}
        </div>
      </dialog>
    </>
  );
}

/** Ctrl+K or ⌘K jumps to the global search, as the shortcut hint in the search box says. */
export function SearchShortcut({ targetId }: { targetId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.getElementById(targetId) as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targetId]);
  return null;
}

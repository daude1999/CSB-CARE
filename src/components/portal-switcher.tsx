"use client";
import Link from "@/components/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretDown, List, MapPin, SignOut, Swap, X } from "@phosphor-icons/react";
import { portalForPath, type Portal } from "@/lib/portals";
import { activeEntryHref, splitHref } from "@/lib/navigation";
import { MOTION } from "@/lib/motion";
import { usePendingHref } from "@/components/navigation-progress";

export type ShellItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Other addresses that belong to this entry (a workspace's tabs), so the entry stays lit on them. */
  match?: string[];
  planned?: boolean;
  /** Starts a labelled group of pages in the sidebar. */
  group?: string;
  /** Set on a group's first page to make its heading a button that folds the group; "closed" starts it folded. */
  fold?: "open" | "closed";
  /** The page sits in a folded list with this name at the end of its group (for example "More rota tools"). */
  more?: string;
};
export type ShellPortal = Portal & { icon: React.ReactNode };
export type ShellPerson = { name: string; initials: string; role: string };
export type ShellOrganisation = { name: string; branch: string | null; options: { id: string; name: string }[]; currentId: string | null };

const OVERVIEW_HREF = "/overview";

/**
 * A portal's entry in the sidebar. Another module's name opens that module; the name of the module on screen takes
 * the person back to the Overview (its own dashboard stays one row below, in its pages). Links into or out of the
 * HR Hub load a fresh page (HubEdge in navigation-progress.tsx).
 */
function PortalAnchor({ portal, className, current, inside, style, children }: { portal: ShellPortal; className: string; current: boolean; inside: boolean; style?: React.CSSProperties; children: React.ReactNode }) {
  const back = inside && portal.home !== OVERVIEW_HREF;
  return (
    <Link href={back ? OVERVIEW_HREF : portal.home} className={className} style={style} title={back ? "Back to Overview" : undefined} aria-label={back ? `${portal.name}, back to Overview` : undefined} data-portal-home="" data-portal={portal.id} data-back-to-overview={back ? "" : undefined} aria-current={current && !back ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** Every portal this person may open, with the current portal's pages listed underneath it. */
/** The order of the approved design; a portal missing from the list keeps its place at the end. */
const ORDER = ["overview", "policy", "rota", "hr", "reporting", "admin"];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

/**
 * The sidebar follows the page being opened, not only the page on screen: the moment a link is clicked the chosen
 * module lights up and its pages open, while the content area keeps the old page until the new one arrives.
 * aria-current stays on the page actually shown, so assistive technology is never told about a page that has not loaded.
 */
function PortalNav({ portals, items, branch }: { portals: ShellPortal[]; items: Partial<Record<string, ShellItem[]>>; branch: string | null }) {
  const path = usePathname();
  const params = useSearchParams();
  const pendingHref = usePendingHref();
  const target = pendingHref ? splitHref(pendingHref) : { path, params };
  const ordered = [...portals].sort((a, b) => rank(a.id) - rank(b.id));
  const currentId = portalForPath(target.path);
  const shownId = portalForPath(path);
  const entries = Object.values(items).flatMap((x) => x ?? []).filter((i) => !i.planned);
  // Only the most specific matching entry is highlighted, so "/rota" (dashboard) is not lit on "/rota/visits".
  const activeHref = activeEntryHref(entries, target.path, target.params);
  const shownHref = activeEntryHref(entries, path, params);

  // When the module changes, the old module's pages fold away while the new one's open; on first paint nothing moves.
  const [sections, setSections] = useState({ open: currentId, closing: null as string | null, moved: false });
  if (sections.open !== currentId) setSections({ open: currentId, closing: sections.open, moved: true });
  useEffect(() => {
    if (!sections.closing) return;
    const t = setTimeout(() => setSections((s) => ({ ...s, closing: null })), MOTION.slow + 40);
    return () => clearTimeout(t);
  }, [sections.closing]);

  // Bring the current page into view once, when the sidebar first appears (a full page load, or the phone menu opening).
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    const active = el?.querySelector<HTMLElement>('[data-nav-active="true"]');
    if (!el || !active) return;
    const top = active.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + active.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, []);

  return (
    <nav ref={nav} aria-label="Main" className="shell-scroll min-h-0 flex-1 overflow-y-auto px-[10px] pb-[12px]">
      <ul data-testid="portal-switcher" className="space-y-[3px]">
        {ordered.map((p) => {
          const current = p.id === currentId;
          const closing = !current && p.id === sections.closing;
          const pages = current || closing ? (items[p.id] ?? []) : [];
          return (
            <li key={p.id}>
              <PortalAnchor portal={p} current={p.id === shownId && path === p.home} inside={p.id === shownId} className={`shell-portal relative ${current ? "shell-portal-current" : ""}`} style={current ? { background: p.colour } : undefined}>
                <span aria-hidden="true" className="flex w-[20px] shrink-0 justify-center">{p.icon}</span>
                <span className={`min-w-0 leading-[17px] ${p.planned ? "text-white/70" : ""}`}>{p.name}</span>
                {p.planned ? <span className="ml-auto shrink-0 text-[10px] text-white/60">Planned</span> : null}
              </PortalAnchor>
              {pages.length ? (
                <div className="shell-section mb-[8px] mt-[4px]" data-state={closing ? "closing" : sections.moved ? "opening" : "open"} inert={closing || undefined} data-testid={current ? "portal-pages" : undefined}>
                  <div>
                    <PageList pages={pages} activeHref={current ? activeHref : undefined} shownHref={shownHref} accent={p.colour} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {branch ? (
        <div className="mt-[14px] border-t border-white/[0.1] px-[6px] pt-[12px]">
          <p className="text-[12.5px] text-white/60">Workspace</p>
          <p className="mt-[8px] flex items-center gap-[10px] px-[4px] text-[13px] text-white" title="Your branch">
            <MapPin size={18} aria-hidden="true" className="shrink-0" /><span className="sr-only">Your branch: </span><span className="truncate">{branch}</span>
          </p>
        </div>
      ) : null}
    </nav>
  );
}

type PageGroup = { name?: string; fold?: "open" | "closed"; rows: ShellItem[]; more: { name: string; rows: ShellItem[] } | null };

/** Splits a module's flat page list into its groups, each with the pages of its folded "More" list kept apart. */
export function groupPages(pages: ShellItem[]): PageGroup[] {
  const out: PageGroup[] = [];
  for (const p of pages) {
    if (p.group || !out.length) out.push({ name: p.group, fold: p.fold, rows: [], more: null });
    const g = out[out.length - 1]!;
    if (p.more) (g.more ??= { name: p.more, rows: [] }).rows.push(p);
    else g.rows.push(p);
  }
  return out;
}

const hasPage = (rows: ShellItem[], href?: string) => Boolean(href) && rows.some((r) => !r.planned && r.href === href);

/**
 * One module's pages, with a single marker on the guide line that glides to the active page. Groups that opt in
 * (fold) get a heading button that opens and folds them; a group, or its "More" list, always opens when it holds the
 * page being opened, so the current page is never hidden.
 */
function PageList({ pages, activeHref, shownHref, accent }: { pages: ShellItem[]; activeHref?: string; shownHref?: string; accent: string }) {
  const list = useRef<HTMLUListElement>(null);
  const marker = useRef<HTMLLIElement>(null);
  const placed = useRef(false);
  const groups = groupPages(pages);
  // Only the person's own clicks are remembered; everything else follows the group's default and the open page.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [seenActive, setSeenActive] = useState(activeHref);
  if (seenActive !== activeHref) {
    // Moving to another page re-opens whatever holds it, even if the person folded it earlier.
    setSeenActive(activeHref);
    const keep = { ...toggled };
    for (const g of groups) {
      if (g.name && hasPage([...g.rows, ...(g.more?.rows ?? [])], activeHref)) delete keep[g.name];
      if (g.name && g.more && hasPage(g.more.rows, activeHref)) delete keep[`${g.name}/more`];
    }
    setToggled(keep);
  }
  const isOpen = (key: string, byDefault: boolean, holdsActive: boolean) => toggled[key] ?? (byDefault || holdsActive);
  const flip = (key: string, now: boolean) => setToggled((t) => ({ ...t, [key]: !now }));

  useLayoutEffect(() => {
    const m = marker.current;
    const row = activeHref ? list.current?.querySelector<HTMLElement>('[data-nav-active="true"]') : null;
    if (!m) return;
    // A row inside a folded group has no layout box: hide the marker rather than point at nothing.
    if (!row || row.offsetParent === null) {
      m.style.opacity = "0";
      return;
    }
    // The first placement jumps straight to the row; later ones glide.
    if (!placed.current) m.style.transition = "none";
    m.style.transform = `translateY(${row.offsetTop}px)`;
    m.style.height = `${row.offsetHeight}px`;
    m.style.opacity = "1";
    if (!placed.current) {
      void m.offsetHeight;
      m.style.transition = "";
      placed.current = true;
    }
  }, [activeHref, pages, toggled]);

  return (
    <ul ref={list} className="relative ml-[8px] space-y-px border-l border-white/[0.14] pl-[6px]">
      {groups.map((g, n) => {
        const all = [...g.rows, ...(g.more?.rows ?? [])];
        if (!g.fold) {
          const heading = g.name ? <li key={`g-${g.name}`} aria-hidden="true" className="px-[7px] pb-[2px] pt-[9px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/50 first:pt-[2px]">{g.name}</li> : null;
          return [heading, ...all.map(renderItem)];
        }
        const name = g.name ?? `group-${n}`;
        const open = isOpen(name, g.fold === "open", hasPage(all, activeHref));
        const id = `nav-group-${slug(name)}`;
        return (
          <li key={`g-${name}`} className="first:[&>button]:pt-[2px]">
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => flip(name, open)} data-nav-group={name} className="flex w-full items-center rounded-[4px] px-[7px] pb-[2px] pt-[9px] text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-white/60 hover:text-white">
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <CaretDown size={10} weight="bold" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
            <ul id={id} hidden={!open} className="space-y-px">
              {g.rows.map(renderItem)}
              {g.more && g.more.rows.length ? renderMore(name, g.more) : null}
            </ul>
          </li>
        );
      })}
      {/* Last, so it never shifts the rows' spacing or the first heading's "first:" style. */}
      <li ref={marker} aria-hidden="true" className="shell-marker" style={{ background: `color-mix(in srgb, ${accent} 45%, #ffffff)` }} />
    </ul>
  );

  function renderMore(group: string, more: { name: string; rows: ShellItem[] }) {
    const key = `${group}/more`;
    const open = isOpen(key, false, hasPage(more.rows, activeHref));
    const id = `nav-more-${slug(group)}`;
    return (
      <li>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => flip(key, open)} data-nav-more={more.name} className="shell-page w-full text-left italic text-white/70">
          <CaretDown size={10} weight="bold" aria-hidden="true" className={`w-[14px] shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          <span className="min-w-0 truncate">{more.name} ({more.rows.length})</span>
        </button>
        <ul id={id} hidden={!open} className="space-y-px">{more.rows.map(renderItem)}</ul>
      </li>
    );
  }

  function renderItem(i: ShellItem) {
    if (i.planned)
      return (
        <li key={i.label} className="shell-page h-auto cursor-default py-[4px] text-white/45" title={`${i.label}: planned, not built yet`}>
          <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
          {/* Two lines, so the page's full name stays readable in the narrow sidebar. */}
          <span className="min-w-0 leading-[14px]"><span className="block truncate">{i.label}</span><span className="block text-[10px] leading-[12px] text-white/40">Planned</span></span>
        </li>
      );
    const active = i.href === activeHref;
    return (
      <li key={i.href}>
        <Link href={i.href} data-nav-active={active ? "true" : undefined} aria-current={i.href === shownHref ? "page" : undefined} title={i.label} className={`shell-page ${active ? "shell-page-active" : ""}`}>
          <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
          <span className="min-w-0 truncate">{i.label}</span>
        </Link>
      </li>
    );
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

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
      <form action={switchAction} className="menu-pop space-y-2 border-t border-white/[0.12] px-3 pb-3 pt-2">
        <label className="sr-only" htmlFor="shell-org">Organisation</label>
        <select id="shell-org" name="organisationId" defaultValue={org.currentId ?? ""} className="w-full rounded-[6px] border border-white/25 bg-[#0c2a44] px-2 py-1.5 text-[13px] text-white">
          {org.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button type="submit" className="w-full rounded-[6px] bg-white/[0.12] py-1.5 text-[13px] text-white transition-colors hover:bg-white/20">Switch</button>
      </form>
    </details>
  );
}

function SidebarBody({ portals, items, org, person, switchAction, signOutAction, logo }: SidebarProps) {
  return (
    <>
      <div className="shrink-0 px-[18px] pb-5 pt-[18px]">
        <Link href="/overview" aria-label="CSB All in One Platform home" className="block w-fit no-underline">{logo}</Link>
        <p className="mt-2.5 whitespace-nowrap text-[14px] leading-tight text-white">Care Solution Bureau CIC</p>
      </div>
      <PortalNav portals={portals} items={items} branch={org?.branch ?? null} />
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
          <button type="submit" className="flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left text-[14px] text-white transition-colors hover:bg-white/[0.08]">
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
export function MobileMenu({ light = false, ...props }: SidebarProps & { light?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const pendingHref = usePendingHref();
  const dialog = useRef<HTMLDialogElement>(null);
  // Close as soon as a page is chosen, so the progress bar and the arriving page are in view.
  useEffect(() => setOpen(false), [path, pendingHref]);
  // The menu's contents stay mounted while it slides away, then leave the page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setMounted(true);
      d.showModal();
    }
    if (!open && d.open) d.close();
    if (open) return;
    const t = setTimeout(() => setMounted(false), MOTION.base + 20);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`flex h-9 w-9 items-center justify-center rounded-[6px] md:hidden ${light ? "text-white hover:bg-white/10" : "text-[#0b1530] hover:bg-black/5"}`} aria-label="Open menu" aria-haspopup="dialog">
        <List size={22} aria-hidden="true" />
      </button>
      <dialog ref={dialog} onClose={() => setOpen(false)} aria-label="Menu" className="shell-drawer m-0 h-full max-h-none w-[280px] max-w-[85vw] p-0">
        <div className="shell-sidebar flex h-full flex-col">
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
          {open || mounted ? <SidebarBody {...props} /> : null}
        </div>
      </dialog>
    </>
  );
}

/** Ctrl+K or ⌘K jumps to the global search, as the shortcut hint in the search box says. */
export function SearchShortcut({ targetId }: { targetId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A page with its own search (the HR Hub's command palette) has already taken the shortcut.
      if (e.defaultPrevented) return;
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

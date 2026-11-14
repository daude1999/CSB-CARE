"use client";
import Link from "@/components/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell, CalendarDots, CaretDown, CaretRight, ChartBar, FileText, GearSix, House, List, MagnifyingGlass, SignOut,
  SlidersHorizontal, Sparkle, SquaresFour, UsersThree, X,
} from "@phosphor-icons/react";
import { HUB_SEARCH_EVENT, isHubPath, portalForPath, type PortalId } from "@/lib/portals";
import { activeEntryHref, splitHref } from "@/lib/navigation";
import { COORDINATOR_SLOT, OPEN_COMMAND_EVENT, OPEN_COORDINATOR_EVENT } from "@/lib/shell-slots";
import { usePendingHref } from "@/components/navigation-progress";
import { groupPages, type ShellItem, type ShellOrganisation, type ShellPerson, type ShellPortal } from "@/components/portal-switcher";

/**
 * The Harbour application shell (docs/design/harbour, owner's decision of 13 Nov 2026): a 76px icon rail, the full
 * menu sliding out beside it, and a 48px top bar. Below 1024px the rail hides and the same menu opens as a drawer from
 * the top bar's menu button. Which modules and pages appear is decided on the server (portalsFor and each module's
 * menu builder); this file only draws them.
 */

/** The shorter module names the Harbour menu and breadcrumb use. The portals keep their full names everywhere else. */
export const MODULE_NAME: Record<PortalId, string> = {
  overview: "Overview",
  rota: "Care & Rostering",
  hr: "HR & Workforce",
  policy: "Policy & Compliance",
  reporting: "Reporting & Analytics",
  admin: "Administration",
};

const RAIL: { id: PortalId; label: string; icon: React.ReactNode }[] = [
  { id: "rota", label: "Rostering", icon: <CalendarDots size={20} /> },
  { id: "hr", label: "Staff", icon: <UsersThree size={20} /> },
  { id: "policy", label: "Policies", icon: <FileText size={20} /> },
  { id: "reporting", label: "Reporting", icon: <ChartBar size={20} /> },
  { id: "admin", label: "Admin", icon: <SlidersHorizontal size={20} /> },
];

/** The order modules are listed in the menu. */
const ORDER: PortalId[] = ["rota", "hr", "policy", "reporting", "admin"];

type Expanded = PortalId | "all" | null;
type MenuState = { open: boolean; expanded: Expanded; show: (expanded: Expanded, opener?: HTMLElement | null) => void; close: () => void };
const MenuContext = createContext<MenuState | null>(null);
const useMenu = () => useContext(MenuContext)!;

export type HarbourShellProps = {
  portals: ShellPortal[];
  items: Partial<Record<string, ShellItem[]>>;
  org: ShellOrganisation | null;
  person: ShellPerson;
  unread: number;
  /** The AI CSB Coordinator is available to this person (its panel is mounted by the layout). */
  coordinator: boolean;
  /** Where the rail's Settings button goes, or null when this person has no settings page. */
  settingsHref: string | null;
  switchAction: (fd: FormData) => Promise<void>;
  signOutAction: () => Promise<void>;
};

/** Holds the menu's open state for the rail, the menu itself and the top bar's menu button. */
export function HarbourMenuProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean; expanded: Expanded }>({ open: false, expanded: null });
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((expanded: Expanded, from?: HTMLElement | null) => {
    opener.current = from ?? null;
    setState((s) => (s.open && s.expanded === expanded ? { open: false, expanded } : { open: true, expanded }));
  }, []);
  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);
  return <MenuContext.Provider value={{ ...state, show, close }}>{children}</MenuContext.Provider>;
}

/** Which page entry is current: the page being opened as soon as a link is clicked, otherwise the page on screen. */
function useActive(items: Partial<Record<string, ShellItem[]>>) {
  const path = usePathname();
  const params = useSearchParams();
  const pending = usePendingHref();
  const target = pending ? splitHref(pending) : { path, params };
  const entries = Object.values(items).flatMap((x) => x ?? []).filter((i) => !i.planned);
  return { path: target.path, params: target.params, shownPath: path, href: activeEntryHref(entries, target.path, target.params), entries };
}

function railActive(path: string): string {
  if (path === "/notifications" || path.startsWith("/notifications/")) return "alerts";
  return portalForPath(path);
}

/** The 76px icon rail (1024px and wider). */
export function IconRail({ portals, unread, coordinator, settingsHref }: HarbourShellProps) {
  const menu = useMenu();
  const path = usePathname();
  const pending = usePendingHref();
  const on = menu.open && menu.expanded ? (menu.expanded === "all" ? "all" : menu.expanded) : railActive(pending ? splitHref(pending).path : path);
  const has = new Set(portals.map((p) => p.id));
  const overview = portals.find((p) => p.id === "overview");
  return (
    <nav aria-label="Modules" className="hb-rail print:hidden" data-testid="icon-rail">
      {/* The ClearCare mark from the approved reference (a navy 40px square with "CC"). */}
      <Link href="/overview" className="hb-rail-logo" aria-label="Overview" title="ClearCare home" data-testid="rail-logo">CC</Link>
      {overview ? (
        <Link href="/overview" className="hb-rail-b" data-hb-module="overview" data-on={on === "overview" && !menu.open ? "" : undefined} aria-current={path === "/overview" ? "page" : undefined} title="Home" onClick={() => menu.open && menu.close()}>
          <span className="hb-rail-i"><House size={20} aria-hidden="true" /></span><span className="hb-rail-t">Home</span>
        </Link>
      ) : null}
      <Link href="/notifications" className="hb-rail-b" data-on={on === "alerts" ? "" : undefined} title={unread ? `Alerts, ${unread} unread` : "Alerts"} aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"} onClick={() => menu.open && menu.close()}>
        <span className="hb-rail-i"><Bell size={20} aria-hidden="true" />{unread ? <i className="hb-rail-bd" aria-hidden="true">{unread > 99 ? "99+" : unread}</i> : null}</span><span className="hb-rail-t" aria-hidden="true">Alerts</span>
      </Link>
      {RAIL.filter((r) => has.has(r.id)).map((r) => (
        // A link to the module's home, so the rail still navigates with scripts switched off; with scripts it opens
        // the menu at that module's pages instead (a modified click still opens the home page in a new tab).
        <a
          key={r.id}
          href={portals.find((p) => p.id === r.id)!.home}
          role="button"
          className="hb-rail-b"
          data-on={on === r.id ? "" : undefined}
          aria-expanded={menu.open && menu.expanded === r.id}
          aria-controls="hb-menu"
          title={MODULE_NAME[r.id]}
          aria-label={`${MODULE_NAME[r.id]} menu`}
          data-rail={r.id}
          // Each module's button carries its colour (owner's request, 13 Nov 2026): a tile in the module colour.
          data-hb-module={r.id}
          // With scripts on, the click opens the menu rather than the page, so the page-loading signal must not start.
          data-no-progress=""
          onKeyDown={(e) => {
            if (e.key === " ") {
              e.preventDefault();
              menu.show(r.id, e.currentTarget);
            }
          }}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            menu.show(r.id, e.currentTarget);
          }}
        >
          <span className="hb-rail-i" aria-hidden="true">{r.icon}</span><span className="hb-rail-t" aria-hidden="true">{r.label}</span>
        </a>
      ))}
      <button type="button" className="hb-rail-b" data-on={on === "all" ? "" : undefined} aria-expanded={menu.open && menu.expanded === "all"} aria-controls="hb-menu" title="All pages" aria-label="All pages" data-rail="all" onClick={(e) => menu.show("all", e.currentTarget)}>
        <span className="hb-rail-i" aria-hidden="true"><SquaresFour size={20} /></span><span className="hb-rail-t" aria-hidden="true">All pages</span>
      </button>
      <span className="flex-1" />
      {/* The AI CSB Coordinator launcher draws its rail button here (src/components/coordinator/ai-launcher.tsx). */}
      {coordinator ? <span id={COORDINATOR_SLOT} className="contents" /> : null}
      {settingsHref ? (
        <Link href={settingsHref} className="hb-rail-b" title="Settings" aria-label="Settings" onClick={() => menu.open && menu.close()}>
          <span className="hb-rail-i" aria-hidden="true"><GearSix size={20} /></span><span className="hb-rail-t" aria-hidden="true">Settings</span>
        </Link>
      ) : null}
    </nav>
  );
}

/** The top bar's menu button (below 1024px), which opens the menu as a drawer. */
export function MenuButton() {
  const menu = useMenu();
  return (
    <button type="button" className="hb-ib lg:hidden" aria-label="Open menu" title="Menu" aria-haspopup="dialog" aria-expanded={menu.open} aria-controls="hb-menu" onClick={(e) => menu.show(null, e.currentTarget)}>
      <List size={20} aria-hidden="true" />
    </button>
  );
}

/** The full navigation tree: closed by default, slides out from the rail; a drawer below 1024px. */
export function MenuFlyout(props: HarbourShellProps) {
  const { portals, items, org, person, unread, coordinator, switchAction, signOutAction } = props;
  const menu = useMenu();
  const active = useActive(items);
  const panel = useRef<HTMLElement>(null);
  const currentPortal = portalForPath(active.path);
  // Which modules are open in the tree: the clicked one (or every one for "All pages"); otherwise the current module.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  useEffect(() => setToggled({}), [menu.expanded, menu.open]);
  const isOpen = (id: PortalId) => toggled[id] ?? (menu.expanded === "all" || (menu.expanded ?? currentPortal) === id);

  // Picking a page closes the menu.
  const path = usePathname();
  const pending = usePendingHref();
  const { open, close } = menu;
  const last = useRef(path);
  useEffect(() => {
    if (last.current === path && !pending) return;
    last.current = path;
    if (open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pending]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      // Focus stays inside the open menu, as in any dialog.
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), summary, select, input")].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!panel.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the menu so it can be used from the keyboard straight away.
    const first = panel.current?.querySelector<HTMLElement>(menu.expanded && menu.expanded !== "all" ? `[data-module-toggle="${menu.expanded}"]` : "a, button");
    first?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, menu.expanded]);

  const modules = ORDER.map((id) => portals.find((p) => p.id === id)).filter((p): p is ShellPortal => Boolean(p));
  const pageCount = modules.reduce((n, p) => n + Math.max(1, (items[p.id] ?? []).filter((i) => !i.planned).length), 0);
  const overview = portals.find((p) => p.id === "overview");
  // A module picked on the icon rail shows that module's pages on their own (owner's request, 14 Nov 2026); "All pages",
  // the phone's menu button and the closed menu keep the full list.
  const focused = open && menu.expanded && menu.expanded !== "all" ? modules.find((p) => p.id === menu.expanded) ?? null : null;
  return (
    <>
      {/* Clicking outside closes the menu; keyboard users have Escape and the menu's own Close button. */}
      <div className="hb-scrim print:hidden" data-open={open ? "" : undefined} aria-hidden="true" onClick={close} />
      <aside ref={panel} id="hb-menu" className="hb-fly print:hidden" data-open={open ? "" : undefined} role={open ? "dialog" : undefined} aria-modal={open ? "true" : undefined} aria-label="Menu" inert={!open} data-testid="harbour-menu">
        <div className="hb-fly-top">
          <div className="flex items-start gap-1">
            {org ? <OrgSwitcher org={org} switchAction={switchAction} /> : <p className="hb-org"><span className="hb-org-t">CSB</span><span className="min-w-0"><b>CSB platform</b><small>Administration</small></span></p>}
            <button type="button" className="hb-ib lg:hidden" aria-label="Close menu" title="Close menu" onClick={close}><X size={18} aria-hidden="true" /></button>
          </div>
          <button type="button" className="hb-jump" onClick={() => { close(); window.dispatchEvent(new Event(OPEN_COMMAND_EVENT)); }}>
            <MagnifyingGlass size={16} aria-hidden="true" />Search or jump to<span className="hb-kbd" aria-label="Control K">Ctrl K</span>
          </button>
        </div>
        <nav aria-label="Main" className="hb-fly-nav">
          {focused ? (
            <div data-testid="module-menu" data-hb-module={focused.id}>
              <Link href={focused.home} className="hb-fly-mod" data-module-toggle={focused.id} data-portal-home="" data-portal={focused.id}>
                <span className="hb-mt" style={{ "--mc": focused.colour } as React.CSSProperties} aria-hidden="true">{focused.icon}</span>
                <span className="min-w-0 flex-1"><b className="block truncate">{MODULE_NAME[focused.id]}</b><small className="block">Open the module home</small></span>
                <CaretRight size={14} aria-hidden="true" />
              </Link>
              {(items[focused.id] ?? []).filter((i) => !i.planned).length ? (
                <PageTree id={`hb-tree-${focused.id}`} testId="portal-pages" pages={items[focused.id] ?? []} activeHref={active.href} shownHref={activeEntryHref(active.entries, active.shownPath, new URLSearchParams())} />
              ) : (
                <ul id={`hb-tree-${focused.id}`} className="hb-tree" data-testid="portal-pages">
                  <li><Link href={focused.home} className="hb-ti" data-on={active.path === focused.home ? "" : undefined}>{MODULE_NAME[focused.id]} home</Link></li>
                </ul>
              )}
              <button type="button" className="hb-sbi mt-2" onClick={(e) => menu.show("all", e.currentTarget)} data-testid="menu-show-all"><SquaresFour size={16} aria-hidden="true" />Show all modules</button>
            </div>
          ) : (
          <ul data-testid="portal-switcher" className="space-y-[1px]">
            {overview ? (
              <li><Link href="/overview" className="hb-sbi" data-portal-home="" data-portal="overview" data-on={active.path === "/overview" ? "" : undefined} aria-current={active.shownPath === "/overview" ? "page" : undefined}><House size={16} aria-hidden="true" />Overview</Link></li>
            ) : null}
            <li><Link href="/notifications" className="hb-sbi" data-on={active.path === "/notifications" ? "" : undefined}><Bell size={16} aria-hidden="true" />Notifications{unread ? <span className="hb-cnt" data-bad="">{unread}<span className="sr-only"> unread</span></span> : null}</Link></li>
            <li><button type="button" className="hb-sbi" data-on={menu.expanded === "all" ? "" : undefined} onClick={() => setToggled(Object.fromEntries(modules.map((m) => [m.id, true])))}><SquaresFour size={16} aria-hidden="true" />All pages<span className="hb-cnt">{pageCount}</span></button></li>
            <li className="hb-sb-h" aria-hidden="true">Modules</li>
            {modules.map((p) => {
              const pages = (items[p.id] ?? []).filter((i) => !i.planned);
              const expanded = isOpen(p.id);
              const treeId = `hb-tree-${p.id}`;
              return (
                <li key={p.id} data-hb-module={p.id}>
                  <div className="flex items-center gap-1">
                    {/* The module's own home stays one click away; the chevron opens and folds its pages. */}
                    <button type="button" className="hb-sbi flex-1" aria-expanded={expanded} aria-controls={treeId} data-module-toggle={p.id} onClick={() => setToggled((t) => ({ ...t, [p.id]: !expanded }))}>
                      <span className="hb-mt" style={{ "--mc": p.colour } as React.CSSProperties} aria-hidden="true">{p.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{MODULE_NAME[p.id]}</span>
                      {expanded ? <CaretDown size={14} aria-hidden="true" className="text-[var(--hb-ink-3)]" /> : <CaretRight size={14} aria-hidden="true" className="text-[var(--hb-ink-3)]" />}
                    </button>
                    {/* Kept for the portal list's existing behaviour: a direct link to the module's home page. */}
                    <Link href={p.home} className="sr-only focus:not-sr-only focus:rounded-[6px] focus:px-2 focus:text-[12px]" data-portal-home="" data-portal={p.id}>Open {MODULE_NAME[p.id]} home</Link>
                  </div>
                  {expanded ? (
                    pages.length ? (
                      <PageTree id={treeId} testId={p.id === currentPortal ? "portal-pages" : undefined} pages={items[p.id] ?? []} activeHref={active.href} shownHref={activeEntryHref(active.entries, active.shownPath, new URLSearchParams())} />
                    ) : (
                      <ul id={treeId} className="hb-tree" data-testid={p.id === currentPortal ? "portal-pages" : undefined}>
                        <li><Link href={p.home} className="hb-ti" data-on={active.path === p.home ? "" : undefined}>{MODULE_NAME[p.id]} home</Link></li>
                      </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
          )}
        </nav>
        <div className="hb-fly-foot space-y-2">
          {coordinator ? (
            <button type="button" className="flex h-9 w-full items-center gap-2.5 rounded-[8px] bg-[#15181d] px-2.5 text-[13.5px] font-semibold text-white hover:bg-[#262a31]" onClick={() => { close(); window.dispatchEvent(new Event(OPEN_COORDINATOR_EVENT)); }}>
              <Sparkle size={16} weight="fill" aria-hidden="true" />AI CSB Coordinator
            </button>
          ) : null}
          <div className="hb-me">
            <span className="hb-av hb-av-32" aria-hidden="true">{person.initials}</span>
            <span className="min-w-0 flex-1"><b className="truncate">{person.name}</b><small className="truncate">{person.role}</small></span>
            <form action={signOutAction}>
              <button type="submit" className="hb-ib" aria-label="Sign out" title="Sign out"><SignOut size={17} aria-hidden="true" /></button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

const hasPage = (rows: ShellItem[], href?: string) => Boolean(href) && rows.some((r) => !r.planned && r.href === href);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * One module's pages in the menu, keeping the page list's existing behaviour: group headings, groups that fold
 * (opening on their own pages), a folded "More" list, planned pages labelled as not built yet, and a separated foot entry.
 */
function PageTree({ id, testId, pages, activeHref, shownHref }: { id: string; testId?: string; pages: ShellItem[]; activeHref?: string; shownHref?: string }) {
  const groups = groupPages(pages);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, byDefault: boolean, holdsActive: boolean) => toggled[key] ?? (byDefault || holdsActive);
  const flip = (key: string, now: boolean) => setToggled((t) => ({ ...t, [key]: !now }));

  const item = (i: ShellItem) => {
    if (i.planned)
      return (
        <li key={i.label}>
          <span className="hb-ti cursor-default opacity-60" title={`${i.label}: planned, not built yet`}>
            <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
            <span className="min-w-0 flex-1 truncate">{i.label}</span><small className="text-[11px]">Planned</small>
          </span>
        </li>
      );
    const on = i.href === activeHref;
    return (
      <li key={i.href} className={i.separated ? "mt-1.5 border-t border-[var(--hb-line)] pt-1.5" : undefined} data-nav-separated={i.separated ? "" : undefined}>
        <Link href={i.href} className="hb-ti" data-on={on ? "" : undefined} data-nav-active={on ? "true" : undefined} aria-current={i.href === shownHref ? "page" : undefined} title={i.label}>
          <span aria-hidden="true" className="flex w-[14px] shrink-0 justify-center">{i.icon}</span>
          <span className={i.wrap ? "min-w-0 flex-1 leading-[15px]" : "min-w-0 flex-1 truncate"}>{i.label}</span>
        </Link>
      </li>
    );
  };
  const more = (group: string, m: { name: string; rows: ShellItem[] }) => {
    const key = `${group}/more`;
    const open = isOpen(key, false, hasPage(m.rows, activeHref));
    const listId = `${id}-more-${slug(group)}`;
    return (
      <li key={key}>
        <button type="button" className="hb-ti w-full italic" aria-expanded={open} aria-controls={listId} data-nav-more={m.name} onClick={() => flip(key, open)}>
          {open ? <CaretDown size={12} aria-hidden="true" className="w-[14px] shrink-0" /> : <CaretRight size={12} aria-hidden="true" className="w-[14px] shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{m.name} ({m.rows.length})</span>
        </button>
        <ul id={listId} hidden={!open}>{m.rows.map(item)}</ul>
      </li>
    );
  };

  return (
    <ul id={id} className="hb-tree" data-testid={testId}>
      {groups.map((g, n) => {
        if (!g.fold) {
          return [
            g.name ? <li key={`g-${g.name}`} className="hb-tg" aria-hidden="true">{g.name}</li> : null,
            ...g.rows.map(item),
            g.more && g.more.rows.length ? more(g.name ?? `group-${n}`, g.more) : null,
          ];
        }
        const name = g.name ?? `group-${n}`;
        const open = isOpen(name, g.fold === "open", hasPage([...g.rows, ...(g.more?.rows ?? [])], activeHref));
        const listId = `${id}-group-${slug(name)}`;
        return (
          <li key={`g-${name}`}>
            <button type="button" className="hb-tg flex w-full items-center text-left" aria-expanded={open} aria-controls={listId} data-nav-group={name} onClick={() => flip(name, open)}>
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {open ? <CaretDown size={11} aria-hidden="true" /> : <CaretRight size={11} aria-hidden="true" />}
            </button>
            <ul id={listId} hidden={!open}>
              {g.rows.map(item)}
              {g.more && g.more.rows.length ? more(name, g.more) : null}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** The organisation card: switching is offered only when the person belongs to more than one organisation. */
function OrgSwitcher({ org, switchAction }: { org: ShellOrganisation; switchAction: (fd: FormData) => Promise<void> }) {
  const code = org.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "ORG";
  const body = (
    <>
      <span className="hb-org-t" aria-hidden="true">{code}</span>
      <span className="min-w-0 flex-1"><b className="truncate">{org.name}</b><small className="truncate">{org.branch ? `${org.branch} branch` : "All branches"}</small></span>
    </>
  );
  if (org.options.length < 2) return <div className="hb-org" title={org.branch ? `${org.name} · ${org.branch}` : org.name}>{body}</div>;
  return (
    <details className="group relative min-w-0 flex-1">
      <summary className="hb-org cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label="Switch organisation">
        {body}<CaretDown size={13} aria-hidden="true" className="text-[var(--hb-ink-3)] transition-transform group-open:rotate-180" />
      </summary>
      <form action={switchAction} className="menu-pop space-y-2 px-1.5 pb-2 pt-1">
        <label className="sr-only" htmlFor="shell-org">Organisation</label>
        <select id="shell-org" name="organisationId" defaultValue={org.currentId ?? ""} className="input py-1.5 text-[13px]">
          {org.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button type="submit" className="hb-btn w-full">Switch</button>
      </form>
    </details>
  );
}

/** The breadcrumb: module icon, module name and the page (with its sub-page where the entry has sub-tabs). */
export function Breadcrumb({ portals, items }: Pick<HarbourShellProps, "portals" | "items">) {
  const active = useActive(items);
  const id = portalForPath(active.path);
  const portal = portals.find((p) => p.id === id);
  const entry = active.entries.find((e) => e.href === active.href);
  const tab = entry?.tabs ? activeEntryHref(entry.tabs, active.path, active.params) : undefined;
  const tabLabel = tab ? entry!.tabs!.find((t) => t.href === tab)?.label : undefined;
  const page = entry ? (tabLabel && tabLabel !== entry.label ? `${entry.label} · ${tabLabel}` : entry.label) : null;
  // The Overview's page heading is the company name in the top bar, as it was in the Overview's own header.
  if (id === "overview" && active.shownPath === "/overview")
    return (
      <div className="hb-crumbs" data-testid="breadcrumb">
        {portal ? <span className="hb-mt" style={{ "--mc": portal.colour } as React.CSSProperties} aria-hidden="true">{portal.icon}</span> : null}
        <h1 className="truncate text-[14px] font-semibold text-[var(--hb-ink)] max-sm:sr-only">Care Solution Bureau CIC</h1>
      </div>
    );
  return (
    <div className="hb-crumbs" data-testid="breadcrumb">
      {portal ? <span className="hb-mt" style={{ "--mc": portal.colour } as React.CSSProperties} aria-hidden="true">{portal.icon}</span> : null}
      {page ? (
        <>
          <span className="hidden truncate sm:inline">{MODULE_NAME[id]}</span>
          <CaretRight size={13} aria-hidden="true" className="hidden shrink-0 text-[var(--hb-ink-4)] sm:block" />
          <b>{page}</b>
        </>
      ) : (
        <b>{MODULE_NAME[id]}</b>
      )}
    </div>
  );
}

/**
 * The top bar's search icon (Harbour reference: a plain icon between the bell and Recent). It opens the existing search
 * in a small box under the bar: on HR pages the HR Hub's own search; on rostering pages service users, team members
 * and visit references; everywhere else the policy library. Enter submits it; Escape or a click elsewhere closes it.
 */
export function SearchButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (isHubPath(path)) {
    return (
      <button type="button" className="hb-ib" aria-label="Search people or documents" title="Search people or documents" onClick={() => window.dispatchEvent(new Event(HUB_SEARCH_EVENT))}>
        <MagnifyingGlass size={18} aria-hidden="true" />
      </button>
    );
  }
  const rota = path === "/rota" || path.startsWith("/rota/");
  const action = rota ? "/rota/search" : "/policies";
  const label = rota ? "Search rostering" : "Search policies";
  return (
    <div ref={box} className="relative">
      <button ref={button} type="button" className="hb-ib" aria-label={label} title={label} aria-expanded={open} aria-controls="hb-search-pop" data-testid="top-search" onClick={() => setOpen((o) => !o)}>
        <MagnifyingGlass size={18} aria-hidden="true" />
      </button>
      {open ? (
        <form id="hb-search-pop" action={action} method="get" role="search" className="hb-search-pop">
          <label htmlFor="global-search" className="hb-search">
            <MagnifyingGlass size={16} aria-hidden="true" className="shrink-0" />
            <span className="sr-only">{label}</span>
            <input id="global-search" name="q" type="search" autoFocus placeholder={rota ? "Search service users, staff, references..." : "Search policies, categories, keywords…"} className="h-full min-w-0 flex-1 bg-transparent text-[var(--hb-ink)] placeholder:text-[var(--hb-ink-4)] focus:outline-none" />
          </label>
        </form>
      ) : null}
    </div>
  );
}

/** Sub-tabs under the top bar for a menu entry with more than one page (Care & Rostering's grouped pages). */
export function ShellSubTabs({ items }: { items: Partial<Record<string, ShellItem[]>> }) {
  const active = useActive(items);
  const entry = active.entries.find((e) => e.href === active.href);
  if (!entry?.tabs || entry.tabs.length < 2) return null;
  const current = activeEntryHref(entry.tabs, active.path, active.params);
  const shown = activeEntryHref(entry.tabs, active.shownPath, active.params);
  const moduleId = portalForPath(active.path);
  return (
    <nav aria-label={`${entry.label} pages`} className="hb-stabs print:hidden" data-hb-module={moduleId} data-testid={entry.tabsKey ? `rota-tabs-${entry.tabsKey}` : "sub-tabs"}>
      <span className="hb-stabs-t" aria-hidden="true">{entry.label}</span>
      {entry.tabs.map((t) => (
        <Link key={t.href} href={t.href} className="hb-stab" aria-current={t.href === shown ? "page" : undefined} data-pending={t.href === current && t.href !== shown ? "" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

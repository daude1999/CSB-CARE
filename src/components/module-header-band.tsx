"use client";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { CaretDown, CaretRight, CalendarDots, ChartBar, GearSix, House, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { portalById, portalForPath, type PortalId } from "@/lib/portals";

export type Crumb = { label: string; href?: string };

/** Each module's sidebar icon, shown white at 22px in the header's chip. */
const MODULE_ICON: Record<PortalId, (p: { size: number }) => ReactNode> = {
  overview: (p) => <House {...p} />,
  policy: (p) => <ShieldCheck {...p} />,
  rota: (p) => <CalendarDots {...p} />,
  hr: (p) => <UsersThree {...p} />,
  reporting: (p) => <ChartBar {...p} />,
  admin: (p) => <GearSix {...p} />,
};

export type ModuleHeaderProps = {
  title: ReactNode;
  /** The page's name in the breadcrumb, when `title` is not plain text. */
  page?: string;
  /** Levels between the module and this page (a detail page's list), each with its address. */
  crumbs?: Crumb[];
  /** One line saying what the page is for. */
  description?: ReactNode;
  /** The page's actions on the right. Give the main one `.btn-primary` (or `.module-primary`); the rest are quieter. */
  actions?: ReactNode;
  /** A second row inside the band, for a page's own controls (the Rota's date navigation). */
  children?: ReactNode;
  /** Puts `children` on the right of the title, in the same row, wrapping below it only when there is no room. */
  inline?: boolean;
  /** Replaces the module's icon in the chip (the Rota Dashboard shows the home icon, as its sidebar entry does). */
  icon?: ReactNode;
  /** Shown under the band, on the page: the page's tabs. */
  tabs?: ReactNode;
  /** Overrides the module worked out from the address. */
  module?: PortalId;
  testId?: string;
  titleId?: string;
};

/**
 * The one page header for every module (owner's approved redesign, 10 Nov 2026): a band in the module colour with the
 * module's icon, the breadcrumb "Module › Page", the page title, an optional one-line description and the page's
 * actions. It replaces the centred title bar with its Back link, the Policy breadcrumb header, the HR heading and the
 * Rota headers. The breadcrumb and the top bar's history arrows do the job of the old Back link.
 */
export function ModuleHeader({ title, page, crumbs = [], description, actions, children, inline = false, icon, tabs, module, testId = "module-header", titleId }: ModuleHeaderProps) {
  const path = usePathname() ?? "/";
  const portal = portalById(module ?? portalForPath(path));
  const pageName = page ?? (typeof title === "string" ? title : undefined);
  const home = portal.id === "overview" ? null : portal;
  return (
    <header className="mh" data-testid={testId} data-module-header={portal.id}>
      <div className="mh-band" data-testid="title-bar">
        <span className="mh-chip" aria-hidden="true">{icon ?? MODULE_ICON[portal.id]({ size: 22 })}</span>
        <div className="mh-main">
          <nav aria-label="Breadcrumb">
            <ol className="mh-crumbs">
              {/* The module name is plain text: not everyone who can open a page in a module can open its home page (a
                  coordinator reaches Rota Reports but not Analytics). The sidebar is the way round a module. */}
              {home ? <Crumbed><span>{home.name}</span></Crumbed> : null}
              {crumbs.filter((c) => c.label !== pageName).map((c, i) => (
                <Crumbed key={i}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}</Crumbed>
              ))}
              {pageName ? <li aria-current="page">{pageName}</li> : null}
            </ol>
          </nav>
          <h1 className="mh-title" id={titleId}>{title}</h1>
          {description ? <p className="mh-desc">{description}</p> : null}
        </div>
        {actions ? <div className="mh-actions"><BandActions>{actions}</BandActions></div> : null}
        {children ? <div className={inline ? "mh-row mh-row-inline" : "mh-row"}>{children}</div> : null}
      </div>
      {tabs ? <div className="mt-2">{tabs}</div> : null}
    </header>
  );
}

function Crumbed({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {children}
      <CaretRight size={10} weight="bold" aria-hidden="true" />
    </li>
  );
}

/** The page's own buttons, flattened out of fragments so they can be counted. */
function flatten(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => (isValidElement(child) && child.type === Fragment ? flatten((child as ReactElement<{ children?: ReactNode }>).props.children) : [child]));
}

function isMain(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const cls = (node.props as { className?: unknown }).className;
  return typeof cls === "string" && /\b(btn-primary|btn-teal|pc-btn|pl-btn-primary|module-primary|mh-btn-primary)\b/.test(cls);
}

/**
 * ClearCare header band (owner's design, 12 Nov 2026): up to four of the page's buttons sit in the band; when a page
 * has more, the main ones stay and the rest move into a "More" menu. They are the same buttons, not copies, so each
 * keeps its link, form and permission check.
 */
function BandActions({ children }: { children: ReactNode }) {
  const items = flatten(children);
  if (items.length <= 4) return <>{children}</>;
  const keep = new Set<number>();
  items.forEach((n, i) => { if (isMain(n)) keep.add(i); });
  for (let i = 0; i < items.length && keep.size < 3; i++) keep.add(i);
  const shown = items.filter((_, i) => keep.has(i));
  const more = items.filter((_, i) => !keep.has(i));
  return (
    <>
      {items.map((n, i) => (keep.has(i) && !isMain(n) ? <Fragment key={i}>{n}</Fragment> : null))}
      <details className="mh-more relative" data-testid="band-more">
        <summary className="mh-btn list-none [&::-webkit-details-marker]:hidden">More <CaretDown size={13} weight="bold" aria-hidden="true" /></summary>
        <div className="mh-more-menu menu-pop absolute right-0 top-[calc(100%+6px)] z-40 flex min-w-[220px] flex-col gap-1 rounded-[12px] border border-cc-line bg-white p-2 shadow-lg">
          {more.map((n, i) => <Fragment key={i}>{n}</Fragment>)}
        </div>
      </details>
      {shown.map((n, i) => (isMain(n) ? <Fragment key={`m${i}`}>{n}</Fragment> : null))}
    </>
  );
}

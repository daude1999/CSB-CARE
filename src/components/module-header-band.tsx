"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { CaretRight, CalendarDots, ChartBar, GearSix, House, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";
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
export function ModuleHeader({ title, page, crumbs = [], description, actions, children, tabs, module, testId = "module-header", titleId }: ModuleHeaderProps) {
  const path = usePathname() ?? "/";
  const portal = portalById(module ?? portalForPath(path));
  const pageName = page ?? (typeof title === "string" ? title : undefined);
  const home = portal.id === "overview" ? null : portal;
  return (
    <header className="mh" data-testid={testId} data-module-header={portal.id}>
      <div className="mh-band" data-testid="title-bar">
        <span className="mh-chip" aria-hidden="true">{MODULE_ICON[portal.id]({ size: 22 })}</span>
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
        {actions ? <div className="mh-actions">{actions}</div> : null}
        {children ? <div className="mh-row">{children}</div> : null}
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

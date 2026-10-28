"use client";
import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { CaretDown } from "@phosphor-icons/react";
import { portalById, portalForPath, type Portal } from "@/lib/portals";
import { SideNav, type SideNavItem, type SideNavSection } from "@/components/side-nav";
import { NavLink } from "@/components/nav-link";

type Later = { code: string; name: string; summary: string; planned: string };

function Badge({ code, dim = false, size = 26 }: { code: string; dim?: boolean; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center rounded-[5px] text-[11.5px] font-bold text-white ${dim ? "bg-slate-300" : "bg-navy-900"}`}>
      {code}
    </span>
  );
}

function Status({ planned }: { planned?: string }) {
  return planned ? (
    <span className="ml-auto whitespace-nowrap rounded-full border border-dashed border-slate-400 bg-slate-100 px-2 text-[11.5px] font-medium leading-[20px] text-slate-600">Planned · {planned}</span>
  ) : (
    <span className="ml-auto whitespace-nowrap rounded-full bg-[#e3f4ea] px-2 text-[11.5px] font-medium leading-[20px] text-[#1f7a4d]">Working now</span>
  );
}

/** A link to a portal. A portal with its own look (the HR Hub) loads as a fresh page so the two style sheets never mix. */
function PortalAnchor({ portal, className, children }: { portal: Portal; className: string; children: React.ReactNode }) {
  return portal.separateApp ? <a href={portal.home} className={className}>{children}</a> : <Link href={portal.home} className={className}>{children}</Link>;
}

/** The portal button in the global header. It lists only the portals this person may open (decided on the server). */
export function PortalSwitcher({ portals, later }: { portals: Portal[]; later: readonly Later[] }) {
  const current = portalById(portalForPath(usePathname()));
  return (
    <details className="group relative shrink-0" data-testid="portal-switcher">
      <summary className="flex h-[40px] cursor-pointer list-none items-center gap-2 rounded-[6px] border-[1.5px] border-navy-900 bg-white pl-[7px] pr-3 text-[15.5px] font-medium text-navy-900 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Badge code={current.code} />
        <span className="max-w-[160px] truncate sm:max-w-none" data-testid="current-portal">{current.name}</span>
        <CaretDown size={11} weight="bold" aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="fixed inset-x-2 top-[58px] z-40 max-h-[calc(100vh-70px)] overflow-y-auto rounded-[8px] border border-slate-200 bg-white p-2 shadow-[0_16px_44px_rgb(10_28_54/0.28)] sm:absolute sm:inset-x-auto sm:left-0 sm:top-[46px] sm:w-[520px]">
        <p className="mx-2.5 mb-1 mt-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-slate-500">Switch portal</p>
        <ul>
          {portals.map((p) => {
            const on = p.id === current.id;
            return (
              <li key={p.id}>
                <PortalAnchor portal={p} className={`flex items-center gap-3 rounded-[6px] px-2.5 py-2 no-underline hover:bg-slate-50 ${on ? "bg-[#edf8fd] outline outline-1 outline-teal-100" : ""}`}>
                  <Badge code={p.code} dim={Boolean(p.planned)} size={32} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-navy-900" aria-current={on ? "page" : undefined}>{p.name}</span>
                    <span className="hidden text-[12.5px] text-slate-500 sm:block">{p.summary}</span>
                  </span>
                  <Status planned={p.planned} />
                </PortalAnchor>
              </li>
            );
          })}
        </ul>
        {later.length ? (
          <>
            <p className="mx-2.5 mb-1 mt-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-slate-500">Coming later</p>
            {later.map((l) => (
              <div key={l.code} className="flex items-center gap-3 px-2.5 py-2">
                <Badge code={l.code} dim size={32} />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-navy-900">{l.name}</span>
                  <span className="hidden text-[12.5px] text-slate-500 sm:block">{l.summary}</span>
                </span>
                <Status planned={l.planned} />
              </div>
            ))}
          </>
        ) : null}
      </div>
    </details>
  );
}

/** The side menu for whichever portal the current page belongs to. */
export function PortalSideNav({ nav }: { nav: Partial<Record<string, SideNavSection[]>> }) {
  const current = portalById(portalForPath(usePathname()));
  return (
    <>
      <p className="border-t border-white/10 px-[14px] pb-1.5 pt-2.5 text-[11.5px] font-medium uppercase tracking-[0.1em] text-white/60" data-testid="portal-title">{current.name}</p>
      <SideNav sections={nav[current.id] ?? []} />
    </>
  );
}

/** Phone layout: the current portal's pages as a row that scrolls sideways. */
export function PortalMobileNav({ nav }: { nav: Partial<Record<string, SideNavSection[]>> }) {
  const current = portalById(portalForPath(usePathname()));
  const items: SideNavItem[] = (nav[current.id] ?? []).filter((s) => !s.planned).flatMap((s) => s.items);
  return (
    <nav className="overflow-x-auto border-b border-slate-200 bg-paper px-3 py-2 md:hidden" aria-label="Main">
      <div className="flex min-w-max gap-1">
        {items.map((n) => (
          <NavLink key={n.href} href={n.href} compact>{n.label}</NavLink>
        ))}
      </div>
    </nav>
  );
}

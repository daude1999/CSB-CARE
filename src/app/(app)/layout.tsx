import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Archive, Bell, BookOpenText, Broadcast, Buildings, ChartLine, ChatTeardropText, Checks, ClipboardText, Cpu, Flag, House, Pulse, Scales, Tray, UsersThree } from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";
import { cookies } from "next/headers";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { THEME_COOKIE, parseTheme } from "@/lib/themes";

type Icon = ComponentType<{ size?: number; weight?: "regular" | "duotone" | "bold" }>;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [memberships, unread, org] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.userId }, include: { organisation: true } }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId } }) : null,
  ]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const isPlatformAdmin = hasPlatformPermission(ctx, "sources.manage");
  const nav: { href: string; label: string; group: string; icon: Icon; show: boolean }[] = [
    { href: "/", label: "Overview", group: "Home", icon: House, show: true },
    { href: "/policies", label: "Policies & Procedures", group: "Policy management", icon: BookOpenText, show: true },
    { href: "/changes", label: "Regulatory Updates", group: "Policy management", icon: Broadcast, show: true },
    { href: "/queue", label: "Policy Change Queue", group: "Policy management", icon: Tray, show: hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author") },
    { href: "/requirements", label: "Requirements Register", group: "Policy management", icon: Scales, show: true },
    { href: "/audits", label: "Audits & Inspections", group: "Care operations", icon: ClipboardText, show: hasOrgPermission(ctx, "audit.conduct") },
    { href: "/actions", label: "Actions & Risks", group: "Care operations", icon: Flag, show: Boolean(ctx.organisationId) },
    { href: "/staff", label: "Staff & Training", group: "Care operations", icon: UsersThree, show: hasOrgPermission(ctx, "staff.view") },
    { href: "/evidence", label: "Evidence Library", group: "Care operations", icon: Archive, show: hasOrgPermission(ctx, "evidence.read") },
    { href: "/assistant", label: "AI Assistant", group: "Insights", icon: ChatTeardropText, show: hasOrgPermission(ctx, "assistant.use") },
    { href: "/reports", label: "Reports", group: "Insights", icon: ChartLine, show: hasOrgPermission(ctx, "report.view") || isPlatformAdmin },
    { href: "/admin/sources", label: "Source Monitoring", group: "Administration", icon: Pulse, show: isPlatformAdmin },
    { href: "/admin/jobs", label: "Background Jobs", group: "Administration", icon: Cpu, show: isPlatformAdmin },
    { href: "/settings", label: "Organisation Settings", group: "Administration", icon: Buildings, show: hasOrgPermission(ctx, "org.manage") },
  ];
  const visibleNav = nav.filter((n) => n.show);
  const navGroups = [...new Set(visibleNav.map((item) => item.group))].map((group) => ({ group, items: visibleNav.filter((item) => item.group === group) }));
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform administration";
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-navy-950 text-slate-200 md:flex">
        <Link href="/" aria-label="CSB home" className="block bg-white px-5 py-4">
          <Logo className="h-11 max-w-full" />
        </Link>
        <div className="h-[3px] bg-teal-400" aria-hidden="true" />
        <nav className="flex-1 space-y-6 overflow-y-auto pb-4 pt-5" aria-label="Main">
          {navGroups.map(({ group, items }) => (
            <div key={group}>
              {group !== "Home" ? <h2 className="mb-1.5 px-5 font-label text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{group}</h2> : null}
              <div>
                {items.map((n) => <NavLink key={n.href} href={n.href} icon={<n.icon size={17} />}>{n.label}</NavLink>)}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
          Starter content is not legal advice. AI output is a proposal for human review.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-paper/90 px-4 py-2.5 backdrop-blur sm:px-6 xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="mr-1 block md:hidden" aria-label="CSB home"><Logo className="h-9" /></Link>
            {memberships.length > 1 ? (
              <form action={switchOrgAction} className="flex items-center gap-2">
                <select name="organisationId" defaultValue={ctx.organisationId ?? ""} className="input w-auto py-1" aria-label="Organisation">
                  {memberships.map((m) => (
                    <option key={m.organisationId} value={m.organisationId}>{m.organisation.name}</option>
                  ))}
                </select>
                <button className="btn-secondary py-1" type="submit">Switch</button>
              </form>
            ) : (
              <span className="truncate font-serif text-[15px] font-semibold text-navy-900">{orgName}</span>
            )}
            {org?.isDemo ? <span className="hidden rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-[0.08em] text-slate-600 sm:inline">Sample workspace</span> : null}
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Link href="/acknowledgements" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-700 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Checks size={17} aria-hidden="true" /><span className="hidden lg:inline">My policies to read</span>
            </Link>
            <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-700 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Bell size={17} aria-hidden="true" /><span className="hidden lg:inline">Notifications</span>
              {unread ? <span className="min-w-[18px] rounded-full bg-teal-400 px-1 text-center font-mono text-[10px] font-semibold leading-[18px] text-navy-950">{unread}</span> : null}
            </Link>
            <ThemeSwitcher initial={theme} />
            <span className="mx-2 hidden h-5 w-px bg-slate-300 sm:block" aria-hidden="true" />
            <span className="hidden items-center gap-2 sm:flex">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 font-mono text-[11px] font-medium text-white">{ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
            </span>
            <span className="text-slate-700" data-testid="current-user">{ctx.userName}</span>
            <form action={logoutAction} className="ml-2">
              <button className="btn-secondary py-1 text-xs" type="submit">Sign out</button>
            </form>
          </div>
        </header>
        <nav className="overflow-x-auto border-b border-slate-200 bg-paper px-3 py-2 md:hidden" aria-label="Main">
          <div className="flex min-w-max gap-1">
            {visibleNav.map((n) => (
              <NavLink key={n.href} href={n.href} compact icon={<n.icon size={15} />}>{n.label}</NavLink>
            ))}
          </div>
        </nav>
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-10">{children}</main>
        {inlineJobsEnabled() ? <JobKicker /> : null}
      </div>
    </div>
  );
}

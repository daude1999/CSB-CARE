import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { SideNav, type SideNavSection } from "@/components/side-nav";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Archive, Bell, BookOpenText, Broadcast, Buildings, ChartLine, ChatTeardropText, Checks, ClipboardText, Cpu, Flag, House, MagnifyingGlass, Pulse, Scales, Tray, UsersThree, Warning } from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

type Icon = ComponentType<{ size?: number; weight?: "regular" | "duotone" | "bold" }>;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [memberships, unread, org] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.userId }, include: { organisation: true } }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId } }) : null,
  ]);
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
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform administration";
  const at = (...hrefs: string[]) => visibleNav.filter((n) => hrefs.includes(n.href)).map(({ href, label }) => ({ href, label }));
  const canAuthor = hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.author");
  const sections: SideNavSection[] = [
    { label: "Policy Hub", icon: <BookOpenText size={19} />, items: [{ href: "/", label: "Dashboard" }, { href: "/policies", label: ctx.organisationId ? "My Policies" : "Policies" }, { href: "/policies?tab=templates", label: "CSB Template Library" }, ...at("/changes", "/queue", "/requirements")], action: canAuthor ? { href: "/policies/new", label: "Upload Own Policy" } : undefined },
    { label: "Read and Sign", icon: <Checks size={19} />, items: [{ href: "/acknowledgements", label: "Read and Sign" }] },
    { label: "Care Operations", icon: <ClipboardText size={19} />, items: at("/audits", "/actions", "/evidence") },
    { label: "Our Team", icon: <UsersThree size={19} />, items: at("/staff") },
    { label: "Insights", icon: <ChartLine size={19} />, items: at("/assistant", "/reports") },
    { label: "Administration", icon: <Buildings size={19} />, items: at("/settings", "/admin/sources", "/admin/jobs") },
  ].filter((section) => section.items.length > 0);
  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const setupLeft = canManage ? (await setupChecklist(ctx.organisationId!)).filter((step) => !step.done).length : 0;
  const initials = ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return (
    <div className="flex min-h-screen flex-col">
      {setupLeft ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-rose-100 px-4 py-1.5 text-[12.5px] text-rose-900">
          <Warning size={16} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">Your organisation is not fully set up yet. {setupLeft === 1 ? "One step is" : `${setupLeft} steps are`} left on your setup checklist.</span>
          <Link href="/" className="rounded-[4px] bg-teal-500 px-3 py-1 font-medium text-navy-950 no-underline hover:bg-teal-400 hover:text-navy-950">Finish setup</Link>
        </div>
      ) : null}
      <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col bg-navy-800 md:flex">
        <Link href="/" aria-label="CSB home" className="block bg-white px-5 py-3">
          <Logo className="h-10 max-w-full" />
        </Link>
        <div className="flex min-h-[44px] items-center gap-2 bg-navy-950 px-4 text-[13px] font-medium leading-tight text-white">
          <Buildings size={16} aria-hidden="true" className="shrink-0 text-teal-200" />
          <span className="truncate">{orgName}</span>
        </div>
        <SideNav sections={sections} />
        <div className="border-t border-white/10 px-4 py-3 text-[10.5px] leading-relaxed text-teal-100/80">
          Starter content is not legal advice. AI output is a proposal for human review.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
          <Link href="/" className="mr-1 block md:hidden" aria-label="CSB home"><Logo className="h-9" /></Link>
          <form action="/policies" method="get" role="search" className="flex min-w-0 flex-1 items-center sm:max-w-[460px]">
            <label htmlFor="global-search" className="sr-only">Search policies</label>
            <span aria-hidden="true" className="flex h-9 items-center rounded-l-[6px] bg-navy-900 px-2.5 text-white"><MagnifyingGlass size={15} weight="bold" /></span>
            <input id="global-search" name="q" type="search" placeholder="Search one word, for example: falls" className="h-9 min-w-0 flex-1 border border-l-0 border-slate-300 bg-white px-3 text-[13px] focus:border-teal-500 focus:outline-none" />
            <button type="submit" className="h-9 rounded-r-[6px] bg-navy-900 px-3.5 text-[13px] font-medium text-white hover:bg-navy-700">Search</button>
          </form>
          <div className="ml-auto flex items-center gap-1.5 text-sm">
            {memberships.length > 1 ? (
              <form action={switchOrgAction} className="mr-1 flex items-center gap-1.5">
                <select name="organisationId" defaultValue={ctx.organisationId ?? ""} className="input w-auto py-1 text-[13px]" aria-label="Organisation">
                  {memberships.map((m) => (
                    <option key={m.organisationId} value={m.organisationId}>{m.organisation.name}</option>
                  ))}
                </select>
                <button className="btn-secondary py-1" type="submit">Switch</button>
              </form>
            ) : null}
            {org?.isDemo ? <span className="mr-1 hidden rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 font-label text-[10px] uppercase tracking-[0.08em] text-slate-600 xl:inline">Sample workspace</span> : null}
            <Link href="/acknowledgements" aria-label="My policies to read" title="My policies to read" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 no-underline hover:border-navy-900 hover:text-navy-900">
              <Checks size={17} aria-hidden="true" />
            </Link>
            <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 no-underline hover:border-navy-900 hover:text-navy-900">
              <Bell size={17} aria-hidden="true" />
              {unread ? <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread}</span> : null}
            </Link>
            <span className="ml-1 flex items-center gap-2 rounded-full border border-slate-300 py-0.5 pl-0.5 pr-3">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-navy-900">{initials}</span>
              <span className="text-[13px] text-slate-700" data-testid="current-user">{ctx.userName}</span>
            </span>
            <form action={logoutAction} className="ml-1">
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
    </div>
  );
}

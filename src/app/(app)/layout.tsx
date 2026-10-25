import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { SideNav, type SideNavSection } from "@/components/side-nav";
import { MainArea } from "@/components/main-area";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Archive, Bell, BookOpenText, Books, Broadcast, Buildings, CaretDown, ChartLine, ChatTeardropText, Checks, ClipboardText, Cpu, Eyeglasses, Flag, House, MagnifyingGlass, Pulse, Question, Scales, ShieldCheck, SlidersHorizontal, Tray, UsersThree, Warning } from "@phosphor-icons/react/dist/ssr";
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
    { label: "Policy Centre", icon: <Books size={26} weight="fill" />, items: [{ href: "/", label: "Dashboard" }, { href: "/policies", label: ctx.organisationId ? "My Policies" : "Policies" }, { href: "/policies?tab=templates", label: "Template Library" }, ...at("/changes", "/queue", "/requirements")], action: canAuthor ? { href: "/policies/new", label: "Upload Custom Policy" } : undefined },
    { label: "Reading Lists", icon: <Eyeglasses size={26} />, items: [{ href: "/acknowledgements", label: "Reading Lists" }] },
    { label: "Resource Centre", icon: <Archive size={26} weight="fill" />, items: at("/evidence") },
    { label: "Compliance Tools", icon: <ShieldCheck size={26} weight="fill" />, items: at("/audits", "/actions") },
    { label: "My Staff", icon: <UsersThree size={26} weight="fill" />, items: at("/staff") },
    { label: "Insights", icon: <ChartLine size={26} weight="bold" />, items: at("/reports", "/assistant") },
    { label: "Administration", icon: <Buildings size={26} weight="fill" />, items: at("/settings", "/admin/sources", "/admin/jobs") },
  ].filter((section) => section.items.length > 0);
  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const setupLeft = canManage ? (await setupChecklist(ctx.organisationId!)).filter((step) => !step.done).length : 0;
  const initials = ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return (
    <div className="flex min-h-screen flex-col">
      {setupLeft ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-[#fde1e3] px-4 py-2 text-[14px] text-[#a3242c]">
          <Warning size={18} weight="fill" aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">Your organisation is not fully set up yet. Complete your setup checklist so every policy is personalised to your service.</span>
          <Link href="/" className="rounded-[4px] bg-emerald-500 px-4 py-1 font-medium text-white no-underline hover:bg-emerald-600 hover:text-white">Complete Setup</Link>
        </div>
      ) : null}
      <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col bg-navy-900 text-white md:flex">
        <div className="flex h-[120px] shrink-0 flex-col items-center justify-center gap-1.5 px-3 text-center">
          <Link href="/" aria-label="CSB home" className="block"><Logo light className="h-[30px] max-w-full" /></Link>
          <span className="text-[18px] font-medium leading-[20px]">{orgName}</span>
        </div>
        <SideNav sections={sections} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[58px] flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-[9px]">
          <Link href="/" className="mr-1 block md:hidden" aria-label="CSB home"><Logo className="h-9" /></Link>
          <form action="/policies" method="get" role="search" className="flex min-w-0 flex-1 items-center sm:max-w-[560px]">
            <span aria-hidden="true" className="flex h-[38px] w-[64px] shrink-0 items-center justify-center gap-1 rounded-l-[6px] bg-navy-900 text-white"><SlidersHorizontal size={22} weight="bold" /><CaretDown size={11} weight="bold" /></span>
            <label htmlFor="global-search" className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5 border border-l-0 border-slate-300 bg-white pl-2.5">
              <MagnifyingGlass size={22} aria-hidden="true" className="shrink-0 text-slate-700" />
              <span className="sr-only">Search policies</span>
              <input id="global-search" name="q" type="search" placeholder="Enter a single search word, for example 'Falls'" className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[16px] text-slate-800 placeholder:text-slate-600 focus:outline-none" />
            </label>
            <button type="submit" className="h-[38px] w-[76px] shrink-0 rounded-r-[6px] border-2 border-white bg-navy-900 text-[16px] text-white outline outline-1 outline-slate-300 hover:bg-navy-700">Search</button>
          </form>
          <div className="ml-auto flex items-center gap-2.5">
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
            {org?.isDemo ? <span className="mr-1 hidden rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600 xl:inline">Sample workspace</span> : null}
            <Link href="/assistant" aria-label="Help and AI assistant" title="Help" className="flex h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Question size={30} aria-hidden="true" />
            </Link>
            <Link href="/acknowledgements" aria-label="My policies to read" title="My policies to read" className="flex h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Checks size={28} aria-hidden="true" />
            </Link>
            <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Bell size={28} aria-hidden="true" />
              {unread ? <span className="absolute -right-0.5 -top-1 min-w-[20px] rounded-full border-2 border-white bg-[#f06a4d] px-1 text-center text-[10px] font-bold leading-[16px] text-white">{unread}</span> : null}
            </Link>
            <details className="relative ml-1 border-l border-slate-200 pl-3.5">
              <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-slate-500 text-[15px] font-bold text-slate-800">{initials}</span>
                <span className="text-[16px] text-slate-800" data-testid="current-user">{ctx.userName}</span>
                <CaretDown size={12} weight="bold" aria-hidden="true" className="text-slate-800" />
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-44 rounded-[6px] border border-slate-200 bg-white py-1 shadow-lg">
                <form action={logoutAction}>
                  <button className="w-full px-3 py-2 text-left text-[14px] text-navy-900 hover:bg-slate-100" type="submit">Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <nav className="overflow-x-auto border-b border-slate-200 bg-paper px-3 py-2 md:hidden" aria-label="Main">
          <div className="flex min-w-max gap-1">
            {visibleNav.map((n) => (
              <NavLink key={n.href} href={n.href} compact icon={<n.icon size={15} />}>{n.label}</NavLink>
            ))}
          </div>
        </nav>
        <MainArea>{children}</MainArea>
        {inlineJobsEnabled() ? <JobKicker /> : null}
      </div>
      </div>
    </div>
  );
}

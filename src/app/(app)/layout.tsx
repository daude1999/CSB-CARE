import "../globals.css";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { portalsFor } from "@/server/auth/portals";
import { COMING_LATER } from "@/lib/portals";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo } from "@/components/brand";
import { type SideNavSection } from "@/components/side-nav";
import { PortalMobileNav, PortalSideNav, PortalSwitcher } from "@/components/portal-switcher";
import { MainArea } from "@/components/main-area";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Archive, Bell, Books, Buildings, CalendarDots, CaretDown, ChartLine, ChatTeardropText, Checks, ClipboardText, Cpu, Eyeglasses, House, Info, ListChecks, MagnifyingGlass, Pulse, Question, ShieldCheck, SlidersHorizontal, SquaresFour, UserList, UsersThree, Warning } from "@phosphor-icons/react/dist/ssr";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [memberships, unread, org] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.userId }, include: { organisation: true } }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId } }) : null,
  ]);
  const isPlatformAdmin = hasPlatformPermission(ctx, "sources.manage");
  const can = {
    queue: hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author"),
    audits: hasOrgPermission(ctx, "audit.conduct"),
    actions: Boolean(ctx.organisationId),
    staff: hasOrgPermission(ctx, "staff.view"),
    evidence: hasOrgPermission(ctx, "evidence.read"),
    assistant: hasOrgPermission(ctx, "assistant.use"),
    reports: hasOrgPermission(ctx, "report.view") || isPlatformAdmin,
    settings: hasOrgPermission(ctx, "org.manage"),
    author: hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.author"),
  };
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform administration";
  const only = (label: string, icon: React.ReactNode, href: string, show = true): SideNavSection[] => (show ? [{ label, icon, items: [{ href, label }] }] : []);
  const planned = (label: string, icon: React.ReactNode): SideNavSection => ({ label, icon, items: [], planned: true });

  // Each portal's side menu. Pages keep the addresses they had before portals existed.
  const nav: Record<string, SideNavSection[]> = {
    overview: [...only("Overview", <House size={26} weight="fill" />, "/overview"), ...only("My Reading List", <Eyeglasses size={26} />, "/acknowledgements"), ...only("Notifications", <Bell size={26} weight="fill" />, "/notifications")],
    policy: [
      {
        label: "Policy Centre",
        icon: <Books size={26} weight="fill" />,
        items: [
          { href: "/", label: "Dashboard" },
          { href: "/policies", label: ctx.organisationId ? "My Policies" : "Policies" },
          { href: "/policies?tab=templates", label: "Template Library" },
          { href: "/changes", label: "Regulatory Updates" },
          ...(can.queue ? [{ href: "/queue", label: "Policy Change Queue" }] : []),
          { href: "/requirements", label: "Requirements Register" },
        ],
        action: can.author ? { href: "/policies/new", label: "Upload Custom Policy" } : undefined,
      },
      ...only("Reading Lists", <Eyeglasses size={26} />, "/acknowledgements"),
      ...(can.audits || can.actions || can.staff
        ? [{ label: "Compliance Tools", icon: <ShieldCheck size={26} weight="fill" />, items: [...(can.audits ? [{ href: "/audits", label: "Audits & Inspections" }] : []), ...(can.actions ? [{ href: "/actions", label: "Actions & Risks" }] : []), ...(can.staff ? [{ href: "/staff", label: "Staff Sign-off" }] : [])] }]
        : []),
      { label: "Resource Centre", icon: <Archive size={26} weight="fill" />, items: [{ href: "/resource-centre", label: "CQC Registration Pack" }, { href: "/interview-prep", label: "Interview Prep" }] },
      ...only("Evidence Library", <ClipboardText size={26} weight="fill" />, "/evidence", can.evidence),
    ],
    "service-users": [...only("About this portal", <Info size={26} weight="fill" />, "/service-users"), planned("Service users", <UsersThree size={26} />), planned("Enquiries", <UserList size={26} />), planned("Contacts & families", <UsersThree size={26} />), planned("Care plans", <ClipboardText size={26} />), planned("Risk assessments", <ShieldCheck size={26} />)],
    rota: [...only("About this portal", <Info size={26} weight="fill" />, "/rota"), planned("Weekly rota", <CalendarDots size={26} />), planned("Today's visits", <ListChecks size={26} />), planned("Unassigned visits", <Warning size={26} />), planned("Visit log", <ClipboardText size={26} />), planned("Availability", <UsersThree size={26} />)],
    reporting: [...only("Reports", <ChartLine size={26} weight="bold" />, "/reports", can.reports), ...only("AI Assistant", <ChatTeardropText size={26} weight="fill" />, "/assistant", can.assistant)],
    admin: [
      ...only("System Settings", <Buildings size={26} weight="fill" />, "/settings", can.settings),
      ...only("Modules", <SquaresFour size={26} weight="fill" />, "/modules"),
      ...only("Source Monitoring", <Pulse size={26} weight="bold" />, "/admin/sources", isPlatformAdmin),
      ...only("Background Jobs", <Cpu size={26} weight="fill" />, "/admin/jobs", isPlatformAdmin),
    ],
  };
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
      <div className="hidden w-[220px] shrink-0 bg-navy-900 md:block">
      <aside className="sticky top-0 flex h-screen w-[220px] flex-col bg-navy-900 text-white">
        <div className="flex h-[132px] shrink-0 flex-col items-center justify-center gap-1 px-3 text-center">
          <Link href="/overview" aria-label="CSB All in One Platform home" className="block"><Logo light className="h-[30px] max-w-full" /></Link>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-teal-400">All in One Platform</span>
          <span className="mt-0.5 text-[17px] font-medium leading-[20px]">{orgName}</span>
        </div>
        <PortalSideNav nav={nav} />
      </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[58px] flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-[9px]">
          <Link href="/overview" className="mr-1 block md:hidden" aria-label="CSB All in One Platform home"><Logo className="h-9" /></Link>
          <PortalSwitcher portals={portalsFor(ctx)} later={COMING_LATER} />
          <form action="/policies" method="get" role="search" className="hidden min-w-0 flex-1 items-center sm:flex sm:max-w-[480px]">
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
            <Link href="/assistant" aria-label="Help and AI assistant" title="Help" className="hidden h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900 sm:flex">
              <Question size={30} aria-hidden="true" />
            </Link>
            <Link href="/acknowledgements" aria-label="My policies to read" title="My policies to read" className="hidden h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900 sm:flex">
              <Checks size={28} aria-hidden="true" />
            </Link>
            <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full text-slate-800 no-underline hover:bg-slate-100 hover:text-navy-900">
              <Bell size={28} aria-hidden="true" />
              {unread ? <span className="absolute -right-0.5 -top-1 min-w-[20px] rounded-full border-2 border-white bg-[#f06a4d] px-1 text-center text-[10px] font-bold leading-[16px] text-white">{unread}</span> : null}
            </Link>
            <details className="relative ml-1 border-l border-slate-200 pl-3.5">
              <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-slate-500 text-[15px] font-bold text-slate-800">{initials}</span>
                <span className="hidden text-[16px] text-slate-800 lg:inline" data-testid="current-user">{ctx.userName}</span>
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
        <PortalMobileNav nav={nav} />
        <MainArea>{children}</MainArea>
        {inlineJobsEnabled() ? <JobKicker /> : null}
      </div>
      </div>
    </div>
  );
}

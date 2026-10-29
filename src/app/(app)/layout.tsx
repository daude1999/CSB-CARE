import "../globals.css";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { portalsFor } from "@/server/auth/portals";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo, Monogram } from "@/components/brand";
import { MobileMenu, SearchShortcut, ShellSidebar, type ShellItem, type ShellPortal } from "@/components/portal-switcher";
import { MainArea } from "@/components/main-area";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Archive, Bell, BookOpenText, Buildings, CalendarDots, ChartBar, ChartLine, ChatTeardropText, ClipboardText, ClockCounterClockwise, Cpu, Eyeglasses, FolderOpen, GearSix, House, Info, ListChecks, MagnifyingGlass, Newspaper, Pulse, Question, ShieldCheck, Signature, Sparkle, SquaresFour, UserCircle, UsersThree, Warning, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [memberships, unread, org] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.userId }, include: { organisation: true, branch: { select: { name: true } } } }),
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
  const page = (href: string, label: string, icon: React.ReactNode, show = true): ShellItem[] => (show ? [{ href, label, icon }] : []);
  const planned = (label: string, icon: React.ReactNode): ShellItem => ({ href: `#${label}`, label, icon, planned: true });
  const i = { size: 15 } as const;

  // Each portal's pages, listed under it in the sidebar when it is open. Pages keep the addresses they had before portals existed.
  const items: Record<string, ShellItem[]> = {
    overview: [...page("/overview", "Today", <House {...i} />), ...page("/acknowledgements", "My Reading List", <Eyeglasses {...i} />), ...page("/notifications", "Notifications", <Bell {...i} />)],
    policy: [
      ...page("/", "Compliance Dashboard", <Sparkle {...i} />),
      ...page("/policies", ctx.organisationId ? "Policy Library" : "Template Library", <BookOpenText {...i} />),
      ...page("/changes", "Regulatory Updates", <Newspaper {...i} />),
      ...page("/requirements", "Requirements Register", <ListChecks {...i} />),
      ...page("/queue", "Policy Change Queue", <ClockCounterClockwise {...i} />, can.queue),
      ...page("/staff", "Staff Sign-off", <Signature {...i} />, can.staff),
      ...page("/audits", "Audits & Inspections", <ClipboardText {...i} />, can.audits),
      ...page("/actions", "Actions & Risks", <WarningCircle {...i} />, can.actions),
      ...page("/evidence", "Evidence Library", <FolderOpen {...i} />, can.evidence),
      ...page("/reports", "Compliance Reports", <ChartLine {...i} />, can.reports),
      ...page("/resource-centre", "Resource Centre", <Archive {...i} />),
      ...page("/interview-prep", "Interview Prep", <ChatTeardropText {...i} />),
    ],
    "service-users": [...page("/service-users", "About this portal", <Info {...i} />), planned("Service users", <UsersThree {...i} />), planned("Care plans", <ClipboardText {...i} />), planned("Risk assessments", <ShieldCheck {...i} />)],
    rota: [...page("/rota", "About this portal", <Info {...i} />), planned("Weekly rota", <CalendarDots {...i} />), planned("Today's visits", <ListChecks {...i} />), planned("Visit log", <ClipboardText {...i} />)],
    reporting: [...page("/reports", "Reports", <ChartLine {...i} />, can.reports), ...page("/assistant", "AI Assistant", <ChatTeardropText {...i} />, can.assistant)],
    admin: [
      ...page("/settings", "System Settings", <Buildings {...i} />, can.settings),
      ...page("/modules", "Modules", <SquaresFour {...i} />),
      ...page("/admin/sources", "Source Monitoring", <Pulse {...i} />, isPlatformAdmin),
      ...page("/admin/jobs", "Background Jobs", <Cpu {...i} />, isPlatformAdmin),
    ],
  };
  const portalIcon: Record<string, React.ReactNode> = {
    overview: <House size={20} />,
    "service-users": <UserCircle size={20} />,
    policy: <ShieldCheck size={20} />,
    rota: <CalendarDots size={20} />,
    hr: <UsersThree size={20} />,
    reporting: <ChartBar size={20} />,
    admin: <GearSix size={20} />,
  };
  const portals: ShellPortal[] = portalsFor(ctx).map((p) => ({ ...p, icon: portalIcon[p.id] }));
  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const setupLeft = canManage ? (await setupChecklist(ctx.organisationId!)).filter((step) => !step.done).length : 0;
  const initials = ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const me = memberships.find((m) => m.organisationId === ctx.organisationId);
  const roleName = me?.jobTitle ?? (me?.roles[0] ? ROLE_NAMES[me.roles[0]] : ctx.platformRoles[0] ? ROLE_NAMES[ctx.platformRoles[0]] : "Member");
  const shell = {
    portals,
    items,
    org: org ? { name: orgName, branch: me?.branch?.name ?? null, currentId: ctx.organisationId, options: memberships.map((m) => ({ id: m.organisationId, name: m.organisation.name })) } : null,
    person: { name: ctx.userName, initials, role: roleName },
    switchAction: switchOrgAction,
    signOutAction: logoutAction,
    logo: <Monogram className="h-[34px]" />,
  };
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
        <ShellSidebar {...shell} />
        <div className="shell-main flex min-w-0 flex-1 flex-col">
          <header className="shell-topbar sticky top-0 z-20 flex h-[56px] items-center gap-[12px] px-[16px] md:px-[32px]">
            <MobileMenu {...shell} />
            <Link href="/overview" className="block md:hidden" aria-label="CSB All in One Platform home"><Logo className="h-7" /></Link>
            <form action="/policies" method="get" role="search" className="hidden min-w-0 flex-1 sm:block sm:max-w-[776px]">
              <label htmlFor="global-search" className="shell-search">
                <MagnifyingGlass size={17} aria-hidden="true" className="shrink-0 text-[#3a4b5e]" />
                <span className="sr-only">Search policies</span>
                <input id="global-search" name="q" type="search" placeholder="Search policies, categories, keywords…" className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-[#0b1530] placeholder:text-[#5f6b7a] focus:outline-none" />
                <kbd className="hidden rounded-[4px] border border-[#dcd9d2] bg-white px-1.5 text-[10.5px] leading-[18px] text-[#3a4b5e] lg:inline">⌘ K</kbd>
              </label>
              <SearchShortcut targetId="global-search" />
            </form>
            <div className="ml-auto flex items-center gap-4">
              {org?.isDemo ? <span className="hidden rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600 xl:inline">Sample workspace</span> : null}
              <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#0b1530] no-underline hover:bg-black/5 hover:text-[#0b1530]">
                <Bell size={21} aria-hidden="true" />
                {unread ? <span className="absolute right-[5px] top-[5px] h-[9px] w-[9px] rounded-full border-2 border-[#f6f5f3] bg-[#e12125]"><span className="sr-only">{unread} unread</span></span> : null}
              </Link>
              <Link href="/assistant" className="flex items-center gap-2 text-[14px] text-[#0b1530] no-underline hover:text-[#0646b1]">
                <Question size={21} aria-hidden="true" /><span className="hidden sm:inline">Help</span><span className="sr-only sm:hidden">Help</span>
              </Link>
            </div>
          </header>
          <MainArea>{children}</MainArea>
          {inlineJobsEnabled() ? <JobKicker /> : null}
        </div>
      </div>
    </div>
  );
}

const ROLE_NAMES: Record<string, string> = {
  ORG_ADMIN: "Organisation admin",
  COMPLIANCE_LEAD: "Compliance lead",
  POLICY_AUTHOR: "Policy author",
  POLICY_REVIEWER: "Policy reviewer",
  POLICY_APPROVER: "Policy approver",
  STAFF: "Care staff",
  PLATFORM_ADMIN: "CSB platform admin",
  REGULATORY_REVIEWER: "CSB regulatory reviewer",
  CONTENT_EDITOR: "CSB content editor",
};

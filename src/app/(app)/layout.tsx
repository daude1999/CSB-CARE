import "../globals.css";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { portalsFor } from "@/server/auth/portals";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo, Monogram } from "@/components/brand";
import { MobileMenu, ShellSidebar, type ShellItem, type ShellPortal } from "@/components/portal-switcher";
import { ShellSearch } from "@/components/shell-search";
import { hrItems } from "@/components/hr-nav";
import { MainArea } from "@/components/main-area";
import { NavigationProgress } from "@/components/navigation-progress";
import { rotaItems } from "@/components/rota-nav";
import { complianceItems } from "@/components/compliance-nav";
import { HelpMenu } from "@/components/help-menu";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { Bell, Buildings, CalendarDots, ChartBar, ChartLine, ChatTeardropText, ClockCounterClockwise, Cpu, GearSix, House, ListChecks, Pulse, ShieldCheck, SquaresFour, UsersThree, Warning, MapTrifold, IdentificationCard } from "@phosphor-icons/react/dist/ssr";

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
  const i = { size: 15 } as const;

  // Each portal's pages, listed under it in the sidebar when it is open. Pages keep the addresses they had before portals existed.
  const items: Record<string, ShellItem[]> = {
    // The Overview stands alone in the sidebar, as in the approved design; notifications open from the bell.
    overview: [],
    // Six workspaces; their tabs (Regulatory Updates, Review Queue, Evidence Library and so on) keep their own addresses.
    policy: complianceItems(ctx, i),
    rota: rotaItems(ctx, i),
    reporting: [
      ...page("/analytics", "Analytics", <ChartBar {...i} />, hasOrgPermission(ctx, "analytics.view")),
      ...page("/reports", "Compliance Reports", <ChartLine {...i} />, can.reports),
      ...page("/rota/reports", "Rota Reports", <CalendarDots {...i} />, hasOrgPermission(ctx, "rota.view")),
      ...page("/assistant", "AI Assistant", <ChatTeardropText {...i} />, can.assistant),
    ],
    hr: hrItems(ctx, i),
    // Everyday settings first; technical and platform pages sit in a folded "Advanced" group that opens when one of
    // its pages is open, so office staff are not faced with every configuration screen at once.
    admin: groupAdmin(
      [
        ...page("/settings", "System Settings", <Buildings {...i} />, can.settings),
        ...page("/admin/users", "Users", <UsersThree {...i} />, can.settings),
        ...page("/admin/branches", "Branches", <Buildings {...i} />, can.settings),
        ...page("/admin/areas", "Areas", <MapTrifold {...i} />, can.settings),
      ],
      [
        ...page("/admin/workforce", "Workforce Sync & Logins", <IdentificationCard {...i} />, can.settings),
        ...page("/admin/readiness", "Staff Readiness Matrix", <ListChecks {...i} />, hasOrgPermission(ctx, "readiness.manage")),
        ...page("/admin/audit", "Audit Log", <ClockCounterClockwise {...i} />, can.settings),
        ...page("/modules", "Modules", <SquaresFour {...i} />),
        ...page("/admin/sources", "Source Monitoring", <Pulse {...i} />, isPlatformAdmin),
        ...page("/admin/jobs", "Background Jobs", <Cpu {...i} />, isPlatformAdmin),
      ],
    ),
  };
  const portalIcon: Record<string, React.ReactNode> = {
    overview: <House size={20} />,
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
    logo: <Monogram className="h-[42px]" />,
  };
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-[6px] bg-white px-3 py-2 text-[14px] text-[#0b1530] shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
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
          <header className="shell-topbar sticky top-0 z-[35] flex h-[56px] items-center gap-[12px] px-[16px] md:px-[32px]">
            <NavigationProgress renderKey={String(Date.now())} />
            <MobileMenu {...shell} />
            <Link href="/overview" className="block md:hidden" aria-label="CSB All in One Platform home"><Logo className="h-7" /></Link>
            <ShellSearch />
            <div className="ml-auto flex items-center gap-4">
              {me?.branch?.name ? (
                <span className="hidden items-center gap-2 rounded-[8px] border border-[#e3e6ec] bg-white px-3 py-[7px] text-[13px] text-[#0b1530] lg:flex" title="Your branch">
                  <Buildings size={17} aria-hidden="true" /><span className="sr-only">Your branch: </span>{me.branch.name}
                </span>
              ) : null}
              {org?.isDemo ? <span className="hidden rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600 xl:inline">Sample workspace</span> : null}
              <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#0b1530] no-underline hover:bg-black/5 hover:text-[#0b1530]">
                <Bell size={21} aria-hidden="true" />
                {unread ? <span className="absolute right-[5px] top-[5px] h-[9px] w-[9px] rounded-full border-2 border-[#f6f5f3] bg-[#e12125]"><span className="sr-only">{unread} unread</span></span> : null}
              </Link>
              <HelpMenu assistant={can.assistant} />
              <span aria-hidden="true" title={ctx.userName} className="hidden h-9 w-9 items-center justify-center rounded-full bg-[#dbe7f8] text-[13px] font-semibold text-[#0b2a4a] sm:flex">{initials}</span>
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

/** Labels the Administration pages as an open "Everyday" group and a folded "Advanced" group. */
function groupAdmin(everyday: ShellItem[], advanced: ShellItem[]): ShellItem[] {
  if (!everyday.length) return advanced;
  return [
    ...everyday.map((p, n) => (n === 0 ? { ...p, group: "Everyday", fold: "open" as const } : p)),
    ...advanced.map((p, n) => (n === 0 ? { ...p, group: "Advanced", fold: "closed" as const } : p)),
  ];
}

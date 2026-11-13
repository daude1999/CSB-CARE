import "../globals.css";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { portalsFor } from "@/server/auth/portals";
import { logoutAction, switchOrgAction } from "../actions";
import { type ShellItem, type ShellPortal } from "@/components/portal-switcher";
import { Breadcrumb, HarbourMenuProvider, IconRail, MenuButton, MenuFlyout, SearchButton, ShellSubTabs } from "@/components/harbour/shell";
import { HarbourAccountMenu, TopBarClock, TopBarColourMode } from "@/components/harbour/account-menu";
import { hrItems } from "@/components/hr-nav";
import { AppHistory, HistoryButtons } from "@/components/history-nav";
import { MainArea } from "@/components/main-area";
import { NavigationProgress } from "@/components/navigation-progress";
import { rotaItems } from "@/components/rota-nav";
import { complianceItems } from "@/components/compliance-nav";
import { HelpMenu } from "@/components/help-menu";
import { MODE_COOKIE, parseMode } from "@/lib/colour-mode";
import { cookies } from "next/headers";
import { setupChecklist } from "@/server/setup/checklist";
import { JobKicker } from "@/components/job-kicker";
import { AiCsbCoordinatorLauncher } from "@/components/coordinator/ai-launcher";
import { COORDINATOR_SLOT } from "@/lib/shell-slots";
import { CommandBar, type CommandPage } from "@/components/command-bar";
import { commandActions } from "@/server/search/command";
import { coordinatorAiStatus } from "@/server/care/coordinator/agent";
import { inlineJobsEnabled } from "@/server/jobs/inline";
import { getSetting } from "@/server/platform/settings";
import { Bell, Buildings, CalendarDots, ChartBar, ChartLine, ChatTeardropText, ClockCounterClockwise, Cpu, GearSix, House, ListChecks, Pulse, ShieldCheck, SquaresFour, UsersThree, Warning, MapTrifold } from "@phosphor-icons/react/dist/ssr";

/**
 * Server actions run in the page's function. The AI CSB Coordinator's Claude loop can take up to 55 seconds, and an AI
 * reading of a long support plan up to about 3.5 minutes (it then falls back to CSB's basic reader), so pages in the
 * app get a 300-second limit, the same as the daily cron route, instead of the hosting default.
 */
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const colourMode = parseMode((await cookies()).get(MODE_COOKIE)?.value);
  const [maintenanceNotice, supportContact] = await Promise.all([getSetting("maintenance.notice"), Promise.all([getSetting("general.supportEmail"), getSetting("general.supportPhone")])]);
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
      // Every report is listed here, once. The Rota and Policy menus keep a shortcut to their own reports, which opens
      // the same page here rather than a second copy.
      ...page("/rota/reports", "Rota Reports", <CalendarDots {...i} />, hasOrgPermission(ctx, "rota.view")),
      ...page("/rota/insights", "Rota Insights", <Pulse {...i} />, hasOrgPermission(ctx, "rota.view")),
      ...page(ctx.organisationId ? "/compliance/reports" : "/reports", "Compliance Reports", <ChartLine {...i} />, can.reports),
      ...page("/assistant", "AI Assistant", <ChatTeardropText {...i} />, can.assistant),
    ],
    hr: hrItems(ctx, i),
    // Everyday settings first; technical and platform pages sit in a folded "Advanced" group that opens when one of
    // its pages is open, so office staff are not faced with every configuration screen at once.
    admin: groupAdmin(
      [
        ...page("/settings", "All Settings", <Buildings {...i} />, can.settings),
        // One entry per job: who can sign in, and where the organisation works. Each opens a page with tabs.
        ...(can.settings ? [{ href: "/admin/users", label: "Users & Logins", icon: <UsersThree {...i} />, match: ["/admin/workforce"] }] : []),
        ...(can.settings ? [{ href: "/admin/branches", label: "Branches & Areas", icon: <MapTrifold {...i} />, match: ["/admin/areas"] }] : []),
      ],
      [
        ...page("/admin/readiness", "Staff Readiness Rules", <ListChecks {...i} />, hasOrgPermission(ctx, "readiness.manage")),
        ...page("/admin/audit", "Activity Log", <ClockCounterClockwise {...i} />, can.settings),
        ...page("/modules", "Modules", <SquaresFour {...i} />),
        ...page("/admin/sources", "Source Monitoring", <Pulse {...i} />, isPlatformAdmin),
        ...page("/admin/jobs", "Background Jobs", <Cpu {...i} />, isPlatformAdmin),
        // The Evantix Platform Admin Centre has its own shell; it is listed here for platform administrators only.
        ...page("/platform-admin", "Evantix Admin Centre", <ShieldCheck {...i} />, hasPlatformPermission(ctx, "platform.view")),
      ],
    ),
  };
  // Drawn white inside the module's 20px colour square in the menu and the breadcrumb.
  const portalIcon: Record<string, React.ReactNode> = {
    overview: <House size={13} weight="bold" />,
    policy: <ShieldCheck size={13} weight="bold" />,
    rota: <CalendarDots size={13} weight="bold" />,
    hr: <UsersThree size={13} weight="bold" />,
    reporting: <ChartBar size={13} weight="bold" />,
    admin: <GearSix size={13} weight="bold" />,
  };

  const portals: ShellPortal[] = portalsFor(ctx).map((p) => ({ ...p, icon: portalIcon[p.id] }));
  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const setupLeft = canManage ? (await setupChecklist(ctx.organisationId!)).filter((step) => !step.done).length : 0;
  const initials = ctx.userName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const me = memberships.find((m) => m.organisationId === ctx.organisationId);
  const roleName = me?.jobTitle ?? (me?.roles[0] ? ROLE_NAMES[me.roles[0]] : ctx.platformRoles[0] ? ROLE_NAMES[ctx.platformRoles[0]] : "Member");
  // The AI CSB Coordinator (Claude with CRM tools when switched on, built-in CRM search otherwise), for employees who may use it.
  const coordinator = ctx.organisationId && hasOrgPermission(ctx, "serviceUser.documents") && portalsFor(ctx).some((p) => p.id === "rota")
    ? {
        access: {
          intake: hasOrgPermission(ctx, "serviceUser.edit") && hasOrgPermission(ctx, "rota.edit"),
          createServiceUser: hasOrgPermission(ctx, "serviceUser.edit"),
          carePlans: hasOrgPermission(ctx, "serviceUser.view"),
          buildRota: hasOrgPermission(ctx, "rota.build"),
        },
        // Claude answers only when the organisation switched AI on and the server has a provider.
        aiOn: (await coordinatorAiStatus(ctx.organisationId)).on,
      }
    : null;
  // The command bar (Ctrl+K) lists exactly the modules and pages the sidebar offers this person.
  const commandPages: CommandPage[] = portals.filter((p) => !p.planned).flatMap((p) => [
    { label: p.name, href: p.home, hint: "Module", home: true },
    ...(items[p.id] ?? []).filter((x) => !x.planned && x.href !== p.home).map((x) => ({ label: x.label, href: x.href, hint: p.name })),
  ]);
  const shell = {
    org: org ? { name: orgName, branch: me?.branch?.name ?? null, currentId: ctx.organisationId, options: memberships.map((m) => ({ id: m.organisationId, name: m.organisation.name })) } : null,
    person: { name: ctx.userName, initials, role: roleName },
  };

  const place = org ? (me?.branch?.name ? `${orgName} · ${me.branch.name}` : orgName) : "CSB platform administration";
  const harbour = {
    portals,
    items,
    org: shell.org,
    person: shell.person,
    unread,
    coordinator: Boolean(coordinator),
    settingsHref: can.settings ? "/settings" : null,
    switchAction: switchOrgAction,
    signOutAction: logoutAction,
  };
  return (
    <div className="hb-shell flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-[6px] bg-white px-3 py-2 text-[14px] text-[#0b1530] shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      {setupLeft ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-[#fde1e3] px-4 py-2 text-[14px] text-[#a3242c]">
          <Warning size={18} weight="fill" aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">Your organisation is not fully set up yet. Complete your setup checklist so every policy is personalised to your service.</span>
          <Link href="/" className="rounded-[4px] bg-emerald-500 px-4 py-1 font-medium text-white no-underline hover:bg-emerald-600 hover:text-white">Complete Setup</Link>
        </div>
      ) : null}
      <HarbourMenuProvider>
        <div className="flex flex-1">
          <IconRail {...harbour} />
          <MenuFlyout {...harbour} />
          <div className="shell-main hb-main flex min-w-0 flex-1 flex-col">
            {/* The Harbour top bar: breadcrumb on the left; demo badge, alerts, search, history, help and the person on the right. */}
            <header className="hb-hd print:hidden">
              <NavigationProgress renderKey={String(Date.now())} />
              <MenuButton />
              <div className="hidden sm:block"><HistoryButtons /></div>
              <Breadcrumb portals={portals} items={items} />
              <span className="flex-1" />
              <SearchButton />
              <TopBarClock initial={Date.now()} />
              {org?.isDemo ? <span className="hb-demo hidden sm:inline">Demo data</span> : null}
              {coordinator ? <span id={COORDINATOR_SLOT} className="contents" /> : null}
              <Link href="/notifications" data-testid="notifications-link" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className="hb-ib">
                <Bell size={18} aria-hidden="true" />
                {unread ? <span className="hb-dot"><span className="sr-only">{unread} unread</span></span> : null}
              </Link>
              <TopBarColourMode initial={colourMode} />
              <HelpMenu assistant={can.assistant} />
              <span aria-hidden="true" className="hb-hd-v hidden sm:block" />
              <HarbourAccountMenu name={ctx.userName} initials={initials} role={roleName} place={place} sample={Boolean(org?.isDemo)} mode={colourMode} signOutAction={logoutAction} />
            </header>
            {maintenanceNotice ? <div role="status" className="border-b border-[#f3d38a] bg-[#fff8e6] px-4 py-2 text-[13.5px] text-[#6b4a00] md:px-8">{maintenanceNotice}</div> : null}
            <ShellSubTabs items={items} />
            <MainArea>{ctx.suspended ? <SuspendedNotice orgName={orgName} email={supportContact[0]} phone={supportContact[1]} /> : children}</MainArea>
            {coordinator ? <AiCsbCoordinatorLauncher access={coordinator.access} aiOn={coordinator.aiOn} /> : null}
            <CommandBar pages={commandPages} actions={commandActions(ctx)} />
            <AppHistory />
            {inlineJobsEnabled() ? <JobKicker /> : null}
          </div>
        </div>
      </HarbourMenuProvider>
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

/** Shown instead of every page while Evantix has suspended or closed the organisation. Nothing has been deleted. */
function SuspendedNotice({ orgName, email, phone }: { orgName: string; email: string; phone: string }) {
  return (
    <section aria-labelledby="suspended-heading" className="mx-auto mt-10 max-w-xl rounded-[6px] bg-white p-6 text-[15px]" data-testid="organisation-suspended">
      <h1 id="suspended-heading" className="text-[22px] font-semibold text-[#0b1530]">{orgName} is suspended</h1>
      <p className="mt-2 text-slate-700">Access to this organisation has been paused by the platform provider. Your records are safe and have not been changed or deleted.</p>
      <p className="mt-2 text-slate-700">Please contact your organisation&apos;s administrator{email || phone ? <> or Evantix support{email ? <> at <a href={`mailto:${email}`}>{email}</a></> : null}{phone ? <> on {phone}</> : null}</> : null}.</p>
    </section>
  );
}

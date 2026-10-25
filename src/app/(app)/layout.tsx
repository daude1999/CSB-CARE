import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { logoutAction, switchOrgAction } from "../actions";
import { Logo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { JobKicker } from "@/components/job-kicker";
import { inlineJobsEnabled } from "@/server/jobs/inline";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [memberships, unread, org] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.userId }, include: { organisation: true } }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId } }) : null,
  ]);
  const isPlatformAdmin = hasPlatformPermission(ctx, "sources.manage");
  const nav: { href: string; label: string; group: string; show: boolean }[] = [
    { href: "/", label: "Overview", group: "Home", show: true },
    { href: "/policies", label: "Policies & Procedures", group: "Policy management", show: true },
    { href: "/changes", label: "Regulatory Updates", group: "Policy management", show: true },
    { href: "/queue", label: "Policy Change Queue", group: "Policy management", show: hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author") },
    { href: "/requirements", label: "Requirements Register", group: "Policy management", show: true },
    { href: "/audits", label: "Audits & Inspections", group: "Care operations", show: hasOrgPermission(ctx, "audit.conduct") },
    { href: "/actions", label: "Actions & Risks", group: "Care operations", show: Boolean(ctx.organisationId) },
    { href: "/staff", label: "Staff & Training", group: "Care operations", show: hasOrgPermission(ctx, "staff.view") },
    { href: "/evidence", label: "Evidence Library", group: "Care operations", show: hasOrgPermission(ctx, "evidence.read") },
    { href: "/assistant", label: "AI Assistant", group: "Insights", show: hasOrgPermission(ctx, "assistant.use") },
    { href: "/reports", label: "Reports", group: "Insights", show: hasOrgPermission(ctx, "report.view") || isPlatformAdmin },
    { href: "/admin/sources", label: "Source Monitoring", group: "Administration", show: isPlatformAdmin },
    { href: "/admin/jobs", label: "Background Jobs", group: "Administration", show: isPlatformAdmin },
    { href: "/settings", label: "Organisation Settings", group: "Administration", show: hasOrgPermission(ctx, "org.manage") },
  ];
  const visibleNav = nav.filter((n) => n.show);
  const navGroups = [...new Set(visibleNav.map((item) => item.group))].map((group) => ({ group, items: visibleNav.filter((item) => item.group === group) }));
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-950 text-slate-200 md:flex">
        <div className="border-b-4 border-teal-400 bg-white px-5 py-4">
          <Logo className="h-12 max-w-full" />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pt-4" aria-label="Main">
          {navGroups.map(({ group, items }) => (
            <div key={group}>
              {group !== "Home" ? <h2 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group}</h2> : null}
              <div className="space-y-0.5">
                {items.map((n) => <NavLink key={n.href} href={n.href}>{n.label}</NavLink>)}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-navy-800 p-4 text-xs text-slate-400">
          <div className="mb-1 font-medium text-slate-300">CSB · Care Solution Bureau</div>
          Starter content is not legal advice. AI output is a proposal for human review.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="mr-1 block md:hidden" aria-label="CSB home"><Logo className="h-10" /></Link>
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
              <span className="font-medium text-navy-900">{org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform administration"}</span>
            )}
            {org?.isDemo ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800">Sample workspace</span> : null}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/acknowledgements">My policies to read</Link>
            <Link href="/notifications" data-testid="notifications-link">
              Notifications{unread ? <span className="ml-1 rounded-full bg-teal-600 px-1.5 text-xs text-white">{unread}</span> : null}
            </Link>
            <span className="text-slate-500" data-testid="current-user">{ctx.userName}</span>
            <form action={logoutAction}>
              <button className="btn-secondary py-1" type="submit">Sign out</button>
            </form>
          </div>
        </header>
        <nav className="overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden" aria-label="Main">
          <div className="flex min-w-max gap-1">
            {visibleNav.map((n) => (
              <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
            ))}
          </div>
        </nav>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">{children}</main>
        {inlineJobsEnabled() ? <JobKicker /> : null}
      </div>
    </div>
  );
}

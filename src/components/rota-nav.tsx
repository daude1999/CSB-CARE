import Link from "@/components/link";
import { Bank, ChartLine, DeviceMobile, FirstAidKit, GearSix, House, IdentificationBadge, ListChecks, Pulse, Repeat, UsersThree, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { canUsePortal } from "@/server/auth/portals";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The Rostering & Care Management side menu: nine destinations and Settings, nothing else. Each destination is a
 * workspace; the pages that used to be separate menu entries are its tabs, and they keep their own addresses, so
 * bookmarks, notification links and server actions still work. Every tab appears only for people with the permission
 * its page checks on the server, and a destination appears only when the person may open at least one of its tabs.
 *
 * The Rota Dashboard, Daily Rota, Daily Templates, Unassigned Visits and Missed Calls are approved designs, so they do
 * not show the tab strip; their own buttons already lead to the other pages (see ROTA_NAVIGATION.md).
 */
export type RotaWorkspace = "daily" | "attention" | "monitor" | "templates" | "people" | "staff" | "finance" | "reports";
export type RotaTab = { key: string; label: string; href: string };

type TabDef = RotaTab & { perm: OrgPermission | OrgPermission[]; show?: boolean };

const can = (ctx: Ctx, perm: OrgPermission | OrgPermission[]) => (Array.isArray(perm) ? perm : [perm]).some((p) => hasOrgPermission(ctx, p));

function tabDefs(ctx: Ctx, ws: RotaWorkspace): TabDef[] {
  // Staff holidays, sickness and availability are kept in the HR portal; those pages need HR access and an HR Hub login.
  const hr = canUsePortal(ctx, "hr") && Boolean(ctx.hrUserId);
  switch (ws) {
    case "daily":
      return [
        { key: "visits", label: "Daily Rota", href: "/rota/visits", perm: "rota.view" },
        { key: "advanced", label: "Advanced Rota", href: "/rota/advanced", perm: "rota.view" },
        { key: "planner", label: "Weekly Planner", href: "/rota/planner", perm: "rota.view" },
        { key: "build", label: "Build Rota", href: "/rota/build", perm: "rota.build" },
        { key: "optimise", label: "Generate & Optimise", href: "/rota/optimise", perm: "rota.view" },
        { key: "routes", label: "Live Run Routes", href: "/rota/routes", perm: "rota.view" },
        { key: "print", label: "Printable Rota", href: "/rota/print", perm: "rota.view" },
        { key: "cover", label: "Sickness & Holiday Cover", href: "/rota/cover", perm: "rota.view" },
      ];
    case "attention":
      return [
        { key: "attention", label: "Visits Needing Attention", href: "/rota/attention", perm: ["rota.view", "rota.monitor"] },
        { key: "unassigned", label: "Unassigned Visits", href: "/rota/unassigned", perm: "rota.view" },
        { key: "missed", label: "Missed Calls", href: "/rota/missed", perm: "rota.monitor" },
      ];
    case "monitor":
      return [
        { key: "monitor", label: "The Monitor", href: "/rota/monitor", perm: "rota.monitor" },
        { key: "exceptions", label: "Exceptions", href: "/rota/exceptions", perm: "rota.monitor" },
      ];
    case "templates":
      return [
        { key: "daily", label: "Daily Templates", href: "/rota/templates", perm: "rota.view" },
        { key: "advanced", label: "Advanced Templates", href: "/rota/templates/planner", perm: "rota.view" },
        { key: "routes", label: "Template Run Routes", href: "/rota/routes/templates", perm: "rota.view" },
      ];
    case "people":
      return [
        { key: "directory", label: "Service Users", href: "/rota/service-users", perm: "serviceUser.view" },
        { key: "care-plans", label: "Care Plans", href: "/rota/care-plans", perm: "serviceUser.view" },
        { key: "risks", label: "Risk Assessments", href: "/rota/risks", perm: "serviceUser.view" },
        { key: "incidents", label: "Incidents", href: "/rota/incidents", perm: ["incident.manage", "incident.report"] },
        { key: "notes", label: "Visit Notes", href: "/rota/notes", perm: "rota.view" },
      ];
    case "staff":
      return [
        { key: "team", label: "Team Members", href: "/rota/staff", perm: "staff.directory" },
        { key: "readiness", label: "Staff Readiness", href: "/rota/readiness", perm: "readiness.view" },
        { key: "absences", label: "Holidays & Sickness", href: "/workforce/absences", perm: "rota.view", show: hr },
        { key: "availability", label: "Availability", href: "/workforce/availability", perm: "rota.view", show: hr },
      ];
    case "finance":
      return [
        { key: "overview", label: "Finance Overview", href: "/rota/finance", perm: "finance.view" },
        { key: "invoices", label: "Invoicing", href: "/rota/finance/invoices", perm: "finance.view" },
        { key: "payroll", label: "Wages", href: "/rota/finance/payroll", perm: "finance.view" },
        { key: "timesheets", label: "Timesheets", href: "/rota/finance/timesheets", perm: "finance.view" },
        { key: "mileage", label: "Mileage", href: "/rota/finance/mileage", perm: "finance.view" },
        { key: "rates", label: "Tariffs & Funders", href: "/rota/finance/rates", perm: "finance.view" },
        { key: "holidays", label: "Bank Holidays", href: "/rota/finance/rates?tab=holidays", perm: "finance.view" },
      ];
    case "reports":
      return [
        { key: "reports", label: "Rota Reports", href: "/rota/reports", perm: "rota.view" },
        { key: "insights", label: "Rota Insights", href: "/rota/insights", perm: "rota.view" },
      ];
  }
}

/** A workspace's tabs this person may open, in order. */
export function rotaWorkspaceTabs(ctx: Ctx, ws: RotaWorkspace): RotaTab[] {
  return tabDefs(ctx, ws)
    .filter((t) => (t.show ?? true) && can(ctx, t.perm))
    .map(({ key, label, href }) => ({ key, label, href }));
}

type Destination = { label: string; icon: React.ReactNode; ws?: RotaWorkspace; href?: string; perm?: OrgPermission };

/** The sidebar entry for one workspace: it opens the first tab the person may use and stays lit on all of them. */
function destination(ctx: Ctx, d: Destination, i: { size: number }): ShellItem | null {
  if (!d.ws) return d.href && d.perm && hasOrgPermission(ctx, d.perm) ? { href: d.href, label: d.label, icon: d.icon } : null;
  const tabs = rotaWorkspaceTabs(ctx, d.ws).filter((t) => t.href.startsWith("/rota"));
  if (!tabs.length) return null;
  const [home, ...rest] = tabs;
  // Someone who may only report incidents (a carer) sees that page under its own name, not a "Service Users" link
  // that would open something else.
  const label = d.ws === "people" && home!.key === "incidents" ? "Incidents" : d.label;
  const icon = label === "Incidents" ? <FirstAidKit key="i" {...i} /> : d.icon;
  const match = rest.map((t) => t.href.split("?")[0]!).filter((h, n, all) => h !== home!.href && all.indexOf(h) === n);
  return { href: home!.href, label, icon, ...(match.length ? { match } : {}), ...(label.length > 22 ? { wrap: true } : {}) };
}

export function rotaItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const destinations: Destination[] = [
    { label: "Rota Home", icon: <House key="i" {...i} />, href: "/rota", perm: "rota.view" },
    { label: "Daily Rota", icon: <ListChecks key="i" {...i} />, ws: "daily" },
    { label: "Visits Needing Attention", icon: <WarningOctagon key="i" {...i} />, ws: "attention" },
    { label: "The Monitor", icon: <Pulse key="i" {...i} />, ws: "monitor" },
    { label: "Daily Templates", icon: <Repeat key="i" {...i} />, ws: "templates" },
    { label: "Service Users", icon: <UsersThree key="i" {...i} />, ws: "people" },
    { label: "Staff & Workforce", icon: <IdentificationBadge key="i" {...i} />, ws: "staff" },
    { label: "Finance", icon: <Bank key="i" {...i} />, ws: "finance" },
    { label: "Reports", icon: <ChartLine key="i" {...i} />, ws: "reports" },
    // Carers have no office pages; their own visits are their one page in this module.
    { label: "My Visits", icon: <DeviceMobile key="i" {...i} />, href: "/carer", perm: "visit.own" },
  ];
  const out = destinations.map((d) => destination(ctx, d, i)).filter((x): x is ShellItem => x !== null);
  if (hasOrgPermission(ctx, "rota.settings")) out.push({ href: "/rota/settings", label: "Settings", icon: <GearSix key="i" {...i} />, separated: true });
  return out;
}

/** A workspace's tabs, under the page's title bar. Shown only when the workspace has more than one page for this person. */
export function RotaTabs({ ctx, ws, active }: { ctx: Ctx; ws: RotaWorkspace; active: string }) {
  const tabs = rotaWorkspaceTabs(ctx, ws);
  if (tabs.length < 2) return null;
  const label = { daily: "Daily Rota", attention: "Visits Needing Attention", monitor: "The Monitor", templates: "Daily Templates", people: "Service Users", staff: "Staff & Workforce", finance: "Finance", reports: "Reports" }[ws];
  return (
    <nav aria-label={`${label} pages`} className="ws-tabs print:hidden" data-testid={`rota-tabs-${ws}`}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="ws-tab" aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

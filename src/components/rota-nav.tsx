import Link from "@/components/link";
import { Bank, CalendarPlus, DeviceMobile, FirstAidKit, GearSix, House, IdentificationBadge, ListChecks, Repeat, UsersThree, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The Rostering & Care Management side menu: eight destinations and Settings, nothing else. Each destination is a
 * workspace; the pages that used to be separate menu entries are its tabs, and they keep their own addresses, so
 * bookmarks, notification links and server actions still work. Every tab appears only for people with the permission
 * its page checks on the server, and a destination appears only when the person may open at least one of its tabs.
 *
 * The Rota Dashboard, Daily Rota, Daily Templates, Unassigned Visits and Missed Calls are approved designs, so they do
 * not show the tab strip; their own buttons already lead to the other pages (see ROTA_NAVIGATION.md).
 *
 * There is no staff administration here: HR & Workforce owns the employee (creation, personal and employment details,
 * documents, checks, holidays and sickness). The rota keeps only its operational staff pages, Staff & Eligibility and
 * Staff Readiness, as Daily Rota tabs (HR_SINGLE_STAFF_RECORD.md).
 *
 * Every visit problem lives under Visits Needing Attention, the one to-do list: its full registers (Unassigned Visits,
 * Sickness & Holiday Cover, Missed Calls and Exceptions) are its tabs. The Monitor is the live view only.
 */
export type RotaWorkspace = "daily" | "attention" | "monitor" | "templates" | "people" | "finance" | "reports";
export type RotaTab = { key: string; label: string; href: string };

type TabDef = RotaTab & { perm: OrgPermission | OrgPermission[] };

const can = (ctx: Ctx, perm: OrgPermission | OrgPermission[]) => (Array.isArray(perm) ? perm : [perm]).some((p) => hasOrgPermission(ctx, p));

function tabDefs(ws: RotaWorkspace): TabDef[] {
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
        // Operational staff views: who can work, their working pattern, bookings and eligibility. Read from HR.
        { key: "staff", label: "Staff & Eligibility", href: "/rota/staff", perm: "staff.directory" },
        { key: "readiness", label: "Staff Readiness", href: "/rota/readiness", perm: "readiness.view" },
      ];
    case "attention":
      return [
        { key: "attention", label: "Visits Needing Attention", href: "/rota/attention", perm: ["rota.view", "rota.monitor"] },
        { key: "unassigned", label: "Unassigned Visits", href: "/rota/unassigned", perm: "rota.view" },
        { key: "cover", label: "Sickness & Holiday Cover", href: "/rota/cover", perm: "rota.view" },
        { key: "missed", label: "Missed Calls", href: "/rota/missed", perm: "rota.monitor" },
        { key: "exceptions", label: "Exceptions", href: "/rota/exceptions", perm: "rota.monitor" },
      ];
    case "monitor":
      return [
        { key: "monitor", label: "The Monitor", href: "/rota/monitor", perm: "rota.monitor" },
      ];
    case "templates":
      return [
        { key: "daily", label: "Daily Templates", href: "/rota/templates", perm: "rota.view" },
        { key: "advanced", label: "Advanced Templates", href: "/rota/templates/planner", perm: "rota.view" },
        { key: "routes", label: "Template Run Routes", href: "/rota/routes/templates", perm: "rota.view" },
      ];
    case "people":
      return [
        // All Service Users is the one service-user workspace (Add New, Update Existing and the directory). The old
        // Service User Management address redirects to it.
        { key: "directory", label: "All Service Users", href: "/rota/service-users", perm: "serviceUser.view" },
        { key: "coordinator", label: "Care Coordinator", href: "/rota/coordinator", perm: "serviceUser.documents" },
        // Care plans and risk assessments live in each service user's profile. The incident register stays here for
        // the organisation-wide view; each profile also lists that person's incidents.
        { key: "incidents", label: "Incidents", href: "/rota/incidents", perm: ["incident.manage", "incident.report"] },
        { key: "notes", label: "Visit Notes", href: "/rota/notes", perm: "rota.view" },
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
  return tabDefs(ws)
    .filter((t) => can(ctx, t.perm))
    .map(({ key, label, href }) => ({ key, label, href }));
}

/**
 * Care & Rostering in the Harbour menu (owner's decision, 13 Nov 2026): nine entries. An entry with more than one page
 * shows its pages as sub-tabs under the top bar (src/components/harbour/sub-tabs.tsx). This is grouping only: every
 * page keeps its address, and every page appears only for people with the permission its page checks on the server.
 */
export type CareGroupKey = "home" | "daily" | "attention" | "plan" | "templates" | "people" | "carers" | "finance" | "settings";

type CareGroup = { key: CareGroupKey; label: string; icon: (i: { size: number }) => React.ReactNode; tabs: TabDef[] };

const CARE_GROUPS: CareGroup[] = [
  { key: "home", label: "Rota Home", icon: (i) => <House key="i" {...i} />, tabs: [
    { key: "today", label: "Today", href: "/rota", perm: "rota.view" },
    { key: "monitor", label: "The Monitor", href: "/rota/monitor", perm: "rota.monitor" },
  ] },
  { key: "daily", label: "Daily Rota", icon: (i) => <ListChecks key="i" {...i} />, tabs: [
    { key: "visits", label: "Daily Rota", href: "/rota/visits", perm: "rota.view" },
  ] },
  { key: "attention", label: "Needs attention", icon: (i) => <WarningOctagon key="i" {...i} />, tabs: tabDefs("attention") },
  { key: "plan", label: "Plan the rota", icon: (i) => <CalendarPlus key="i" {...i} />, tabs: [
    { key: "planner", label: "Weekly Planner", href: "/rota/planner", perm: "rota.view" },
    { key: "advanced", label: "Advanced Rota", href: "/rota/advanced", perm: "rota.view" },
    { key: "build", label: "Build Rota", href: "/rota/build", perm: "rota.build" },
    { key: "optimise", label: "Generate & Optimise", href: "/rota/optimise", perm: "rota.view" },
    { key: "print", label: "Printable Rota", href: "/rota/print", perm: "rota.view" },
  ] },
  { key: "templates", label: "Templates & runs", icon: (i) => <Repeat key="i" {...i} />, tabs: [
    { key: "daily", label: "Daily Templates", href: "/rota/templates", perm: "rota.view" },
    { key: "advanced", label: "Advanced Templates", href: "/rota/templates/planner", perm: "rota.view" },
    { key: "routes", label: "Live Run Routes", href: "/rota/routes", perm: "rota.view" },
    { key: "template-routes", label: "Template Run Routes", href: "/rota/routes/templates", perm: "rota.view" },
  ] },
  { key: "people", label: "Service users", icon: (i) => <UsersThree key="i" {...i} />, tabs: [
    { key: "directory", label: "All service users", href: "/rota/service-users", perm: "serviceUser.view" },
    { key: "coordinator", label: "Care Coordinator", href: "/rota/coordinator", perm: "serviceUser.documents" },
    { key: "care-plans", label: "Care Plans", href: "/rota/care-plans", perm: "serviceUser.view" },
    { key: "risks", label: "Risk Assessments", href: "/rota/risks", perm: "serviceUser.view" },
    { key: "incidents", label: "Incidents", href: "/rota/incidents", perm: ["incident.manage", "incident.report"] },
    { key: "notes", label: "Visit Notes", href: "/rota/notes", perm: "rota.view" },
  ] },
  { key: "carers", label: "Carers", icon: (i) => <IdentificationBadge key="i" {...i} />, tabs: [
    { key: "staff", label: "Staff & Eligibility", href: "/rota/staff", perm: "staff.directory" },
    { key: "readiness", label: "Staff Readiness", href: "/rota/readiness", perm: "readiness.view" },
    { key: "carer", label: "Carer app", href: "/carer", perm: "visit.own" },
  ] },
  { key: "finance", label: "Finance", icon: (i) => <Bank key="i" {...i} />, tabs: [
    { key: "overview", label: "This week", href: "/rota/finance", perm: "finance.view" },
    ...tabDefs("finance").slice(1),
  ] },
  { key: "settings", label: "Rota Settings", icon: (i) => <GearSix key="i" {...i} />, tabs: [
    { key: "settings", label: "Rota Settings", href: "/rota/settings", perm: "rota.settings" },
  ] },
];

/** The Care & Rostering entries this person may open, each with the sub-pages they may open (in order). */
export function rotaItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const out: ShellItem[] = [];
  for (const g of CARE_GROUPS) {
    // The staff pages appear here only for people who also work the rota, as before the regroup (a finance officer
    // may open Staff & Eligibility but never had it in their menu).
    const tabs = g.tabs
      .filter((t) => can(ctx, t.perm) && (g.key !== "carers" || t.key === "carer" || hasOrgPermission(ctx, "rota.view")))
      .map(({ label, href }) => ({ label, href }));
    if (!tabs.length) continue;
    const [home] = tabs;
    // Someone whose only page here is their own visits (a carer) sees it under its own name.
    const own = g.key === "carers" && tabs.length === 1 && home!.href === "/carer";
    const incidentsOnly = g.key === "people" && tabs.length === 1 && home!.href === "/rota/incidents";
    const label = own ? "My Visits" : incidentsOnly ? "Incidents" : g.label;
    const icon = own ? <DeviceMobile key="i" {...i} /> : incidentsOnly ? <FirstAidKit key="i" {...i} /> : g.icon(i);
    const match = tabs.slice(1).map((t) => t.href.split("?")[0]!).filter((h, n, all) => h !== home!.href && all.indexOf(h) === n);
    out.push({ href: home!.href, label, icon, ...(match.length ? { match } : {}), ...(tabs.length > 1 ? { tabs, tabsKey: g.key } : {}) });
  }
  return out;
}

/** A workspace's tabs, under the page's title bar. Shown only when the workspace has more than one page for this person. */
export function RotaTabs({ ctx, ws, active }: { ctx: Ctx; ws: RotaWorkspace; active: string }) {
  // Care & Rostering pages get their sub-tabs from the shell (Harbour); Rota Reports belong to Reporting & Analytics.
  if (ws !== "reports") return null;
  const tabs = rotaWorkspaceTabs(ctx, ws);
  if (tabs.length < 2) return null;
  const label = { daily: "Daily Rota", attention: "Visits Needing Attention", monitor: "The Monitor", templates: "Daily Templates", people: "Service Users", finance: "Finance", reports: "Reports" }[ws];
  return (
    <nav aria-label={`${label} pages`} className="ws-tabs tabs-line print:hidden" data-testid={`rota-tabs-${ws}`}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="ws-tab tab-line" aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

import { ArrowsLeftRight, CalendarCheck, CalendarDots, CalendarPlus, ChartLine, ClipboardText, Coins, DeviceMobile, FirstAidKit, GearSix, House, IdentificationBadge, ListChecks, Path, Pulse, Receipt, Repeat, ShieldWarning, UsersThree, Wallet, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The Rostering & Care Management side menu: its subsections grouped by the job they serve. Each entry appears only
 * for people with the permission its page checks on the server. Entries for pages that are not built yet are marked
 * "Planned" and are not links.
 */
type Entry = [href: string, label: string, icon: React.ReactNode, perm: OrgPermission | OrgPermission[], built: boolean];

export function rotaItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const groups: [string, Entry[]][] = [
    [
      "Operations",
      [
        ["/rota", "Today", <House key="i" {...i} />, "rota.view", true],
        ["/rota/visits", "Daily Visits", <ListChecks key="i" {...i} />, "rota.view", true],
        ["/rota/planner", "Rota Planner", <CalendarDots key="i" {...i} />, "rota.view", true],
        ["/rota/unassigned", "Unassigned Visits", <WarningOctagon key="i" {...i} />, "rota.view", true],
        ["/rota/monitor", "Live Call Monitor", <Pulse key="i" {...i} />, "rota.monitor", true],
        ["/rota/routes", "Run Routes", <Path key="i" {...i} />, "rota.view", false],
      ],
    ],
    [
      "Planning",
      [
        ["/rota/templates", "Rota Templates", <Repeat key="i" {...i} />, "rota.view", true],
        ["/rota/templates/planner", "Template Planner", <ArrowsLeftRight key="i" {...i} />, "rota.view", true],
        ["/rota/build", "Build Rota", <CalendarPlus key="i" {...i} />, "rota.build", true],
      ],
    ],
    [
      "People",
      [
        ["/rota/service-users", "Service Users", <UsersThree key="i" {...i} />, "serviceUser.view", true],
        ["/rota/staff", "Staff & Eligibility", <IdentificationBadge key="i" {...i} />, "staff.directory", true],
      ],
    ],
    [
      "Care records",
      [
        ["/rota/care-plans", "Care Plans", <ClipboardText key="i" {...i} />, "serviceUser.view", false],
        ["/rota/risks", "Risk Assessments", <ShieldWarning key="i" {...i} />, "serviceUser.view", false],
        ["/rota/incidents", "Incidents", <FirstAidKit key="i" {...i} />, ["incident.manage", "incident.report"], false],
      ],
    ],
    [
      "Finance",
      [
        ["/rota/finance/timesheets", "Timesheets", <CalendarCheck key="i" {...i} />, "finance.view", false],
        ["/rota/finance/rates", "Funders & Rates", <Coins key="i" {...i} />, "finance.view", false],
        ["/rota/finance/invoices", "Invoice Preparation", <Receipt key="i" {...i} />, "finance.view", false],
        ["/rota/finance/payroll", "Payroll Preparation", <Wallet key="i" {...i} />, "finance.view", false],
      ],
    ],
    [
      "Reports & settings",
      [
        ["/rota/reports", "Rota Reports", <ChartLine key="i" {...i} />, "rota.view", false],
        ["/rota/settings", "Rostering Settings", <GearSix key="i" {...i} />, "rota.settings", true],
      ],
    ],
    ["My work", [["/carer", "My Visits", <DeviceMobile key="i" {...i} />, "visit.own", true]]],
  ];
  const can = (p: Entry[3]) => (Array.isArray(p) ? p : [p]).some((x) => hasOrgPermission(ctx, x));
  const out: ShellItem[] = [];
  for (const [group, entries] of groups) {
    const shown = entries.filter((e) => can(e[3]));
    shown.forEach(([href, label, icon, , built], n) => out.push({ href: built ? href : `#${label}`, label, icon, planned: !built, group: n === 0 ? group : undefined }));
  }
  return out;
}


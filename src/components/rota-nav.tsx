import { ArrowsLeftRight, Bank, Car, Printer, CalendarCheck, CalendarDots, CalendarPlus, ChartLine, ClipboardText, Coins, DeviceMobile, FirstAidKit, GearSix, House, IdentificationBadge, ListChecks, Path, Pulse, Receipt, Repeat, Notepad, SealCheck, ShieldWarning, Siren, UsersThree, Wallet, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The Rostering & Care Management side menu: its subsections grouped by the job they serve. Each entry appears only
 * for people with the permission its page checks on the server. Entries for pages that are not built yet are marked
 * "Planned" and are not links.
 */
type Entry = [href: string, label: string, icon: React.ReactNode, perm: OrgPermission | OrgPermission[], built: boolean];

export function rotaItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  // Sections follow the order of work the office already knows from OnePlan: Home, Rota, Templates, Users,
  // Invoicing/Wages, Reports. Care records sit with the people they belong to.
  const groups: [string, Entry[]][] = [
    ["Home", [["/rota", "Rota Dashboard", <House key="i" {...i} />, "rota.view", true]]],
    [
      "Rota",
      [
        ["/rota/visits", "Daily Rota", <ListChecks key="i" {...i} />, "rota.view", true],
        ["/rota/advanced", "Advanced Rota", <CalendarDots key="i" {...i} />, "rota.view", true],
        ["/rota/unassigned", "Unassigned Visits", <WarningOctagon key="i" {...i} />, "rota.view", true],
        ["/rota/monitor", "The Monitor", <Pulse key="i" {...i} />, "rota.monitor", true],
        ["/rota/exceptions", "Exceptions", <Siren key="i" {...i} />, "rota.monitor", true],
        ["/rota/notes", "Visit Notes", <Notepad key="i" {...i} />, "rota.view", true],
        ["/rota/routes", "Live Run Routes", <Path key="i" {...i} />, "rota.view", true],
        ["/rota/print", "Printable Rota", <Printer key="i" {...i} />, "rota.view", true],
        ["/rota/build", "Build Rota", <CalendarPlus key="i" {...i} />, "rota.build", true],
      ],
    ],
    [
      "Templates",
      [
        ["/rota/templates", "Daily Templates", <Repeat key="i" {...i} />, "rota.view", true],
        ["/rota/templates/planner", "Advanced Templates", <ArrowsLeftRight key="i" {...i} />, "rota.view", true],
        ["/rota/routes/templates", "Template Run Routes", <Path key="i" {...i} />, "rota.view", true],
      ],
    ],
    [
      "Users",
      [
        ["/rota/service-users", "Service Users", <UsersThree key="i" {...i} />, "serviceUser.view", true],
        ["/rota/staff", "Team Members", <IdentificationBadge key="i" {...i} />, "staff.directory", true],
        ["/rota/readiness", "Staff Readiness", <SealCheck key="i" {...i} />, "readiness.view", true],
        ["/rota/care-plans", "Care Plans", <ClipboardText key="i" {...i} />, "serviceUser.view", true],
        ["/rota/risks", "Risk Assessments", <ShieldWarning key="i" {...i} />, "serviceUser.view", true],
        ["/rota/incidents", "Incidents", <FirstAidKit key="i" {...i} />, ["incident.manage", "incident.report"], true],
      ],
    ],
    [
      "Invoicing/Wages",
      [
        ["/rota/finance", "Overview", <Bank key="i" {...i} />, "finance.view", true],
        ["/rota/finance/invoices", "Invoicing", <Receipt key="i" {...i} />, "finance.view", true],
        ["/rota/finance/payroll", "Wages", <Wallet key="i" {...i} />, "finance.view", true],
        ["/rota/finance/timesheets", "Timesheets", <CalendarCheck key="i" {...i} />, "finance.view", true],
        ["/rota/finance/mileage", "Mileage", <Car key="i" {...i} />, "finance.view", true],
        ["/rota/finance/rates", "Tariffs & Funders", <Coins key="i" {...i} />, "finance.view", true],
      ],
    ],
    [
      "Reports",
      [
        ["/rota/reports", "Rota Reports", <ChartLine key="i" {...i} />, "rota.view", true],
        ["/rota/settings", "Rota Settings", <GearSix key="i" {...i} />, "rota.settings", true],
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


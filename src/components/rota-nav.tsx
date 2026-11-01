import { ArrowsLeftRight, Bank, Car, Printer, CalendarCheck, CalendarDots, CalendarPlus, ChartLine, ClipboardText, Coins, DeviceMobile, FirstAidKit, GearSix, House, IdentificationBadge, ListChecks, Path, PhoneX, Pulse, Receipt, Repeat, Notepad, SealCheck, ShieldWarning, Siren, UsersThree, Wallet, UserSwitch, WarningOctagon, Faders, ChartBar, CalendarBlank, Plus, Airplane, AirplaneTilt, Heart, EnvelopeSimple, Confetti, FileText, Question } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { canUsePortal } from "@/server/auth/portals";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The Rostering & Care Management side menu. Its sections follow the order the office already knows from OnePlan:
 * Rota, Templates, Users, Invoicing/Wages, Reports, then Settings and Help. Only the Rota, Templates and Users
 * sections start open, and each shows its everyday pages first; the extra CSB pages sit in a folded "More" list.
 * Each entry appears only for people with the permission its page checks on the server. Entries for pages that are
 * not built yet are marked "Planned" and are not links.
 */
type Entry = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** The permission the page itself checks; null only for pages that are not built yet. */
  perm: OrgPermission | OrgPermission[] | null;
  /** Shown in the folded "More" list of its section. */
  more?: boolean;
  /** Extra condition the page checks on the server, beyond the permission. */
  show?: boolean;
};
type Section = { name: string; open: boolean; more?: string; entries: Entry[] };

const planned = (label: string, icon: React.ReactNode): Entry => ({ href: `#${label}`, label, icon, perm: null });

export function rotaItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  // Staff holidays and sickness are kept in the HR portal; the page checks HR access and an HR Hub login.
  const hrAbsences = canUsePortal(ctx, "hr") && Boolean(ctx.hrUserId);
  const sections: Section[] = [
    {
      name: "Rota",
      open: true,
      more: "More rota tools",
      entries: [
        { href: "/rota", label: "Rota Home", icon: <House key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/visits/new", label: "Add Visit", icon: <Plus key="i" {...i} />, perm: "rota.edit" },
        { href: "/rota/visits", label: "Daily Rota", icon: <ListChecks key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/advanced", label: "Advanced Rota", icon: <CalendarDots key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/routes", label: "Live Run Routes", icon: <Path key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/monitor", label: "The Monitor", icon: <Pulse key="i" {...i} />, perm: "rota.monitor" },
        { href: "/rota/print", label: "Printable Rota", icon: <Printer key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/build", label: "Build Rota", icon: <CalendarPlus key="i" {...i} />, perm: "rota.build" },
        { href: "/rota/planner", label: "Weekly Planner", icon: <CalendarBlank key="i" {...i} />, perm: "rota.view", more: true },
        { href: "/rota/unassigned", label: "Unassigned Visits", icon: <WarningOctagon key="i" {...i} />, perm: "rota.view", more: true },
        { href: "/rota/cover", label: "Sickness & Holiday Cover", icon: <UserSwitch key="i" {...i} />, perm: "rota.view", more: true },
        { href: "/rota/missed", label: "Missed Calls", icon: <PhoneX key="i" {...i} />, perm: "rota.monitor", more: true },
        { href: "/rota/exceptions", label: "Exceptions", icon: <Siren key="i" {...i} />, perm: "rota.monitor", more: true },
        { href: "/rota/notes", label: "Visit Notes", icon: <Notepad key="i" {...i} />, perm: "rota.view", more: true },
        { href: "/rota/optimise", label: "Generate & Optimise", icon: <Faders key="i" {...i} />, perm: "rota.view", more: true },
      ],
    },
    {
      name: "Templates",
      open: true,
      entries: [
        { href: "/rota/templates", label: "Daily Templates", icon: <Repeat key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/templates/planner", label: "Advanced Templates", icon: <ArrowsLeftRight key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/routes/templates", label: "Template Run Routes", icon: <Path key="i" {...i} />, perm: "rota.view" },
      ],
    },
    {
      name: "Users",
      open: true,
      more: "Care records",
      entries: [
        { href: "/rota/staff", label: "Team Members", icon: <IdentificationBadge key="i" {...i} />, perm: "staff.directory" },
        { href: "/workforce/absences", label: "Staff Time Off", icon: <AirplaneTilt key="i" {...i} />, perm: "rota.view", show: hrAbsences },
        { href: "/rota/service-users", label: "Service Users", icon: <UsersThree key="i" {...i} />, perm: "serviceUser.view" },
        planned("Service User Absences", <Airplane key="i" {...i} />),
        planned("Preference Manager", <Heart key="i" {...i} />),
        planned("Communication Log", <EnvelopeSimple key="i" {...i} />),
        { href: "/rota/care-plans", label: "Care Plans", icon: <ClipboardText key="i" {...i} />, perm: "serviceUser.view", more: true },
        { href: "/rota/risks", label: "Risk Assessments", icon: <ShieldWarning key="i" {...i} />, perm: "serviceUser.view", more: true },
        { href: "/rota/incidents", label: "Incidents", icon: <FirstAidKit key="i" {...i} />, perm: ["incident.manage", "incident.report"], more: true },
        { href: "/rota/readiness", label: "Staff Readiness", icon: <SealCheck key="i" {...i} />, perm: "readiness.view", more: true },
      ],
    },
    {
      name: "Invoicing/Wages",
      open: false,
      entries: [
        { href: "/rota/finance/invoices", label: "Invoicing", icon: <Receipt key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance/payroll", label: "Wages", icon: <Wallet key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance/timesheets", label: "Timesheets", icon: <CalendarCheck key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance/mileage", label: "Mileage", icon: <Car key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance/rates", label: "Tariffs & Funders", icon: <Coins key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance/rates?tab=holidays", label: "Bank Holidays", icon: <Confetti key="i" {...i} />, perm: "finance.view" },
        { href: "/rota/finance", label: "Finance Overview", icon: <Bank key="i" {...i} />, perm: "finance.view" },
        planned("Holiday Report", <FileText key="i" {...i} />),
      ],
    },
    {
      name: "Reports",
      open: false,
      entries: [
        { href: "/rota/reports", label: "Rota Reports", icon: <ChartLine key="i" {...i} />, perm: "rota.view" },
        { href: "/rota/insights", label: "Rota Insights", icon: <ChartBar key="i" {...i} />, perm: "rota.view" },
      ],
    },
    { name: "Settings", open: false, entries: [{ href: "/rota/settings", label: "Rota Settings", icon: <GearSix key="i" {...i} />, perm: "rota.settings" }] },
    { name: "Help & Training", open: false, entries: [planned("Guides and videos", <Question key="i" {...i} />)] },
    { name: "My work", open: true, entries: [{ href: "/carer", label: "My Visits", icon: <DeviceMobile key="i" {...i} />, perm: "visit.own" }] },
  ];

  const allowed = (e: Entry) => (e.show ?? true) && (e.perm === null || (Array.isArray(e.perm) ? e.perm : [e.perm]).some((x) => hasOrgPermission(ctx, x)));
  // A section appears only when the person can open at least one real page in it, so nobody sees a heading of
  // "Planned" rows alone. Help & Training, not built yet, is shown to office staff who use the rota.
  const anyReal = (s: Section) => s.entries.some((e) => e.perm !== null && allowed(e));
  const allPlanned = (s: Section) => s.entries.every((e) => e.perm === null);
  const out: ShellItem[] = [];
  for (const s of sections) {
    if (allPlanned(s) ? !hasOrgPermission(ctx, "rota.view") : !anyReal(s)) continue;
    const shown = s.entries.filter(allowed);
    shown.forEach((e, n) => {
      const isPlanned = e.href.startsWith("#");
      out.push({
        href: e.href,
        label: e.label,
        icon: e.icon,
        planned: isPlanned || undefined,
        group: n === 0 ? s.name : undefined,
        fold: n === 0 ? (s.open ? "open" : "closed") : undefined,
        more: e.more ? s.more : undefined,
      });
    });
  }
  return out;
}

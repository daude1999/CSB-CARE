import { Briefcase, FolderOpen, GearSix, GraduationCap, House, UsersThree, CalendarDots } from "@phosphor-icons/react/dist/ssr";
import type { Ctx } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * HR & Workforce has seven destinations (owner's brief of 1 Nov 2026: "fewer predictable destinations, not arbitrary
 * hiding"). Every screen the HR menu listed before is still one click away: My Tasks and Alerts open from the HR
 * Dashboard (and keep it lit), Compliance checks sit beside Training under Checks & Training, Availability beside
 * Holidays & Sickness, and Branches beside Settings. Old addresses are unchanged.
 *
 * The portal itself is shown only to people allowed into it (canUsePortal); the HR Hub's screens check access again on
 * the server.
 */
export function hrItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const hrLogin = Boolean(ctx.hrUserId);
  const items: (ShellItem & { show: boolean })[] = [
    { href: "/hr/dashboard", label: "HR Dashboard", icon: <House {...i} />, match: ["/hr/alerts"], show: true },
    { href: "/hr/people", label: "People", icon: <UsersThree {...i} />, match: ["/hr/imports"], show: true },
    { href: "/hr/recruitment", label: "Recruitment", icon: <Briefcase {...i} />, show: hrLogin },
    { href: "/hr/training", label: "Checks & Training", icon: <GraduationCap {...i} />, match: ["/hr/compliance"], show: true },
    { href: "/hr/documents", label: "Documents", icon: <FolderOpen {...i} />, show: true },
    { href: "/workforce/absences", label: "Time Off & Availability", icon: <CalendarDots {...i} />, match: ["/workforce/availability"], show: hrLogin },
    { href: "/hr/settings", label: "Settings", icon: <GearSix {...i} />, match: ["/hr/branches"], show: true },
  ];
  return items.filter((x) => x.show).map(({ show: _show, ...x }) => x);
}

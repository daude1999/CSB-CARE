import { Bell, Briefcase, Buildings, CalendarDots, ClockCounterClockwise, FolderOpen, GearSix, GraduationCap, House, ListChecks, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";
import type { Ctx } from "@/server/auth/rbac";
import type { ShellItem } from "@/components/portal-switcher";

/**
 * The HR & Workforce side menu: the HR Hub's own screens in the order of its original menu, then the workforce pages
 * the rota relies on. The portal itself is shown only to people allowed into it (canUsePortal); the HR Hub's screens
 * check access again on the server.
 */
export function hrItems(ctx: Ctx, i: { size: number }): ShellItem[] {
  const hrLogin = Boolean(ctx.hrUserId);
  const groups: [string, [href: string, label: string, icon: React.ReactNode, show: boolean][]][] = [
    ["Home", [["/hr/dashboard", "HR Dashboard", <House key="i" {...i} />, true]]],
    [
      "People",
      [
        ["/hr/people", "People", <UsersThree key="i" {...i} />, true],
        ["/hr/alerts?view=tasks", "My Tasks", <ListChecks key="i" {...i} />, true],
        ["/hr/recruitment", "Recruitment", <Briefcase key="i" {...i} />, hrLogin],
      ],
    ],
    [
      "HR Management",
      [
        ["/hr/compliance", "Compliance", <ShieldCheck key="i" {...i} />, true],
        ["/hr/documents", "Documents", <FolderOpen key="i" {...i} />, true],
        ["/hr/training", "Training", <GraduationCap key="i" {...i} />, true],
      ],
    ],
    [
      "Workforce",
      [
        ["/workforce/absences", "Holidays & Sickness", <CalendarDots key="i" {...i} />, hrLogin],
        ["/workforce/availability", "Availability", <ClockCounterClockwise key="i" {...i} />, hrLogin],
      ],
    ],
    [
      "Organisation",
      [
        ["/hr/branches", "Branches", <Buildings key="i" {...i} />, true],
        ["/hr/alerts", "Alerts", <Bell key="i" {...i} />, true],
        ["/hr/settings", "Settings", <GearSix key="i" {...i} />, true],
      ],
    ],
  ];
  return groups.flatMap(([group, entries]) =>
    entries.filter(([, , , show]) => show).map(([href, label, icon], n) => ({ href, label, icon, ...(n === 0 ? { group } : {}) })),
  );
}

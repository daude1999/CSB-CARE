import Link from "@/components/link";

/** HR & Workforce destinations that hold more than one existing page (see hr-nav.tsx). */
export type HrSection = "home" | "checks" | "timeoff" | "settings";
export type HrTab = { key: string; label: string; href: string };

/** The tabs inside one HR destination. Each tab is an existing page at its original address. */
export function hrTabs(section: HrSection, opts: { hrLogin: boolean }): HrTab[] {
  switch (section) {
    case "home":
      return [
        { key: "dashboard", label: "Overview", href: "/hr/dashboard" },
        { key: "tasks", label: "My Tasks", href: "/hr/alerts?view=tasks" },
        { key: "alerts", label: "Alerts", href: "/hr/alerts" },
      ];
    case "checks":
      return [
        { key: "training", label: "Training & Readiness", href: "/hr/training" },
        { key: "compliance", label: "Checks Register", href: "/hr/compliance" },
      ];
    case "timeoff":
      return opts.hrLogin
        ? [
            { key: "absences", label: "Holidays & Sickness", href: "/workforce/absences" },
            { key: "availability", label: "Availability", href: "/workforce/availability" },
          ]
        : [];
    case "settings":
      return [
        { key: "settings", label: "HR Settings", href: "/hr/settings" },
        { key: "branches", label: "Branches", href: "/hr/branches" },
      ];
  }
}

/** Tabs under an HR page's title bar; the page on screen is marked as current. Uses the platform's tab style. */
export function HrTabs({ tabs, active, label, branch }: { tabs: HrTab[]; active: string; label: string; branch?: string }) {
  if (tabs.length < 2) return null;
  const withBranch = (href: string) => {
    if (!branch || branch === "all" || !href.startsWith("/hr/")) return href;
    return `${href}${href.includes("?") ? "&" : "?"}branch=${encodeURIComponent(branch)}`;
  };
  return (
    <nav aria-label={label} className="ws-tabs" data-testid="hr-tabs">
      {tabs.map((t) => (
        <Link key={t.key} href={withBranch(t.href)} className="ws-tab" aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

import Link from "@/components/link";

/**
 * Administration pages that are two halves of one job share one menu entry and a tab strip, so each job has one
 * place: who can sign in (office users and carer app logins) and where the organisation works (branches and areas).
 * Every page still checks its own permission on the server.
 */
const GROUPS = {
  logins: { label: "Users & Logins", tabs: [{ key: "users", label: "Office users", href: "/admin/users" }, { key: "workforce", label: "Carer app logins & HR sync", href: "/admin/workforce" }] },
  places: { label: "Branches & Areas", tabs: [{ key: "branches", label: "Branches", href: "/admin/branches" }, { key: "areas", label: "Areas", href: "/admin/areas" }] },
} as const;

export type AdminGroup = keyof typeof GROUPS;

export function AdminTabs({ group, active }: { group: AdminGroup; active: string }) {
  const g = GROUPS[group];
  return (
    <nav aria-label={`${g.label} pages`} className="ws-tabs tabs-line" data-testid={`admin-tabs-${group}`}>
      {g.tabs.map((t) => (
        <Link key={t.key} href={t.href} className="ws-tab tab-line" aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

import Link from "@/components/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";

type Entry = { href: string; label: string; detail: string; hub?: boolean };
type Group = { name: string; entries: Entry[] };

/**
 * Every settings screen in the platform, in one list, so nobody has to remember which module keeps which switch.
 * Each module's own settings page stays where it is (its gear icon still opens it); this is the one place that lists
 * them all. Only the screens this person may open are listed, and each page checks access again on the server.
 */
export function settingsDirectory(ctx: Ctx): Group[] {
  const can = (p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);
  const groups: Group[] = [
    {
      name: "Organisation",
      entries: [
        ...(can("org.manage") ? [{ href: "#business", label: "Business details", detail: "Name, address and contacts used in every policy and download (below)" }] : []),
        ...(can("org.manage") ? [{ href: "/admin/users", label: "Users & Logins", detail: "Office users, roles and branches; carer app logins" }] : []),
        ...(can("org.manage") ? [{ href: "/admin/branches", label: "Branches & Areas", detail: "Where you work, and which coordinators cover each area" }] : []),
      ],
    },
    {
      name: "Rota & care",
      entries: can("rota.settings") ? [{ href: "/rota/settings", label: "Rostering Settings", detail: "Rota rules, call types, care tasks, medication records, Care Summary" }] : [],
    },
    {
      name: "HR & recruitment",
      entries: ctx.hrUserId
        ? [
            { href: "/hr/settings", label: "HR Settings", detail: "HR accounts, reminders, required checks by role, document access", hub: true },
            { href: "/hr/recruitment/settings", label: "Recruitment Settings", detail: "Hiring stages and recruitment options", hub: true },
          ]
        : [],
    },
    {
      name: "Policy & compliance",
      entries: [
        ...(can("org.manage") ? [{ href: "#approval-rules", label: "Policy approval rules", detail: "How many approvers a policy needs before publishing (below)" }] : []),
        ...(can("staff.view") ? [{ href: "/staff/rules", label: "Policy Sign-off rules", detail: "Who is asked to read which policies" }] : []),
        ...(can("readiness.manage") ? [{ href: "/admin/readiness", label: "Staff Readiness Rules", detail: "What each role, task or person needs before someone may work" }] : []),
      ],
    },
    {
      name: "Records",
      entries: can("org.manage") ? [{ href: "/admin/audit", label: "Activity Log", detail: "Every recorded change: who, what and when" }] : [],
    },
  ];
  return groups.filter((g) => g.entries.length);
}

export function SettingsDirectory({ ctx }: { ctx: Ctx }) {
  const groups = settingsDirectory(ctx);
  return (
    <section aria-labelledby="all-settings-heading" className="mb-4 rounded-[3px] bg-white px-5 pb-4 pt-4" data-testid="settings-directory">
      <h2 id="all-settings-heading" className="text-[19px] font-normal tracking-normal text-slate-800">All settings</h2>
      <p className="mb-3 text-[13px] text-slate-600">Every settings screen in the platform, in one place. Each module&apos;s gear icon opens the same screen.</p>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.name}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{g.name}</h3>
            <ul className="divide-y divide-slate-100">
              {g.entries.map((e) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-[#0b1530]">{e.label}</span><span className="block text-[12.5px] text-slate-600">{e.detail}</span></span>
                    <CaretRight size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
                  </>
                );
                const cls = "flex items-center gap-3 py-2 no-underline hover:bg-slate-50";
                // HR Hub pages bring their own style sheet, so links into them are full page loads.
                return <li key={e.href}>{e.hub || e.href.startsWith("#") ? <a href={e.href} className={cls}>{body}</a> : <Link href={e.href} className={cls}>{body}</Link>}</li>;
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

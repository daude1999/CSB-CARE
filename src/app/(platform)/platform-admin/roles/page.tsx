import type { OrgRole } from "@prisma/client";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { ORG_ROLE_NAMES, platformStaff, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { PERMISSION_GROUPS, roleMatrix } from "@/server/platform/permissions";
import { requirePlatform } from "@/server/platform/access";
import { PLATFORM_PERMISSIONS } from "@/server/auth/rbac";
import { Pill, PxHeader, PxPanel, pxSecondary, pxSm, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roles & Permissions" };

const SHADE: Record<string, string> = { "No access": "text-px-faint", View: "bg-px-info-bg text-px-info", Create: "bg-px-ok-bg text-px-ok", Edit: "bg-px-warn-bg text-px-warn", Manage: "bg-px-accent-soft text-px-accent-strong", Administrative: "bg-px-ink text-white" };
const Level = ({ level, title }: { level: string; title?: string }) => <span title={title} className={`inline-block whitespace-nowrap rounded-[4px] px-1.5 py-[1px] text-caption font-medium ${SHADE[level]}`}>{level === "No access" ? "—" : level}</span>;

/**
 * The permission registry the server enforces, read-only. Roles are assigned per person and organisation from a
 * person's account or a client's Users & Permissions tab. Custom roles are not built.
 */
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.accounts");
  const sp = await searchParams;
  const roles = Object.keys(ORG_ROLE_NAMES) as OrgRole[];
  const matrix = roleMatrix(roles);
  const staff = await platformStaff(ctx);
  const picked = matrix.find((r) => r.role === sp.role) ?? matrix[0]!;
  return (
    <>
      <PxHeader title="Roles & Permissions" description="What each organisation role can do in each module, exactly as the server enforces it. Assign roles from a person's account or a client's Users & Permissions tab." />
      <PxPanel title="Organisation roles by module" description="The highest level each role has in each module. Hover a level for its permissions; choose a role below for the full list." flush className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-meta">
            <thead>
              <tr className="border-b border-px-divider bg-px-field text-left text-micro font-medium uppercase tracking-[0.04em] text-px-muted">
                <th scope="col" className="sticky left-0 bg-px-field px-4 py-2 font-medium">Role</th>
                {PERMISSION_GROUPS.map((g) => <th key={g} scope="col" className="px-1.5 py-2 align-bottom font-medium leading-tight">{g}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.role} className={`border-b border-px-row last:border-0 ${r.role === picked.role ? "bg-px-accent-tint" : "hover:bg-px-hover"}`}>
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-inherit px-4 py-2 text-left text-meta font-medium"><Link href={`?role=${r.role}#role`} scroll={false} className="text-px-ink no-underline hover:text-px-accent">{ORG_ROLE_NAMES[r.role]}</Link></th>
                  {r.groups.map((g) => <td key={g.group} className="px-1.5 py-1.5"><Level level={g.level} title={g.permissions.map((p) => p.key).join(", ")} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PxPanel>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <PxPanel id="role" title={ORG_ROLE_NAMES[picked.role]} description="Every permission this role has, grouped by module." actions={
          <form method="get" className="flex items-center gap-1.5">
              <label htmlFor="role-pick" className="sr-only">Role</label>
              <select id="role-pick" name="role" defaultValue={picked.role} className="input !h-8 !w-auto !text-meta">{roles.map((r) => <option key={r} value={r}>{ORG_ROLE_NAMES[r]}</option>)}</select>
              <button className={`${pxSecondary} ${pxSm}`}>Show</button>
          </form>
        }>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {picked.groups.map((g) => (
              <div key={g.group} className="min-w-0 border-b border-px-row pb-2.5">
                <dt className="flex items-center justify-between gap-2 text-meta font-medium text-px-ink">{g.group}<Level level={g.level} /></dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {g.permissions.length ? g.permissions.map((p) => <code key={p.key} className="rounded-[4px] bg-px-row px-1.5 py-[1px] text-caption text-px-body">{p.key}</code>) : <span className="text-caption text-px-subtle">No access</span>}
                </dd>
              </div>
            ))}
          </dl>
        </PxPanel>
        <div className="space-y-4">
          <PxPanel title="Evantix platform staff" description="Granted from a person's account, with the administrator's password. Organisation administrators can never grant them." flush>
            <div className="px-4">
              <Table label="Platform staff" minWidth={340} head={["Person", "Platform roles", "Status"]}>
                {staff.map((s) => <tr key={s.id}><td><Link href={`/platform-admin/users/${s.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{s.name}</Link><span className="block text-caption text-px-muted">{s.email}</span></td><td className="text-meta">{s.platformRoles.map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES]).join(", ")}</td><td>{s.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : <Pill value="ACTIVE" />}</td></tr>)}
              </Table>
            </div>
          </PxPanel>
          <PxPanel title="Platform permissions" flush>
            <ul className="divide-y divide-px-row text-meta">{Object.entries(PLATFORM_PERMISSIONS).map(([k, v]) => <li key={k} className="flex items-center justify-between gap-3 px-4 py-2"><code className="text-px-ink">{k}</code><span className="text-right text-px-muted">{(v as readonly string[]).map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES] ?? r).join(", ")}</span></li>)}</ul>
          </PxPanel>
          <PxPanel title="Safeguards">
            <ul className="space-y-1.5 text-meta text-px-body">
              <li>Every permission is checked on the server for every page and action.</li>
              <li>Roles come from a fixed list; a request naming any other role is refused.</li>
              <li>Each client keeps one active organisation administrator, and the platform one platform administrator.</li>
              <li>Changes apply at the person&apos;s next click; removing an administrator role also ends their sessions.</li>
              <li>Every change is in the Security Audit with before and after. Custom roles are not available yet.</li>
            </ul>
          </PxPanel>
        </div>
      </div>
    </>
  );
}

import type { OrgRole } from "@prisma/client";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { ORG_ROLE_NAMES, platformStaff, PLATFORM_ROLE_NAMES } from "@/server/platform/accounts";
import { PERMISSION_GROUPS, roleMatrix } from "@/server/platform/permissions";
import { requirePlatform } from "@/server/platform/access";
import { PLATFORM_PERMISSIONS } from "@/server/auth/rbac";
import { Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roles & Permissions" };

const SHADE: Record<string, string> = { "No access": "text-[#a3a9b7]", View: "bg-[#eef4ff] text-[#1d4f91]", Create: "bg-[#e6f6ed] text-[#17663a]", Edit: "bg-[#fff3d6] text-[#8a5300]", Manage: "bg-[#efe9fe] text-[#5b21b6]", Administrative: "bg-[#0f1b3d] text-white" };

/** The role-based permission registry, read-only: roles are assigned per person and organisation from All Users or a client's Users tab. */
export default async function RolesPage() {
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.accounts");
  const roles = Object.keys(ORG_ROLE_NAMES) as OrgRole[];
  const matrix = roleMatrix(roles);
  const staff = await platformStaff(ctx);
  return (
    <>
      <PxHeader title="Roles & Permissions" description="What each organisation role can do in each module, from the permission registry the server enforces. Levels are descriptions; open a role for the exact permissions. Custom roles are not available yet and need their own reviewed change." />
      <PxPanel title="Organisation roles by module">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
            <thead><tr className="border-b border-[#eef0f5] text-left text-[11.5px] uppercase text-[#5b6478]"><th scope="col" className="px-4 py-2 font-medium">Role</th>{PERMISSION_GROUPS.map((g) => <th key={g} scope="col" className="px-1.5 py-2 font-medium">{g}</th>)}</tr></thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.role} className="border-b border-[#f1f2f6]">
                  <th scope="row" className="whitespace-nowrap px-4 py-2 text-left font-medium">{ORG_ROLE_NAMES[r.role]}</th>
                  {r.groups.map((g) => <td key={g.group} className="px-1.5 py-1.5"><span title={g.permissions.map((p) => p.key).join(", ")} className={`inline-block whitespace-nowrap rounded-[4px] px-1.5 py-0.5 ${SHADE[g.level]}`}>{g.level}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PxPanel>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PxPanel title="Exact permissions per role">
          {matrix.map((r) => (
            <details key={r.role} className="border-b border-[#f1f2f6] py-2 last:border-0">
              <summary className="cursor-pointer text-[13.5px] font-medium">{ORG_ROLE_NAMES[r.role]}</summary>
              <ul className="mt-1 space-y-1 text-[12.5px]">{r.groups.filter((g) => g.permissions.length).map((g) => <li key={g.group}><span className="font-medium">{g.group}:</span> {g.permissions.map((p) => `${p.key} (${p.level.toLowerCase()})`).join(", ")}</li>)}</ul>
            </details>
          ))}
        </PxPanel>
        <div className="space-y-4">
          <PxPanel title="Evantix platform staff" description="Platform roles are granted from a person's account page, with your password. Organisation administrators can never grant them.">
            <Table head={["Person", "Platform roles", "Status"]}>
              {staff.map((s) => <tr key={s.id}><td><Link href={`/platform-admin/users/${s.id}`}>{s.name}</Link><span className="block text-[12px] text-[#5b6478]">{s.email}</span></td><td>{s.platformRoles.map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES]).join(", ")}</td><td>{s.deactivatedAt ? <Pill value="SUSPENDED" label="Deactivated" /> : <Pill value="ACTIVE" />}</td></tr>)}
            </Table>
          </PxPanel>
          <PxPanel title="Platform permissions">
            <ul className="space-y-1 text-[12.5px]">{Object.entries(PLATFORM_PERMISSIONS).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="font-mono">{k}</span><span className="text-[#5b6478]">{(v as readonly string[]).map((r) => PLATFORM_ROLE_NAMES[r as keyof typeof PLATFORM_ROLE_NAMES] ?? r).join(", ")}</span></li>)}</ul>
          </PxPanel>
          <PxPanel title="Safeguards">
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              <li>Every permission is checked on the server for every page and action.</li>
              <li>Organisation roles come from a fixed list; a request naming any other role is refused.</li>
              <li>Each organisation keeps at least one active organisation administrator, and the platform at least one platform administrator.</li>
              <li>Role and branch changes apply at the person&apos;s next click; removing an administrator role or a platform role also ends their sessions.</li>
              <li>Every change is in the Security Audit with before and after.</li>
            </ul>
          </PxPanel>
        </div>
      </div>
    </>
  );
}

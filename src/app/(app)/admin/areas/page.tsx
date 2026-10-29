import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { areaActiveAction, memberAreasAction, saveAreaAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const COORD_ROLES = ["CARE_MANAGER", "CARE_COORDINATOR"];

export default async function AreasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "rota.settings")) notFound();
  const org = ctx.organisationId!;
  const [areas, branches, members] = await Promise.all([
    db.area.findMany({ where: { organisationId: org }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { branch: { select: { name: true } }, _count: { select: { staff: true, serviceUsers: true } } } }),
    db.branch.findMany({ where: { organisationId: org }, orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { organisationId: org, roles: { hasSome: ["CARE_MANAGER", "CARE_COORDINATOR"] } }, include: { user: { select: { name: true, email: true } }, areas: true }, orderBy: { user: { name: "asc" } } }),
  ]);
  const canMembers = hasOrgPermission(ctx, "org.manage");
  const back = "/admin/areas";
  return (
    <>
      <PageHeader title="Areas" back="/settings" subtitle="Geographical patches used to group service users, carers and visits. A coordinator given areas sees and changes only visits in those areas; one with no areas covers the whole organisation." />
      <Flash searchParams={sp} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Areas">
          {areas.length ? (
            <ul className="rows">
              {areas.map((a) => (
                <li key={a.id} className="py-3">
                  <form action={saveAreaAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="areaId" value={a.id} />
                    <label><span className="label">Colour</span><input type="color" name="colour" defaultValue={a.colour} className="h-[38px] w-12 rounded border border-slate-300" /></label>
                    <label className="flex-1"><span className="label">Name</span><input name="name" defaultValue={a.name} required className="input" /></label>
                    <label><span className="label">Branch</span><select name="branchId" defaultValue={a.branchId ?? ""} className="input"><option value="">None</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                    <button className="btn-secondary">Save</button>
                  </form>
                  <div className="mt-1.5 flex items-center gap-2 text-[13px] text-slate-600">
                    {a.active ? null : <Badge>Switched off</Badge>}
                    <span>{a._count.serviceUsers} service users · {a._count.staff} carers</span>
                    <form action={areaActiveAction} className="ml-auto"><input type="hidden" name="back" value={back} /><input type="hidden" name="areaId" value={a.id} /><input type="hidden" name="active" value={a.active ? "0" : "1"} /><button className="btn-secondary px-2 py-0.5 text-[13px]">{a.active ? "Switch off" : "Switch on"}</button></form>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No areas yet.</Empty>}
          <form action={saveAreaAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
            <input type="hidden" name="back" value={back} />
            <label><span className="label">Colour</span><input type="color" name="colour" defaultValue="#4a7fc9" className="h-[38px] w-12 rounded border border-slate-300" /></label>
            <label className="flex-1"><span className="label">New area</span><input name="name" required className="input" /></label>
            <label><span className="label">Branch</span><select name="branchId" className="input"><option value="">None</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <button className="btn-primary">Add area</button>
          </form>
        </Card>
        <Card title="Coordinators’ areas">
          {members.length ? (
            <ul className="rows">
              {members.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="text-[14.5px] font-medium">{m.user.name} <span className="font-normal text-slate-500">· {m.roles.filter((r) => COORD_ROLES.includes(r)).map((r) => r.replace("CARE_", "").toLowerCase()).join(", ")}</span></div>
                  <form action={memberAreasAction} className="mt-1.5 flex flex-wrap items-center gap-3">
                    <fieldset disabled={!canMembers} className="flex flex-wrap gap-3">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      {areas.filter((a) => a.active).map((a) => <label key={a.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="areaIds" value={a.id} defaultChecked={m.areas.some((x) => x.areaId === a.id)} className="h-4 w-4" /> {a.name}</label>)}
                      {canMembers ? <button className="btn-secondary py-1">Save</button> : null}
                    </fieldset>
                    {!m.areas.length ? <span className="text-[12.5px] text-slate-500">Whole organisation</span> : null}
                  </form>
                </li>
              ))}
            </ul>
          ) : <Empty>No care managers or coordinators yet.</Empty>}
        </Card>
      </div>
    </>
  );
}

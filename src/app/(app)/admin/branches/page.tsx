import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { hrBranches, listBranches } from "@/server/admin/branches";
import { memberBranchesAction, saveBranchAction } from "@/app/admin-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Branches are the organisation's operational units. Areas belong to a branch, staff come from HR by branch, and a
 * member's branch grants decide what they may see. Everything here is enforced on the server on every request.
 */
export default async function BranchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const org = ctx.organisationId!;
  const [branches, hr, members] = await Promise.all([
    listBranches(ctx),
    hrBranches(org),
    db.membership.findMany({ where: { organisationId: org }, include: { user: { select: { name: true, email: true } }, branches: true, branch: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  const back = "/admin/branches";
  const hrName = new Map(hr.map((b) => [b.id, b.name]));
  return (
    <>
      <PageHeader title="Branches" back="/settings" subtitle="Each branch maps to its HR & Workforce branch so staff records arrive in the right place. A member given branches sees only those branches' service users, visits, staff, timesheets and audits; one with none covers the whole organisation." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="Branches">
          {branches.length ? (
            <ul className="rows">
              {branches.map((b) => (
                <li key={b.id} className="py-3">
                  <form action={saveBranchAction} className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="branchId" value={b.id} />
                    <label className="col-span-2"><span className="label">Name</span><input name="name" defaultValue={b.name} required className="input" /></label>
                    <label><span className="label">CQC location ID</span><input name="cqcLocationId" defaultValue={b.cqcLocationId ?? ""} className="input" /></label>
                    <label><span className="label">HR branch</span>
                      {hr.length ? (
                        <select name="hrBranchKey" defaultValue={b.hrBranchKey ?? ""} className="input"><option value="">Not mapped</option>{hr.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
                      ) : (
                        <input name="hrBranchKey" defaultValue={b.hrBranchKey ?? ""} className="input" placeholder="HR branch id" />
                      )}
                    </label>
                    <label className="col-span-2 md:col-span-3"><span className="label">Address</span><input name="address" defaultValue={b.address ?? ""} className="input" /></label>
                    <div className="flex items-end"><button className="btn-secondary">Save</button></div>
                  </form>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                    {b.hrBranchKey ? <Badge tone="green">HR: {hrName.get(b.hrBranchKey) ?? b.hrBranchKey}</Badge> : <Badge tone="amber">Not mapped to HR: staff from HR cannot be placed here</Badge>}
                    <span>{b._count.areas} areas · {b._count.staff} staff · {b._count.serviceUsers} service users · {b._count.grants} members limited to it</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No branches yet. Add the first one below.</Empty>}
          <form action={saveBranchAction} className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 md:grid-cols-4">
            <input type="hidden" name="back" value={back} />
            <label className="col-span-2"><span className="label">New branch</span><input name="name" required className="input" placeholder="e.g. Tower Hamlets" /></label>
            <label><span className="label">HR branch</span>
              {hr.length ? (
                <select name="hrBranchKey" className="input" defaultValue=""><option value="">Not mapped</option>{hr.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              ) : <input name="hrBranchKey" className="input" placeholder="HR branch id" />}
            </label>
            <div className="flex items-end"><button className="btn-primary">Add branch</button></div>
          </form>
        </Card>
        <Card title="Members’ branch access">
          {members.length ? (
            <ul className="rows">
              {members.map((m) => (
                <li key={m.id} className="py-3">
                  <div className="text-[14.5px] font-medium">{m.user.name} <span className="font-normal text-slate-500">· {m.user.email}{m.branch ? ` · based at ${m.branch.name}` : ""}</span></div>
                  <form action={memberBranchesAction} className="mt-1.5 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="membershipId" value={m.id} />
                    {branches.map((b) => <label key={b.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="branchIds" value={b.id} defaultChecked={m.branches.some((x) => x.branchId === b.id)} className="h-4 w-4" /> {b.name}</label>)}
                    <button className="btn-secondary py-1">Save</button>
                    {!m.branches.length ? <span className="text-[12.5px] text-slate-500">Whole organisation</span> : null}
                  </form>
                </li>
              ))}
            </ul>
          ) : <Empty>No members yet.</Empty>}
        </Card>
      </div>
    </>
  );
}

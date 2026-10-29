import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaScope, staffDirectoryWhere } from "@/server/rota/scope";
import { rotaSettings, isCareRole } from "@/server/rota/settings";
import { complianceOn } from "@/server/workforce/eligibility";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function Check({ g }: { g: { required: number; problems: string[] } }) {
  if (!g.required) return <span className="text-slate-500">Not recorded</span>;
  return g.problems.length ? <Badge tone="rose" title={g.problems.join("; ")}>Needs attention</Badge> : <Badge tone="green">Up to date</Badge>;
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "staff.directory")) notFound();
  const scope = await rotaScope(ctx, "staff.directory");
  const org = scope.organisationId;
  const settings = await rotaSettings(db, org);
  const today = londonDate();
  const wk = mondayOf(today);
  const where = staffDirectoryWhere(scope, { area: sp.area, status: sp.status, q: sp.q });
  const [staff, areas, booked] = await Promise.all([
    db.staffMember.findMany({ where, include: { profile: true, compliance: true, areas: { include: { area: { select: { name: true, colour: true } } } }, branch: { select: { name: true } } }, orderBy: { displayName: "asc" } }),
    db.area.findMany({ where: { organisationId: org, active: true }, orderBy: { name: "asc" } }),
    db.visitAssignment.groupBy({ by: ["staffId"], where: { organisationId: org, blocking: true, startsAt: { gte: dbDate(wk), lt: dbDate(addDays(wk, 7)) } }, _count: true }),
  ]);
  const careOnly = sp.role !== "all";
  let rows = staff.filter((s) => !careOnly || isCareRole(settings, s.jobTitle)).map((s) => ({ s, c: complianceOn(s.compliance, today) }));
  if (sp.problems === "1") rows = rows.filter((r) => r.c.problems.length > 0);
  const visits = new Map(booked.map((b) => [b.staffId, b._count]));

  return (
    <>
      <PageHeader title="Staff & Eligibility" back="/rota" subtitle="Care staff as HR & Workforce records them, with what the rota needs to know. Employment, checks and training are kept in HR and update here automatically; areas, rota participation and matching details are set here." />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, staff number, role" className="input w-56" /></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span className="label">Roles</span><select name="role" defaultValue={sp.role ?? ""} className="input"><option value="">Care roles</option><option value="all">Everyone</option></select></label>
          <label><span className="label">Employment</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Active and onboarding</option><option value="all">Include left and archived</option></select></label>
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="problems" value="1" defaultChecked={sp.problems === "1"} className="h-4 w-4" /> HR checks need attention</label>
          <button className="btn-primary">Apply</button>
          <Link href="/rota/staff" className="btn-secondary">Clear</Link>
        </form>
      </section>
      <Card>
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Areas</th><th>DBS</th><th>Right to work</th><th>Training</th><th>Rota</th><th>Visits this week</th><th>Sign-in</th></tr></thead>
            <tbody>
              {rows.map(({ s, c }) => (
                <tr key={s.id}>
                  <td><Link href={`/rota/staff/${s.id}`}>{s.displayName}</Link><div className="text-[12.5px] text-slate-500">{s.jobTitle} · {s.branch?.name ?? "No branch"}{s.employmentStatus !== "ACTIVE" ? ` · ${s.employmentStatus.toLowerCase()}` : ""}</div></td>
                  <td className="text-[13px]">{s.areas.length ? s.areas.map((a) => a.area.name).join(", ") : <span className="text-slate-500">Any</span>}</td>
                  <td><Check g={c.dbs} /></td>
                  <td><Check g={c.rtw} /></td>
                  <td>{c.training.required ? <span className={c.training.problems.length ? "text-[#a3242c]" : ""} title={c.training.problems.join("; ")}>{c.training.required - c.training.problems.length} of {c.training.required}</span> : <span className="text-slate-500">None</span>}</td>
                  <td>{(s.profile?.rotaEnabled ?? isCareRole(settings, s.jobTitle)) ? "On" : <Badge>Off</Badge>}</td>
                  <td className="tabular-nums">{visits.get(s.id) ?? 0}</td>
                  <td>{s.userId ? <Badge tone="teal">Linked</Badge> : <span className="text-slate-500">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No staff match these filters.</Empty>}
      </Card>
    </>
  );
}

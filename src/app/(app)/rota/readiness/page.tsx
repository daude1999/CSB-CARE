import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaScope } from "@/server/rota/scope";
import { pendingVerifications, READINESS_LABEL, readinessQueue, type ReadinessStatus } from "@/server/readiness";
import { ReadinessBadge } from "@/components/readiness-ui";
import { Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(READINESS_LABEL) as ReadinessStatus[];
const isStatus = (s: string | undefined): s is ReadinessStatus => !!s && (STATUSES as string[]).includes(s);

/**
 * The manager's readiness queue: everyone in scope with the status worked out from their evidence now, filtered by
 * branch, status and what falls due soon, plus the evidence waiting for a second person to verify.
 */
export default async function ReadinessQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "readiness.view")) notFound();
  const scope = await rotaScope(ctx, "readiness.view");
  const status = isStatus(sp.status) ? sp.status : undefined;
  const dueWithin = sp.due === "1" ? 30 : undefined;
  const [queue, pending, branches] = await Promise.all([
    readinessQueue(ctx, { status, branch: sp.branch || undefined, q: sp.q || undefined, dueWithin }),
    pendingVerifications(ctx),
    db.branch.findMany({ where: { organisationId: scope.organisationId, ...(scope.branchIds ? { id: { in: scope.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ branch: sp.branch, q: sp.q, due: sp.due, status, ...over })) if (v) q.set(k, v);
    const s = q.toString();
    return `/rota/readiness${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="staff" active="readiness" />} title="Staff Readiness" back="/rota" subtitle="Whether each person may work, worked out now from HR checks, verified training, observed competency, policy acknowledgement, restrictions, exceptions and open reviews. Allocation, publishing and clock-in use the same rules." actions={hasOrgPermission(ctx, "readiness.manage") ? <Link href="/admin/readiness" className="btn-secondary">Requirements matrix</Link> : null} />
      <Flash searchParams={sp} />
      <SegmentNav
        label="Readiness status"
        items={[{ href: href({ status: undefined }), label: "Everyone", active: !status, count: queue.total }, ...STATUSES.map((s) => ({ href: href({ status: s }), label: READINESS_LABEL[s], active: status === s, count: queue.counts[s] }))]}
      />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, staff number, role" className="input w-56" /></label>
          <label><span className="label">Branch</span><select name="branch" defaultValue={sp.branch ?? ""} className="input"><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="due" value="1" defaultChecked={sp.due === "1"} className="h-4 w-4" /> Something due soon</label>
          <button className="btn-primary">Apply</button>
          <Link href="/rota/readiness" className="btn-secondary">Clear</Link>
        </form>
      </section>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          {queue.rows.length ? (
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Branch</th><th>Status</th><th>Why</th><th>Due soon</th></tr></thead>
              <tbody>
                {queue.rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/rota/staff/${r.id}`} className="row-title">{r.displayName}</Link>{r.userId ? null : <span className="block text-[12px] text-slate-500">No sign-in linked</span>}</td>
                    <td>{r.jobTitle}</td>
                    <td>{r.branch?.name ?? "—"}</td>
                    <td><ReadinessBadge status={r.result.status} /></td>
                    <td className="max-w-[360px] text-[13px] text-slate-700">{r.result.reasons.slice(0, 2).join("; ") || "—"}{r.result.reasons.length > 2 ? ` and ${r.result.reasons.length - 2} more` : ""}</td>
                    <td className="text-[13px]">{r.dueSoon.length ? r.dueSoon.map((d) => `${d.name}${d.dueDate ? ` (${fmtDate(new Date(`${d.dueDate}T12:00:00Z`))})` : ""}`).join("; ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>{queue.total ? "Nobody matches these filters." : "No staff in your branches yet. Staff arrive from HR & Workforce."}</Empty>}
        </Card>
        <Card title={`Awaiting verification (${queue.pendingRecords})`}>
          {pending.length ? (
            <ul className="rows">
              {pending.map((p) => (
                <li key={p.id} className="py-2 text-[14px]">
                  <Link href={`/rota/staff/${p.staff.id}`} className="row-title">{p.staff.displayName}</Link>
                  <div className="text-[13px] text-slate-600">{p.requirement.name} · completed {fmtDate(p.completedAt)} · entered {fmtDate(p.createdAt, true)}</div>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing waiting. Evidence entered for someone appears here until a second person verifies or rejects it.</Empty>}
        </Card>
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { auditPage, PAGE_SIZE } from "@/server/admin/audit-viewer";
import { Card, Empty, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The audit log: every recorded action in the organisation, read-only, with filters, paging and a CSV. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const { f, rows, total, pages, entities, members, names } = await auditPage(ctx, sp);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ actor: f.actor, action: f.action, entity: f.entity, from: f.from, to: f.to, ...over })) if (v) p.set(k, v);
    return p.toString();
  };

  return (
    <>
      <PageHeader title="Audit Log" back="/settings" subtitle="Every recorded change in your organisation: who did it, what and when. Entries cannot be edited or deleted." actions={<a href={`/api/admin/audit?${qs({})}`} className="btn-secondary">Download CSV</a>} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">Who</span><select name="actor" defaultValue={f.actor ?? ""} className="input"><option value="">Anyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label><span className="label">Action contains</span><input name="action" defaultValue={f.action ?? ""} placeholder="e.g. published" className="input" /></label>
          <label><span className="label">Record type</span><select name="entity" defaultValue={f.entity ?? ""} className="input"><option value="">Any</option>{entities.map((e) => <option key={e} value={e}>{e}</option>)}</select></label>
          <label><span className="label">From</span><input type="date" name="from" defaultValue={f.from ?? ""} className="input" /></label>
          <label><span className="label">To</span><input type="date" name="to" defaultValue={f.to ?? ""} className="input" /></label>
          <button className="btn-primary">Apply</button>
          <Link href="/admin/audit" className="btn-secondary">Clear</Link>
        </form>
      </section>
      <Card title={`${total.toLocaleString("en-GB")} entr${total === 1 ? "y" : "ies"}`}>
        {rows.length ? (
          <div className="relative min-w-0 overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(r.createdAt, true)}</td>
                    <td>{r.actorId ? names.get(r.actorId) ?? "Former member" : "System"}</td>
                    <td className="font-mono text-[12.5px]">{r.action}</td>
                    <td className="text-[13px]">{r.entityType}<span className="block font-mono text-[11.5px] text-slate-500">{r.entityId}</span></td>
                    <td className="max-w-[420px] break-words font-mono text-[11.5px] text-slate-600">{r.data && JSON.stringify(r.data) !== "{}" ? JSON.stringify(r.data).slice(0, 400) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No entries match these filters.</Empty>}
        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-3 flex items-center gap-3 text-[14px]">
            {f.page > 1 ? <Link href={`/admin/audit?${qs({ page: String(f.page - 1) })}`}>Newer</Link> : null}
            <span className="text-slate-600">Page {f.page} of {pages} ({PAGE_SIZE} a page)</span>
            {f.page < pages ? <Link href={`/admin/audit?${qs({ page: String(f.page + 1) })}`}>Older</Link> : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}

import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ACK_NOT_TRAINING, parseSignoffFilters, signoffCounts, signoffLookups, signoffRows, type SignoffRow } from "@/server/policies/assignment";
import { AckBadge, personKey, SignoffFilterForm, SignoffSummary, signoffHref } from "@/components/signoff-ui";
import { Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE = 300;

/** Groups rows for the "by person" and "by policy" views; the figures are counted from the same rows as the list. */
function group(rows: SignoffRow[], key: (r: SignoffRow) => string) {
  const m = new Map<string, SignoffRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()];
}
const tally = (rows: SignoffRow[]) => ({ assigned: rows.filter((r) => r.b.bucket !== "withdrawn").length, done: rows.filter((r) => r.b.bucket === "acknowledged").length, outstanding: rows.filter((r) => r.b.outstanding).length, overdue: rows.filter((r) => r.b.overdue).length, cannotSign: rows.some((r) => r.b.cannotSign) });

/**
 * Staff Sign-off: who has been asked to read which policy version, who has opened and acknowledged it, what is overdue
 * and who cannot sign because they have no login. Counts, lists, drill-downs and the CSV come from one set of rows.
 */
export default async function StaffSignoffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const f = parseSignoffFilters(sp);
  const view = sp.view === "policies" || sp.view === "rows" ? sp.view : "people";
  const [all, lookups] = await Promise.all([signoffRows(ctx, { ...f, status: undefined }), signoffLookups(ctx)]);
  const rows = f.status ? all.filter((r) => (f.status === "overdue" ? r.b.overdue : f.status === "cannot_sign" ? r.b.cannotSign : r.b.bucket === f.status)) : all;
  const c = signoffCounts(all);
  const base = "/staff";
  const fv = { ...f, view };
  const csv = signoffHref("/api/staff-signoff", f);

  return (
    <>
      <PageHeader title="Staff Sign-off" subtitle={`Who has been asked to read each published policy version, and whether they have opened, acknowledged or been assessed on it. ${ACK_NOT_TRAINING}`} actions={<><a href={csv} className="btn-secondary">Export CSV</a><Link href="/rota/readiness" className="btn-secondary">Staff readiness</Link></>} />
      <Flash searchParams={sp} />
      <SignoffFilterForm f={f} view={view} branches={lookups.branches} roles={lookups.roles} policies={lookups.policies} base={base} />
      <SignoffSummary c={c} base={base} f={fv} />
      <SegmentNav label="Views" items={[
        { href: signoffHref(base, { ...fv, view: "people" }), label: "By person", active: view === "people" },
        { href: signoffHref(base, { ...fv, view: "policies" }), label: "By policy", active: view === "policies" },
        { href: signoffHref(base, { ...fv, view: "rows" }), label: "Every assignment", active: view === "rows", count: rows.length },
      ]} />
      <Card>
        {!rows.length ? <Empty>{all.length ? "Nothing matches these filters." : "No policy has been assigned yet. Publish a policy, or add assignment rules on a policy's sign-off page."}</Empty> : view === "people" ? (
          <table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Branch</th><th className="text-right">Assigned</th><th className="text-right">Acknowledged</th><th className="text-right">Outstanding</th><th className="text-right">Overdue</th></tr></thead>
            <tbody>
              {group(rows, personKey).map(([k, rs]) => {
                const t = tally(rs);
                const r0 = rs[0]!;
                return (
                  <tr key={k}>
                    <td><Link href={`/staff/person/${k}`} className="row-title">{r0.person}</Link>{t.cannotSign ? <span className="ml-2"><AckBadge bucket="not_opened" cannotSign /></span> : null}</td>
                    <td>{r0.staffMember?.jobTitle ?? "Office member"}</td>
                    <td>{r0.staffMember?.branch?.name ?? "—"}</td>
                    <td className="text-right tabular-nums">{t.assigned}</td>
                    <td className="text-right tabular-nums">{t.done}</td>
                    <td className="text-right tabular-nums">{t.outstanding}</td>
                    <td className={`text-right tabular-nums ${t.overdue ? "text-[#a3242c]" : ""}`}>{t.overdue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : view === "policies" ? (
          <table className="table">
            <thead><tr><th>Policy</th><th>Version</th><th className="text-right">Assigned</th><th className="text-right">Acknowledged</th><th className="text-right">Completion</th><th className="text-right">Overdue</th></tr></thead>
            <tbody>
              {group(rows, (r) => r.publication.policyId).map(([id, rs]) => {
                const t = tally(rs);
                const p = rs[0]!.publication;
                const req = rs.filter((r) => r.b.bucket !== "withdrawn" && r.b.bucket !== "exempted").length;
                return (
                  <tr key={id}>
                    <td><Link href={`/staff/policy/${id}`} className="row-title">{p.policy.ref} {p.policy.title}</Link></td>
                    <td>{p.version.label}</td>
                    <td className="text-right tabular-nums">{t.assigned}</td>
                    <td className="text-right tabular-nums">{t.done}</td>
                    <td className="text-right tabular-nums">{req ? `${Math.round((t.done / req) * 100)}%` : "—"}</td>
                    <td className={`text-right tabular-nums ${t.overdue ? "text-[#a3242c]" : ""}`}>{t.overdue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <>
            <table className="table">
              <thead><tr><th>Person</th><th>Policy</th><th>Version</th><th>Status</th><th>Due</th><th>Opened</th><th>Acknowledged</th></tr></thead>
              <tbody>
                {rows.slice(0, PAGE).map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/staff/person/${personKey(r)}`}>{r.person}</Link></td>
                    <td><Link href={`/staff/policy/${r.publication.policyId}`}>{r.publication.policy.ref} {r.publication.policy.title}</Link></td>
                    <td>{r.publication.version.label}</td>
                    <td><AckBadge bucket={r.b.bucket} overdue={r.b.overdue} cannotSign={r.b.cannotSign} /></td>
                    <td className="tabular-nums">{fmtDate(r.dueAt)}</td>
                    <td className="tabular-nums">{fmtDate(r.openedAt, true)}</td>
                    <td className="tabular-nums">{fmtDate(r.acknowledgedAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > PAGE ? <p className="mt-2 text-[13px] text-slate-600">Showing the first {PAGE} of {rows.length}. Narrow the filters or export the CSV for all of them.</p> : null}
          </>
        )}
      </Card>
    </>
  );
}

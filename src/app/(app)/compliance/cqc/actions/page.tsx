import { notFound } from "next/navigation";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { PcBadge, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Flash, fmtDate } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ACTION_STATUS, improvementActions } from "@/server/cqc/improvements";

export const dynamic = "force-dynamic";

/**
 * Improvement actions from root cause analyses and CQC assessments, in one list. They are ordinary corrective actions:
 * owners update them and someone else verifies them on the action page, so the rules stay the same everywhere.
 */
export default async function ImprovementActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId || !(hasOrgPermission(ctx, "cqc.view") || hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate"))) notFound();
  const status = sp.status ?? "OPEN";
  const source = sp.source === "RCA" || sp.source === "CQC" ? sp.source : undefined;
  const all = await improvementActions(ctx, { status: status === "ALL" ? undefined : status, source, owner: sp.owner || undefined });
  const mine = sp.owner === ctx.userId;
  const owners = [...new Map(all.map((a) => [a.ownerId, a.ownerName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const qs = new URLSearchParams(Object.entries({ status, source }).filter((e): e is [string, string] => Boolean(e[1])));
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="cqc" active="actions" />}
        title="Improvement Actions"
        subtitle="Corrective and preventative actions from investigations and CQC assessments. Each is verified by someone other than its owner."
        actions={hasOrgPermission(ctx, "report.export") ? <>
          <a href={`/api/cqc-reports/actions?${qs}&format=pdf`} data-no-progress="" className="pc-btn-secondary"><DownloadSimple size={16} aria-hidden="true" />Export PDF</a>
          <a href={`/api/cqc-reports/actions?${qs}&format=csv`} data-no-progress="" className="pc-btn-secondary">CSV</a>
        </> : null}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <form method="get" action="/compliance/cqc/actions" className="pc-panel pc-toolbar" role="search" aria-label="Filter actions">
          <PcSelect name="status" label="Status" defaultValue={status} options={[{ value: "OPEN", label: "All open" }, { value: "OVERDUE", label: "Overdue" }, ...Object.entries(ACTION_STATUS).map(([value, label]) => ({ value, label })), { value: "ALL", label: "Any" }]} />
          <PcSelect name="source" label="From" defaultValue={source ?? ""} options={[{ value: "", label: "Investigations and assessments" }, { value: "RCA", label: "Root cause analyses" }, { value: "CQC", label: "CQC assessments" }]} />
          <PcSelect name="owner" label="Responsible" defaultValue={sp.owner ?? ""} options={[{ value: "", label: "Anyone" }, { value: ctx.userId, label: "Me" }, ...owners.filter(([id]) => id !== ctx.userId).map(([value, label]) => ({ value, label }))]} />
          <button className="pc-btn-secondary pc-btn-sm" type="submit">Apply</button>
          {mine ? null : <Link href={`/compliance/cqc/actions?status=${status}&owner=${ctx.userId}`} className="pc-link ml-auto">My actions</Link>}
        </form>
        <section className="pc-panel" data-testid="improvement-actions">
          <div className="pc-panel-head"><h2 className="pc-panel-title">Actions <span className="font-normal text-[#667085]">({all.length})</span></h2></div>
          <PcTableWrap label="Improvement actions">
            <table className="pc-table">
              <thead><tr><th>Reference</th><th>Action</th><th>From</th><th>Type</th><th>Priority</th><th>Responsible</th><th>Due</th><th>Progress</th></tr></thead>
              <tbody>
                {all.map((a) => (
                  <tr key={a.id} data-testid={`action-${a.reference}`}>
                    <td className="whitespace-nowrap tabular-nums">{a.reference}</td>
                    <td className="min-w-[220px] max-w-[360px]"><Link href={`/actions/${a.id}`} className="pc-strong">{a.title}</Link>{a.evidenceRequired ? <span className="pc-sub">Evidence: {a.evidenceRequired}</span> : null}</td>
                    <td className="whitespace-nowrap">{a.sourceHref && !(a.rca?.restricted && !hasOrgPermission(ctx, "rca.safeguarding")) ? <Link href={a.sourceHref} className="pc-link">{a.sourceLabel}</Link> : a.sourceLabel}{a.cqcCriterion ? <span className="pc-sub">{a.cqcCriterion.title}</span> : null}</td>
                    <td>{a.typeLabel}</td>
                    <td><PcBadge tone={a.priority === "URGENT" || a.priority === "HIGH" ? "red" : a.priority === "MEDIUM" ? "amber" : "grey"}>{a.priorityLabel}</PcBadge></td>
                    <td className="whitespace-nowrap">{a.ownerName}</td>
                    <td className={`whitespace-nowrap ${a.overdue ? "font-semibold text-[#b42318]" : ""}`}>{fmtDate(a.dueDate)}{a.overdue ? <span className="pc-sub text-[#b42318]">Overdue</span> : null}</td>
                    <td className="whitespace-nowrap"><PcBadge tone={a.status === "VERIFIED" || a.status === "CLOSED" ? "green" : a.status === "COMPLETED" ? "purple" : a.overdue ? "red" : "blue"}>{a.statusLabel}</PcBadge><span className="pc-sub">{a.verification}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PcTableWrap>
          {!all.length ? <p className="pc-empty">No actions match.</p> : null}
        </section>
      </div>
    </>
  );
}

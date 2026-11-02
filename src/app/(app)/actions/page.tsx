import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { createActionAction } from "../../actions";
import { ComplianceTabs } from "@/components/compliance-nav";
import { Badge, Card, Empty, Flash, fmtDate, SegmentNav, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const VIEWS = {
  open: { label: "Open", where: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
  overdue: { label: "Overdue", where: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
  check: { label: "Awaiting verification", where: { status: "COMPLETED" } },
  done: { label: "Verified and closed", where: { status: { in: ["VERIFIED", "CLOSED"] } } },
  all: { label: "All", where: {} },
} satisfies Record<string, { label: string; where: Prisma.ComplianceActionWhereInput }>;
type View = keyof typeof VIEWS;

/**
 * Corrective actions: what must be put right, where the need came from (an audit finding or a risk), who owns it, when
 * it is due, the evidence and who independently verified it. Open an action for its full history.
 */
export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId) notFound();
  const orgId = ctx.organisationId;
  const isManager = hasOrgPermission(ctx, "action.manage");
  // Link to the audit or risk only for people who may open it; others see where the action came from as text.
  const canAudit = hasOrgPermission(ctx, "audit.conduct");
  const canRisk = hasOrgPermission(ctx, "risk.view");
  const showAll = isManager && sp.mine !== "1";
  // The old address /actions?closed=1 listed everything, closed included.
  const view: View = sp.closed === "1" ? "all" : sp.view && sp.view in VIEWS ? (sp.view as View) : "open";
  const now = new Date();
  const scope: Prisma.ComplianceActionWhereInput = { organisationId: orgId, ...(showAll ? {} : { ownerId: ctx.userId }) };
  const [actions, members, counts, evidenceCounts] = await Promise.all([
    db.complianceAction.findMany({
      where: { ...scope, ...VIEWS[view].where, ...(view === "overdue" ? { dueDate: { lt: now } } : {}) },
      orderBy: { dueDate: "asc" },
      include: { finding: { select: { description: true, riskRating: true, audit: { select: { id: true, title: true } } } }, risk: { select: { id: true, ref: true, title: true } } },
    }),
    db.membership.findMany({ where: { organisationId: orgId, user: { deactivatedAt: null } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    Promise.all((Object.keys(VIEWS) as View[]).map((v) => db.complianceAction.count({ where: { ...scope, ...VIEWS[v].where, ...(v === "overdue" ? { dueDate: { lt: now } } : {}) } }))),
    db.evidenceDocument.groupBy({ by: ["linkedId"], where: { organisationId: orgId, linkedType: "ACTION" }, _count: { _all: true } }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const evidenceOf = new Map(evidenceCounts.map((e) => [e.linkedId, e._count._all]));
  const count = Object.fromEntries((Object.keys(VIEWS) as View[]).map((v, n) => [v, counts[n]!])) as Record<View, number>;
  const mine = sp.mine === "1" ? "&mine=1" : "";
  return (
    <>
      <CompliancePageHeader tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="actions" />} eyebrow="Care operations · corrective actions" title="Audits & Improvements" subtitle="Corrective actions from audits, risks and reviews. Completing an action needs a note of what was done; it is then verified by someone other than its owner before it is closed." actions={isManager ? <a href={sp.mine === "1" ? `/actions?view=${view}` : `/actions?view=${view}&mine=1`} className="btn-secondary">{sp.mine === "1" ? "Show everyone's" : "Show only mine"}</a> : null} />
      <Flash searchParams={sp} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <SegmentNav alert label="Which actions" items={(Object.keys(VIEWS) as View[]).map((v) => ({ href: `/actions?view=${v}${mine}`, label: VIEWS[v].label, active: v === view, count: v === "all" ? undefined : count[v] }))} />
          <Card className="rounded-tl-none">
            {actions.length ? (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Action</th><th>Came from</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th><th className="text-right">Evidence</th></tr></thead>
                <tbody>
                  {actions.map((x) => {
                    const overdue = ["OPEN", "IN_PROGRESS"].includes(x.status) && x.dueDate < now;
                    return (
                      <tr key={x.id} data-testid={`action-${x.id}`}>
                        <td className="min-w-[220px]"><Link href={`/actions/${x.id}`} className="row-title">{x.title}</Link>{x.isDemo ? <span className="ml-2"><Badge tone="violet">Demo</Badge></span> : null}{x.completionNote ? <div className="mt-0.5 text-[12.5px] text-[#1c7a43]">Done: {x.completionNote.slice(0, 90)}</div> : null}</td>
                        <td className="min-w-[160px] text-[13px]">{x.finding ? (canAudit ? <Link href={`/audits/${x.finding.audit.id}#findings`}>Audit: {x.finding.audit.title}</Link> : <span>Audit: {x.finding.audit.title}</span>) : x.risk ? (canRisk ? <Link href={`/compliance/risks/${x.risk.id}`}>Risk {x.risk.ref}: {x.risk.title}</Link> : <span>Risk {x.risk.ref}: {x.risk.title}</span>) : <span className="text-slate-600">Raised directly</span>}</td>
                        <td className="text-[13.5px]">{names.get(x.ownerId) ?? "—"}</td>
                        <td className={`whitespace-nowrap text-[13.5px] tabular-nums ${overdue ? "font-medium text-[#a3242c]" : ""}`}>{fmtDate(x.dueDate)}{overdue ? " · overdue" : ""}</td>
                        <td>{x.finding ? <StatusBadge status={x.finding.riskRating} /> : <span className="text-[13px] text-slate-500">—</span>}</td>
                        <td><StatusBadge status={x.status} />{x.verifiedById ? <div className="mt-0.5 text-[12px] text-slate-600">by {names.get(x.verifiedById) ?? "a member"}</div> : null}</td>
                        <td className="text-right tabular-nums">{(evidenceOf.get(x.id) ?? 0) + (x.completionEvidenceId ? 1 : 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            ) : (
              <Empty>{view === "open" ? "No open actions." : "Nothing here."}</Empty>
            )}
          </Card>
        </div>
        {isManager ? (
          <Card title="New corrective action">
            <p className="mb-2 text-[13px] text-slate-600">Actions from an audit are best raised from the audit&apos;s finding, and actions for a risk from the risk, so the link is kept.</p>
            <form action={createActionAction} className="space-y-2">
              <input type="hidden" name="back" value="/actions" />
              <label className="block"><span className="label">Action</span><input name="title" className="input" required minLength={3} /></label>
              <label className="block"><span className="label">Details</span><textarea name="description" className="input" rows={2} /></label>
              <label className="block"><span className="label">Owner</span><select name="ownerId" className="input">{members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></label>
              <label className="block"><span className="label">Due</span><input name="dueDate" type="date" className="input" required /></label>
              <button className="btn-primary" type="submit">Create</button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}

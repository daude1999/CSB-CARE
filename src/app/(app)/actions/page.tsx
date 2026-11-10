import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { createActionAction } from "../../actions";
import { ComplianceTabs } from "@/components/compliance-nav";
import { Flash, fmtDate } from "@/components/ui";
import { ActionDialog } from "@/components/dialog";
import { PcBadge, PcFoot, PcTableWrap, type PcTone } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Plus } from "@phosphor-icons/react/dist/ssr";

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
/** Actions per page: closed actions are kept for ever, so "All" grows without limit. */
const PAGE_SIZE = 50;

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
  const requestedPage = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const [actions, members, counts, evidenceCounts] = await Promise.all([
    db.complianceAction.findMany({
      where: { ...scope, ...VIEWS[view].where, ...(view === "overdue" ? { dueDate: { lt: now } } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      skip: (requestedPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { finding: { select: { description: true, riskRating: true, audit: { select: { id: true, title: true } } } }, risk: { select: { id: true, ref: true, title: true } } },
    }),
    db.membership.findMany({ where: { organisationId: orgId, user: { deactivatedAt: null } }, include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    Promise.all((Object.keys(VIEWS) as View[]).map((v) => db.complianceAction.count({ where: { ...scope, ...VIEWS[v].where, ...(v === "overdue" ? { dueDate: { lt: now } } : {}) } }))),
    db.evidenceDocument.groupBy({ by: ["linkedId"], where: { organisationId: orgId, linkedType: "ACTION" }, _count: { _all: true } }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const evidenceOf = new Map(evidenceCounts.map((e) => [e.linkedId, e._count._all]));
  const count = Object.fromEntries((Object.keys(VIEWS) as View[]).map((v, n) => [v, counts[n]!])) as Record<View, number>;
  const mine = sp.mine === "1" ? "1" : undefined;
  const pageHref = (n: number) => `/actions?view=${view}${mine ? "&mine=1" : ""}${n > 1 ? `&page=${n}` : ""}`;
  const STATUS: Record<string, { label: string; tone: PcTone }> = { OPEN: { label: "Open", tone: "amber" }, IN_PROGRESS: { label: "In progress", tone: "blue" }, COMPLETED: { label: "Awaiting verification", tone: "purple" }, VERIFIED: { label: "Verified", tone: "green" }, CLOSED: { label: "Closed", tone: "grey" } };
  const PRIORITY: Record<string, PcTone> = { LOW: "grey", MEDIUM: "amber", HIGH: "red", CRITICAL: "red" };
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="actions" />}
        title="Audits & Improvements"
        subtitle="Corrective actions from audits, risks and reviews. An action is completed with a note of what was done, then verified by someone other than its owner before it is closed."
        actions={isManager ? (
          <>
            <a href={sp.mine === "1" ? `/actions?view=${view}` : `/actions?view=${view}&mine=1`} className="pc-btn-secondary">{sp.mine === "1" ? "Show everyone's" : "Show only mine"}</a>
            <ActionDialog triggerClassName="pc-btn" trigger={<><Plus size={16} weight="bold" aria-hidden="true" />New action</>} title="New corrective action" description="Actions from an audit are best raised from the audit's finding, and actions for a risk from the risk, so the link is kept.">
              <form action={createActionAction} className="space-y-3">
                <input type="hidden" name="back" value="/actions" />
                <label className="block"><span className="label">Action</span><input name="title" className="input" required minLength={3} /></label>
                <label className="block"><span className="label">Details</span><textarea name="description" className="input" rows={2} /></label>
                <label className="block"><span className="label">Responsible person</span><select name="ownerId" className="input">{members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></label>
                <label className="block"><span className="label">Due</span><input name="dueDate" type="date" className="input" required /></label>
                <button className="btn-primary w-full" type="submit">Create action</button>
              </form>
            </ActionDialog>
          </>
        ) : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Corrective actions" className="pc-panel">
        <form className="pc-toolbar" aria-label="Filter actions">
          {mine ? <input type="hidden" name="mine" value="1" /> : null}
          <PcSelect name="view" label="Show" defaultValue={view} options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: v === "all" ? VIEWS[v].label : `${VIEWS[v].label} (${count[v]})` }))} />
          <button className="pc-btn-secondary sr-only focus:not-sr-only" type="submit">Apply</button>
          {!showAll ? <span className="pc-note">Showing actions you own.</span> : null}
        </form>
        {actions.length ? (
          <PcTableWrap>
            <table className="pc-table">
              <thead><tr><th>Action</th><th>Responsible</th><th>Priority</th><th>Due</th><th>Status</th><th className="text-right">Evidence</th><th>Verification</th></tr></thead>
              <tbody>
                {actions.map((x) => {
                  const overdue = ["OPEN", "IN_PROGRESS"].includes(x.status) && x.dueDate < now;
                  const st = STATUS[x.status] ?? { label: x.status.toLowerCase(), tone: "grey" as const };
                  return (
                    <tr key={x.id} data-testid={`action-${x.id}`}>
                      <td className="min-w-[260px] max-w-[420px]">
                        <span className="flex flex-wrap items-center gap-2"><Link href={`/actions/${x.id}`} className="pc-strong">{x.title}</Link>{x.isDemo ? <PcBadge tone="purple">Demo</PcBadge> : null}</span>
                        <span className="pc-sub truncate">{x.finding ? (canAudit ? <Link href={`/audits/${x.finding.audit.id}#findings`}>From audit: {x.finding.audit.title}</Link> : <>From audit: {x.finding.audit.title}</>) : x.risk ? (canRisk ? <Link href={`/compliance/risks/${x.risk.id}`}>From risk {x.risk.ref}: {x.risk.title}</Link> : <>From risk {x.risk.ref}: {x.risk.title}</>) : "Raised directly"}</span>
                      </td>
                      <td className="whitespace-nowrap">{names.get(x.ownerId) ?? "—"}</td>
                      <td>{x.finding ? <PcBadge tone={PRIORITY[x.finding.riskRating] ?? "grey"}>{x.finding.riskRating.charAt(0) + x.finding.riskRating.slice(1).toLowerCase()}</PcBadge> : <span className="text-[#667085]">—</span>}</td>
                      <td className={`whitespace-nowrap ${overdue ? "font-semibold text-[#b42318]" : ""}`}>{fmtDate(x.dueDate)}{overdue ? <span className="pc-sub text-[#b42318]">Overdue</span> : null}</td>
                      <td><PcBadge tone={overdue ? "red" : st.tone}>{overdue ? "Overdue" : st.label}</PcBadge></td>
                      <td className="text-right">{(evidenceOf.get(x.id) ?? 0) + (x.completionEvidenceId ? 1 : 0)}</td>
                      <td className="whitespace-nowrap">{x.verifiedById ? <>Verified by {names.get(x.verifiedById) ?? "a member"}{x.verifiedAt ? <span className="pc-sub">{fmtDate(x.verifiedAt)}</span> : null}</> : x.status === "COMPLETED" ? <span className="text-module">Needs an independent check</span> : <span className="text-[#667085]">Not yet</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : (
          <p className="pc-empty">{view === "open" ? "No open actions." : "Nothing here."}</p>
        )}
        <PcFoot shown={actions.length} total={count[view]} page={requestedPage} pages={Math.max(1, Math.ceil(count[view] / PAGE_SIZE))} href={pageHref} />
      </section>
    </>
  );
}

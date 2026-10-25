import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ACTION_FLOW } from "@/server/compliance/audits";
import { createActionAction, transitionActionAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId) notFound();
  const orgId = ctx.organisationId;
  const isManager = hasOrgPermission(ctx, "action.manage");
  const showAll = isManager && sp.mine !== "1";
  const [actions, members, evidence] = await Promise.all([
    db.complianceAction.findMany({ where: { organisationId: orgId, ...(showAll ? {} : { ownerId: ctx.userId }), ...(sp.closed === "1" ? {} : { status: { not: "CLOSED" } }) }, orderBy: { dueDate: "asc" }, include: { finding: { select: { description: true, riskRating: true } }, history: { orderBy: { createdAt: "desc" }, take: 3 } } }),
    db.membership.findMany({ where: { organisationId: orgId }, include: { user: { select: { id: true, name: true } } } }),
    hasOrgPermission(ctx, "evidence.read") ? db.evidenceDocument.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, filename: true } }) : [],
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const now = new Date();
  const back = `/actions${sp.mine === "1" ? "?mine=1" : ""}`;
  return (
    <>
      <PageHeader eyebrow="Care operations · corrective actions" title="Actions & Risks" subtitle="Corrective actions from audits and reviews. Completing an action requires a note; verification must be done by someone other than the owner." />
      <Flash searchParams={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={showAll ? "All actions" : "My actions"} actions={isManager ? <a href={sp.mine === "1" ? "/actions" : "/actions?mine=1"} className="text-sm">{sp.mine === "1" ? "Show all" : "Show mine"}</a> : null}>
          {actions.length ? (
            <ul className="space-y-3">
              {actions.map((x) => {
                const overdue = ["OPEN", "IN_PROGRESS"].includes(x.status) && x.dueDate < now;
                const next = ACTION_FLOW[x.status] ?? [];
                return (
                  <li key={x.id} className="rounded border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{x.title}</span>
                      <StatusBadge status={x.status} />
                      {overdue ? <Badge tone="rose">overdue</Badge> : null}
                      {x.isDemo ? <Badge tone="violet">demo</Badge> : null}
                    </div>
                    <div className="text-xs text-slate-500">Owner {names.get(x.ownerId) ?? "—"} · due {fmtDate(x.dueDate)}{x.finding ? ` · finding (${x.finding.riskRating.toLowerCase()}): ${x.finding.description.slice(0, 100)}` : ""}</div>
                    {x.description ? <p className="mt-1 text-sm">{x.description}</p> : null}
                    {x.completionNote ? <p className="mt-1 text-xs text-emerald-700">Completion: {x.completionNote}</p> : null}
                    {next.length && (isManager || x.ownerId === ctx.userId) ? (
                      <form action={transitionActionAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="actionId" value={x.id} />
                        <input type="hidden" name="back" value={back} />
                        <select name="to" className="input w-40" aria-label="Move to">{next.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</select>
                        <input name="note" className="input flex-1" placeholder="Note (required to complete)" aria-label="Note" />
                        {evidence.length ? (
                          <select name="evidenceId" className="input w-48" aria-label="Evidence"><option value="">No evidence</option>{evidence.map((e) => <option key={e.id} value={e.id}>{e.filename}</option>)}</select>
                        ) : null}
                        <button className="btn-secondary" type="submit">Update</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No open actions.</Empty>
          )}
        </Card>
        {isManager ? (
          <Card title="New action">
            <form action={createActionAction} className="space-y-2">
              <input type="hidden" name="back" value={back} />
              <input name="title" className="input" required placeholder="Action" aria-label="Action title" />
              <textarea name="description" className="input" placeholder="Details" aria-label="Description" />
              <select name="ownerId" className="input" aria-label="Owner">{members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select>
              <input name="dueDate" type="date" className="input" required aria-label="Due date" />
              <button className="btn-primary" type="submit">Create</button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}

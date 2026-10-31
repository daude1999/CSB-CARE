import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaScope } from "@/server/rota/scope";
import { EXCEPTION_KINDS, listExceptions } from "@/server/rota/exceptions";
import { assignExceptionOwnerAction, escalateExceptionAction, resolveExceptionAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

const SEVERITY = { CRITICAL: ["Critical", "rose"], WARNING: ["Warning", "amber"], INFO: ["Info", "slate"] } as const;

/**
 * Exceptions register: every rota alert with its owner, deadline and escalation, from open to resolved. A row opens
 * its visit. Assigning, escalating and resolving are checked again on the server; escalation is in-app only.
 */
export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.monitor")) notFound();
  const scope = await rotaScope(ctx, "rota.monitor");
  const [{ f, rows, open, overdue, owners, names }, areas] = await Promise.all([
    listExceptions(ctx, sp),
    db.area.findMany({ where: { organisationId: scope.organisationId, active: true, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const canWork = hasOrgPermission(ctx, "rota.edit");
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ kind: f.kind, severity: f.severity, area: f.area, owner: f.owner, state: f.state, ...over })) if (v) p.set(k, v);
    return `/rota/exceptions?${p}`;
  };
  const back = q({});

  return (
    <>
      <PageHeader title="Exceptions" back="/rota" subtitle="Late, missed and unfinished calls, visits not delivered, allocations needing review and readiness refusals. Give each one an owner and resolve it with what was done; anything past its deadline is escalated to the care managers inside the platform." actions={<Link href="/rota/monitor" className="btn-secondary">The Monitor</Link>} />
      <Flash searchParams={sp} />
      <SegmentNav label="Exception state" alert items={[
        { href: q({ state: "open" }), label: "Open", active: f.state === "open", count: open },
        { href: q({ state: "overdue" }), label: "Past deadline", active: f.state === "overdue", count: overdue },
        { href: q({ state: "closed" }), label: "Resolved", active: f.state === "closed" },
        { href: q({ state: "all" }), label: "All", active: f.state === "all" },
      ]} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="state" value={f.state} />
          <label><span className="label">Type</span><select name="kind" defaultValue={f.kind ?? ""} className="input"><option value="">Any</option>{Object.entries(EXCEPTION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span className="label">Severity</span><select name="severity" defaultValue={f.severity ?? ""} className="input"><option value="">Any</option><option value="CRITICAL">Critical</option><option value="WARNING">Warning</option><option value="INFO">Info</option></select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={f.area ?? ""} className="input"><option value="">All my areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label><span className="label">Owner</span><select name="owner" defaultValue={f.owner ?? ""} className="input"><option value="">Anyone</option><option value="none">No owner yet</option>{owners.map((o) => <option key={o.userId} value={o.userId}>{o.name}</option>)}</select></label>
          <button className="btn-primary">Apply</button>
          <Link href="/rota/exceptions" className="btn-secondary">Clear</Link>
        </form>
      </section>
      <Card>
        {rows.length ? (
          <ul className="rows">
            {rows.map((r) => {
              const sev = SEVERITY[r.severity];
              return (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={sev[1]}>{sev[0]}</Badge>
                        <span className="text-[13px] text-slate-600">{EXCEPTION_KINDS[r.kind] ?? r.kind.replace(/_/g, " ").toLowerCase()}</span>
                        {r.overdue ? <Badge tone="rose">Past deadline</Badge> : null}
                        {r.escalatedAt ? <Badge tone="violet">Escalated {fmtDate(r.escalatedAt, true)}</Badge> : null}
                        {r.resolvedAt ? <Badge tone="green">Resolved</Badge> : null}
                      </div>
                      <p className="mt-1 text-[14.5px]">{r.visit ? <Link href={`/rota/visits/${r.visit.id}`} className="row-title">{r.message}</Link> : r.message}</p>
                      <p className="text-[12.5px] text-slate-600">Raised {fmtDate(r.raisedAt, true)}{r.deadline ? ` · deadline ${londonTime(r.deadline)} ${fmtDate(r.deadline)}` : " · no deadline"}{r.visit?.area ? ` · ${r.visit.area.name}` : ""} · owner {r.ownerId ? names.get(r.ownerId) ?? "a member" : "nobody yet"}</p>
                      {r.escalationNote ? <p className="text-[12.5px] text-slate-600">Escalation: {r.escalationNote}</p> : null}
                      {r.kind === "MISSED" && r.visit ? <p className="text-[13px]"><Link href={`/rota/missed?period=custom&from=${londonDate(r.visit.scheduledStart)}&to=${londonDate(r.visit.scheduledStart)}&q=${encodeURIComponent(r.visit.reference)}`}>Investigate in Missed Calls →</Link> <span className="text-slate-500">(the case there escalates and closes this one)</span></p> : null}
                      {r.resolvedAt ? <p className="text-[13px] text-slate-700">Resolved by {r.resolvedById ? names.get(r.resolvedById) ?? "a member" : "the system"} {fmtDate(r.resolvedAt, true)}: {r.resolution}{r.evidenceNote ? ` · evidence: ${r.evidenceNote}` : ""}</p> : null}
                    </div>
                  </div>
                  {canWork && !r.resolvedAt ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
                      <form action={assignExceptionOwnerAction} className="flex gap-2">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="alertId" value={r.id} />
                        <select name="ownerId" defaultValue={r.ownerId ?? ""} required className="input min-w-0 flex-1 py-1.5 text-[14px]" aria-label="Owner"><option value="">Give to…</option>{owners.map((o) => <option key={o.userId} value={o.userId}>{o.name}</option>)}</select>
                        <button className="btn-secondary py-1">Assign</button>
                      </form>
                      {!r.escalatedAt ? (
                        <form action={escalateExceptionAction} className="flex gap-2">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="alertId" value={r.id} />
                          <input name="note" required minLength={5} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Why a manager is needed" aria-label="Why a manager is needed" />
                          <button className="btn-secondary py-1">Escalate</button>
                        </form>
                      ) : <span />}
                      <form action={resolveExceptionAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="alertId" value={r.id} />
                        <input name="resolution" required minLength={3} className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="What was done" aria-label="What was done" />
                        <input name="evidenceNote" className="input min-w-0 flex-1 py-1.5 text-[14px]" placeholder="Evidence (optional)" aria-label="Evidence" />
                        <button className="btn-primary py-1">Resolve</button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : <Empty>{f.state === "open" ? "No open exceptions in your areas." : "Nothing matches these filters."}</Empty>}
      </Card>
    </>
  );
}

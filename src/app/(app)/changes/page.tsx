import Link from "@/components/link";
import type { ChangeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, Pagination, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const GROUPS: Record<string, ChangeStatus[]> = {
  open: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW", "CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED"],
  triage: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW"],
  assessment: ["CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED"],
  closed: ["EDITORIAL_OR_IMMATERIAL", "CONFIRMED_NOT_APPLICABLE", "NO_POLICY_REVISION_REQUIRED", "CLOSED"],
};

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const group = sp.group && GROUPS[sp.group] ? sp.group : sp.group === "all" ? "all" : "open";
  const page = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 25;
  const where: Prisma.RegulatoryChangeWhereInput = {
    ...(group !== "all" ? { status: { in: GROUPS[group] } } : {}),
    ...(sp.source ? { sourceId: sp.source } : {}),
    ...(sp.urgency ? { suggestedUrgency: sp.urgency as "HIGH" } : {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { summary: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total, sources] = await Promise.all([
    db.regulatoryChange.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        source: true,
        candidates: { where: { organisationId: ctx.organisationId ?? null }, select: { policyId: true } },
      },
    }),
    db.regulatoryChange.count({ where }),
    db.regulatorySource.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const tabs = [
    ["open", "Open"],
    ["triage", "Awaiting triage"],
    ["assessment", "Impact assessment"],
    ["closed", "Closed or not applicable"],
    ["all", "All"],
  ] as const;
  return (
    <>
      <PageHeader
        title="Regulatory Updates"
        subtitle="Changes detected in monitored sources. Detection, confirmation that a change is substantive, applicability to your services, and the decision to revise a policy are separate, recorded steps."
      />
      <Flash searchParams={sp} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/changes?group=${k}`} className={group === k ? "btn-primary" : "btn-secondary"}>{label}</Link>
        ))}
        <form className="ml-auto flex flex-wrap gap-2" role="search">
          <input type="hidden" name="group" value={group} />
          <input className="input w-56" name="q" defaultValue={sp.q} placeholder="Search updates" aria-label="Search updates" />
          <select className="input w-56" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
            <option value="">All sources</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input w-36" name="urgency" defaultValue={sp.urgency ?? ""} aria-label="Urgency">
            <option value="">Any urgency</option>
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
          </select>
          <button className="btn-secondary" type="submit">Filter</button>
        </form>
      </div>
      <Card>
        {items.length ? (
          <table className="table" data-testid="changes-table">
            <thead>
              <tr><th>Detected</th><th>Update</th><th>Source</th><th>Classification</th><th>Status</th><th>Urgency</th><th>{ctx.organisationId ? "Our policies flagged" : "Policies flagged"}</th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(c.detectedAt, true)}</td>
                  <td>
                    <Link href={`/changes/${c.id}`} className="font-medium">{c.title}</Link> <SimulatedBadge show={c.isSimulated} />
                    <div className="max-w-md text-xs text-slate-500">{c.summary.slice(0, 180)}</div>
                  </td>
                  <td className="text-xs">{c.source.name}</td>
                  <td><Badge tone={c.classification === "POTENTIALLY_SUBSTANTIVE" ? "rose" : c.classification === "EDITORIAL" ? "slate" : "amber"}>{c.classification.replace(/_/g, " ").toLowerCase()}</Badge><div className="text-[11px] text-slate-400">by {c.classificationBasis}</div></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td><StatusBadge status={c.suggestedUrgency} /></td>
                  <td className="text-sm">{new Set(c.candidates.map((x) => x.policyId)).size || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No updates match. Detected changes appear here once a monitored source has been checked at least twice and its content has changed.</Empty>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} base="/changes" params={{ group, q: sp.q, source: sp.source, urgency: sp.urgency }} />
      </Card>
    </>
  );
}

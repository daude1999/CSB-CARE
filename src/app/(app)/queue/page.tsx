import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const scope = { organisationId: ctx.organisationId ?? null };
  const [revisions, needsDraft, myAssignments] = await Promise.all([
    db.policyRevision.findMany({
      where: { ...scope, closedAt: null },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      include: { policy: { select: { id: true, ref: true, title: true } }, draftVersion: { select: { status: true, label: true } }, assignments: true, impactAssessment: { select: { change: { select: { id: true, title: true, isSimulated: true } } } } },
    }),
    db.impactAssessment.findMany({
      where: { ...scope, status: "CONFIRMED_REVISION_REQUIRED", revisions: { none: { closedAt: null } } },
      include: { policy: { select: { id: true, ref: true, title: true } }, change: { select: { id: true, title: true, isSimulated: true } } },
    }),
    db.reviewAssignment.findMany({ where: { assigneeId: ctx.userId, status: "PENDING", revision: { closedAt: null, ...scope } }, select: { revisionId: true } }),
  ]);
  const mine = new Set(myAssignments.map((a) => a.revisionId));
  const columns = [
    { title: "Drafts in progress", items: revisions.filter((r) => ["DRAFT", "CHANGES_REQUESTED"].includes(r.draftVersion.status)) },
    { title: "Awaiting review and approval", items: revisions.filter((r) => r.draftVersion.status === "UNDER_REVIEW") },
    { title: "Approved, ready to publish or scheduled", items: revisions.filter((r) => ["APPROVED", "SCHEDULED"].includes(r.draftVersion.status)) },
  ];
  return (
    <>
      <PageHeader title="Policy Change Queue" subtitle="Every policy change passes through draft, review and approval before it is published. Nothing here is live until it is published." />
      <Flash searchParams={sp} />
      {needsDraft.length ? (
        <Card title="Revision required, no draft yet" className="mb-6">
          <ul className="space-y-2 text-sm">
            {needsDraft.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/changes/${a.change.id}`}>{a.policy.ref} {a.policy.title}</Link>
                <span className="text-xs text-slate-500">because of “{a.change.title}”</span>
                <SimulatedBadge show={a.change.isSimulated} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        {columns.map((col) => (
          <Card key={col.title} title={`${col.title} (${col.items.length})`}>
            {col.items.length ? (
              <ul className="space-y-3">
                {col.items.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3" data-testid={`queue-${r.policy.ref}`}>
                    <Link href={`/revisions/${r.id}`} className="font-medium">{r.policy.ref} {r.policy.title}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <StatusBadge status={r.draftVersion.status} />
                      <Badge>{r.kind.replace(/_/g, " ").toLowerCase()}</Badge>
                      <StatusBadge status={r.urgency} />
                      <SimulatedBadge show={r.isSimulated} />
                      {mine.has(r.id) ? <Badge tone="teal">assigned to you</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{r.title}</div>
                    {r.impactAssessment ? <div className="text-xs text-slate-400">From update: {r.impactAssessment.change.title}</div> : null}
                    <div className="text-xs text-slate-400">Created {fmtDate(r.createdAt)}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing here.</Empty>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

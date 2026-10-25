import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { Badge, Card, Empty, fmtDate, PageHeader, SimulatedBadge, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const ctx = await requireCtx();
  const m = await dashboardMetrics(ctx);
  const [changes, myAssignments, myAcks] = await Promise.all([
    db.regulatoryChange.findMany({ orderBy: { detectedAt: "desc" }, take: 6, include: { source: true } }),
    db.reviewAssignment.findMany({ where: { assigneeId: ctx.userId, status: "PENDING", revision: { closedAt: null } }, include: { revision: { include: { policy: true, draftVersion: true } } }, take: 10 }),
    db.acknowledgement.findMany({ where: { userId: ctx.userId, acknowledgedAt: null }, include: { publication: { include: { policy: true, version: true } } }, take: 10 }),
  ]);
  const admin = hasPlatformPermission(ctx, "sources.manage");
  return (
    <>
      <PageHeader title="Overview" subtitle="All figures are calculated from current records. Platform scores and statuses support professional judgement; they are not proof of regulatory compliance." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Sources checked within window" value={`${m.sources.fresh}/${m.sources.total - m.sources.manual}`} hint={`${m.sources.manual} manual-review-only`} href={admin ? "/admin/sources" : undefined} tone="green" />
        <Stat label="Sources failing or stale" value={m.sources.failing + m.sources.stale} tone={m.sources.failing + m.sources.stale ? "rose" : "green"} href={admin ? "/admin/sources" : undefined} />
        <Stat label="New changes to triage" value={m.newChanges} href="/changes" tone={m.newChanges ? "amber" : "navy"} />
        <Stat label="Assessments awaiting decision" value={m.awaitingAssessment} href="/queue" tone={m.awaitingAssessment ? "amber" : "navy"} />
        <Stat label="Policies awaiting revision" value={m.policiesAwaitingRevision} href="/queue" />
        <Stat label="Drafts awaiting approval" value={m.draftsAwaitingApproval} href="/queue" />
        <Stat label="Published this month" value={m.publishedThisMonth} tone="green" />
        <Stat label="Overdue policy reviews" value={m.overdueReviews} href="/policies?overdue=1" tone={m.overdueReviews ? "rose" : "navy"} />
        <Stat label="Outstanding acknowledgements" value={m.outstandingAcks} hint={`${m.overdueAcks} overdue`} href="/staff" tone={m.overdueAcks ? "amber" : "navy"} />
        <Stat label="Overdue compliance actions" value={m.overdueActions} href="/actions" tone={m.overdueActions ? "rose" : "navy"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Latest regulatory changes" actions={<Link href="/changes">View all</Link>}>
          {changes.length ? (
            <ul className="divide-y divide-slate-100">
              {changes.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${c.id}`} className="font-medium">{c.title}</Link>
                    <SimulatedBadge show={c.isSimulated} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StatusBadge status={c.status} />
                    <span>{c.source.name}</span>
                    <span>· detected {fmtDate(c.detectedAt, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No changes detected yet. Changes appear here after the monitor finds a genuine content change.</Empty>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Waiting for you">
            {myAssignments.length ? (
              <ul className="space-y-2">
                {myAssignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <Link href={`/revisions/${a.revisionId}`}>{a.revision.policy.ref} {a.revision.policy.title}</Link>
                    <span className="flex items-center gap-2"><Badge>{a.role.toLowerCase()}</Badge><StatusBadge status={a.revision.draftVersion.status} /></span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No reviews or approvals assigned to you.</Empty>
            )}
          </Card>
          <Card title="Policies for you to read">
            {myAcks.length ? (
              <ul className="space-y-2">
                {myAcks.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <Link href={`/policies/${a.publication.policyId}`}>{a.publication.policy.ref} {a.publication.policy.title} ({a.publication.version.label})</Link>
                    <span className="text-xs text-slate-500">due {fmtDate(a.dueAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>You are up to date.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

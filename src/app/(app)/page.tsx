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
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, isDemo: true } }) : null;
  return (
    <>
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-6 px-6 py-7 sm:px-8 sm:py-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">Care governance workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Organisation overview</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">A clear view of policy reviews, regulatory updates and the actions that need attention.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/policies/new" className="btn bg-white text-navy-900 hover:bg-slate-100">Create a policy</Link>
            <Link href="/queue" className="btn border border-white/25 bg-white/10 text-white hover:bg-white/15">Open change queue</Link>
          </div>
        </div>
      </div>
      {org?.isDemo ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
          <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-200 text-xs font-bold text-violet-800">i</span>
          <div><span className="font-semibold">Presentation workspace · {org.name.replace(/\s+\(DEMO\)$/i, "")}</span><p className="mt-0.5 text-violet-800">This workspace uses sample records to demonstrate the platform. Regulatory proposals and status indicators require human verification.</p></div>
        </div>
      ) : null}
      <PageHeader title="At a glance" subtitle="Live totals from this organisation's current records. Status indicators support professional judgement and are not proof of regulatory compliance." />
      <section aria-labelledby="monitoring-heading" className="mb-6">
        <h2 id="monitoring-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Monitoring and policy health</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Sources checked within window" value={`${m.sources.fresh}/${m.sources.total - m.sources.manual}`} hint={`${m.sources.manual} manual-review-only`} href={admin ? "/admin/sources" : undefined} tone="green" />
          <Stat label="Sources failing or stale" value={m.sources.failing + m.sources.stale} tone={m.sources.failing + m.sources.stale ? "rose" : "green"} href={admin ? "/admin/sources" : undefined} />
          <Stat label="New changes to triage" value={m.newChanges} href="/changes" tone={m.newChanges ? "amber" : "navy"} />
          <Stat label="Overdue policy reviews" value={m.overdueReviews} href="/policies?overdue=1" tone={m.overdueReviews ? "rose" : "navy"} />
        </div>
      </section>
      <section aria-labelledby="work-heading" className="mb-6">
        <h2 id="work-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Reviews and follow-up</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Assessments awaiting decision" value={m.awaitingAssessment} href="/queue" tone={m.awaitingAssessment ? "amber" : "navy"} />
          <Stat label="Policies awaiting revision" value={m.policiesAwaitingRevision} href="/queue" />
          <Stat label="Drafts awaiting approval" value={m.draftsAwaitingApproval} href="/queue" />
          <Stat label="Overdue compliance actions" value={m.overdueActions} href="/actions" tone={m.overdueActions ? "rose" : "navy"} />
        </div>
      </section>
      <section aria-labelledby="staff-heading" className="mb-6">
        <h2 id="staff-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Staff and publishing</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Outstanding acknowledgements" value={m.outstandingAcks} hint={`${m.overdueAcks} overdue`} href="/staff" tone={m.overdueAcks ? "amber" : "navy"} />
          <Stat label="Published this month" value={m.publishedThisMonth} tone="green" />
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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

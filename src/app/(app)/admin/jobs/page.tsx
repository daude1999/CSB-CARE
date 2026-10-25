import { notFound } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { cancelJobAction, retryJobAction } from "../../../actions";
import Link from "@/components/link";
import { Card, Empty, Flash, fmtDate, PageHeader, Pagination, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";
const STATUSES: JobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasPlatformPermission(ctx, "jobs.manage")) notFound();
  const status = STATUSES.includes(sp.status as JobStatus) ? (sp.status as JobStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = { ...(status ? { status } : {}), ...(sp.type ? { type: sp.type } : {}) };
  const [jobs, total, counts] = await Promise.all([
    db.backgroundJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    db.backgroundJob.count({ where }),
    db.backgroundJob.groupBy({ by: ["status"], _count: true }),
  ]);
  const back = `/admin/jobs?${new URLSearchParams(Object.entries({ status, type: sp.type, page: String(page) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Background Jobs" subtitle="Monitoring, analysis, drafting, notification and publication jobs. Failed jobs retry with backoff; jobs that exhaust their retries are moved to the dead-letter state for manual action." />
      <Flash searchParams={sp} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/jobs" className={!status ? "btn-primary" : "btn-secondary"}>All</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/jobs?status=${s}`} className={status === s ? "btn-primary" : "btn-secondary"}>{s.toLowerCase()} ({counts.find((c) => c.status === s)?._count ?? 0})</Link>
        ))}
      </div>
      <Card>
        {jobs.length ? (
          <table className="table">
            <thead><tr><th>Created</th><th>Type</th><th>Status</th><th>Attempts</th><th>Run after</th><th>Last error</th><th /></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="text-xs">{fmtDate(j.createdAt, true)}</td>
                  <td className="font-mono text-xs">{j.type}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>{j.attempts}/{j.maxAttempts}</td>
                  <td className="text-xs">{fmtDate(j.runAfter, true)}</td>
                  <td className="max-w-sm text-xs text-rose-700">{j.lastError}</td>
                  <td className="flex gap-1">
                    {["FAILED", "DEAD", "CANCELLED"].includes(j.status) ? (
                      <form action={retryJobAction}><input type="hidden" name="jobId" value={j.id} /><input type="hidden" name="back" value={back} /><button className="btn-secondary py-1 text-xs" type="submit">Retry</button></form>
                    ) : null}
                    {["QUEUED", "FAILED"].includes(j.status) ? (
                      <form action={cancelJobAction}><input type="hidden" name="jobId" value={j.id} /><input type="hidden" name="back" value={back} /><button className="btn-secondary py-1 text-xs" type="submit">Cancel</button></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No jobs.</Empty>
        )}
        <Pagination page={page} pageSize={50} total={total} base="/admin/jobs" params={{ status, type: sp.type }} />
      </Card>
    </>
  );
}

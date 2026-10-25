import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { freshness } from "@/server/sources/engine";
import { notFound } from "next/navigation";
import { Badge, Card, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasPlatformPermission(ctx, "sources.manage")) notFound();
  const sources = await db.regulatorySource.findMany({ orderBy: [{ coverage: "asc" }, { name: "asc" }], include: { _count: { select: { documents: true, changes: true } } } });
  const workerBeat = await db.backgroundJob.findFirst({ where: { type: "maintenance.tick", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  const workerStale = isStale(workerBeat?.finishedAt);
  return (
    <>
      <PageHeader eyebrow="Administration · monitored sources" title="Source Monitoring" subtitle="Registry of monitored regulatory sources. A source is only shown as monitored when it has been successfully checked within its freshness window." />
      <Flash searchParams={sp} />
      {workerStale ? (
        <div role="alert" className="mb-4 border-l-2 border-rose-500 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          The background worker has not reported in the last 30 minutes (last heartbeat: {fmtDate(workerBeat?.finishedAt, true)}). Scheduled monitoring is not running. Start it with <code>npm run worker</code>.
        </div>
      ) : null}
      <Card>
        <table className="table">
          <thead><tr><th>Source</th><th>Method</th><th>Coverage</th><th>Status</th><th>Freshness</th><th>Last success</th><th>Next check</th><th>Docs / changes</th></tr></thead>
          <tbody>
            {sources.map((s) => {
              const f = freshness(s);
              return (
                <tr key={s.id}>
                  <td><Link href={`/admin/sources/${s.id}`} className="font-medium">{s.name}</Link> <SimulatedBadge show={s.isSimulated} />{!s.active ? <Badge>inactive</Badge> : null}<div className="font-mono text-[11px] text-slate-400">{s.key}</div></td>
                  <td className="text-xs">{s.monitoringMethod.replace(/_/g, " ").toLowerCase()}</td>
                  <td><StatusBadge status={s.coverage} /></td>
                  <td><StatusBadge status={s.retrievalStatus} />{s.consecutiveFailures ? <div className="text-[11px] text-rose-600">{s.consecutiveFailures} consecutive failure(s)</div> : null}</td>
                  <td><Badge tone={f.state === "fresh" ? "green" : f.state === "stale" || f.state === "never" ? "rose" : "slate"}>{f.label}</Badge></td>
                  <td className="text-xs">{fmtDate(s.lastSuccessAt, true)}</td>
                  <td className="text-xs">{s.coverage === "MANUAL_REVIEW_ONLY" ? "—" : fmtDate(s.nextCheckAt, true)}</td>
                  <td className="text-xs">{s._count.documents} / {s._count.changes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/** The worker counts as stopped when its last heartbeat is over 30 minutes old. */
function isStale(lastBeat: Date | null | undefined) {
  return !lastBeat || Date.now() - lastBeat.getTime() > 30 * 60_000;
}

import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { freshness } from "@/server/sources/engine";
import { notFound } from "next/navigation";
import { Badge, Card, Flash, fmtDate, PageHeader, SimulatedBadge, Stat, StatRow, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasPlatformPermission(ctx, "sources.manage")) notFound();
  const sources = await db.regulatorySource.findMany({ orderBy: [{ coverage: "asc" }, { name: "asc" }], include: { _count: { select: { documents: true, changes: true } } } });
  const workerBeat = await db.backgroundJob.findFirst({ where: { type: "maintenance.tick", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  const workerStale = !workerBeat?.finishedAt || Date.now() - workerBeat.finishedAt.getTime() > 30 * 60_000;
  return (
    <>
      <PageHeader eyebrow="Administration · monitored sources" title="Source Monitoring" subtitle="Registry of monitored regulatory sources. A source is only shown as monitored when it has been successfully checked within its freshness window." />
      <Flash searchParams={sp} />
      {workerStale ? (
        <div role="alert" className="mb-3 rounded-[3px] border-l-4 border-[#e4544f] bg-[#fde1e3] px-4 py-3 text-[14px] text-[#a3242c]">
          The background worker has not reported in the last 30 minutes (last heartbeat: {fmtDate(workerBeat?.finishedAt, true)}). Scheduled monitoring is not running. Start it with <code>npm run worker</code>.
        </div>
      ) : null}
      <StatRow>
        <Stat label="Sources" value={sources.length} hint="In the registry" tone="violet" />
        <Stat label="Checked Automatically" value={sources.filter((s) => s.coverage === "AUTOMATED").length} hint="On a schedule" tone="navy" />
        <Stat label="Up to Date" value={sources.filter((s) => freshness(s).state === "fresh").length} hint="Inside their freshness window" tone="green" />
        <Stat label="Needs Attention" value={sources.filter((s) => ["stale", "never"].includes(freshness(s).state)).length} hint="Stale or never checked" tone="rose" />
      </StatRow>
      <Card title="Monitored sources">
        <table className="table">
          <thead><tr><th>Source</th><th>Method</th><th>Coverage</th><th>Status</th><th>Freshness</th><th>Last success</th><th>Next check</th><th>Docs / changes</th></tr></thead>
          <tbody>
            {sources.map((s) => {
              const f = freshness(s);
              return (
                <tr key={s.id}>
                  <td><Link href={`/admin/sources/${s.id}`} className="font-medium">{s.name}</Link> <SimulatedBadge show={s.isSimulated} />{!s.active ? <Badge>inactive</Badge> : null}<div className="text-[12px] text-slate-500">{s.key}</div></td>
                  <td className="text-[13px]">{s.monitoringMethod.replace(/_/g, " ").toLowerCase()}</td>
                  <td><StatusBadge status={s.coverage} /></td>
                  <td><StatusBadge status={s.retrievalStatus} />{s.consecutiveFailures ? <div className="mt-1 text-[12px] text-[#a3242c]">{s.consecutiveFailures} consecutive failure(s)</div> : null}</td>
                  <td><Badge tone={f.state === "fresh" ? "green" : f.state === "stale" || f.state === "never" ? "rose" : "slate"}>{f.label}</Badge></td>
                  <td className="text-[13px]">{fmtDate(s.lastSuccessAt, true)}</td>
                  <td className="text-[13px]">{s.coverage === "MANUAL_REVIEW_ONLY" ? "—" : fmtDate(s.nextCheckAt, true)}</td>
                  <td className="text-[13px]">{s._count.documents} / {s._count.changes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

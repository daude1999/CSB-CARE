import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { jobsOverview } from "@/server/platform/health";
import { fmtDate } from "@/components/ui";
import { EmptyRow, fmtNumber, Indicator, MetricStrip, Pill, PxHeader, PxPanel, pxSecondary, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Background Jobs" };

const STATUSES = ["SUCCEEDED", "FAILED", "DEAD", "QUEUED", "RUNNING"];

/** The job queue: failures first, then volume by job type. Retry and cancel stay in the job console. */
export default async function JobsPage() {
  const ctx = await requireCtx();
  const j = await jobsOverview(ctx);
  return (
    <>
      <PxHeader title="Background Jobs" description="The queue that reads documents, monitors regulatory sources and sends in-app notices." actions={<Link href="/admin/jobs" className={pxSecondary}>Retry or cancel in the job console</Link>} />
      <MetricStrip label="Job figures" cols={5}>
        <Indicator label="Waiting" value={fmtNumber(j.stats.queued)} note={j.stats.oldestQueuedMinutes !== null ? `Oldest ${j.stats.oldestQueuedMinutes} min` : "None waiting"} />
        <Indicator label="Running" value={fmtNumber(j.stats.running)} />
        <Indicator label="Succeeded (24 h)" value={fmtNumber(j.stats.succeeded24h)} />
        <Indicator label="Failed (24 h)" value={fmtNumber(j.stats.failed24h)} alert={j.stats.failed24h > 0} />
        <Indicator label="Given up" value={fmtNumber(j.stats.dead)} alert={j.stats.dead > 0} note={j.stats.dead > 0 ? "Keeps health at Degraded" : undefined} />
      </MetricStrip>
      <PxPanel title="Latest failures" description="Error messages are shortened and never include document content." flush>
        <div className="px-4">
          <Table label="Failed jobs" minWidth={860} head={["Updated", "Job", "Client", "Status", "Attempts", "Error"]} empty={j.failures.length ? null : <EmptyRow>No failed jobs.</EmptyRow>}>
            {j.failures.map((f) => <tr key={f.id}><td className="whitespace-nowrap tabular-nums">{fmtDate(f.updatedAt, true)}</td><td className="font-mono text-meta">{f.type}</td><td>{f.organisationId ? <Link href={`/platform-admin/clients/${f.organisationId}`}>{f.organisation ?? "Removed"}</Link> : "Platform"}</td><td><Pill value={f.status === "DEAD" ? "SUSPENDED" : "REQUESTED"} label={f.status === "DEAD" ? "Given up" : "Will retry"} /></td><td className="tabular-nums">{f.attempts}/{f.maxAttempts}</td><td className="max-w-[360px] break-words text-meta text-px-muted">{f.error || "—"}</td></tr>)}
          </Table>
        </div>
      </PxPanel>
      <PxPanel title="Last 7 days by job type" className="mt-5" flush>
        <div className="px-4">
          <Table label="Jobs by type" minWidth={640} head={["Job type", "Succeeded", "Failed", "Given up", "Waiting", "Running"]} align={["left", "right", "right", "right", "right", "right"]} empty={j.byType.length ? null : <EmptyRow>No jobs in the last 7 days.</EmptyRow>}>
            {j.byType.map((t) => <tr key={t.type}><td className="font-mono text-meta">{t.type}</td>{STATUSES.map((s) => <td key={s} className="text-right tabular-nums">{t.counts[s] ?? 0}</td>)}</tr>)}
          </Table>
        </div>
      </PxPanel>
    </>
  );
}

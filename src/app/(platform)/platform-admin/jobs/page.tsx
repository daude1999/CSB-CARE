import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { jobsOverview } from "@/server/platform/health";
import { fmtDate } from "@/components/ui";
import { EmptyRow, fmtNumber, Indicator, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Background Jobs" };

export default async function JobsPage() {
  const ctx = await requireCtx();
  const j = await jobsOverview(ctx);
  return (
    <>
      <PxHeader title="Background Jobs" description="The job queue that reads documents, monitors regulatory sources and sends in-app notices. Retry or cancel individual jobs in the job console." actions={<Link href="/admin/jobs" className="text-[13px]">Open the job console</Link>} />
      <section aria-label="Job indicators" className="mb-4 grid grid-cols-2 divide-x divide-[#eef0f5] overflow-hidden rounded-[8px] border border-[#e4e7ef] bg-white md:grid-cols-5">
        <Indicator label="Waiting" value={fmtNumber(j.stats.queued)} note={j.stats.oldestQueuedMinutes !== null ? `Oldest ${j.stats.oldestQueuedMinutes} min` : "None waiting"} />
        <Indicator label="Running" value={fmtNumber(j.stats.running)} />
        <Indicator label="Succeeded (24 h)" value={fmtNumber(j.stats.succeeded24h)} />
        <Indicator label="Failed (24 h)" value={fmtNumber(j.stats.failed24h)} alert={j.stats.failed24h > 0} />
        <Indicator label="Given up" value={fmtNumber(j.stats.dead)} alert={j.stats.dead > 0} />
      </section>
      <PxPanel title="Latest failures" description="Error messages are shortened; they never include document content.">
        <Table head={["Updated", "Job", "Client", "Status", "Attempts", "Error"]} empty={j.failures.length ? null : <EmptyRow>No failed jobs.</EmptyRow>}>
          {j.failures.map((f) => <tr key={f.id}><td className="whitespace-nowrap">{fmtDate(f.updatedAt, true)}</td><td className="font-mono text-[12.5px]">{f.type}</td><td>{f.organisationId ? <Link href={`/platform-admin/clients/${f.organisationId}`}>{f.organisation ?? "Removed"}</Link> : "Platform"}</td><td><Pill value={f.status === "DEAD" ? "SUSPENDED" : "REQUESTED"} label={f.status === "DEAD" ? "Given up" : "Will retry"} /></td><td className="tabular-nums">{f.attempts}/{f.maxAttempts}</td><td className="max-w-[360px] break-words text-[12.5px] text-[#46505f]">{f.error || "—"}</td></tr>)}
        </Table>
      </PxPanel>
      <PxPanel title="Last 7 days by job type" className="mt-4">
        <Table head={["Job type", "Succeeded", "Failed", "Given up", "Waiting", "Running"]} empty={j.byType.length ? null : <EmptyRow>No jobs in the last 7 days.</EmptyRow>}>
          {j.byType.map((t) => <tr key={t.type}><td className="font-mono text-[12.5px]">{t.type}</td>{["SUCCEEDED", "FAILED", "DEAD", "QUEUED", "RUNNING"].map((s) => <td key={s} className="tabular-nums">{t.counts[s] ?? 0}</td>)}</tr>)}
        </Table>
      </PxPanel>
    </>
  );
}

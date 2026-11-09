import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { platformHealth } from "@/server/platform/health";
import { platformStatus } from "@/server/platform/command-centre";
import { DetailRows, fmtBytes, Pill, PxHeader, PxPanel, pxSecondary, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "System Health" };

const STATE_TONE: Record<string, string> = { Healthy: "text-px-ok", Degraded: "text-px-warn", Down: "text-px-danger" };

/** Live checks of the platform's own services, measured when the page opens. */
export default async function HealthPage() {
  const ctx = await requireCtx();
  const [h, status] = await Promise.all([platformHealth(ctx), platformStatus()]);
  return (
    <>
      <PxHeader title="System Health" description="Checked when this page opened. Each line says whether it was measured, recorded by a person, or is not configured." actions={<Link href="/platform-admin/jobs" className={pxSecondary}>Background jobs</Link>} />
      <section aria-label="Overall state" className="mb-5 rounded-[10px] border border-px-line bg-white px-5 py-4">
        <p className="text-[13px] font-medium text-px-muted">Overall</p>
        <p className={`mt-0.5 text-[20px] font-semibold ${STATE_TONE[status.state]}`}>{status.state}</p>
        {status.reasons.length ? (
          <ul className="mt-2 space-y-1 text-[13.5px] text-px-body">{status.reasons.map((r) => <li key={r} className="flex gap-2"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-px-warn" />{r}</li>)}</ul>
        ) : <p className="mt-1 text-[13.5px] text-px-muted">The database responds and no background job has failed.</p>}
      </section>
      <PxPanel title="Checks" flush>
        <div className="px-4">
          <Table label="Health checks" head={["Check", "State", "Detail", "Source"]} minWidth={720}>
            {h.checks.map((c) => <tr key={c.name}><td className="font-medium text-px-ink">{c.name}</td><td><Pill value={c.state} /></td><td>{c.detail}</td><td className="text-[12.5px] text-px-muted">{c.measure}</td></tr>)}
          </Table>
        </div>
      </PxPanel>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PxPanel title="Database"><DetailRows items={[["Response time", h.database.latencyMs === null ? "Not responding" : `${h.database.latencyMs} ms`], ["Size", fmtBytes(h.database.sizeBytes)], ["Engine", "PostgreSQL"]]} /></PxPanel>
        <PxPanel title="Deployment"><DetailRows items={[["Version", h.deployment.commit ?? "Not reported by the host"], ["Branch", h.deployment.branch ?? "—"], ["Environment", h.deployment.environment], ["Host", h.deployment.host], ["Region", h.deployment.region ?? "—"], ["Node.js", h.deployment.nodeVersion]]} /></PxPanel>
      </div>
    </>
  );
}

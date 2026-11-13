import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { requirePlatform } from "@/server/platform/access";
import { databaseSize, storageByOrg, storageGrowth } from "@/server/platform/usage";
import { deploymentInfo } from "@/server/platform/health";
import { lastRestoreTest } from "@/server/platform/settings";
import { fmtDate } from "@/components/ui";
import { Back, DetailRows, EmptyRow, fmtBytes, fmtNumber, Indicator, MetricStrip, NotConfigured, PxFlash, PxHeader, PxPanel, pxPrimary, Table, Tone } from "@/components/platform/ui";
import { restoreTestAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage" };

/** Database and file storage, backups and restore tests. Counts and sizes only, never file contents. */
export default async function StoragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.view");
  const [dbSize, byOrg, growth, restore, orgs] = await Promise.all([databaseSize(), storageByOrg(), storageGrowth(), lastRestoreTest(), db.organisation.findMany({ select: { id: true, name: true, _count: { select: { memberships: true, serviceUsers: true, visits: true } } }, orderBy: { name: "asc" } })]);
  const total = [...byOrg.values()].reduce((a, b) => a + b.bytes, 0);
  const files = [...byOrg.values()].reduce((a, b) => a + b.files, 0);
  const max = Math.max(1, ...growth.map((g) => g.bytes));
  const dep = deploymentInfo();
  return (
    <>
      <PxHeader title="Storage" description="Measured from the database. Anything recorded by a person, or not configured, is labelled so." />
      <PxFlash searchParams={sp} />
      <MetricStrip label="Storage figures" cols={4}>
        <Indicator label="Database size" value={dbSize === null ? <NotConfigured>Not available</NotConfigured> : fmtBytes(dbSize)} note="PostgreSQL, measured" />
        <Indicator label="Stored files" value={fmtBytes(total)} note={`${fmtNumber(files)} files`} />
        <Indicator label="Clients with files" value={fmtNumber(byOrg.size)} note={`of ${fmtNumber(orgs.length)} clients`} />
        <Indicator label="Last restore test" value={restore ? fmtDate(restore.testedOn) : <NotConfigured>None recorded</NotConfigured>} note={restore ? (restore.outcome === "PASSED" ? "Passed" : "Failed") : "Record one below"} alert={restore?.outcome === "FAILED"} />
      </MetricStrip>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PxPanel title="Usage by client" description="Counts and sizes only." flush>
          <div className="px-4">
            <Table label="Storage by client" minWidth={720} head={["Client", "Files", "Size", "Users", "Service users", "Visits"]} align={["left", "right", "right", "right", "right", "right"]} empty={orgs.length ? null : <EmptyRow>No clients.</EmptyRow>}>
              {orgs.map((o) => <tr key={o.id}><td><Link href={`/platform-admin/clients/${o.id}?tab=usage`}>{o.name}</Link></td><td className="text-right tabular-nums">{fmtNumber(byOrg.get(o.id)?.files ?? 0)}</td><td className="text-right tabular-nums">{fmtBytes(byOrg.get(o.id)?.bytes ?? 0)}</td><td className="text-right tabular-nums">{fmtNumber(o._count.memberships)}</td><td className="text-right tabular-nums">{fmtNumber(o._count.serviceUsers)}</td><td className="text-right tabular-nums">{fmtNumber(o._count.visits)}</td></tr>)}
            </Table>
          </div>
        </PxPanel>
        <PxPanel title="Files added per month" description="All clients, measured.">
          {growth.length ? (
            <ul className="space-y-2">{growth.map((g) => <li key={g.month} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2 text-[12.5px]"><span className="tabular-nums text-px-muted">{g.month}</span><span className="h-2 rounded-full bg-px-row"><span className="block h-2 rounded-full bg-px-accent" style={{ width: `${(g.bytes / max) * 100}%` }} /></span><span className="text-right tabular-nums">{fmtBytes(g.bytes)}</span></li>)}</ul>
          ) : <p className="text-[13.5px] text-px-muted">No files stored yet.</p>}
        </PxPanel>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PxPanel title="Backups and restore tests" description="Backups are taken by the database host. The platform cannot see them, so it never reports them as successful.">
          {restore ? <p className="text-[13.5px]"><Tone tone={restore.outcome === "PASSED" ? "green" : "rose"}>Last restore test {restore.outcome === "PASSED" ? "passed" : "failed"}</Tone> on {fmtDate(restore.testedOn)} <span className="text-px-muted">(recorded on {fmtDate(restore.recordedAt, true)}{restore.notes ? `: ${restore.notes}` : ""})</span></p> : <p className="text-[13.5px]"><NotConfigured>No restore test recorded</NotConfigured></p>}
          <form action={restoreTestAction} className="mt-4 grid grid-cols-1 items-end gap-3 border-t border-px-divider pt-4 sm:grid-cols-[160px_140px_minmax(0,1fr)_auto]">
            <Back value="/platform-admin/storage" />
            <label><span className="label">Tested on</span><input type="date" name="testedOn" required className="input" /></label>
            <label><span className="label">Outcome</span><select name="outcome" className="input"><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></label>
            <label className="min-w-0"><span className="label">Notes</span><input name="notes" maxLength={500} className="input" /></label>
            <button className={pxPrimary}>Record restore test</button>
          </form>
        </PxPanel>
        <PxPanel title="Deployment"><DetailRows items={[["Version", dep.commit ?? "Not reported by the host"], ["Environment", dep.environment], ["Host", dep.host], ["Region", dep.region ?? "—"]]} /></PxPanel>
      </div>
    </>
  );
}

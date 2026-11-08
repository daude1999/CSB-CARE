import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { requirePlatform } from "@/server/platform/access";
import { databaseSize, storageByOrg, storageGrowth } from "@/server/platform/usage";
import { deploymentInfo, jobStats } from "@/server/platform/health";
import { lastRestoreTest } from "@/server/platform/settings";
import { Flash, fmtDate } from "@/components/ui";
import { Back, EmptyRow, fmtBytes, fmtNumber, KeyValues, NotConfigured, PxHeader, PxPanel, pxPrimary, Table, Tone } from "@/components/platform/ui";
import { restoreTestAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage & Infrastructure" };

export default async function StoragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  requirePlatform(ctx, "platform.view");
  const [dbSize, byOrg, growth, jobs, restore, orgs] = await Promise.all([databaseSize(), storageByOrg(), storageGrowth(), jobStats(), lastRestoreTest(), db.organisation.findMany({ select: { id: true, name: true, _count: { select: { memberships: true, serviceUsers: true, visits: true } } }, orderBy: { name: "asc" } })]);
  const total = [...byOrg.values()].reduce((a, b) => a + b.bytes, 0);
  const max = Math.max(1, ...growth.map((g) => g.bytes));
  const dep = deploymentInfo();
  return (
    <>
      <PxHeader title="Storage & Infrastructure" description="Measured figures are counted from the database. Anything recorded by a person, or not configured, is labelled so. This view works the same on Vercel or any other host." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PxPanel title="Database"><KeyValues items={[["Size", dbSize === null ? <NotConfigured key="d">Not available</NotConfigured> : `${fmtBytes(dbSize)} (measured)`], ["Engine", "PostgreSQL"]]} /></PxPanel>
        <PxPanel title="Document storage"><KeyValues items={[["Stored files", `${fmtBytes(total)} (measured)`], ["Clients with files", fmtNumber(byOrg.size)]]} /></PxPanel>
        <PxPanel title="Deployment"><KeyValues items={[["Version", dep.commit ?? "Not reported by the host"], ["Environment", dep.environment], ["Host", dep.host], ["Region", dep.region ?? "—"]]} /></PxPanel>
        <PxPanel title="Background jobs (24 hours)"><KeyValues items={[["Succeeded", fmtNumber(jobs.succeeded24h)], ["Failed", fmtNumber(jobs.failed24h)], ["Given up", fmtNumber(jobs.dead)], ["Waiting", fmtNumber(jobs.queued)]]} /><Link href="/platform-admin/jobs" className="mt-2 inline-block text-[13px]">Job details</Link></PxPanel>
        <PxPanel title="Backups and restore tests" className="xl:col-span-2">
          {restore ? <p className="text-[13.5px]"><Tone tone={restore.outcome === "PASSED" ? "green" : "rose"}>Last restore test {restore.outcome === "PASSED" ? "passed" : "failed"}</Tone> on {fmtDate(restore.testedOn)} <span className="text-[#5b6478]">(recorded by a person on {fmtDate(restore.recordedAt, true)}{restore.notes ? `: ${restore.notes}` : ""})</span></p> : <p className="text-[13.5px]"><NotConfigured>No restore test recorded</NotConfigured></p>}
          <p className="mt-2 text-[12.5px] text-[#5b6478]">Backups are taken by the database host. The platform cannot see them, so it never reports them as successful. Record each restore test you carry out:</p>
          <form action={restoreTestAction} className="mt-2 flex flex-wrap items-end gap-2">
            <Back value="/platform-admin/storage" />
            <label><span className="label">Tested on</span><input type="date" name="testedOn" required className="input" /></label>
            <label><span className="label">Outcome</span><select name="outcome" className="input"><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></label>
            <label className="min-w-0 flex-1"><span className="label">Notes</span><input name="notes" maxLength={500} className="input" /></label>
            <button className={pxPrimary}>Record restore test</button>
          </form>
        </PxPanel>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PxPanel title="Usage by client" description="Counts and sizes only.">
          <Table head={["Client", "Stored files", "Size", "Users", "Service users", "Visits"]} empty={orgs.length ? null : <EmptyRow>No clients.</EmptyRow>}>
            {orgs.map((o) => <tr key={o.id}><td><Link href={`/platform-admin/clients/${o.id}?tab=storage`}>{o.name}</Link></td><td className="tabular-nums">{fmtNumber(byOrg.get(o.id)?.files ?? 0)}</td><td className="tabular-nums">{fmtBytes(byOrg.get(o.id)?.bytes ?? 0)}</td><td className="tabular-nums">{fmtNumber(o._count.memberships)}</td><td className="tabular-nums">{fmtNumber(o._count.serviceUsers)}</td><td className="tabular-nums">{fmtNumber(o._count.visits)}</td></tr>)}
          </Table>
        </PxPanel>
        <PxPanel title="Storage growth" description="Files added per month, all clients (measured).">
          <ul className="space-y-1.5">{growth.map((g) => <li key={g.month} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2 text-[12.5px]"><span className="tabular-nums text-[#5b6478]">{g.month}</span><span className="h-2.5 rounded-full bg-[#f1f2f6]"><span className="block h-2.5 rounded-full bg-[#7c3aed]" style={{ width: `${(g.bytes / max) * 100}%` }} /></span><span className="text-right tabular-nums">{fmtBytes(g.bytes)}</span></li>)}</ul>
        </PxPanel>
      </div>
    </>
  );
}

import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { freshness } from "@/server/sources/engine";
import { ComplianceTabs } from "@/components/compliance-nav";
import { Badge, Card, Empty, fmtDate, PageHeader, SimulatedBadge, StatusBadge, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const FRESH_TONE: Record<string, Tone> = { fresh: "green", stale: "amber", never: "rose", manual: "slate", inactive: "slate" };

/**
 * Which regulatory sources CSB monitors and how recently each was successfully checked. A source is only described as
 * up to date when the monitoring service has confirmed a successful check within its freshness window; failures and
 * manual-only sources are shown as they are. Read-only here: CSB platform staff manage sources in Administration.
 */
export default async function SourceStatusPage() {
  const ctx = await requireCtx();
  const isAdmin = hasPlatformPermission(ctx, "sources.manage");
  const now = new Date();
  const sources = await db.regulatorySource.findMany({ orderBy: [{ isSimulated: "asc" }, { name: "asc" }], include: { _count: { select: { changes: true } } } });
  const rows = sources.map((s) => ({ ...s, fresh: freshness(s, now) }));
  const live = rows.filter((s) => !s.isSimulated && s.active);
  const ok = live.filter((s) => s.fresh.state === "fresh").length;
  const failing = live.filter((s) => s.retrievalStatus === "FAILING" || s.retrievalStatus === "DEGRADED").length;
  const manual = live.filter((s) => s.fresh.state === "manual").length;
  return (
    <>
      <PageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="sources" />}
        title="Regulatory Monitoring"
        subtitle="The legislation and guidance sources CSB checks for changes. A source is shown as up to date only after a confirmed successful check within its window. Simulated sources are demonstration data, not real monitoring."
        actions={isAdmin ? <Link href="/admin/sources" className="btn-secondary">Manage sources</Link> : null}
      />
      <section aria-label="Monitoring summary" className="panel mb-3 text-[14px] text-slate-800">
        {live.length ? (
          <p><strong className="tabular-nums">{ok}</strong> of {live.length} monitored sources checked successfully within their window · <span className={failing ? "text-[#a3242c]" : ""}><strong className="tabular-nums">{failing}</strong> with failing checks</span> · <strong className="tabular-nums">{manual}</strong> reviewed by hand only (not automatically monitored).</p>
        ) : <p>No real sources are being monitored yet.</p>}
      </section>
      <Card>
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Source</th><th>How it is checked</th><th>Last successful check</th><th>Last attempt</th><th>Status</th><th className="text-right">Changes found</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.canonicalUrl} target="_blank" rel="noreferrer noopener" className="row-title">{s.name}</a> <SimulatedBadge show={s.isSimulated} />
                    <div className="text-[12.5px] text-slate-600">{s.category.replace(/_/g, " ").toLowerCase()}{s.jurisdiction ? ` · ${s.jurisdiction}` : ""}</div>
                  </td>
                  <td className="text-[13.5px]">{s.coverage === "MANUAL_REVIEW_ONLY" ? "Reviewed by hand" : `Automatic, every ${s.frequencyMinutes >= 1440 ? `${Math.round(s.frequencyMinutes / 1440)} day(s)` : `${Math.round(s.frequencyMinutes / 60)} hour(s)`}`}</td>
                  <td className="whitespace-nowrap text-[13.5px] tabular-nums">{s.lastSuccessAt ? fmtDate(s.lastSuccessAt, true) : "Never"}</td>
                  <td className="whitespace-nowrap text-[13.5px] tabular-nums">{s.lastAttemptedAt ? fmtDate(s.lastAttemptedAt, true) : "Never"}</td>
                  <td>
                    <span className="inline-flex flex-wrap gap-1"><Badge tone={FRESH_TONE[s.fresh.state] ?? "slate"}>{s.fresh.label}</Badge>{s.retrievalStatus === "FAILING" || s.retrievalStatus === "DEGRADED" ? <StatusBadge status={s.retrievalStatus} /> : null}</span>
                    {s.consecutiveFailures ? <div className="mt-1 text-[12.5px] text-[#a3242c]">{s.consecutiveFailures} failed check{s.consecutiveFailures === 1 ? "" : "s"} in a row{isAdmin && s.lastError ? `: ${s.lastError.slice(0, 160)}` : ""}</div> : null}
                  </td>
                  <td className="text-right tabular-nums"><Link href={`/changes?group=all&source=${s.id}`}>{s._count.changes}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No regulatory sources are configured.</Empty>}
      </Card>
    </>
  );
}

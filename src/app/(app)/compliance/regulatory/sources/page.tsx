import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { freshness } from "@/server/sources/engine";
import { ComplianceTabs } from "@/components/compliance-nav";
import { fmtDate } from "@/components/ui";
import { PcBadge, PcFoot, PcTableWrap, type PcTone } from "@/components/compliance-ui";

export const dynamic = "force-dynamic";

/**
 * One word for a source's health. Healthy only after a confirmed successful check within its window; Error when its
 * checks are failing; Needs review when it has never been checked, has gone stale or is reviewed by hand.
 */
function sourceHealth(s: { active: boolean; retrievalStatus: string; fresh: { state: string } }): { label: string; tone: PcTone } {
  if (!s.active) return { label: "Inactive", tone: "grey" };
  if (s.retrievalStatus === "FAILING" || s.retrievalStatus === "DEGRADED") return { label: "Error", tone: "red" };
  if (s.fresh.state === "fresh") return { label: "Healthy", tone: "green" };
  return { label: "Needs review", tone: "amber" };
}

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
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="sources" />}
        title="Regulatory Monitoring"
        subtitle="The legislation and guidance sources CSB checks for changes. A source is healthy only after a confirmed successful check within its window. Simulated sources are demonstration data, not real monitoring."
        actions={isAdmin ? <Link href="/admin/sources" className="pc-btn-secondary">Manage sources</Link> : null}
      />
      <section aria-label="Regulatory sources" className="pc-panel">
        <div className="pc-panel-head">
          <p className="text-body text-[#344054]" data-testid="monitoring-summary">
            {live.length ? <><strong className="tabular-nums">{ok}</strong> of {live.length} monitored sources checked successfully within their window · <span className={failing ? "text-[#b42318]" : ""}><strong className="tabular-nums">{failing}</strong> with failing checks</span> · <strong className="tabular-nums">{manual}</strong> reviewed by hand only</> : "No real sources are being monitored yet."}
          </p>
        </div>
        {rows.length ? (
          <PcTableWrap>
            <table className="pc-table">
              <thead><tr><th>Source</th><th>Verified or simulated</th><th>Last checked</th><th>Last successful check</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const health = sourceHealth(s);
                  return (
                    <tr key={s.id}>
                      <td className="max-w-[320px]">
                        <a href={s.canonicalUrl} target="_blank" rel="noreferrer noopener" className="pc-strong">{s.name}</a>
                        <span className="pc-sub">{s.category.replace(/_/g, " ").toLowerCase()}{s.jurisdiction ? ` · ${s.jurisdiction}` : ""} · <Link href={`/changes?group=all&source=${s.id}`}>{s._count.changes} change{s._count.changes === 1 ? "" : "s"} found</Link></span>
                      </td>
                      <td>{s.isSimulated ? <PcBadge tone="purple" title="Demonstration data, not real monitoring">Simulated</PcBadge> : <PcBadge tone="green">Verified source</PcBadge>}</td>
                      <td className="whitespace-nowrap">{s.lastAttemptedAt ? fmtDate(s.lastAttemptedAt, true) : "Never"}</td>
                      <td className="whitespace-nowrap">{s.lastSuccessAt ? fmtDate(s.lastSuccessAt, true) : "Never"}</td>
                      <td><PcBadge tone={health.tone}>{health.label}</PcBadge></td>
                      <td className="max-w-[340px] text-meta text-[#475467]">
                        {s.coverage === "MANUAL_REVIEW_ONLY" ? "Reviewed by hand; not automatically monitored." : `Checked automatically every ${s.frequencyMinutes >= 1440 ? `${Math.round(s.frequencyMinutes / 1440)} day(s)` : `${Math.round(s.frequencyMinutes / 60)} hour(s)`}. ${s.fresh.label}.`}
                        {s.consecutiveFailures ? <span className="block text-[#b42318]">{s.consecutiveFailures} failed check{s.consecutiveFailures === 1 ? "" : "s"} in a row{isAdmin && s.lastError ? `: ${s.lastError.slice(0, 160)}` : ""}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">No regulatory sources are configured.</p>}
        <PcFoot shown={rows.length} total={rows.length} />
      </section>
    </>
  );
}

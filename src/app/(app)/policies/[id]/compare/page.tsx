import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { PolicyDiffView } from "@/components/diff";
import { Empty, fmtDate, StatusBadge } from "@/components/ui";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getPolicy } from "@/server/policies/library";
import { versionDiff } from "@/server/policies/versions";

export const dynamic = "force-dynamic";

/**
 * Compare two versions of one policy, section by section (Policy Reader → "Compare Versions"). Uses the same diff as
 * the revision review screen. Read only: restoring an earlier version stays on the Versions view, through a new draft.
 */
export default async function CompareVersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const p = await orNotFound(getPolicy(ctx, id));
  const versions = p.versions; // newest first
  const back = `/policies/${p.id}`;
  // Default: the version staff read now against the one before it; otherwise the two newest.
  const liveIdx = versions.findIndex((v) => v.id === p.currentPublishedVersionId);
  const defTo = versions[liveIdx >= 0 ? liveIdx : 0];
  const defFrom = versions[(liveIdx >= 0 ? liveIdx : 0) + 1];
  const to = versions.find((v) => v.id === sp.to) ?? defTo;
  const from = versions.find((v) => v.id === sp.from) ?? (to && to.id !== defTo?.id ? versions[versions.indexOf(to) + 1] : defFrom);
  const diff = to && from && from.id !== to.id ? await versionDiff(from.id, to.id) : null;
  const label = (v: (typeof versions)[number]) => `Version ${v.label} · ${v.status.replace(/_/g, " ").toLowerCase()} · ${fmtDate(v.publishedAt ?? v.createdAt)}`;

  return (
    <>
      <CompliancePageHeader
        back={back}
        crumbs={[{ label: "Policy & Compliance", href: "/" }, { label: "Policy Library", href: "/policies" }, { label: `${p.ref} ${p.title}`, href: back }]}
        title="Compare versions"
        subtitle="Choose two versions to see what changed between them. Added text is green and removed text is red. Approved and published versions are never edited; a change always comes from a new revision."
        actions={<Link className="btn-secondary" href={`${back}?view=history`}>Version history</Link>}
      />
      {versions.length < 2 ? (
        <Empty>This policy has only one version, so there is nothing to compare yet.</Empty>
      ) : (
        <>
          <form className="pc-panel mb-4 flex flex-wrap items-end gap-3 p-4" method="get" data-testid="compare-form">
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="cmp-from">Earlier version</label>
              <select id="cmp-from" name="from" className="input" defaultValue={from?.id}>
                {versions.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
              </select>
            </div>
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="cmp-to">Later version</label>
              <select id="cmp-to" name="to" className="input" defaultValue={to?.id}>
                {versions.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
              </select>
            </div>
            <button className="btn-primary" type="submit">Compare</button>
          </form>
          {diff && from && to ? (
            <section className="pc-panel p-5" aria-label="Differences" data-testid="version-compare">
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[14px] text-slate-700">
                Comparing <strong>Version {from.label}</strong> <StatusBadge status={from.status} /> with <strong>Version {to.label}</strong> <StatusBadge status={to.status} />
              </p>
              <PolicyDiffView diff={diff} />
            </section>
          ) : (
            <Empty>Choose two different versions to compare.</Empty>
          )}
        </>
      )}
    </>
  );
}

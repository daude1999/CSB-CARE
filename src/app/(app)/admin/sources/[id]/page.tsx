import Link from "@/components/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { freshness } from "@/server/sources/engine";
import { manualCheckAction, updateSourceAction } from "../../../../actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasPlatformPermission(ctx, "sources.manage")) notFound();
  const s = await db.regulatorySource.findUnique({
    where: { id },
    include: {
      runs: { orderBy: { startedAt: "desc" }, take: 15 },
      documents: { orderBy: { lastSeenAt: "desc" }, take: 50, include: { currentVersion: { select: { id: true, versionNumber: true, retrievedAt: true } }, _count: { select: { versions: true } } } },
      changes: { orderBy: { detectedAt: "desc" }, take: 10 },
    },
  });
  if (!s) notFound();
  const events = await db.processingEvent.findMany({ where: { sourceId: s.id }, orderBy: { createdAt: "desc" }, take: 30 });
  const f = freshness(s);
  const back = `/admin/sources/${s.id}`;
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{s.name} <SimulatedBadge show={s.isSimulated} /></span>} subtitle={<a href={s.canonicalUrl} target="_blank" rel="noreferrer noopener">{s.canonicalUrl}</a>}
        actions={s.coverage !== "MANUAL_REVIEW_ONLY" ? (
          <form action={manualCheckAction}>
            <input type="hidden" name="sourceId" value={s.id} />
            <input type="hidden" name="back" value={back} />
            <button className="btn-primary" type="submit">Check now</button>
          </form>
        ) : null}
      />
      <Flash searchParams={sp} />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Retrieval runs">
            {s.runs.length ? (
              <table className="table table-stack">
                <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Checked</th><th>New</th><th>Changed</th><th>Failed</th><th>Error</th></tr></thead>
                <tbody>
                  {s.runs.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Started" className="text-xs">{fmtDate(r.startedAt, true)}</td>
                      <td data-label="Trigger" className="text-xs">{r.trigger.toLowerCase()}</td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Checked">{r.documentsChecked}</td><td data-label="New">{r.documentsNew}</td><td data-label="Changed">{r.documentsChanged}</td><td data-label="Failed">{r.documentsFailed}</td>
                      <td data-label="Error" className="max-w-xs text-xs text-rose-700">{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>This source has never been checked.</Empty>
            )}
          </Card>
          <Card title="Documents">
            {s.documents.length ? (
              <table className="table table-stack">
                <thead><tr><th>Title</th><th>Legal status</th><th>Versions</th><th>Current</th><th>Last seen</th></tr></thead>
                <tbody>
                  {s.documents.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Title"><a href={d.url} target="_blank" rel="noreferrer noopener">{d.title}</a>{d.withdrawnAt ? <Badge tone="rose">withdrawn</Badge> : null}</td>
                      <td data-label="Legal status" className="text-xs">{d.legalStatus.replace(/_/g, " ").toLowerCase()}</td>
                      <td data-label="Versions">{d._count.versions}</td>
                      <td data-label="Current">{d.currentVersion ? <Link href={`/sources/versions/${d.currentVersion.id}`}>v{d.currentVersion.versionNumber}</Link> : "—"}</td>
                      <td data-label="Last seen" className="text-xs">{fmtDate(d.lastSeenAt, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No documents captured yet.</Empty>
            )}
          </Card>
          <Card title="Processing log">
            {events.length ? (
              <ul className="space-y-1 font-mono text-[11px]">
                {events.map((e) => <li key={e.id} className={e.level === "error" ? "text-rose-700" : e.level === "warn" ? "text-amber-700" : "text-slate-600"}>{fmtDate(e.createdAt, true)} [{e.level}] {e.event}: {e.message}</li>)}
              </ul>
            ) : (
              <Empty>No events.</Empty>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Status">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Retrieval"><StatusBadge status={s.retrievalStatus} /></Field>
              <Field label="Coverage"><StatusBadge status={s.coverage} /></Field>
              <Field label="Freshness">{f.label}</Field>
              <Field label="Method">{s.monitoringMethod.replace(/_/g, " ").toLowerCase()}</Field>
              <Field label="Last attempt">{fmtDate(s.lastAttemptedAt, true)}</Field>
              <Field label="Last success">{fmtDate(s.lastSuccessAt, true)}</Field>
              <Field label="Last change">{fmtDate(s.lastChangeDetectedAt, true)}</Field>
              <Field label="Consecutive failures">{s.consecutiveFailures}</Field>
            </div>
            {s.lastError ? <p className="mt-3 text-xs text-rose-700">Last error: {s.lastError}</p> : null}
            {s.monitoringNotes ? <p className="mt-3 text-xs text-slate-500">{s.monitoringNotes}</p> : null}
            {s.licence ? <p className="mt-2 text-xs text-slate-500">Licence: {s.licence}{s.reuseNotes ? `. ${s.reuseNotes}` : ""}</p> : null}
          </Card>
          <Card title="Settings">
            <form action={updateSourceAction} className="space-y-2">
              <input type="hidden" name="sourceId" value={s.id} />
              <input type="hidden" name="back" value={back} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> Active</label>
              <label className="label" htmlFor="freq">Check every (minutes)</label>
              <input id="freq" className="input" type="number" min={60} name="frequencyMinutes" defaultValue={s.frequencyMinutes} />
              <label className="label" htmlFor="fresh">Freshness window (hours)</label>
              <input id="fresh" className="input" type="number" min={1} name="freshnessWindowHours" defaultValue={s.freshnessWindowHours} />
              <button className="btn-secondary" type="submit">Save</button>
            </form>
            <pre className="mt-3 overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(s.config, null, 2)}</pre>
          </Card>
          <Card title="Recent changes">
            {s.changes.length ? <ul className="space-y-1 text-sm">{s.changes.map((c) => <li key={c.id}><Link href={`/changes/${c.id}`}>{c.title}</Link> <StatusBadge status={c.status} /></li>)}</ul> : <Empty>None detected.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}

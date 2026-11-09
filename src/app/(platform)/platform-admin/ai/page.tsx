import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { aiUsage } from "@/server/platform/usage";
import { aiProviderProblem, aiProviderSetting } from "@/server/ai";
import { getSetting } from "@/server/platform/settings";
import { fmtDate } from "@/components/ui";
import { DetailRows, EmptyRow, fmtMoney, fmtNumber, Indicator, MetricStrip, NotConfigured, PxHeader, PxPanel, pxSecondary, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI" };

/** AI usage across clients. Metadata only: no document, prompt or answer appears here. */
export default async function AiPage() {
  const ctx = await requireCtx();
  const [u, ceiling] = await Promise.all([aiUsage(ctx), getSetting("ai.platformMonthlyRequests")]);
  const problem = aiProviderProblem();
  const cost = (p: number | null) => (p === null ? <NotConfigured>{u.tokensMetered ? "Prices not set" : "Not metered"}</NotConfigured> : fmtMoney(p));
  return (
    <>
      <PxHeader title="AI" description={`Usage since ${fmtDate(u.since)}. Each request is recorded with its client, feature, outcome, tokens and duration only. Allowances per client are set on the client's Modules tab.`} actions={<Link href="/platform-admin/settings?section=ai" className={pxSecondary}>AI settings</Link>} />
      {problem ? <p role="status" className="mb-5 rounded-[8px] border border-px-warn/30 bg-px-warn-bg px-4 py-2.5 text-[13.5px] text-px-ink"><strong className="font-semibold">AI provider needs attention.</strong> {problem}</p> : null}
      <MetricStrip label="AI figures" cols={4}>
        <Indicator label="Requests" value={fmtNumber(u.requests)} note={ceiling ? `Platform ceiling ${fmtNumber(ceiling)}` : "No platform ceiling"} />
        <Indicator label="Failed requests" value={fmtNumber(u.failed)} alert={u.failed > 0} note={u.failedBackgroundJobs ? `${fmtNumber(u.failedBackgroundJobs)} failed background jobs` : undefined} href={u.failedBackgroundJobs ? "/platform-admin/jobs" : undefined} />
        <Indicator label="Tokens" value={u.tokensMetered ? fmtNumber(u.inputTokens + u.outputTokens) : <NotConfigured>Not metered yet</NotConfigured>} note={`${fmtNumber(u.inputTokens)} in · ${fmtNumber(u.outputTokens)} out`} />
        <Indicator label="Estimated cost" value={cost(u.estimatedCostPence)} note={u.avgDurationMs === null ? "From measured tokens" : `Average ${(u.avgDurationMs / 1000).toFixed(1)} s per request`} />
      </MetricStrip>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PxPanel title="Usage by client" flush>
          <div className="px-4">
            <Table label="AI usage by client" minWidth={480} head={["Client", "Requests", "Tokens", "Estimated cost"]} align={["left", "right", "right", "right"]} empty={u.byOrg.length ? null : <EmptyRow>No AI requests this month.</EmptyRow>}>
              {u.byOrg.map((o) => <tr key={o.organisationId ?? "platform"}><td>{o.organisationId ? <Link href={`/platform-admin/clients/${o.organisationId}?tab=usage`}>{o.name}</Link> : o.name}</td><td className="text-right tabular-nums">{fmtNumber(o.requests)}</td><td className="text-right tabular-nums">{fmtNumber(o.tokens)}</td><td className="text-right">{cost(o.costPence)}</td></tr>)}
            </Table>
          </div>
        </PxPanel>
        <PxPanel title="Usage by feature" flush>
          <div className="px-4">
            <Table label="AI usage by feature" minWidth={480} head={["Feature", "Requests", "Tokens", "Estimated cost"]} align={["left", "right", "right", "right"]} empty={u.byFeature.length ? null : <EmptyRow>No AI requests this month.</EmptyRow>}>
              {u.byFeature.map((f) => <tr key={f.feature}><td className="font-mono text-[12.5px]">{f.feature}</td><td className="text-right tabular-nums">{fmtNumber(f.requests)}</td><td className="text-right tabular-nums">{fmtNumber(f.tokens)}</td><td className="text-right">{cost(f.costPence)}</td></tr>)}
            </Table>
          </div>
        </PxPanel>
        <PxPanel title="Recent failures" flush>
          <div className="px-4">
            <Table label="Recent AI failures" minWidth={480} head={["When", "Feature", "Reason", "Duration"]} empty={u.recentFailures.length ? null : <EmptyRow>No failures this month.</EmptyRow>}>
              {u.recentFailures.map((f) => <tr key={f.id}><td className="whitespace-nowrap tabular-nums">{fmtDate(f.createdAt, true)}</td><td className="font-mono text-[12.5px]">{f.feature}</td><td>{f.errorReason ?? "—"}</td><td className="tabular-nums">{(f.durationMs / 1000).toFixed(1)} s</td></tr>)}
            </Table>
          </div>
        </PxPanel>
        <PxPanel title="Provider">
          <DetailRows items={[["Provider setting", aiProviderSetting()], ["Status", problem ?? "Ready"], ["Model", process.env.ANTHROPIC_MODEL?.trim() || "Platform default"], ["API key", process.env.ANTHROPIC_API_KEY?.trim() ? "Set in the hosting environment (never shown)" : <NotConfigured key="k">Not configured</NotConfigured>], ["Support plans processed", `${fmtNumber(u.supportPlansProcessed)} (${fmtNumber(u.documentsProcessed)} documents)`]]} />
        </PxPanel>
      </div>
    </>
  );
}

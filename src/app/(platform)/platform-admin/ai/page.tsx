import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { aiUsage } from "@/server/platform/usage";
import { aiProviderProblem, aiProviderSetting } from "@/server/ai";
import { getSetting } from "@/server/platform/settings";
import { fmtDate } from "@/components/ui";
import { EmptyRow, fmtMoney, fmtNumber, Indicator, KeyValues, NotConfigured, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Management" };

/** AI usage across clients. Metadata only: no document, prompt or answer appears here. */
export default async function AiPage() {
  const ctx = await requireCtx();
  const [u, ceiling] = await Promise.all([aiUsage(ctx), getSetting("ai.platformMonthlyRequests")]);
  const problem = aiProviderProblem();
  const cost = (p: number | null) => (p === null ? <NotConfigured>{u.tokensMetered ? "Prices not set" : "Not metered"}</NotConfigured> : fmtMoney(p));
  return (
    <>
      <PxHeader title="AI Management" description={`Usage since ${fmtDate(u.since)}. Every AI request is recorded with its client, feature, outcome, tokens and duration only. Allowances per client are set on each client's Modules tab.`} />
      <section aria-label="AI indicators" className="mb-4 grid grid-cols-2 divide-x divide-y divide-[#eef0f5] overflow-hidden rounded-[8px] border border-[#e4e7ef] bg-white md:grid-cols-4 [&>*]:border-[#eef0f5]">
        <Indicator label="AI requests" value={fmtNumber(u.requests)} note={ceiling ? `Platform ceiling ${fmtNumber(ceiling)}` : "No platform ceiling"} />
        <Indicator label="Failed requests" value={fmtNumber(u.failed)} alert={u.failed > 0} />
        <Indicator label="Support plans processed" value={fmtNumber(u.supportPlansProcessed)} note={`${fmtNumber(u.documentsProcessed)} documents`} />
        <Indicator label="Tokens" value={u.tokensMetered ? fmtNumber(u.inputTokens + u.outputTokens) : <NotConfigured>Not metered yet</NotConfigured>} note={`${fmtNumber(u.inputTokens)} in · ${fmtNumber(u.outputTokens)} out`} />
        <Indicator label="Estimated cost" value={cost(u.estimatedCostPence)} note="From measured tokens and Platform Settings prices" />
        <Indicator label="Average duration" value={u.avgDurationMs === null ? "—" : `${(u.avgDurationMs / 1000).toFixed(1)} s`} />
        <Indicator label="Background processing failures" value={fmtNumber(u.failedBackgroundJobs)} alert={u.failedBackgroundJobs > 0} href="/platform-admin/jobs" />
        <Indicator label="Provider" value={<span className="text-[15px]">{aiProviderSetting()}</span>} note={problem ? "Needs attention" : "Ready"} alert={Boolean(problem)} />
      </section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PxPanel title="Usage by client">
          <Table head={["Client", "Requests", "Tokens", "Estimated cost"]} empty={u.byOrg.length ? null : <EmptyRow>No AI requests this month.</EmptyRow>}>
            {u.byOrg.map((o) => <tr key={o.organisationId ?? "platform"}><td>{o.organisationId ? <Link href={`/platform-admin/clients/${o.organisationId}?tab=ai`}>{o.name}</Link> : o.name}</td><td className="tabular-nums">{fmtNumber(o.requests)}</td><td className="tabular-nums">{fmtNumber(o.tokens)}</td><td>{cost(o.costPence)}</td></tr>)}
          </Table>
        </PxPanel>
        <PxPanel title="Usage by feature">
          <Table head={["Feature", "Requests", "Tokens", "Estimated cost"]} empty={u.byFeature.length ? null : <EmptyRow>No AI requests this month.</EmptyRow>}>
            {u.byFeature.map((f) => <tr key={f.feature}><td className="font-mono text-[12.5px]">{f.feature}</td><td className="tabular-nums">{fmtNumber(f.requests)}</td><td className="tabular-nums">{fmtNumber(f.tokens)}</td><td>{cost(f.costPence)}</td></tr>)}
          </Table>
        </PxPanel>
        <PxPanel title="Recent failures">
          <Table head={["When", "Feature", "Reason", "Duration"]} empty={u.recentFailures.length ? null : <EmptyRow>No failures this month.</EmptyRow>}>
            {u.recentFailures.map((f) => <tr key={f.id}><td className="whitespace-nowrap">{fmtDate(f.createdAt, true)}</td><td className="font-mono text-[12.5px]">{f.feature}</td><td>{f.errorReason ?? "—"}</td><td>{(f.durationMs / 1000).toFixed(1)} s</td></tr>)}
          </Table>
        </PxPanel>
        <PxPanel title="Provider configuration" actions={<Link href="/platform-admin/settings#ai" className="text-[13px]">AI settings</Link>}>
          <KeyValues items={[["Provider setting", aiProviderSetting()], ["Status", problem ?? "Ready"], ["Model", process.env.ANTHROPIC_MODEL?.trim() || "Platform default"], ["API key", process.env.ANTHROPIC_API_KEY?.trim() ? "Configured in the hosting environment (never shown)" : "Not configured"]]} />
        </PxPanel>
      </div>
    </>
  );
}

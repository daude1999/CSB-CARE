import { Card, fmtDate } from "@/components/ui";
import { PcBadge } from "@/components/compliance-ui";
import { SeverityBadge, TrustBadge } from "@/components/policy-geo-ui";
import type { generationForRevision } from "@/server/policy-geo/generator";
import { recheckGapsAction, resolveGapAction } from "@/app/policy-geo-actions";

type Generated = NonNullable<Awaited<ReturnType<typeof generationForRevision>>>;

const MODE_LABEL: Record<string, string> = { NATIONAL: "National policy", SHARED_WITH_APPENDICES: "Company policy with branch appendices", BRANCH_SPECIFIC: "Separate branch policy" };

/** On a generated draft: how it was made, the sources it cites (as they stood when generated) and the gaps to close. */
export function GeneratedDraftCard({ generated, canResolve, back, open }: { generated: Generated; canResolve: boolean; back: string; open: boolean }) {
  const { run, snapshot, branches } = generated;
  const openGaps = run.gaps.filter((g) => !g.resolvedAt);
  const critical = openGaps.filter((g) => g.severity === "CRITICAL").length;
  const sources = [...snapshot.national, ...snapshot.branches.flatMap((b) => [...b.regional, ...b.local])];
  return (
    <Card title="Generated draft: sources and gaps">
      <div className="space-y-4 text-sm" data-testid="generated-draft-card">
        <p>
          {MODE_LABEL[run.mode] ?? run.mode}{branches.length ? ` for ${branches.map((b) => b.name).join(", ")}` : ""}.{" "}
          {run.method === "AI" ? `Wording improved by AI (${run.provider ?? "provider"}) and checked against the sources.` : "Built only from the recorded sources and branch details (no AI)."} Generated {fmtDate(run.createdAt, true)}.
        </p>
        {snapshot.notes.length ? <ul className="list-disc pl-5 text-xs text-slate-600">{snapshot.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-navy-900">Gaps {critical ? <PcBadge tone="red">{critical} critical open</PcBadge> : <PcBadge tone="green">No critical gaps open</PcBadge>}</span>
            {open && canResolve ? (
              <form action={recheckGapsAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="runId" value={run.id} /><button className="btn-secondary" type="submit">Re-check gaps</button></form>
            ) : null}
          </div>
          {run.gaps.length ? (
            <ul className="divide-y divide-slate-100" aria-label="Gaps">
              {run.gaps.map((g) => (
                <li key={g.id} className="py-2" data-testid={`gap-${g.kind}`}>
                  <div className="flex items-start gap-2"><SeverityBadge severity={g.severity} /><span>{g.message}</span></div>
                  {g.resolvedAt ? (
                    <p className="ml-1 mt-1 text-xs text-[#067647]">Resolved {fmtDate(g.resolvedAt, true)}: {g.resolution}</p>
                  ) : open && canResolve ? (
                    <form action={resolveGapAction} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="gapId" value={g.id} />
                      <input name="resolution" required minLength={10} className="input min-w-[220px] flex-1" placeholder="What was done (e.g. confirmed the procedure from the council's page)" aria-label="How this gap was resolved" />
                      <button className="btn-secondary" type="submit">Resolve</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-600">No gaps were found.</p>}
        </div>
        <div>
          <div className="mb-1 font-semibold text-navy-900">Sources cited</div>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={`${s.label}-${s.id}`} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{s.label}</span><a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a><span className="text-xs text-slate-500">{s.areas}</span><TrustBadge trust={s.trust} /></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Status as recorded when the draft was generated. Current status is in Local &amp; Safeguarding References.</p>
        </div>
      </div>
    </Card>
  );
}

import type { ReactNode } from "react";
import { PcBadge, type PcTone } from "@/components/compliance-ui";
import { TRUST_LABEL, type SourceTrust } from "@/server/policy-geo/applicability";
import { CELL_LABEL, type CellState } from "@/server/policy-geo/coverage";

/** Small presentational pieces shared by the branch-specific policy screens. Every value shown is passed in. */

const TRUST_TONE: Record<SourceTrust, PcTone> = { verified: "green", unverified: "amber", needs_review: "amber", review_overdue: "red", superseded: "grey", check_failed: "red" };
export function TrustBadge({ trust }: { trust: SourceTrust }) {
  return <PcBadge tone={TRUST_TONE[trust]}>{TRUST_LABEL[trust]}</PcBadge>;
}

const LEVEL_LABEL: Record<string, string> = { NATIONAL: "National", REGIONAL: "Regional", LOCAL: "Local authority" };
const LEVEL_TONE: Record<string, PcTone> = { NATIONAL: "blue", REGIONAL: "purple", LOCAL: "grey" };
export function LevelBadge({ level }: { level: string }) {
  return <PcBadge tone={LEVEL_TONE[level] ?? "grey"}>{LEVEL_LABEL[level] ?? level}</PcBadge>;
}

const CELL_TONE: Record<CellState, PcTone> = { approved: "green", approved_needs_review: "amber", awaiting_approval: "purple", draft: "blue", missing_local: "red", national: "green", not_started: "grey" };
export function CellBadge({ state }: { state: CellState }) {
  return <PcBadge tone={CELL_TONE[state]}>{CELL_LABEL[state]}</PcBadge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return severity === "CRITICAL" ? <PcBadge tone="red">Critical</PcBadge> : <PcBadge tone="amber">Warning</PcBadge>;
}

/** The six steps of the generator, with the current one marked. */
export const GENERATOR_STEPS = ["Select policy", "Select branches", "Review requirements", "Generate draft", "Check the draft", "Publish"] as const;
export function GeneratorSteps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 border-b border-[#eaecf0] px-5 py-3 text-[13px]" aria-label="Policy Generator steps" data-testid="generator-steps">
      {GENERATOR_STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={s} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${state === "current" ? "bg-module text-white" : state === "done" ? "bg-[#ecfdf3] text-[#067647]" : "bg-[#f2f4f7] text-[#667085]"}`}>{state === "done" ? "✓" : n}</span>
            <span className={state === "current" ? "font-semibold text-[#101828]" : "text-[#475467]"}>{s}</span>
            {n < GENERATOR_STEPS.length ? <span aria-hidden="true" className="mx-1.5 text-[#98a2b3]">›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A labelled read-only fact. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium uppercase tracking-[0.04em] text-[#667085]">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] text-[#101828]">{children}</dd>
    </div>
  );
}

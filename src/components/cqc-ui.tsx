import type { ReactNode } from "react";
import Link from "@/components/link";
import { Info, WarningOctagon, Warning as WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { PcBadge, type PcTone } from "@/components/compliance-ui";
import type { Confidence, GroupScore } from "@/server/cqc/scoring";

/**
 * Building blocks for CQC Inspection & Evidence, in the Policy & Compliance look (pc- styles). Layout only: every
 * figure is passed in by the page from server-side records.
 */

/** The label the owner's spec requires wherever a readiness score appears. */
export function NotOfficialBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-module/[.22] bg-module/[.08] px-4 py-2.5 text-[13.5px] text-[#3e1c96]" role="note" data-testid="not-official">
      <Info size={18} weight="fill" aria-hidden="true" className="shrink-0" />
      <strong className="font-semibold">Internal CQC Readiness Assessment – Not an Official CQC Rating</strong>
      {children ? <span className="text-module">{children}</span> : null}
    </div>
  );
}

export function scoreToneOf(score: number | null): PcTone {
  if (score === null) return "grey";
  return score >= 80 ? "green" : score >= 60 ? "amber" : "red";
}

const CONF_LABEL: Record<Confidence, string> = { HIGH: "High confidence", LOW: "Low confidence", NOT_ASSESSED: "Not assessed" };

/** A score, or the reason it is held back. */
export function ScoreValue({ g, big = false }: { g: GroupScore; big?: boolean }) {
  if (g.score !== null) return <span className={`${big ? "text-[34px] leading-[40px]" : "text-[20px] leading-7"} font-semibold tabular-nums ${g.score >= 80 ? "text-[#067647]" : g.score >= 60 ? "text-[#b54708]" : "text-[#b42318]"}`}>{g.score}<span className={`${big ? "text-[16px]" : "text-[13px]"} font-medium text-[#667085]`}>/100</span></span>;
  return <span className={`${big ? "text-[18px]" : "text-[14px]"} font-semibold text-[#475467]`}>{CONF_LABEL[g.confidence]}</span>;
}

export function ConfidenceNote({ g }: { g: GroupScore }) {
  if (g.confidence === "NOT_ASSESSED") return <>No areas assessed yet</>;
  return <>{g.assessed} of {g.applicable} areas assessed{g.confidence === "LOW" ? `; score held back below 75%${g.provisional !== null ? ` (provisional ${g.provisional})` : ""}` : ""}</>;
}

/** A horizontal meter for a 0-100 value. Decorative: the number beside it carries the meaning. */
export function Meter({ value, tone }: { value: number | null; tone: PcTone }) {
  const colour = { green: "#12b76a", amber: "#f79009", red: "#f04438", blue: "#2e90fa", purple: "#7a5af8", grey: "#d0d5dd" }[tone];
  return (
    <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-[#f2f4f7]">
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: colour }} />
    </span>
  );
}

export interface WarningItem { level: "critical" | "high"; text: string; href: string | null }

export function WarningList({ items }: { items: WarningItem[] }) {
  if (!items.length) return <p className="px-5 py-4 text-[13.5px] text-[#067647]" data-testid="no-warnings">No critical warnings from current records.</p>;
  return (
    <ul className="divide-y divide-[#eaecf0]" data-testid="cqc-warnings">
      {items.map((w, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-2.5 text-[14px]">
          {w.level === "critical" ? <WarningOctagon size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-[#d92d20]" /> : <WarningIcon size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-[#dc6803]" />}
          <span className="sr-only">{w.level === "critical" ? "Critical: " : "High: "}</span>
          {w.href ? <Link href={w.href} className="pc-link flex-1">{w.text}</Link> : <span className="flex-1 text-[#101828]">{w.text}</span>}
          <PcBadge tone={w.level === "critical" ? "red" : "amber"}>{w.level === "critical" ? "Critical" : "High"}</PcBadge>
        </li>
      ))}
    </ul>
  );
}

/** A label, value and optional link, as one row of a figures panel. */
export function FigureRow({ label, value, href, tone, note, testId }: { label: string; value: number | string | null; href?: string | null; tone?: "red" | "amber" | "green"; note?: string; testId?: string }) {
  const colour = tone === "red" ? "text-[#b42318]" : tone === "amber" ? "text-[#b54708]" : tone === "green" ? "text-[#067647]" : "text-[#101828]";
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] text-[#344054]">{label}</span>
        {note ? <span className="block text-[12px] text-[#667085]">{note}</span> : null}
      </span>
      <span className={`text-[17px] font-semibold tabular-nums ${colour}`}>{value ?? "—"}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center gap-3 px-5 py-2 no-underline hover:bg-[#f9fafb]" data-testid={testId}>{body}</Link>
  ) : (
    <div className="flex items-center gap-3 px-5 py-2" data-testid={testId}>{body}</div>
  );
}

export const LINK_TONE: Record<string, PcTone> = { SUGGESTED: "blue", AWAITING_REVIEW: "purple", VERIFIED: "green", REJECTED: "red", OUTDATED: "amber", SUPERSEDED: "grey" };
export const RESULT_TONE: Record<string, PcTone> = { MET: "green", PARTIALLY_MET: "amber", NOT_MET: "red", NOT_APPLICABLE: "grey" };
export const RCA_TONE: Record<string, PcTone> = { NEW: "blue", INVESTIGATING: "blue", AWAITING_REVIEW: "purple", ACTIONS_IN_PROGRESS: "amber", EFFECTIVENESS_REVIEW: "purple", CLOSED: "grey" };
export const SEVERITY_TONE: Record<string, PcTone> = { LOW: "grey", MODERATE: "amber", HIGH: "red", CRITICAL: "red" };
export const ASSESSMENT_TONE: Record<string, PcTone> = { IN_PROGRESS: "blue", AWAITING_APPROVAL: "purple", APPROVED: "green", SUPERSEDED: "grey" };

export function Panel({ title, actions, children, testId, className = "" }: { title: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={`pc-panel ${className}`} data-testid={testId}>
      <div className="pc-panel-head"><h2 className="pc-panel-title">{title}</h2>{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}</div>
      {children}
    </section>
  );
}

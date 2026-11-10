import type { ReactNode } from "react";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";

/**
 * HR & Workforce's shared building blocks (owner's approved HR concept, 2 Nov 2026): page heading, summary figure,
 * avatar, status badge and empty state. Styles are in src/app/(app)/hr/hr-ui.css under `.hr-ui`. No hooks, so the
 * same components serve the HR Hub's client screens and the server-rendered Recruitment pages.
 */

export const HX_PRIMARY = "hx-btn hx-btn--primary";
export const HX_SECONDARY = "hx-btn hx-btn--secondary";
export const HX_QUIET = "hx-btn hx-btn--quiet";

/** The page's one level-one heading: the shared module band with a short description and the page's actions. */
export function HrHeading({ title, subtitle, actions, id, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; id?: string; crumbs?: { label: string; href?: string }[] }) {
  return <ModuleHeader title={title} description={subtitle} actions={actions} titleId={id} crumbs={crumbs} module="hr" testId="hr-heading" />;
}

/** A summary figure. `note` says exactly what is counted (shown small, and read out with the figure). */
export function HrStat({ icon, value, label, href, note, testId }: { icon: ReactNode; value: number | string; label: string; href?: string; note?: string; testId?: string }) {
  const body = (
    <>
      <span className="hx-stat-icon" aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="hx-stat-value">{value}</span>
        <span className="hx-stat-label">{label}</span>
        {note ? <span className="hx-stat-note">{note}</span> : null}
      </span>
    </>
  );
  return (
    <li className="min-w-0">
      {href ? (
        <Link href={href} className="hx-card hx-stat" data-testid={testId}>{body}</Link>
      ) : (
        <div className="hx-card hx-stat" data-testid={testId}>{body}</div>
      )}
    </li>
  );
}

/** Initials of a name: first and last word. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return ((words[0]![0] ?? "") + (words.length > 1 ? words[words.length - 1]![0] ?? "" : "")).toUpperCase();
}

function tone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `t${(h % 5) + 1}`;
}

/** Initials avatar (no photographs are held). Decorative: the name is always written beside it. */
export function HrAvatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return (
    <span aria-hidden="true" className={`hx-avatar ${tone(name)} ${size ? `is-${size}` : ""}`}>
      {initials(name)}
    </span>
  );
}

export type HrTone = "good" | "warn" | "bad" | "info" | "neutral";

/** A compact status pill with a dot and a word. */
export function HrBadge({ tone: t = "neutral", children }: { tone?: HrTone; children: ReactNode }) {
  return <span className={`hx-badge ${t === "neutral" ? "" : `is-${t}`}`}>{children}</span>;
}

/** A status written as an icon and a word in the status colour (used for compliance). */
export function HrState({ tone: t, icon, children }: { tone: HrTone; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={`hx-state is-${t}`}>
      <span aria-hidden="true" className="inline-flex">{icon}</span>
      {children}
    </span>
  );
}

export function HrEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="hx-empty" role="status">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

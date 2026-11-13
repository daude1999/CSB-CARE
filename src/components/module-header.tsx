import type { ReactNode } from "react";
import Link from "@/components/link";
import { ModuleHeader, type Crumb } from "@/components/module-header-band";

/**
 * Page headers for each module. Since the owner's approved colour redesign (10 Nov 2026) they all draw the one shared
 * `ModuleHeader` band (src/components/module-header-band.tsx); these wrappers keep the props pages already pass.
 * `subtitle` becomes the band's one-line description and `back` the middle breadcrumb of a detail page.
 */
export type ModuleHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Kept for call sites that passed it to PageHeader; not shown. */
  eyebrow?: ReactNode;
  back?: string | null;
  tabs?: ReactNode;
  /** Kept for call sites that passed it; the band shows the module's own icon. */
  icon?: ReactNode;
};

export function ModulePageHeader({ title, subtitle, actions, tabs }: ModuleHeaderProps) {
  return <ModuleHeader title={title} description={subtitle} actions={actions} tabs={tabs} />;
}

/**
 * Where a Policy & Compliance page's "back" address sits in the module, so a detail page's breadcrumb leads back to
 * the list it came from.
 */
const COMPLIANCE_PARENTS: [string, string][] = [
  ["/policies/generator", "Policy Generator"],
  ["/policies/coverage", "Branch Coverage"],
  ["/policies/cross-boundary", "Branch Coverage"],
  ["/policies/branches", "Branch Configuration"],
  ["/policies/updates", "Monthly Updates"],
  ["/policies", "Policy Library"],
  ["/queue", "Drafts"],
  ["/changes", "Regulatory Monitoring"],
  ["/compliance/regulatory/references", "Local & Safeguarding References"],
  ["/requirements", "Requirements Register"],
  ["/staff", "Staff Sign-off"],
  ["/acknowledgements", "My Reading List"],
  ["/audits", "Audits & Improvements"],
  ["/actions", "Corrective Actions"],
  ["/compliance/risks", "Risk Register"],
  ["/evidence", "Evidence Library"],
  ["/compliance/cqc/assessments", "CQC Assessment"],
  ["/compliance/cqc/rca", "Root Cause Analysis"],
  ["/compliance/cqc", "CQC Inspection & Evidence"],
];

/** The list a detail page belongs to, from its `back` address, as a breadcrumb. */
export function parentCrumb(back: string | null | undefined, title: ReactNode, parents: [string, string][] = COMPLIANCE_PARENTS): Crumb[] {
  const parentPath = back ? back.split("?")[0]! : null;
  const parent = parentPath && parentPath !== "/" ? parents.find(([p]) => parentPath === p || parentPath.startsWith(`${p}/`)) : undefined;
  return parent && parent[1] !== title ? [{ label: parent[1], href: back! }] : [];
}

/** Policy & Compliance page header. A detail page's `back` address becomes the middle breadcrumb. */
export function CompliancePageHeader({ title, subtitle, actions, back, tabs, crumbs }: ModuleHeaderProps & { crumbs?: Crumb[] }) {
  // Older call sites pass the whole trail starting with the module; the band adds the module itself.
  const trail = crumbs ? crumbs.filter((c) => c.label !== "Policy & Compliance") : parentCrumb(back, title);
  return <ModuleHeader title={title} description={subtitle} actions={actions} tabs={tabs} crumbs={trail} />;
}

/** HR & Workforce page header. */
export function HrPageHeader(props: ModuleHeaderProps) {
  return <ModulePageHeader {...props} />;
}

/** A module's primary action button: filled in the module colour. Use only for an action the person may take. */
export const MODULE_PRIMARY =
  "module-primary inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--module,#1f5fd1)] px-3.5 text-[14px] font-semibold text-white no-underline hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--module,#1f5fd1)]";
/** A secondary action: white with a grey border. */
export const MODULE_SECONDARY =
  "module-secondary inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-slate-300 bg-white px-3.5 text-[14px] font-medium text-slate-800 no-underline hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--module,#1f5fd1)]";

const FIGURE_TONE = {
  navy: "text-slate-900",
  teal: "text-[#1d4f91]",
  rose: "text-[#a3242c]",
  amber: "text-[#8a5a00]",
  green: "text-[#1c7a43]",
  violet: "text-slate-900",
} as const;

/**
 * A key figure on an HR or Compliance page (approved designs): label, number, short note, on a white card with a thin
 * border. Same props as the shared `Stat`, which other modules keep. The tone colours the number only, and only for
 * meaning (red overdue, amber attention, green done).
 */
export function ModuleStat({ label, value, href, tone = "navy", hint }: { label: string; value: number | string; href?: string; tone?: keyof typeof FIGURE_TONE; hint?: string }) {
  const body = (
    <span className="min-w-0">
      <span className="block text-[14px] font-medium text-slate-700">{label}</span>
      <span className={`block text-[24px] font-semibold leading-8 tabular-nums ${FIGURE_TONE[tone]}`}>{value}</span>
      {hint ? <span className="block truncate text-[12px] text-slate-500">{hint}</span> : null}
    </span>
  );
  const cls = "flex min-w-0 items-center rounded-[8px] border border-slate-200 bg-white px-4 py-2.5 no-underline";
  return href ? <Link href={href} className={`${cls} hover:border-[#9db8ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--module,#1f5fd1)]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function ModuleStatRow({ children, label = "Key figures" }: { children: ReactNode; label?: string }) {
  return <section aria-label={label} className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">{children}</section>;
}

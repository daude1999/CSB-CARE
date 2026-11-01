import type { ReactNode } from "react";
import Link from "@/components/link";
import { CaretLeft, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";

/**
 * The page header for HR & Workforce (orange) and Policy & Compliance (blue), from the owner's approved designs of
 * 1 Nov 2026: a left-aligned title bar in the module colour with the module's icon, the workspace's tabs under it,
 * then one white strip with what the page is for and its actions.
 *
 * Rostering & Care Management keeps the shared, centred `PageHeader`/`TitleBar` (it is visually locked), so this is a
 * separate component used only by HR and Compliance pages. It takes the same props as `PageHeader`, so a page swaps
 * one for the other without other changes.
 */
export type ModuleHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Kept for call sites that passed it to PageHeader; not shown. */
  eyebrow?: ReactNode;
  back?: string | null;
  tabs?: ReactNode;
  icon?: ReactNode;
};

export function ModulePageHeader({ title, subtitle, actions, back = "/", tabs, icon }: ModuleHeaderProps) {
  return (
    <header className="mb-3" data-testid="module-header">
      <div data-testid="title-bar" className="flex min-h-[56px] items-center gap-3 rounded-t-[6px] bg-[var(--module,#0f2a4f)] px-4 py-2.5 text-white">
        {back ? (
          <Link href={back} className="-ml-1 inline-flex h-9 items-center gap-1 rounded-[6px] px-2 text-[14px] text-white/90 no-underline hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <CaretLeft size={14} weight="bold" aria-hidden="true" />Back
          </Link>
        ) : null}
        {back ? <span aria-hidden="true" className="h-6 w-px bg-white/30" /> : null}
        {icon ? <span aria-hidden="true" className="flex shrink-0 items-center text-white">{icon}</span> : null}
        <h1 className="min-w-0 text-[22px] font-semibold leading-tight tracking-normal text-white">{title}</h1>
      </div>
      {tabs ? <div className="bg-white">{tabs}</div> : null}
      {subtitle || actions ? (
        <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-b-[6px] border-b border-slate-200 bg-white px-4 py-2.5 ${tabs ? "border-t" : ""}`}>
          {subtitle ? <p className="min-w-0 max-w-4xl flex-1 basis-[18rem] text-[13.5px] leading-5 text-slate-600">{subtitle}</p> : <span />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Policy & Compliance page header (blue, from the module colour). */
export function CompliancePageHeader(props: ModuleHeaderProps) {
  return <ModulePageHeader icon={<ShieldCheck size={26} aria-hidden="true" />} {...props} />;
}

/** HR & Workforce page header (orange, from the module colour). */
export function HrPageHeader(props: ModuleHeaderProps) {
  return <ModulePageHeader icon={<UsersThree size={26} aria-hidden="true" />} {...props} />;
}

/** A module's primary action button: filled in the module colour. Use only for an action the person may take. */
export const MODULE_PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--module,#1f5fd1)] px-3.5 text-[14px] font-semibold text-white no-underline hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--module,#1f5fd1)]";
/** A secondary action: white with a grey border. */
export const MODULE_SECONDARY =
  "inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-slate-300 bg-white px-3.5 text-[14px] font-medium text-slate-800 no-underline hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--module,#1f5fd1)]";

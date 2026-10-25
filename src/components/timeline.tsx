// Vertical record timeline. The item / marker / connector / content split follows
// UIAble's timeline component (MIT, codedthemes/uiable), restyled for CSB.
import type { ReactNode } from "react";

export type TimelineMark = "current" | "past" | "pending" | "warning";

const MARKS: Record<TimelineMark, string> = {
  current: "border-emerald-700 bg-emerald-700",
  past: "border-slate-400 bg-white",
  pending: "border-dashed border-teal-600 bg-white",
  warning: "border-amber-600 bg-amber-50",
};

export function Timeline({ children, testId }: { children: ReactNode; testId?: string }) {
  return <ol data-testid={testId} className="relative">{children}</ol>;
}

export function TimelineItem({ mark, when, title, children, aside, last = false }: { mark: TimelineMark; when: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; last?: boolean }) {
  return (
    <li className="grid grid-cols-[7rem_1.25rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[8.5rem_1.25rem_minmax(0,1fr)_auto]">
      <div className="pt-0.5 text-right font-mono text-[11px] uppercase leading-5 text-slate-500">{when}</div>
      <div className="relative flex justify-center">
        <span aria-hidden="true" className={`relative z-10 mt-1 h-3 w-3 rounded-full border-2 ${MARKS[mark]}`} />
        {last ? null : <span aria-hidden="true" className="absolute bottom-0 top-5 w-px bg-slate-300" />}
      </div>
      <div className="min-w-0 pb-8">
        <div className="font-medium text-navy-900">{title}</div>
        {children ? <div className="mt-1 text-sm text-slate-600">{children}</div> : null}
      </div>
      {aside ? <div className="col-start-3 pb-8 sm:col-start-auto">{aside}</div> : null}
    </li>
  );
}

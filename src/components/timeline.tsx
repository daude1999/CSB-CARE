// Vertical record timeline for CSB, built on UIAble's timeline component (MIT, codedthemes/uiable).
import type { ReactNode } from "react";
import { Timeline as UiTimeline, TimelineConnector, TimelineContent, TimelineIndicator, TimelineItem as UiTimelineItem, TimelineSeparator } from "@/components/uiable/timeline";

export type TimelineMark = "current" | "past" | "pending" | "warning";

const MARKS: Record<TimelineMark, string> = {
  current: "border-emerald-700 bg-emerald-700",
  past: "border-slate-400 bg-white",
  pending: "border-dashed border-teal-600 bg-white",
  warning: "border-amber-600 bg-amber-50",
};

export function Timeline({ children, testId }: { children: ReactNode; testId?: string }) {
  return <UiTimeline data-testid={testId} size="sm">{children}</UiTimeline>;
}

export function TimelineItem({ mark, when, title, children, aside }: { mark: TimelineMark; when: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode; last?: boolean }) {
  return (
    <UiTimelineItem className="gap-4">
      <div className="w-24 shrink-0 pt-0.5 text-right font-mono text-[11px] uppercase leading-5 text-slate-500 sm:w-32">{when}</div>
      <TimelineSeparator>
        <TimelineIndicator size="sm" className={`mt-1 size-3! border-2 shadow-none ${MARKS[mark]}`} />
        <TimelineConnector className="bg-slate-300" />
      </TimelineSeparator>
      <TimelineContent className="flex flex-wrap justify-between gap-3 pl-0">
        <div className="min-w-0">
          <div className="font-medium text-navy-900">{title}</div>
          {children ? <div className="mt-1 text-sm text-slate-600">{children}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </TimelineContent>
    </UiTimelineItem>
  );
}

import type { VisitStatus } from "@prisma/client";
import Link from "@/components/link";
import { Badge, type Tone } from "@/components/ui";
import { londonTime } from "@/lib/london";
import type { VisitFlags } from "@/server/rota/queries";

/** Shared pieces of the rostering screens: visit status, derived flags, carer slots and the time column. */

const VISIT_TONE: Record<VisitStatus, Tone> = { SCHEDULED: "teal", IN_PROGRESS: "amber", COMPLETED: "green", MISSED: "rose", CANCELLED: "slate", NOT_DELIVERED: "slate" };
export const VISIT_LABEL: Record<VisitStatus, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", MISSED: "Missed", CANCELLED: "Cancelled", NOT_DELIVERED: "Not delivered" };

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return <Badge tone={VISIT_TONE[status]}>{VISIT_LABEL[status]}</Badge>;
}

/** Late, short, unassigned and needs-review are worked out on read; they are shown next to the stored status. */
export function FlagBadges({ flags }: { flags: VisitFlags }) {
  return (
    <>
      {flags.unassignedSlots ? <Badge tone="rose">{flags.unassignedSlots === 1 ? "Unassigned" : `${flags.unassignedSlots} unassigned`}</Badge> : null}
      {flags.late ? <Badge tone="amber" title={flags.lateBy !== null ? `${flags.lateBy} minutes after the planned start` : undefined}>{flags.overdueStart ? "Not started" : "Late"}{flags.lateBy !== null ? ` ${flags.lateBy}m` : ""}</Badge> : null}
      {flags.short ? <Badge tone="amber">Short</Badge> : null}
      {flags.review.length ? <Badge tone="rose" title={flags.review.join("; ")}>Needs review</Badge> : null}
    </>
  );
}

export function TimeSpan({ start, end }: { start: Date; end: Date }) {
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {londonTime(start)}–{londonTime(end)} <span className="text-slate-500">({mins}m)</span>
    </span>
  );
}

/** The carers on a visit, one chip per slot, with empty slots shown in red. */
export function CarerSlots({ assignments, carersRequired, cancelled }: { assignments: { slot: string; reviewReason: string | null; staff: { id: string; displayName: string } }[]; carersRequired: number; cancelled?: boolean }) {
  const slots = ["PRIMARY", ...(carersRequired > 1 ? ["SECOND"] : [])];
  const shadow = assignments.find((a) => a.slot === "SHADOW");
  return (
    <span className="flex flex-wrap gap-1">
      {slots.map((s) => {
        const a = assignments.find((x) => x.slot === s);
        if (!a) return cancelled ? null : <span key={s} className="rounded-[3px] border border-dashed border-[#e4544f] px-1.5 text-[12.5px] text-[#a3242c]">Unassigned</span>;
        return (
          <span key={s} title={a.reviewReason ?? undefined} className={`rounded-[3px] px-1.5 text-[12.5px] ${a.reviewReason ? "bg-[#fde1e3] text-[#a3242c]" : "bg-[#e3effb] text-[#1d4f91]"}`}>
            {a.staff.displayName}
          </span>
        );
      })}
      {shadow ? <span className="rounded-[3px] bg-slate-100 px-1.5 text-[12.5px] text-slate-600" title="Shadowing">+ {shadow.staff.displayName}</span> : null}
    </span>
  );
}

export function AreaDot({ area }: { area: { name: string; colour: string } | null }) {
  if (!area) return <span className="text-slate-400">No area</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: area.colour }} />
      {area.name}
    </span>
  );
}

/** Previous/next links around a date or week, keeping the other filters. */
export function Stepper({ base, params, param: k, prev, next, label }: { base: string; params: Record<string, string | undefined>; param: string; prev: string; next: string; label: React.ReactNode }) {
  const href = (v: string) => `${base}?${new URLSearchParams(Object.entries({ ...params, [k]: v }).filter((e): e is [string, string] => !!e[1]))}`;
  return (
    <div className="flex items-center gap-1">
      <Link href={href(prev)} className="btn-secondary px-2.5 py-1" aria-label="Previous">‹</Link>
      <span className="min-w-[170px] text-center text-[15px] font-medium text-navy-900">{label}</span>
      <Link href={href(next)} className="btn-secondary px-2.5 py-1" aria-label="Next">›</Link>
    </div>
  );
}

import type { VisitStatus } from "@prisma/client";
import Link from "@/components/link";
import { Badge, type Tone } from "@/components/ui";
import { londonTime, mondayOf } from "@/lib/london";
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

/** "Thursday 29th October 2026": the long date heading used on the dashboard and the rota pages. */
export function longDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${day}${suffix} ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * The status words the office uses on the live rota: Due, Late, In Progress, Complete, Missed. Late and Due are
 * worked out from the clock, so they never go stale. The row tint repeats the status but never replaces the word.
 */
export function rotaState(v: { status: VisitStatus; flags: VisitFlags }): { label: string; tint: string } {
  switch (v.status) {
    case "SCHEDULED":
      return v.flags.overdueStart ? { label: "Late", tint: "[&>td]:bg-[#fff6db]" } : { label: "Due", tint: "" };
    case "IN_PROGRESS":
      return { label: v.flags.late ? "In Progress (late)" : "In Progress", tint: "[&>td]:bg-[#e2f2fb]" };
    case "COMPLETED":
      return { label: v.flags.late ? "Complete (late)" : "Complete", tint: "[&>td]:bg-[#eaf6ec]" };
    case "MISSED":
      return { label: "Missed", tint: "[&>td]:bg-[#fde8e8]" };
    case "NOT_DELIVERED":
      return { label: "Not delivered", tint: "[&>td]:bg-[#fde8e8]" };
    default:
      return { label: "Cancelled", tint: "opacity-60" };
  }
}

/**
 * Shown where a date has no visits because nobody has built that week's rota yet. Visits only exist once a week is
 * built from the templates (or added one at a time), so an empty rota is never a display fault to hide.
 */
export function NotBuiltNotice({ date, canBuild }: { date: string; canBuild: boolean }) {
  const monday = mondayOf(date);
  return (
    <div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-950">
      <strong className="font-semibold">No rota has been built for the week of {longDate(monday)}.</strong>{" "}
      Visits appear here once the week is built from the templates in Build Rota{canBuild ? "" : " (ask a coordinator)"}, or added one at a time.
      {canBuild ? <> <Link href={`/rota/build?week=${monday}`} className="font-medium">Build this week</Link></> : null}
    </div>
  );
}

/** A ring gauge: the share of today's calls in one outcome, with the count in the middle and the share underneath. */
export function CallRing({ label, value, total, colour, note, href }: { label: string; value: number | null; total: number; colour: string; note: string; href?: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const share = value !== null && total ? value / total : 0;
  const body = (
    <>
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" stroke={colour} strokeOpacity={0.25} strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={colour} strokeWidth="7" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90 42 42)" strokeLinecap="round" />
        <text x="42" y="49" textAnchor="middle" fontSize={value === null ? 13 : 22} fill={colour}>{value === null ? "n/a" : value}</text>
      </svg>
      <span className="mt-1 text-[19px] font-semibold" style={{ color: colour }}>{label}</span>
      <span className="text-[12.5px] text-slate-600">{note}</span>
    </>
  );
  const cls = "flex flex-col items-center px-2 py-2 text-center no-underline";
  return href ? <Link href={href} className={`${cls} rounded hover:bg-slate-50`}>{body}</Link> : <div className={cls}>{body}</div>;
}


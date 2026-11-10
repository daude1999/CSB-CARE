import { callRounds, daySegments, initials } from "@/lib/day-board";
import { londonMinute, londonTime } from "@/lib/london";
import { VISIT_LABEL } from "@/components/rota-ui";
import type { BlockTone, BoardBlock, BoardFooter, BoardRowData } from "@/components/rota-board";
import { canMove, durationMin, needsCarer, staffDay, startMinute } from "@/server/rota/board";
import { suName, type VisitRow } from "@/server/rota/queries";

/**
 * Shapes the day's visits (already loaded and filtered by the Daily Rota page) into the Board's rows. Grouping and
 * which visits can be moved come from src/server/rota/board.ts, shared with the Advanced Rota planner.
 */

function tone(v: VisitRow, needsRow: boolean): BlockTone {
  if (v.status === "CANCELLED") return "cancelled";
  if (needsRow) return "needs";
  if (v.status === "COMPLETED") return "done";
  if (v.status === "IN_PROGRESS") return "progress";
  if (v.status === "MISSED" || v.status === "NOT_DELIVERED") return "missed";
  if (v.flags.overdueStart || v.flags.late) return "late";
  return "due";
}

const STATE_WORD: Record<BlockTone, string> = { done: "Completed", due: "Still to come", needs: "Needs a carer", missed: "Missed", late: "Late", progress: "In progress", cancelled: "Cancelled" };

function block(v: VisitRow, opts: { date: string; canEdit: boolean; needsRow: boolean; place?: string }): BoardBlock {
  const t = tone(v, opts.needsRow);
  const carers = v.assignments.filter((a) => a.slot !== "SHADOW").map((a) => a.staff.displayName);
  const start = startMinute(v);
  const minutes = durationMin(v);
  const name = suName(v.serviceUser);
  const status = t === "needs" ? `Needs a carer (${carers.length} of ${v.carersRequired} booked)` : t === "late" ? "Late" : VISIT_LABEL[v.status];
  const movable = canMove(v, opts.canEdit) && opts.place;
  return {
    id: v.id,
    startMin: start,
    endMin: start + Math.max(minutes, 1),
    surname: v.serviceUser.lastName,
    initials: initials(name),
    serviceUser: name,
    callType: v.callType.name,
    reference: v.reference,
    statusLabel: status,
    tone: t,
    carers,
    area: v.area?.name ?? null,
    double: v.carersRequired > 1,
    // The full accessible name: service user, call, time, carer and status.
    label: `${name}, ${v.callType.name}, ${londonTime(v.scheduledStart)} for ${minutes} minutes, ${carers.length ? `carer ${carers.join(" and ")}` : "no carer booked"}${v.carersRequired > 1 ? `, needs ${v.carersRequired} carers` : ""}, ${STATE_WORD[t]}, reference ${v.reference}`,
    fullHref: `/rota/visits/${v.id}`,
    reassignHref: canMove(v, opts.canEdit) ? `/rota/visits?date=${opts.date}&layout=list&visit=${v.id}` : null,
    ...(movable ? { move: { slot: opts.place!, lockVersion: v.lockVersion } } : {}),
  };
}

export function boardData(visits: VisitRow[], opts: { date: string; today: string; canEdit: boolean; now?: Date }) {
  const needs = needsCarer(visits);
  const staff = staffDay(visits).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
  const rows: BoardRowData[] = [];
  if (needs.length) {
    rows.push({ key: "needs", name: "Needs a carer", initials: "!", sub: `${needs.length} visit${needs.length === 1 ? "" : "s"}`, needs: true, blocks: needs.map(({ visit, place }) => block(visit, { ...opts, needsRow: true, place })) });
  }
  for (const r of staff) {
    rows.push({
      key: r.staffId,
      name: r.name,
      initials: initials(r.name),
      sub: `${r.visits} visit${r.visits === 1 ? "" : "s"} · ${(Math.round((r.minutes / 60) * 10) / 10).toString()} h`,
      dropStaffId: opts.canEdit ? r.staffId : undefined,
      blocks: r.items.map(({ visit, place, shadow }) => ({ ...block(visit, { ...opts, needsRow: false, place }), ...(shadow ? { surname: `${visit.serviceUser.lastName} (shadow)` } : {}) })),
    });
  }
  const live = visits.filter((v) => v.status !== "CANCELLED");
  const spans = visits.map((v) => ({ start: startMinute(v), end: startMinute(v) + durationMin(v) }));
  const footer: BoardFooter = {
    visits: live.length,
    completed: live.filter((v) => v.status === "COMPLETED").length,
    toCome: live.filter((v) => v.status === "SCHEDULED").length,
    needs: needs.length,
    carers: staff.filter((r) => r.visits > 0).length,
  };
  return {
    rows,
    rounds: callRounds(live.map((v) => ({ callType: v.callType.name, start: startMinute(v), end: startMinute(v) + durationMin(v) }))),
    segments: daySegments(spans),
    nowMin: opts.date === opts.today ? londonMinute(opts.now ?? new Date()) : null,
    footer,
  };
}

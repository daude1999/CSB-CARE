import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { addDays, daysBetween, dbDate, fmtLondonDate, fromDbDate, isIsoDate, londonDate, mondayOf } from "@/lib/london";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { audit } from "@/server/audit-log";
import { toCsv } from "@/server/reports/tables";
import { effectiveClocks } from "./attendance";
import { suName } from "./queries";
import { isHighRisk, MISSED_REASONS } from "./missed-calls";
import { inScope, rotaScope, visitWhere } from "./scope";
import { rotaSettings } from "./settings";

/**
 * Rostering reports, worked out from visit records and effective clock times at the moment they are opened.
 * Nothing here is stored, so a correction to a clock time shows in the next report.
 */
export const ROTA_REPORTS = {
  delivery: "Visit delivery by day",
  people: "Hours by person supported",
  carers: "Carer attendance",
  coverage: "Unfilled visits",
  alerts: "Call alerts",
  missed: "Missed calls",
} as const;
export type RotaReportKind = keyof typeof ROTA_REPORTS;

export const MAX_RANGE_DAYS = 92;
const MAX_VISITS = 20_000;

const filterSchema = z.object({
  report: z.enum(Object.keys(ROTA_REPORTS) as [RotaReportKind, ...RotaReportKind[]]).catch("delivery"),
  from: z.string().refine(isIsoDate, "Choose a valid start date"),
  to: z.string().refine(isIsoDate, "Choose a valid end date"),
  areaId: z.string().max(64).optional(),
});
export type RotaReportFilters = z.infer<typeof filterSchema>;

/** The last full week (Monday to Sunday), which is the default range. */
export function defaultRange(today = londonDate()) {
  const from = addDays(mondayOf(today), -7);
  return { from, to: addDays(from, 6) };
}

export function parseFilters(input: Record<string, string | undefined>): RotaReportFilters {
  const d = defaultRange();
  const parsed = filterSchema.safeParse({ report: input.report ?? "delivery", from: input.from || d.from, to: input.to || d.to, areaId: input.area || undefined });
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the report filters");
  const f = parsed.data;
  if (f.to < f.from) throw new ValidationError("The end date must be on or after the start date");
  if (daysBetween(f.from, f.to) + 1 > MAX_RANGE_DAYS) throw new ValidationError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer`);
  return f;
}

export type Cell = string | number;
export interface ReportRow {
  cells: Cell[];
  href?: string;
}
export interface RotaReport {
  kind: RotaReportKind;
  title: string;
  filters: RotaReportFilters;
  areaName: string | null;
  columns: string[];
  /** Columns holding numbers, so the page can right-align them. */
  numeric: boolean[];
  rows: ReportRow[];
  totals: Cell[] | null;
  summary: string;
  truncated: boolean;
}

const hrs = (min: number) => Math.round((min / 60) * 10) / 10;
const pct = (n: number, d: number): Cell => (d ? `${Math.round((n / d) * 100)}%` : "—");
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

interface CarerVisit {
  staffId: string;
  staffName: string;
  inAt: Date | null;
  outAt: Date | null;
  worked: number;
  late: boolean;
  short: boolean;
  office: boolean;
}

interface VisitFact {
  id: string;
  date: string;
  status: string;
  serviceUserId: string;
  serviceUserName: string;
  areaName: string | null;
  required: number;
  filled: number;
  planned: number;
  delivered: number;
  onTime: boolean | null;
  late: boolean;
  short: boolean;
  carers: CarerVisit[];
}

async function loadFacts(ctx: Ctx, f: RotaReportFilters) {
  const scope = await rotaScope(ctx, "rota.view");
  if (f.areaId && !inScope(scope, f.areaId)) throw new ValidationError("That area is outside your areas");
  const area = f.areaId ? await db.area.findFirst({ where: { id: f.areaId, organisationId: scope.organisationId }, select: { id: true, name: true } }) : null;
  if (f.areaId && !area) throw new ValidationError("Choose an area from the list");
  const settings = await rotaSettings(db, scope.organisationId);
  const visits = await db.visit.findMany({
    where: { AND: [visitWhere(scope), area ? { areaId: area.id } : {}], date: { gte: dbDate(f.from), lte: dbDate(f.to) } },
    select: {
      id: true, date: true, status: true, scheduledStart: true, scheduledEnd: true, carersRequired: true, serviceUserId: true,
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
      area: { select: { name: true } },
      assignments: { where: { removedAt: null, slot: { not: "SHADOW" } }, select: { staffId: true, staff: { select: { displayName: true } } } },
      clocks: { select: { id: true, supersedesId: true, staffId: true, kind: true, at: true, method: true } },
    },
    orderBy: [{ date: "asc" }, { scheduledStart: "asc" }],
    take: MAX_VISITS + 1,
  });
  const truncated = visits.length > MAX_VISITS;
  const facts: VisitFact[] = visits.slice(0, MAX_VISITS).map((v) => {
    const length = mins(v.scheduledStart, v.scheduledEnd);
    const clocks = effectiveClocks(v.clocks);
    const carers = v.assignments.map((a): CarerVisit => {
      const own = clocks.filter((c) => c.staffId === a.staffId);
      const inAt = own.find((c) => c.kind === "IN")?.at ?? null;
      const outAt = own.find((c) => c.kind === "OUT")?.at ?? null;
      const worked = inAt && outAt ? mins(inAt, outAt) : 0;
      return {
        staffId: a.staffId,
        staffName: a.staff.displayName,
        inAt,
        outAt,
        worked,
        late: !!inAt && inAt.getTime() > v.scheduledStart.getTime() + settings.lateAfterMin * 60000,
        short: !!inAt && !!outAt && length > 0 && worked < (length * settings.shortVisitPercent) / 100,
        office: own.some((c) => c.method === "OFFICE"),
      };
    });
    const firstIn = carers.map((c) => c.inAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const completed = v.status === "COMPLETED";
    return {
      id: v.id,
      date: fromDbDate(v.date),
      status: v.status,
      serviceUserId: v.serviceUserId,
      serviceUserName: suName(v.serviceUser),
      areaName: v.area?.name ?? null,
      required: v.carersRequired,
      filled: Math.min(v.carersRequired, carers.length),
      planned: v.status === "CANCELLED" ? 0 : length * v.carersRequired,
      delivered: carers.reduce((n, c) => n + c.worked, 0),
      onTime: completed && firstIn ? firstIn.getTime() <= v.scheduledStart.getTime() + settings.lateAfterMin * 60000 : null,
      late: completed && carers.some((c) => c.late),
      short: completed && carers.some((c) => c.short),
      carers,
    };
  });
  return { scope, area, settings, facts, truncated };
}

function count(facts: VisitFact[]) {
  const live = facts.filter((v) => v.status !== "CANCELLED");
  const completed = live.filter((v) => v.status === "COMPLETED");
  const timed = completed.filter((v) => v.onTime !== null);
  return {
    planned: live.length,
    completed: completed.length,
    missed: live.filter((v) => v.status === "MISSED").length,
    notDelivered: live.filter((v) => v.status === "NOT_DELIVERED").length,
    cancelled: facts.length - live.length,
    open: live.filter((v) => v.status === "SCHEDULED" || v.status === "IN_PROGRESS").length,
    onTime: timed.filter((v) => v.onTime).length,
    timed: timed.length,
    late: completed.filter((v) => v.late).length,
    short: completed.filter((v) => v.short).length,
    plannedMin: live.reduce((n, v) => n + v.planned, 0),
    deliveredMin: live.reduce((n, v) => n + v.delivered, 0),
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

export async function rotaReport(ctx: Ctx, f: RotaReportFilters): Promise<RotaReport> {
  const { scope, area, settings, facts, truncated } = await loadFacts(ctx, f);
  const base = { kind: f.report, title: ROTA_REPORTS[f.report], filters: f, areaName: area?.name ?? null, truncated };
  const range = `${fmtLondonDate(f.from)} to ${fmtLondonDate(f.to)}`;
  const today = londonDate();

  if (f.report === "delivery") {
    const columns = ["Date", "Planned", "Completed", "Missed", "Not delivered", "Not finished", "Cancelled", "On time", "Late arrivals", "Short visits", "Planned h", "Delivered h"];
    const row = (c: ReturnType<typeof count>): Cell[] => [c.planned, c.completed, c.missed, c.notDelivered, c.open, c.cancelled, pct(c.onTime, c.timed), c.late, c.short, hrs(c.plannedMin), hrs(c.deliveredMin)];
    const days = groupBy(facts, (v) => v.date);
    const rows: ReportRow[] = [];
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) rows.push({ cells: [fmtLondonDate(d), ...row(count(days.get(d) ?? []))], href: `/rota/visits?date=${d}` });
    const t = count(facts);
    return {
      ...base, columns, numeric: columns.map((_, i) => i > 0), rows, totals: ["Total", ...row(t)],
      summary: `${range}: ${t.completed} of ${t.planned} planned visits completed, ${t.missed} missed, ${t.notDelivered} not delivered${t.open ? ` and ${t.open} not finished (not yet due, still in progress, or never clocked)` : ""}. ${t.timed ? `${pct(t.onTime, t.timed)} of completed visits started within ${settings.lateAfterMin} minutes of the planned time.` : "No completed visits with clock times yet."}`,
    };
  }

  if (f.report === "people") {
    const columns = ["Person", "Area", "Planned", "Completed", "Missed or not delivered", "Cancelled", "Short visits", "Planned h", "Delivered h", "Delivered"];
    const rows = [...groupBy(facts, (v) => v.serviceUserId).values()]
      .map((vs) => {
        const c = count(vs);
        // Only hours from visits that have happened count towards the delivered share.
        const due = vs.filter((v) => v.status !== "CANCELLED" && v.date <= today).reduce((n, v) => n + v.planned, 0);
        return { c, row: { cells: [vs[0]!.serviceUserName, vs[0]!.areaName ?? "—", c.planned, c.completed, c.missed + c.notDelivered, c.cancelled, c.short, hrs(c.plannedMin), hrs(c.deliveredMin), pct(c.deliveredMin, due)], href: `/rota/service-users/${vs[0]!.serviceUserId}` } };
      })
      .sort((a, b) => b.c.missed + b.c.notDelivered - (a.c.missed + a.c.notDelivered) || String(a.row.cells[0]).localeCompare(String(b.row.cells[0])));
    const t = count(facts);
    const missedPeople = rows.filter((r) => r.c.missed + r.c.notDelivered > 0).length;
    return {
      ...base, columns, numeric: columns.map((_, i) => i > 1), rows: rows.map((r) => r.row), totals: ["Total", "", t.planned, t.completed, t.missed + t.notDelivered, t.cancelled, t.short, hrs(t.plannedMin), hrs(t.deliveredMin), ""],
      summary: `${range}: ${rows.length} ${rows.length === 1 ? "person" : "people"} had visits planned. ${missedPeople ? `${missedPeople} had at least one missed or undelivered visit; they are listed first.` : "None had a missed or undelivered visit."}`,
    };
  }

  if (f.report === "carers") {
    const columns = ["Carer", "Visits booked", "Completed", "Missed", "Not finished", "Late arrivals", "Short visits", "Office-entered times", "Planned h", "Clocked h"];
    const per = new Map<string, { name: string; booked: number; completed: number; missed: number; open: number; late: number; short: number; office: number; planned: number; worked: number }>();
    for (const v of facts) {
      if (v.status === "CANCELLED") continue;
      const length = v.required ? v.planned / v.required : 0;
      for (const c of v.carers) {
        const p = per.get(c.staffId) ?? { name: c.staffName, booked: 0, completed: 0, missed: 0, open: 0, late: 0, short: 0, office: 0, planned: 0, worked: 0 };
        p.booked++;
        p.planned += length;
        p.worked += c.worked;
        if (c.inAt && c.outAt) p.completed++;
        if (v.status === "MISSED" && !c.inAt) p.missed++;
        else if (!(c.inAt && c.outAt) && v.status !== "NOT_DELIVERED") p.open++;
        if (c.late) p.late++;
        if (c.short) p.short++;
        if (c.office) p.office++;
        per.set(c.staffId, p);
      }
    }
    const list = [...per.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    const sum = (k: "booked" | "completed" | "missed" | "open" | "late" | "short" | "office" | "planned" | "worked") => list.reduce((n, [, p]) => n + p[k], 0);
    return {
      ...base, columns, numeric: columns.map((_, i) => i > 0),
      rows: list.map(([id, p]) => ({ cells: [p.name, p.booked, p.completed, p.missed, p.open, p.late, p.short, p.office, hrs(p.planned), hrs(p.worked)], href: `/rota/staff/${id}` })),
      totals: ["Total", sum("booked"), sum("completed"), sum("missed"), sum("open"), sum("late"), sum("short"), sum("office"), hrs(sum("planned")), hrs(sum("worked"))],
      summary: `${range}: ${list.length} carers were booked on ${sum("booked")} visits. ${sum("late")} arrivals were more than ${settings.lateAfterMin} minutes late and ${sum("office")} clock times were entered by the office. Shadow shifts are not counted.`,
    };
  }

  if (f.report === "coverage") {
    const columns = ["Date", "Visits", "Carer places", "Filled", "Unfilled", "Visits with no carer"];
    const days = groupBy(facts.filter((v) => v.status !== "CANCELLED"), (v) => v.date);
    const rows: ReportRow[] = [];
    const tot = { visits: 0, places: 0, filled: 0, none: 0 };
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
      const vs = days.get(d) ?? [];
      const places = vs.reduce((n, v) => n + v.required, 0);
      const filled = vs.reduce((n, v) => n + v.filled, 0);
      const none = vs.filter((v) => v.filled === 0).length;
      tot.visits += vs.length; tot.places += places; tot.filled += filled; tot.none += none;
      rows.push({ cells: [fmtLondonDate(d), vs.length, places, filled, places - filled, none], href: `/rota/unassigned?from=${d}&days=1` });
    }
    return {
      ...base, columns, numeric: columns.map((_, i) => i > 0), rows, totals: ["Total", tot.visits, tot.places, tot.filled, tot.places - tot.filled, tot.none],
      summary: `${range}: ${tot.places - tot.filled} of ${tot.places} carer places are unfilled (${pct(tot.places - tot.filled, tot.places)}). Cancelled visits are left out.`,
    };
  }

  if (f.report === "missed") {
    // Missed-call cases in the range, by reason, from the investigations (Missed Calls). Same area scope as the visits.
    const cases = await db.missedCallCase.findMany({
      where: { visitId: { in: facts.map((v) => v.id) } },
      select: { reasonCode: true, outcome: true, stage: true, staffId: true, serviceUserId: true, replacementType: true, escalatedAt: true, visit: { select: { serviceUser: { select: { riskLevel: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true }, take: 1 } } } } } },
    });
    const columns = ["Reason", "Missed calls", "Care worker attributable", "High-risk clients", "No replacement possible", "Escalated", "Signed off", "Still open"];
    const rows = [...groupBy(cases, (c) => c.reasonCode ?? "")]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([code, cs]) => ({
        cells: [code ? MISSED_REASONS[code]?.label ?? code : "Not yet investigated", cs.length, cs.filter((c) => c.staffId && (!code || MISSED_REASONS[code]?.carer)).length, cs.filter((c) => isHighRisk(c.visit.serviceUser)).length, cs.filter((c) => c.replacementType === "NONE_POSSIBLE").length, cs.filter((c) => c.escalatedAt).length, cs.filter((c) => c.stage === "CLOSED").length, cs.filter((c) => c.stage !== "CLOSED").length] as Cell[],
        href: `/rota/missed?period=custom&from=${f.from}&to=${f.to}${code ? `&reason=${code}` : "&reason=none"}`,
      }));
    const closed = cases.filter((c) => c.stage === "CLOSED").length;
    const sumCol = (i: number) => rows.reduce((n, r) => n + Number(r.cells[i]), 0);
    return {
      ...base, columns, numeric: columns.map((_, i) => i > 0), rows,
      totals: rows.length ? ["Total", cases.length, sumCol(2), sumCol(3), sumCol(4), sumCol(5), closed, cases.length - closed] : null,
      summary: `${range}: ${cases.length} missed ${cases.length === 1 ? "call" : "calls"} to ${new Set(cases.map((c) => c.serviceUserId)).size} service users; ${closed} investigations signed off, ${cases.length - closed} still open. Open the Missed Calls page for each case.`,
    };
  }

  // Alerts raised in the range. Alerts tied to a visit follow the visit's area; others count only for organisation-wide viewers.
  const visitIds = new Set(facts.map((v) => v.id));
  const alerts = await db.rotaAlert.findMany({
    where: { organisationId: scope.organisationId, raisedAt: { gte: new Date(`${f.from}T00:00:00Z`), lt: new Date(`${addDays(f.to, 2)}T00:00:00Z`) } },
    select: { kind: true, severity: true, visitId: true, raisedAt: true, conditionAt: true, resolvedAt: true },
  });
  const wide = !scope.areaIds && !area;
  const inRange = alerts.filter((a) => {
    const day = londonDate(a.raisedAt);
    return day >= f.from && day <= f.to && (a.visitId ? visitIds.has(a.visitId) : wide);
  });
  const columns = ["Alert", "Raised", "Critical", "Resolved", "Still open", "Median time to raise", "Median time to resolve"];
  const fmtMin = (m: number | null) => (m === null ? "—" : m < 1 ? "under 1 min" : `${Math.round(m)} min`);
  const rows = [...groupBy(inRange, (a) => a.kind).entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kind, as]) => ({
      cells: [ALERT_LABEL[kind] ?? kind, as.length, as.filter((a) => a.severity === "CRITICAL").length, as.filter((a) => a.resolvedAt).length, as.filter((a) => !a.resolvedAt).length,
        fmtMin(median(as.filter((a) => a.conditionAt).map((a) => (a.raisedAt.getTime() - a.conditionAt!.getTime()) / 60000))),
        fmtMin(median(as.filter((a) => a.resolvedAt).map((a) => (a.resolvedAt!.getTime() - a.raisedAt.getTime()) / 60000)))],
    }));
  const open = inRange.filter((a) => !a.resolvedAt).length;
  return {
    ...base, columns, numeric: columns.map((_, i) => i > 0 && i < 5), rows,
    totals: rows.length ? ["Total", inRange.length, inRange.filter((a) => a.severity === "CRITICAL").length, inRange.length - open, open, "", ""] : null,
    summary: `${range}: ${inRange.length} alerts raised, ${open} still open. "Time to raise" is from when the problem began (for example, the late threshold passing) to when the alert appeared.`,
  };
}

export const ALERT_LABEL: Record<string, string> = {
  LATE: "Late call",
  MISSED: "Missed call",
  OVERRUN: "Not clocked out",
  SHORT_VISIT: "Short visit",
  NOT_DELIVERED: "Could not deliver",
  UNASSIGNED: "No carer booked",
  ALLOCATION_REVIEW: "Allocation needs review",
};

/** A report as Excel or PDF, after the same permission and area checks as the page, recorded in the audit log. */
export async function rotaReportFile(ctx: Ctx, f: RotaReportFilters, format: "xlsx" | "pdf") {
  const organisationId = requireOrgPermission(ctx, "report.export");
  const r = await rotaReport(ctx, f);
  const { toPdf, toXlsx } = await import("@/server/reports/export-files");
  const t = { title: r.title, subtitle: `${fmtLondonDate(f.from)} to ${fmtLondonDate(f.to)}${r.areaName ? ` · ${r.areaName}` : " · all my areas"} · ${r.summary}`, columns: r.columns, rows: [...r.rows.map((x) => x.cells), ...(r.totals ? [r.totals] : [])] };
  const body = format === "xlsx" ? await toXlsx(t) : await toPdf(t);
  await audit({ organisationId, actorId: ctx.userId, action: "rota.report.exported", entityType: "RotaReport", entityId: f.report, data: { from: f.from, to: f.to, areaId: f.areaId ?? null, rows: r.rows.length, format } });
  return { name: `csb-${f.report}-${f.from}-to-${f.to}.${format}`, body, type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf" };
}

/** CSV of a report, after the same permission and area checks as the page, recorded in the audit log. */
export async function rotaReportCsv(ctx: Ctx, f: RotaReportFilters) {
  const organisationId = requireOrgPermission(ctx, "report.export");
  const r = await rotaReport(ctx, f);
  await audit({ organisationId, actorId: ctx.userId, action: "rota.report.exported", entityType: "RotaReport", entityId: f.report, data: { from: f.from, to: f.to, areaId: f.areaId ?? null, rows: r.rows.length } });
  return { name: `csb-${f.report}-${f.from}-to-${f.to}.csv`, body: toCsv(r.columns, [...r.rows.map((x) => x.cells), ...(r.totals ? [r.totals] : [])]) };
}

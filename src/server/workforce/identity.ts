import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { State } from "@/hr/lib/domain";
import { projectEmployee, projectionHash } from "./projection";

/**
 * The employee identity check. HR & Workforce is the one employee master (HrWorkspace.state); Rostering's StaffMember
 * row is its projection, keyed one-to-one by (organisationId, hrEmployeeId), and every rota, attendance, payroll and
 * readiness record points at StaffMember.id. This report says whether that link holds for an organisation, without
 * changing anything:
 *
 *  - linked: HR employees with exactly one current StaffMember.
 *  - notProjected: HR employees with no StaffMember yet (fixed by reconcileWorkforce, which only adds).
 *  - stale: StaffMember rows whose copy differs from HR now (fixed by reconcileWorkforce; HR's values win by rule).
 *  - unmatched: StaffMember rows whose HR employee no longer exists. They are kept, never deleted or merged, so delivered
 *    visits, timesheets and pay lines keep their carer. They are listed with what still refers to them.
 *  - duplicateStaffNumbers: one staff number on more than one HR employee. Needs an HR decision; never merged here.
 *  - sameName: different HR employees with the same name. Listed for awareness only: a name is never a match.
 *
 * Re-running is safe: it only reads.
 */

export interface IdentityReport {
  organisationId: string;
  counts: { hrEmployees: number; staffRecords: number; linked: number; notProjected: number; stale: number; unmatched: number };
  notProjected: { hrEmployeeId: string; staffNumber: string; name: string }[];
  stale: { staffId: string; hrEmployeeId: string; name: string }[];
  unmatched: { staffId: string; hrEmployeeId: string; staffNumber: string; name: string; references: number; futureAssignments: number }[];
  duplicateStaffNumbers: { staffNumber: string; hrEmployeeIds: string[] }[];
  sameName: { name: string; hrEmployeeIds: string[] }[];
  /** Records that point at a staff identity, by table. Equal before and after a reconciliation run. */
  references: Record<string, number>;
}

type Db = Prisma.TransactionClient | typeof db;

const groupsOf = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    if (!k) continue;
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...m.entries()].filter(([, v]) => v.length > 1);
};

/** Counts of every record that refers to a staff identity in this organisation. */
export async function staffReferenceCounts(tx: Db, organisationId: string, staffIds?: string[]): Promise<Record<string, number>> {
  const w = { organisationId, ...(staffIds ? { staffId: { in: staffIds } } : {}) };
  const [assignments, clocks, timesheets, payLines, mileage, absences, availability, payRates, notes, outcomes, mar, alerts, missed] = await Promise.all([
    tx.visitAssignment.count({ where: w }),
    tx.visitClock.count({ where: w }),
    tx.timesheet.count({ where: w }),
    tx.payLine.count({ where: { run: { organisationId }, ...(staffIds ? { staffId: { in: staffIds } } : {}) } }),
    tx.mileageClaim.count({ where: w }),
    tx.staffAbsence.count({ where: w }),
    tx.staffAvailability.count({ where: w }),
    tx.staffPayRate.count({ where: w }),
    tx.visitNote.count({ where: w }),
    tx.visitTaskOutcome.count({ where: w }),
    tx.marRecord.count({ where: w }),
    tx.rotaAlert.count({ where: w }),
    tx.missedCallCase.count({ where: w }),
  ]);
  return { assignments, clocks, timesheets, payLines, mileage, absences, availability, payRates, notes, outcomes, mar, alerts, missed };
}

/** Pure comparison of the HR document with the projected staff rows, so it can be unit tested without a database. */
export function compareIdentities(state: Pick<State, "employees" | "checks">, staff: { id: string; hrEmployeeId: string; hrHash: string; hrMissing: boolean; staffNumber: string; displayName: string }[]) {
  const byHr = new Map(staff.map((s) => [s.hrEmployeeId, s]));
  const hrIds = new Set(state.employees.map((e) => e.id));
  const notProjected: IdentityReport["notProjected"] = [];
  const stale: IdentityReport["stale"] = [];
  let linked = 0;
  for (const e of state.employees) {
    const s = byHr.get(e.id);
    if (!s) {
      notProjected.push({ hrEmployeeId: e.id, staffNumber: e.staffId, name: e.name });
      continue;
    }
    linked++;
    if (s.hrMissing || s.hrHash !== projectionHash(projectEmployee(state as State, e))) stale.push({ staffId: s.id, hrEmployeeId: e.id, name: e.name });
  }
  const unmatched = staff.filter((s) => !hrIds.has(s.hrEmployeeId)).map((s) => ({ staffId: s.id, hrEmployeeId: s.hrEmployeeId, staffNumber: s.staffNumber, name: s.displayName }));
  const duplicateStaffNumbers = groupsOf(state.employees, (e) => e.staffId.trim().toLowerCase()).map(([, v]) => ({ staffNumber: v[0]!.staffId, hrEmployeeIds: v.map((e) => e.id) }));
  const sameName = groupsOf(state.employees, (e) => e.name.trim().toLowerCase().replace(/\s+/g, " ")).map(([, v]) => ({ name: v[0]!.name, hrEmployeeIds: v.map((e) => e.id) }));
  return { linked, notProjected, stale, unmatched, duplicateStaffNumbers, sameName };
}

export async function workforceIdentityReport(organisationId: string, tx: Db = db): Promise<IdentityReport | null> {
  const rows = await tx.$queryRaw<{ state: State }[]>`SELECT "state" FROM "HrWorkspace" WHERE "organisationId" = ${organisationId}`;
  if (!rows[0]) return null;
  const state = rows[0].state;
  const staff = await tx.staffMember.findMany({ where: { organisationId }, select: { id: true, hrEmployeeId: true, hrHash: true, hrMissing: true, staffNumber: true, displayName: true } });
  const c = compareIdentities(state, staff);
  const now = new Date();
  const unmatched = [];
  for (const u of c.unmatched) {
    const refs = await staffReferenceCounts(tx, organisationId, [u.staffId]);
    const futureAssignments = await tx.visitAssignment.count({ where: { organisationId, staffId: u.staffId, removedAt: null, startsAt: { gt: now } } });
    unmatched.push({ ...u, references: Object.values(refs).reduce((a, b) => a + b, 0), futureAssignments });
  }
  return {
    organisationId,
    counts: { hrEmployees: state.employees.length, staffRecords: staff.length, linked: c.linked, notProjected: c.notProjected.length, stale: c.stale.length, unmatched: unmatched.length },
    notProjected: c.notProjected,
    stale: c.stale,
    unmatched,
    duplicateStaffNumbers: c.duplicateStaffNumbers,
    sameName: c.sameName,
    references: await staffReferenceCounts(tx, organisationId),
  };
}

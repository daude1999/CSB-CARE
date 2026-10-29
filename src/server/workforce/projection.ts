import { createHash } from "node:crypto";
import type { EmploymentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkCategory, type Employee, type State } from "@/hr/lib/domain";
import { audit } from "@/server/audit-log";
import { reviewStaffImpact } from "./impact";

/**
 * Projects HR & Workforce employees (HrWorkspace.state, the source of truth) into relational StaffMember rows.
 * Called inside the HR Hub's own transaction (src/hr/lib/store.ts), so an HR change and its projection commit or
 * roll back together. Only employees whose projected content changed are written.
 */

const STATUS: Record<Employee["status"], EmploymentStatus> = { Active: "ACTIVE", Onboarding: "ONBOARDING", Archived: "ARCHIVED" };

export interface ProjectedCheck {
  hrCheckId: string;
  category: string;
  name: string;
  required: boolean;
  recurring: boolean;
  dueDate: string | null;
  verified: boolean;
  hasEvidence: boolean;
}

export interface ProjectedEmployee {
  hrEmployeeId: string;
  hrVersion: number;
  staffNumber: string;
  displayName: string;
  preferredName: string | null;
  jobTitle: string;
  employmentStatus: EmploymentStatus;
  hrBranchKey: string;
  startDate: string | null;
  leavingDate: string | null;
  workEmail: string | null;
  workPhone: string | null;
  checks: ProjectedCheck[];
}

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The fields Rostering may know about an employee. Address, date of birth, emergency contact and ID are never projected. */
export function projectEmployee(state: State, e: Employee): ProjectedEmployee {
  return {
    hrEmployeeId: e.id,
    hrVersion: e.version,
    staffNumber: e.staffId,
    displayName: e.name,
    preferredName: e.preferredName?.trim() || null,
    jobTitle: e.job,
    employmentStatus: STATUS[e.status] ?? "ARCHIVED",
    hrBranchKey: e.branch,
    startDate: isDate(e.start) ? e.start : null,
    leavingDate: isDate(e.leavingDate) ? e.leavingDate : null,
    workEmail: e.email || null,
    workPhone: e.phone || null,
    checks: state.checks
      .filter((c) => c.employee === e.id)
      .map((c) => ({
        hrCheckId: c.id,
        category: checkCategory(c),
        name: c.name,
        required: c.required,
        recurring: c.recurring,
        dueDate: isDate(c.due) ? c.due : null,
        verified: c.verified,
        hasEvidence: !!c.evidence,
      }))
      .sort((a, b) => a.hrCheckId.localeCompare(b.hrCheckId)),
  };
}

export function projectionHash(p: ProjectedEmployee) {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 32);
}

export interface ProjectionResult {
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  /** Staff whose status, branch, job or checks changed: their future allocations are re-checked. */
  changedStaffIds: string[];
}

const toDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

export async function projectWorkforce(tx: Prisma.TransactionClient, organisationId: string, state: State, opts: { actorId?: string | null; reason?: string } = {}): Promise<ProjectionResult> {
  const [existing, branches] = await Promise.all([
    tx.staffMember.findMany({ where: { organisationId }, select: { id: true, hrEmployeeId: true, hrHash: true, hrMissing: true } }),
    tx.branch.findMany({ where: { organisationId, hrBranchKey: { not: null } }, select: { id: true, hrBranchKey: true } }),
  ]);
  const byHrId = new Map(existing.map((s) => [s.hrEmployeeId, s]));
  const branchFor = new Map(branches.map((b) => [b.hrBranchKey as string, b.id]));
  const result: ProjectionResult = { created: 0, updated: 0, unchanged: 0, missing: 0, changedStaffIds: [] };
  const now = new Date();
  const seen = new Set<string>();

  for (const e of state.employees) {
    seen.add(e.id);
    const p = projectEmployee(state, e);
    const hash = projectionHash(p);
    const current = byHrId.get(e.id);
    if (current && current.hrHash === hash && !current.hrMissing) {
      result.unchanged++;
      continue;
    }
    const data = {
      hrVersion: p.hrVersion,
      hrHash: hash,
      hrMissing: false,
      staffNumber: p.staffNumber,
      displayName: p.displayName,
      preferredName: p.preferredName,
      jobTitle: p.jobTitle,
      employmentStatus: p.employmentStatus,
      hrBranchKey: p.hrBranchKey,
      branchId: branchFor.get(p.hrBranchKey) ?? null,
      startDate: toDate(p.startDate),
      leavingDate: toDate(p.leavingDate),
      workEmail: p.workEmail,
      workPhone: p.workPhone,
      projectedAt: now,
    };
    // Upsert on the one-to-one key, so a retried or concurrent projection can never create a second identity.
    const staff = await tx.staffMember.upsert({
      where: { organisationId_hrEmployeeId: { organisationId, hrEmployeeId: p.hrEmployeeId } },
      create: { organisationId, hrEmployeeId: p.hrEmployeeId, ...data },
      update: data,
      select: { id: true },
    });
    // The compliance rows are a pure copy of the HR checks, so they are replaced as a set.
    await tx.staffCompliance.deleteMany({ where: { staffId: staff.id } });
    if (p.checks.length) {
      await tx.staffCompliance.createMany({
        data: p.checks.map((c) => ({ organisationId, staffId: staff.id, hrCheckId: c.hrCheckId, category: c.category, name: c.name, required: c.required, recurring: c.recurring, dueDate: toDate(c.dueDate), verified: c.verified, hasEvidence: c.hasEvidence })),
      });
    }
    if (current) result.updated++;
    else result.created++;
    result.changedStaffIds.push(staff.id);
  }

  // HR never deletes employees (it archives them), but if one disappears the identity is kept for history.
  for (const s of existing) {
    if (seen.has(s.hrEmployeeId) || s.hrMissing) continue;
    await tx.staffMember.update({ where: { id: s.id }, data: { hrMissing: true, projectedAt: now } });
    result.missing++;
    result.changedStaffIds.push(s.id);
  }

  if (result.created || result.updated || result.missing) {
    await audit(
      { organisationId, actorId: opts.actorId ?? null, action: "workforce.projected", entityType: "Organisation", entityId: organisationId, data: { created: result.created, updated: result.updated, missing: result.missing, reason: opts.reason ?? "HR change" } },
      tx,
    );
  }
  if (result.changedStaffIds.length) await reviewStaffImpact(tx, organisationId, result.changedStaffIds, { source: "HR record changed" });
  return result;
}

/**
 * Backfill and reconciliation: projects every employee in the organisation's HR workspace under the HR row lock.
 * Idempotent; a second run changes nothing. Returns what changed.
 */
export async function reconcileWorkforce(organisationId: string, actorId: string | null = null): Promise<ProjectionResult | null> {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ state: State }[]>`SELECT "state" FROM "HrWorkspace" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
      if (!rows[0]) return null;
      return projectWorkforce(tx, organisationId, rows[0].state, { actorId, reason: "Reconciliation" });
    },
    { timeout: 60_000 },
  );
}

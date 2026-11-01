import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, isIsoDate, londonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { read, transactionThen } from "@/hr/lib/workspace-tx";
import { checkCategory, checkStatus, permits, type Employee, type HRTask, type State } from "@/hr/lib/domain";
import { applyRequirements } from "@/hr/lib/requirements";
import { runReminders } from "@/hr/lib/reminders";
import { readinessFor, READINESS_LABEL } from "@/server/readiness";
import { outstandingAckWhere } from "@/server/policies/assignment";
import { staffReadinessCheck } from "@/server/workforce/staff-check";
import { notify } from "@/server/notifications/notify";
import { recruitmentAccess, requireEdit } from "./access";
import { bumpCandidate, candidateEvent, factsOf, ownedCandidate, recruitmentSettings } from "./candidates";
import { readyBlockers, REMINDER_LABEL, remindersFor, isOpen, type Reminder } from "./model";

/**
 * Recruitment → HR onboarding → verified readiness → rota eligibility. HR stays the only source of employees: starting
 * onboarding creates (or links) the HR Hub employee inside the HR Hub's own locked transaction, with its standard checks
 * and the organisation's requirements, and the workforce projection gives the rota its StaffMember in the same
 * transaction. Nothing here marks anyone ready to work: the rota's eligibility rules decide that at every assignment.
 */

const convertSchema = z.object({
  mode: z.enum(["create", "link"]),
  staffId: z.string().trim().max(40).optional(),
  start: z.string().optional(),
  linkEmployeeId: z.string().optional(),
  lockVersion: z.coerce.number().int(),
});

const CORE_CHECKS = ["DBS review", "Right to work", "Safeguarding training"];

export function suggestStaffId(state: State, org: string) {
  const used = new Set(state.employees.filter((e) => e.org === org).map((e) => e.staffId.toLowerCase()));
  for (let n = state.employees.length + 1; ; n++) {
    const id = `NS-${String(n).padStart(4, "0")}`;
    if (!used.has(id.toLowerCase())) return id;
  }
}

/** Employees in the HR account's branches with the same email, so HR can link instead of creating a duplicate. */
export function possibleMatches(state: State, org: string, branches: string[], email: string | null, name: string) {
  const n = name.trim().toLowerCase();
  return state.employees.filter((e) => e.org === org && branches.includes(e.branch) && e.status !== "Archived" && ((email && e.email && e.email.toLowerCase() === email.toLowerCase()) || e.name.trim().toLowerCase() === n));
}

/**
 * HR authorises onboarding after an accepted offer: creates the employee as a New starter (or links an existing record),
 * starts the standard checks and the organisation's requirements, and adds HR tasks for each outstanding document.
 */
export async function startOnboarding(ctx: Ctx, candidateId: string, raw: z.input<typeof convertSchema>) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  if (!a.canAuthorise) throw new ForbiddenError("Your HR account cannot authorise onboarding");
  const p = convertSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the onboarding details");
  const input = p.data;
  const c = await ownedCandidate(db, a, candidateId);
  if (c.stage !== "OFFER" || c.offerResponse !== "ACCEPTED") throw new ValidationError("Onboarding starts once the candidate has accepted an offer");
  if (c.hrEmployeeId) throw new ConflictError("Onboarding has already started for this candidate");
  if (c.rightToWork === "NOT_ELIGIBLE") throw new ValidationError("This candidate has no right to work in the UK");
  const branch = a.branches.find((b) => b.id === c.branchId);
  if (!branch) throw new NotFoundError("Branch");
  if (input.mode === "create") {
    if (!input.staffId || !/^[\w-]{2,40}$/.test(input.staffId)) throw new ValidationError("Enter a staff ID of letters, numbers and dashes");
    if (!input.start || !isIsoDate(input.start)) throw new ValidationError("Choose the start date");
  } else if (!input.linkEmployeeId) throw new ValidationError("Choose the existing employee record");
  const now = new Date().toISOString();
  const today = londonDate();
  const name = `${c.firstName} ${c.lastName}`.trim();

  return transactionThen(
    a.organisationId,
    (s) => {
      const u = s.users.find((x) => x.id === a.hrUser.id && x.active);
      if (!u || u.role === "Branch Viewer") throw new ForbiddenError("Your HR account cannot authorise onboarding");
      if (!u.branches.includes(branch.hrBranchKey)) throw new NotFoundError("Branch");
      let e: Employee;
      let created = false;
      if (input.mode === "link") {
        const found = s.employees.find((x) => x.id === input.linkEmployeeId && x.org === u.org);
        if (!found || !permits(u, found)) throw new NotFoundError("Employee");
        if (found.status === "Archived") throw new ValidationError("That employee is archived in HR");
        e = found;
      } else {
        if (s.employees.some((x) => x.org === u.org && x.staffId.toLowerCase() === input.staffId!.toLowerCase())) throw new ConflictError("This staff ID already exists in HR");
        const dup = possibleMatches(s, u.org, u.branches, c.email, name);
        if (dup.length) throw new ConflictError(`HR already has ${dup.map((d) => `${d.name} (${d.staffId})`).join(", ")}. Link to that record instead of creating a duplicate.`);
        e = { id: randomUUID(), org: u.org, staffId: input.staffId!, name, branch: branch.hrBranchKey, job: c.roleApplied, status: "Onboarding", start: input.start!, email: c.email ?? "", phone: c.phone ?? "", updated: now, version: 1 };
        s.employees.push(e);
        for (const check of CORE_CHECKS)
          s.checks.push({ id: randomUUID(), org: u.org, employee: e.id, name: check, required: true, recurring: check !== "Right to work", due: null, verified: false, evidence: null, reviewer: null, checkedAt: null, version: 1 });
        created = true;
      }
      // The organisation's onboarding requirements for this role and branch (the HR Hub's own rule).
      applyRequirements(s, e);
      const task = (type: string, status: HRTask["status"]): HRTask => ({ id: randomUUID(), org: u.org, employee: e.id, branch: e.branch, type, assignedTo: u.id, due: addDays(today, 7), priority: "Normal", status, requirement: null, document: null, version: 1, created: now, updated: now, createdBy: u.name });
      s.tasks ??= [];
      s.tasks.push(task(`Confirm onboarding details (from recruitment ${c.reference})`, "Waiting on HR"));
      for (const d of c.outstandingDocuments) s.tasks.push(task(`Collect: ${d}`, "Waiting on employee"));
      s.events.push({ id: randomUUID(), org: u.org, employee: e.id, actor: u.name, action: created ? `Employee record created from recruitment (${c.reference})` : `Linked to recruitment (${c.reference})`, at: now });
      runReminders(s, today, u.org);
      return { employeeId: e.id, created };
    },
    async (tx, r) => {
      const taken = await tx.candidate.findFirst({ where: { organisationId: a.organisationId, hrEmployeeId: r.employeeId }, select: { reference: true } });
      if (taken) throw new ConflictError(`That employee is already linked to ${taken.reference}`);
      await bumpCandidate(tx, c.id, input.lockVersion, { hrEmployeeId: r.employeeId, stage: "ONBOARDING", stageChangedAt: new Date(), convertedAt: new Date(), convertedById: ctx.userId });
      await candidateEvent(tx, c, r.created ? "ONBOARDING_STARTED" : "ONBOARDING_LINKED", ctx.userId, { fromStage: "OFFER", toStage: "ONBOARDING", data: { employeeCreated: r.created } });
      return r;
    },
    { actorId: ctx.userId },
  );
}

/**
 * Where an onboarding candidate stands, from authoritative records only: the HR checks, the rota's readiness result,
 * outstanding policy sign-offs and the rota's own eligibility rules ("Check Staff Readiness").
 */
export async function onboardingStatus(organisationId: string, hrEmployeeId: string) {
  const state = await read(organisationId);
  const e = state.employees.find((x) => x.id === hrEmployeeId) ?? null;
  const today = londonDate();
  const checks = state.checks.filter((x) => x.employee === hrEmployeeId).map((x) => ({ id: x.id, name: x.name, category: checkCategory(x), required: x.required, status: checkStatus(x, today) }));
  const tasks = (state.tasks ?? []).filter((t) => t.employee === hrEmployeeId).map((t) => ({ id: t.id, type: t.type, status: t.status, due: t.due }));
  const staff = await db.staffMember.findFirst({ where: { organisationId, hrEmployeeId }, select: { id: true, displayName: true, employmentStatus: true, userId: true } });
  if (!staff) return { employee: e, checks, tasks, staff: null, readiness: null, check: null, signOffs: 0 };
  const [readiness, check, signOffs] = await Promise.all([
    readinessFor(db, organisationId, [staff.id]).then((m) => m.get(staff.id) ?? null),
    staffReadinessCheck(organisationId, staff.id),
    db.acknowledgement.count({ where: { organisationId, staffMemberId: staff.id, ...outstandingAckWhere } }),
  ]);
  return { employee: e, checks, tasks, staff, readiness: readiness ? { status: readiness.status, label: READINESS_LABEL[readiness.status], reasons: readiness.reasons } : null, check, signOffs };
}
export type OnboardingStatus = Awaited<ReturnType<typeof onboardingStatus>>;

/** Records HR's decision that onboarding is finished. It changes nothing on the rota. */
export async function markReady(ctx: Ctx, candidateId: string, lockVersion: number) {
  const a = await recruitmentAccess(ctx);
  requireEdit(a);
  const c = await ownedCandidate(db, a, candidateId);
  if (c.stage !== "ONBOARDING" || !c.hrEmployeeId) throw new ValidationError("Only a candidate in onboarding can be marked ready");
  const state = await read(a.organisationId);
  const e = state.employees.find((x) => x.id === c.hrEmployeeId);
  const blockers = readyBlockers({ employeeStatus: e?.status ?? null, outstandingDocuments: c.outstandingDocuments, rightToWork: c.rightToWork });
  if (blockers.length) throw new ValidationError(blockers.join(". "));
  await db.$transaction(async (tx) => {
    await bumpCandidate(tx, c.id, lockVersion, { stage: "READY", stageChangedAt: new Date(), nextAction: null, nextActionDue: null });
    await candidateEvent(tx, c, "READY", ctx.userId, { fromStage: "ONBOARDING", toStage: "READY" });
  });
}

// ── Reminders ────────────────────────────────────────────────────────────

/** Reminders due today for every open candidate the member can see. Shown in the app; nothing is sent to candidates. */
export async function dueReminders(organisationId: string, branchIds: string[] | null, now = new Date()) {
  const settings = await recruitmentSettings(organisationId);
  const today = londonDate(now);
  const candidates = await db.candidate.findMany({ where: { organisationId, ...(branchIds ? { branchId: { in: branchIds } } : {}), stage: { in: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING"] } }, include: { screenings: { orderBy: { sentAt: "desc" } }, interviews: { orderBy: { startsAt: "desc" } } } });
  const onboarding = candidates.filter((c) => c.stage === "ONBOARDING" && c.hrEmployeeId);
  const state = onboarding.length ? await read(organisationId) : null;
  const out: (Reminder & { candidateId: string; reference: string; name: string; recruiterId: string | null })[] = [];
  for (const c of candidates) {
    let trainingMissing = 0;
    let onboardingDocsMissing = 0;
    if (state && c.hrEmployeeId) {
      const checks = state.checks.filter((x) => x.employee === c.hrEmployeeId && x.required);
      trainingMissing = checks.filter((x) => checkCategory(x) === "Training" && !x.verified).length;
      onboardingDocsMissing = checks.filter((x) => checkCategory(x) !== "Training" && !x.evidence).length;
    }
    for (const r of remindersFor({ ...factsOf(c), id: c.id, trainingMissing, onboardingDocsMissing }, settings, today, now)) out.push({ ...r, candidateId: c.id, reference: c.reference, name: `${c.firstName} ${c.lastName}`, recruiterId: c.recruiterId });
  }
  return out;
}

/**
 * Background job: raises each due reminder once, in the app, for the candidate's recruiter. No email, no text, and no
 * message to the candidate. Repeat runs never duplicate a reminder (the notification's dedupe key).
 */
export async function raiseRecruitmentReminders(now = new Date()) {
  const orgs = await db.candidate.findMany({ where: { stage: { in: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "ONBOARDING"] }, recruiterId: { not: null } }, select: { organisationId: true }, distinct: ["organisationId"] });
  let raised = 0;
  for (const { organisationId } of orgs) {
    for (const r of await dueReminders(organisationId, null, now)) {
      if (!r.recruiterId) continue;
      raised += await notify({ organisationId, userIds: [r.recruiterId], type: "recruitment.reminder", title: `${REMINDER_LABEL[r.kind]}: ${r.reference}`, body: r.text, reason: "You are the recruiter for this candidate", actionUrl: `/hr/recruitment/${r.candidateId}`, dedupeKey: `recruitment:${r.key}`, email: false });
    }
  }
  return raised;
}

export { isOpen };

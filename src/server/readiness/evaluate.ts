import type { CompetencyAssessment, ReadinessException, ReadinessRequirement, ReadinessScope, StaffCompliance, StaffReadinessFlag, StaffRestriction, StaffTrainingRecord } from "@prisma/client";
import { addDays } from "@/lib/london";

/**
 * Staff readiness, worked out from evidence every time it is asked for. Pure functions: no database here, so every
 * rule is unit-tested directly. The five statuses follow the specification (Appendix F):
 *
 *   READY                   every applicable requirement is met, in date and verified
 *   READY_WITH_RESTRICTIONS core requirements met, but a task- or person-specific limit applies
 *   NOT_READY               something required is missing, expired, failed, rejected or unverified past its grace
 *   PENDING_VERIFICATION    evidence has been submitted but nobody authorised has checked it yet
 *   REVIEW_REQUIRED         a change (role, branch, long absence, incident, retired requirement) needs a manager's look
 *
 * A status is never "ready because a record exists": unverified evidence never counts as complete, course completion
 * never counts as practical competence, and a policy acknowledgement never counts as training.
 */

export type ReadinessStatus = "READY" | "READY_WITH_RESTRICTIONS" | "NOT_READY" | "PENDING_VERIFICATION" | "REVIEW_REQUIRED";

export type ComponentState = "MET" | "DUE_SOON" | "EXPIRED" | "MISSING" | "PENDING_VERIFICATION" | "COMPETENCY_DUE" | "NOT_COMPETENT" | "EXCEPTION" | "RESTRICTED";

export interface Evidence {
  kind: "TRAINING_RECORD" | "ASSESSMENT" | "ACKNOWLEDGEMENT" | "EXCEPTION" | "RESTRICTION" | "HR_CHECK" | "FLAG";
  id: string;
  summary: string;
  verifiedBy?: string | null;
  at?: string | null;
}

export interface ComponentResult {
  requirementId: string | null;
  key: string;
  name: string;
  category: "TRAINING" | "COMPETENCY" | "POLICY" | "QUALIFICATION" | "CHECK";
  state: ComponentState;
  hardStop: boolean;
  /** Task-level: only bites when a visit involves this task or person. */
  taskLevel: boolean;
  careTaskIds: string[];
  serviceUserIds: string[];
  message: string;
  dueDate: string | null;
  evidence: Evidence[];
}

export interface ReadinessResult {
  staffId: string;
  status: ReadinessStatus;
  /** Reasons in plain words, for rota users who may not see the evidence. */
  reasons: string[];
  components: ComponentResult[];
  restrictions: { id: string; kind: string; careTaskId: string | null; serviceUserId: string | null; reason: string }[];
  openFlags: { id: string; reason: string; raisedAt: string }[];
  /** True when a requirement or restriction that applies to the asked-for visit is not met. */
  blockedForContext: boolean;
}

export interface StaffFacts {
  id: string;
  jobTitle: string;
  branchId: string | null;
  userId: string | null;
  compliance: Pick<StaffCompliance, "category" | "name" | "required" | "recurring" | "dueDate" | "verified" | "hasEvidence" | "hrCheckId">[];
}

export interface ReadinessFacts {
  requirements: (ReadinessRequirement & { scopes: ReadinessScope[] })[];
  records: StaffTrainingRecord[];
  assessments: CompetencyAssessment[];
  restrictions: StaffRestriction[];
  exceptions: ReadinessException[];
  flags: StaffReadinessFlag[];
  /** Policy id → whether the current published version has been acknowledged by this person's login, and the publication id. */
  acknowledgements: { staffId: string; policyId: string; acknowledged: boolean; publicationId: string | null; acknowledgementId: string | null }[];
  /** Policies with a current published version (a POLICY requirement without one cannot be satisfied or failed). */
  publishedPolicies: { id: string; publicationId: string }[];
  userNames: Record<string, string>;
}

export interface ReadinessContext {
  /** ISO date the readiness is judged for. */
  date: string;
  careTaskIds?: string[];
  serviceUserId?: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function scopeApplies(scope: ReadinessScope, staff: StaffFacts): "general" | "task" | null {
  switch (scope.kind) {
    case "ALL":
      return "general";
    case "JOB_TITLE":
      return scope.jobTitle && scope.jobTitle.trim().toLowerCase() === staff.jobTitle.trim().toLowerCase() ? "general" : null;
    case "BRANCH":
      return scope.branchId && scope.branchId === staff.branchId ? "general" : null;
    case "CARE_TASK":
    case "SERVICE_USER":
      return "task";
  }
}

/** Which requirements apply to this person on this date, and whether generally or only for particular tasks/people. */
export function applicableRequirements(facts: ReadinessFacts, staff: StaffFacts, date: string) {
  const out: { req: ReadinessFacts["requirements"][number]; taskLevel: boolean; careTaskIds: string[]; serviceUserIds: string[] }[] = [];
  for (const req of facts.requirements) {
    if (req.status !== "ACTIVE") continue;
    if (iso(req.effectiveFrom)! > date) continue;
    if (req.effectiveTo && iso(req.effectiveTo)! < date) continue;
    let general = false;
    const careTaskIds: string[] = [];
    const serviceUserIds: string[] = [];
    for (const s of req.scopes) {
      const a = scopeApplies(s, staff);
      if (a === "general") general = true;
      if (a === "task" && s.kind === "CARE_TASK" && s.careTaskId) careTaskIds.push(s.careTaskId);
      if (a === "task" && s.kind === "SERVICE_USER" && s.serviceUserId) serviceUserIds.push(s.serviceUserId);
    }
    if (general) out.push({ req, taskLevel: false, careTaskIds: [], serviceUserIds: [] });
    else if (careTaskIds.length || serviceUserIds.length) out.push({ req, taskLevel: true, careTaskIds, serviceUserIds });
  }
  return out;
}

function latestVerified(records: StaffTrainingRecord[]) {
  return records.filter((r) => r.verificationStatus === "VERIFIED").sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0] ?? null;
}

function evaluateRequirement(facts: ReadinessFacts, staff: StaffFacts, item: ReturnType<typeof applicableRequirements>[number], date: string): ComponentResult {
  const { req } = item;
  const base = { requirementId: req.id, key: req.key, name: req.name, category: req.category as ComponentResult["category"], hardStop: req.hardStop, taskLevel: item.taskLevel, careTaskIds: item.careTaskIds, serviceUserIds: item.serviceUserIds };
  const evidence: Evidence[] = [];
  const name = (id: string | null | undefined) => (id ? facts.userNames[id] ?? "a member" : null);

  // Evidence recorded against an earlier version of the same requirement (same key) still counts.
  const lineage = new Set(facts.requirements.filter((r) => r.key === req.key).map((r) => r.id));
  // An approved, unexpired exception stands in for the requirement, and says so.
  const exception = facts.exceptions.find((e) => e.staffId === staff.id && lineage.has(e.requirementId) && !e.revokedAt && iso(e.expiresAt)! >= date);
  if (exception) {
    evidence.push({ kind: "EXCEPTION", id: exception.id, summary: `Exception approved by ${name(exception.approvedById)} until ${iso(exception.expiresAt)}: ${exception.reason}`, verifiedBy: name(exception.approvedById), at: iso(exception.createdAt) });
    return { ...base, state: "EXCEPTION", message: `${req.name}: covered by an approved exception until ${iso(exception.expiresAt)}`, dueDate: iso(exception.expiresAt), evidence };
  }

  if (req.category === "POLICY") {
    if (!req.policyId) return { ...base, state: "MISSING", message: `${req.name}: no policy is linked to this requirement`, dueDate: null, evidence };
    const published = facts.publishedPolicies.find((p) => p.id === req.policyId);
    if (!published) return { ...base, state: "MET", message: `${req.name}: the policy has no published version yet, so nothing is outstanding`, dueDate: null, evidence };
    const ack = facts.acknowledgements.find((a) => a.staffId === staff.id && a.policyId === req.policyId);
    if (!staff.userId) return { ...base, state: "MISSING", message: `${req.name}: this person has no sign-in linked, so they cannot read and acknowledge the policy`, dueDate: null, evidence };
    if (ack?.acknowledged && ack.publicationId === published.publicationId) {
      evidence.push({ kind: "ACKNOWLEDGEMENT", id: ack.acknowledgementId ?? ack.policyId, summary: "Current published version read and acknowledged", at: null });
      return { ...base, state: "MET", message: `${req.name}: current version acknowledged`, dueDate: null, evidence };
    }
    return { ...base, state: "MISSING", message: ack?.acknowledged ? `${req.name}: a newer version was published and has not been acknowledged` : `${req.name}: the current version has not been acknowledged`, dueDate: null, evidence };
  }

  // TRAINING / QUALIFICATION / COMPETENCY all start from verified records.
  const mine = facts.records.filter((r) => r.staffId === staff.id && lineage.has(r.requirementId));
  const superseded = new Set(mine.map((r) => r.supersedesId).filter(Boolean));
  const live = mine.filter((r) => !superseded.has(r.id));
  const verified = latestVerified(live);
  const submitted = live.filter((r) => r.verificationStatus === "SUBMITTED");
  const rejected = live.filter((r) => r.verificationStatus === "REJECTED");
  for (const r of submitted) evidence.push({ kind: "TRAINING_RECORD", id: r.id, summary: `Submitted ${iso(r.createdAt)} by ${name(r.enteredById)}: completed ${iso(r.completedAt)}${r.provider ? ` (${r.provider})` : ""}, awaiting verification` });
  for (const r of rejected) evidence.push({ kind: "TRAINING_RECORD", id: r.id, summary: `Rejected by ${name(r.verifiedById)}: ${r.verificationNote ?? "no note"}`, verifiedBy: name(r.verifiedById), at: iso(r.verifiedAt) });

  let trainingState: ComponentState;
  let dueDate: string | null = null;
  if (verified) {
    evidence.push({ kind: "TRAINING_RECORD", id: verified.id, summary: `Completed ${iso(verified.completedAt)}${verified.provider ? ` with ${verified.provider}` : ""}${verified.result ? `, ${verified.result}` : ""}; verified by ${name(verified.verifiedById)} on ${iso(verified.verifiedAt)}`, verifiedBy: name(verified.verifiedById), at: iso(verified.verifiedAt) });
    const expiry = verified.expiresAt ? iso(verified.expiresAt) : req.renewalMonths ? iso(new Date(Date.UTC(verified.completedAt.getUTCFullYear(), verified.completedAt.getUTCMonth() + req.renewalMonths, verified.completedAt.getUTCDate()))) : null;
    dueDate = expiry;
    if (expiry && expiry < date) trainingState = "EXPIRED";
    else if (expiry && expiry <= addDays(date, req.warningDays)) trainingState = "DUE_SOON";
    else trainingState = "MET";
  } else if (submitted.length) trainingState = "PENDING_VERIFICATION";
  else trainingState = "MISSING";

  // Practical competence is separate from the course.
  let competencyState: ComponentState | null = null;
  if (req.requiresPractical || req.category === "COMPETENCY") {
    const assessments = facts.assessments.filter((a) => a.staffId === staff.id && lineage.has(a.requirementId)).sort((a, b) => b.assessedAt.getTime() - a.assessedAt.getTime());
    const latest = assessments[0];
    if (!latest) competencyState = "COMPETENCY_DUE";
    else {
      evidence.push({ kind: "ASSESSMENT", id: latest.id, summary: `${latest.method.toLowerCase()} assessment on ${iso(latest.assessedAt)} by ${name(latest.assessorId)}: ${latest.outcome.replace(/_/g, " ").toLowerCase()}${latest.restrictions ? ` (${latest.restrictions})` : ""}`, verifiedBy: name(latest.assessorId), at: iso(latest.assessedAt) });
      if (latest.outcome === "NOT_YET_COMPETENT") competencyState = "NOT_COMPETENT";
      else if (latest.reviewDue && iso(latest.reviewDue)! < date) competencyState = "COMPETENCY_DUE";
      else if (latest.outcome === "COMPETENT_WITH_RESTRICTIONS") competencyState = "RESTRICTED";
      else {
        competencyState = latest.reviewDue && iso(latest.reviewDue)! <= addDays(date, req.warningDays) ? "DUE_SOON" : "MET";
        if (!dueDate && latest.reviewDue) dueDate = iso(latest.reviewDue);
      }
    }
  }

  // COMPETENCY-only requirements have no course; the assessment is the whole requirement.
  const state: ComponentState =
    req.category === "COMPETENCY" ? (competencyState ?? "COMPETENCY_DUE") : competencyState && competencyState !== "MET" && competencyState !== "DUE_SOON" && (trainingState === "MET" || trainingState === "DUE_SOON") ? competencyState : trainingState === "MET" && competencyState === "DUE_SOON" ? "DUE_SOON" : trainingState;

  const label: Record<ComponentState, string> = {
    MET: "up to date",
    DUE_SOON: `due ${dueDate ?? "soon"}`,
    EXPIRED: `expired ${dueDate}`,
    MISSING: "no verified record",
    PENDING_VERIFICATION: "evidence awaiting verification",
    COMPETENCY_DUE: req.category === "COMPETENCY" ? "no competency assessment recorded, or review overdue" : "course complete but practical competency not yet signed off",
    NOT_COMPETENT: "assessed as not yet competent",
    EXCEPTION: "exception",
    RESTRICTED: "competent with restrictions",
  };
  return { ...base, state, message: `${req.name}: ${label[state]}`, dueDate, evidence };
}

function hrCheckComponents(staff: StaffFacts, date: string): ComponentResult[] {
  const out: ComponentResult[] = [];
  for (const category of ["DBS", "Right to work"]) {
    const rows = staff.compliance.filter((c) => c.required && c.category === category);
    const evidence: Evidence[] = rows.map((c) => ({ kind: "HR_CHECK" as const, id: c.hrCheckId, summary: `${c.name}: ${!c.hasEvidence ? "evidence missing" : !c.verified ? "awaiting verification in HR" : c.dueDate ? `verified, review ${iso(c.dueDate)}` : "verified"}` }));
    let state: ComponentState = "MET";
    let message = `${category}: verified in HR & Workforce`;
    let dueDate: string | null = null;
    if (!rows.length) {
      state = "MISSING";
      message = `${category}: no check recorded in HR & Workforce`;
    } else {
      for (const c of rows) {
        const due = iso(c.dueDate);
        if (!c.hasEvidence) { state = "MISSING"; message = `${category}: ${c.name} has no evidence`; break; }
        if (!c.verified) { state = "PENDING_VERIFICATION"; message = `${category}: ${c.name} awaiting verification in HR`; break; }
        if (c.recurring && !due) { state = "MISSING"; message = `${category}: ${c.name} has no review date`; break; }
        if (due && due < date) { state = "EXPIRED"; message = `${category}: ${c.name} review was due ${due}`; dueDate = due; break; }
        if (due) dueDate = due;
      }
    }
    out.push({ requirementId: null, key: `hr:${category}`, name: category, category: "CHECK", state, hardStop: true, taskLevel: false, careTaskIds: [], serviceUserIds: [], message, dueDate, evidence });
  }
  return out;
}

const NOT_MET: ComponentState[] = ["EXPIRED", "MISSING", "NOT_COMPETENT", "COMPETENCY_DUE"];

export function evaluateReadiness(facts: ReadinessFacts, staff: StaffFacts, ctx: ReadinessContext): ReadinessResult {
  const date = ctx.date;
  const components: ComponentResult[] = [...hrCheckComponents(staff, date)];
  for (const item of applicableRequirements(facts, staff, date)) components.push(evaluateRequirement(facts, staff, item, date));

  const restrictions = facts.restrictions
    .filter((r) => r.staffId === staff.id && !r.liftedAt && iso(r.startsAt)! <= date && (!r.endsAt || iso(r.endsAt)! >= date))
    .map((r) => ({ id: r.id, kind: r.kind, careTaskId: r.careTaskId, serviceUserId: r.serviceUserId, reason: r.reason }));
  const openFlags = facts.flags.filter((f) => f.staffId === staff.id && !f.clearedAt).map((f) => ({ id: f.id, reason: f.reason, raisedAt: f.raisedAt.toISOString() }));

  const general = components.filter((c) => !c.taskLevel);
  const taskLevel = components.filter((c) => c.taskLevel);
  const reasons: string[] = [];

  // Hard stops decide the status; advisory requirements (hardStop off) are reported but never make someone "not ready".
  const generalNotMet = general.filter((c) => NOT_MET.includes(c.state) && c.hardStop);
  const advisory = general.filter((c) => (NOT_MET.includes(c.state) || c.state === "PENDING_VERIFICATION") && !c.hardStop);
  const generalPending = general.filter((c) => c.state === "PENDING_VERIFICATION" && c.hardStop);
  const generalRestricted = general.filter((c) => c.state === "RESTRICTED");
  for (const c of generalNotMet) reasons.push(c.message);
  for (const c of generalPending) reasons.push(c.message);
  for (const c of advisory) reasons.push(`Advisory: ${c.message}`);
  for (const c of generalRestricted) reasons.push(c.message);
  for (const c of taskLevel.filter((c) => NOT_MET.includes(c.state) || c.state === "PENDING_VERIFICATION" || c.state === "RESTRICTED")) reasons.push(`Restricted duties: ${c.message}`);
  for (const r of restrictions) reasons.push(`Restriction: ${r.reason}`);
  for (const f of openFlags) reasons.push(`Review required: ${f.reason}`);

  // Does anything bite for the visit being asked about?
  const taskIds = new Set(ctx.careTaskIds ?? []);
  const su = ctx.serviceUserId ?? null;
  const taskBites = (c: ComponentResult) => c.careTaskIds.some((t) => taskIds.has(t)) || (su !== null && c.serviceUserIds.includes(su));
  const biting = taskLevel.filter((c) => taskBites(c) && (NOT_MET.includes(c.state) || c.state === "PENDING_VERIFICATION" || c.state === "RESTRICTED"));
  const restrictionBites = restrictions.some((r) => r.kind === "GENERAL" || (r.kind === "TASK" && r.careTaskId && taskIds.has(r.careTaskId)) || (r.kind === "SERVICE_USER" && su !== null && r.serviceUserId === su));
  for (const c of biting) reasons.push(`For this visit: ${c.message}`);

  let status: ReadinessStatus;
  if (generalNotMet.length) status = "NOT_READY";
  else if (generalPending.length) status = "PENDING_VERIFICATION";
  else if (openFlags.length) status = "REVIEW_REQUIRED";
  else if (restrictions.length || generalRestricted.length || taskLevel.some((c) => NOT_MET.includes(c.state) || c.state === "PENDING_VERIFICATION" || c.state === "RESTRICTED")) status = "READY_WITH_RESTRICTIONS";
  else status = "READY";

  const blockedForContext = status === "NOT_READY" || status === "PENDING_VERIFICATION" || biting.length > 0 || restrictionBites;
  return { staffId: staff.id, status, reasons, components, restrictions, openFlags, blockedForContext };
}

export const READINESS_LABEL: Record<ReadinessStatus, string> = {
  READY: "Ready",
  READY_WITH_RESTRICTIONS: "Ready with restrictions",
  NOT_READY: "Not ready",
  PENDING_VERIFICATION: "Pending verification",
  REVIEW_REQUIRED: "Review required",
};

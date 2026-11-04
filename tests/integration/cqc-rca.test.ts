import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Ctx } from "@/server/auth/rbac";
import { reportIncident } from "@/server/care/incidents";
import { readEvidence, uploadEvidence } from "@/server/compliance/evidence";
import { transitionAction } from "@/server/compliance/audits";
import { createAssessment, createImprovementAction, decideAssessment, getAssessment, recordResult, saveSnapshot, submitAssessment } from "@/server/cqc/assessments";
import { cqcOverview } from "@/server/cqc/dashboard";
import { discoverEvidence, linkEvidence, linksFor, reviewEvidence } from "@/server/cqc/evidence";
import { activeFramework } from "@/server/cqc/framework";
import { improvementActions } from "@/server/cqc/improvements";
import { addFinding, addRcaAction, addTimelineEntry, attachRcaEvidence, closeRca, createRca, effectivenessReview, getRca, linkRcaToCqc, listRcas, managerReview, rcaDashboard, recordEscalation, reopenRca, saveConclusions, saveFactors, saveWhatHappened, startEffectivenessReview, submitForReview, ESCALATIONS } from "@/server/cqc/rca";
import { sendCqcReminders } from "@/server/cqc/reminders";
import { cqcReportFile } from "@/server/cqc/reports";
import { deliverNotification } from "@/server/notifications/notify";
import { setEmailProvider } from "@/server/notifications/email";
import { londonDate, addDays } from "@/lib/london";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * CQC Inspection & Evidence with Root Cause Analysis against a real database: the spec's 34 scenarios (assessment,
 * evidence, scoring, RCA workflow, RCA to CQC, security and reliability).
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD); // ORG_ADMIN, COMPLIANCE_LEAD, CARE_MANAGER
const approver = () => ctxFor("approver@care-solution.demo", BROOKFIELD); // POLICY_APPROVER
const reviewer = () => ctxFor("reviewer@care-solution.demo", BROOKFIELD); // POLICY_REVIEWER (can investigate)
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const author = () => ctxFor("author@care-solution.demo", BROOKFIELD); // no CQC or RCA permissions
const other = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const today = londonDate();
const txt = (s: string) => ({ name: "minutes.txt", type: "text/plain", bytes: Buffer.from(s) });
let liverpool = "";
let portsmouth = "";
let serviceUserId = "";
let assessmentId = "";
let criteria: { id: string; code: string; keyQuestion: string }[] = [];
const crit = (code: string) => criteria.find((c) => c.code === code)!.id;

async function incident(ctx: Ctx, over: Record<string, unknown> = {}) {
  return reportIncident(ctx, { serviceUserId, date: today, time: "07:30", category: "Missed or late call", severity: "MODERATE", description: "The morning call was not attended and the person waited without breakfast or medication support.", ...over });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const m = await manager();
  liverpool = (await db.branch.findFirstOrThrow({ where: { organisationId: m.organisationId!, name: { contains: "Liverpool" } } })).id;
  portsmouth = (await db.branch.findFirstOrThrow({ where: { organisationId: m.organisationId!, name: { contains: "Portsmouth" } } })).id;
  serviceUserId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: m.organisationId!, branchId: liverpool, status: "ACTIVE" } })).id;
  const fw = await activeFramework();
  criteria = await db.cqcCriterion.findMany({ where: { frameworkId: fw.id }, select: { id: true, code: true, keyQuestion: true } });
}, 240_000);

describe("CQC assessment", () => {
  it("1. creates a branch-level assessment with a unique reference on the active framework version", async () => {
    const m = await manager();
    const a = await createAssessment(m, { branchId: liverpool, periodFrom: addDays(today, -90), periodTo: today });
    assessmentId = a.id;
    expect(a.reference).toMatch(/^CQC-\d{4}-0001$/);
    expect(a.branchId).toBe(liverpool);
    const b = await createAssessment(m, { periodFrom: addDays(today, -90), periodTo: today });
    expect(b.reference).toMatch(/0002$/);
    await expect(createAssessment(m, { branchId: liverpool, periodFrom: today, periodTo: addDays(today, -5) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("2 and 33. records results under all five key questions; Not applicable needs a reason and is excluded", async () => {
    const m = await manager();
    await expect(recordResult(m, assessmentId, crit("R11"), { result: "NOT_APPLICABLE", rationale: "No one receives end of life care now." })).rejects.toThrow(/does not apply/);
    await expect(recordResult(m, assessmentId, crit("S01"), { result: "MET", rationale: "short" })).rejects.toBeInstanceOf(ValidationError);
    for (const code of ["S01", "E01", "C01", "R01", "W01"]) await recordResult(m, assessmentId, crit(code), { result: "MET", rationale: "Seen in records and observed in practice this quarter." });
    await recordResult(m, assessmentId, crit("R11"), { result: "NOT_APPLICABLE", rationale: "No one receives end of life care now.", naReason: "No service user currently receives end of life care in this branch." });
    const g = await getAssessment(m, assessmentId);
    expect(g.readiness.byQuestion.RESPONSIVE.notApplicable).toBe(1);
    expect(g.readiness.byQuestion.SAFE.assessed).toBe(1);
    // Most areas are not assessed yet: every key question's score is held back, never shown as a misleading percentage.
    expect(g.readiness.byQuestion.SAFE.confidence).toBe("LOW");
    expect(g.readiness.overall.score).toBeNull();
    expect(g.readiness.byQuestion.SAFE.notAssessed).toBe(11);
  });

  it("3, 4, 5 and 6. links existing evidence, verifies it, finds gaps and scores it", async () => {
    const m = await manager();
    const doc = await uploadEvidence(m, txt("Safeguarding supervision minutes"), { description: "Safeguarding supervision minutes" });
    const link = await linkEvidence(m, { criterionId: crit("S01"), sourceType: "EVIDENCE_DOCUMENT", sourceId: doc.id });
    expect(link.status).toBe("AWAITING_REVIEW");
    // A reviewer without verify permission cannot verify; linking never verifies.
    await expect(reviewEvidence(await reviewer(), link.id, { to: "VERIFIED" })).rejects.toBeInstanceOf(ForbiddenError);
    let g = await getAssessment(m, assessmentId);
    expect(g.readiness.criteria.find((c) => c.id === crit("S01"))!.score).toBe(50);
    await reviewEvidence(await approver(), link.id, { to: "VERIFIED" });
    g = await getAssessment(m, assessmentId);
    expect(g.readiness.criteria.find((c) => c.id === crit("S01"))!.score).toBe(100);
    expect(g.readiness.criteria.find((c) => c.id === crit("E01"))!.score).toBe(50);
    // Missing evidence: essential areas without verified evidence are flagged.
    expect(g.readiness.criteria.filter((c) => c.essentialGap).length).toBeGreaterThan(5);
    const found = await discoverEvidence(m, { frameworkId: g.assessment.frameworkId, branchId: liverpool });
    expect(found.added).toBeGreaterThan(0);
    const again = await discoverEvidence(m, { frameworkId: g.assessment.frameworkId, branchId: liverpool });
    expect(again.added).toBe(0);
    // Suggestions are never counted as verified.
    const suggested = await linksFor(m, m.organisationId!, { branchId: liverpool, status: "SUGGESTED" });
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.every((s) => s.status === "SUGGESTED")).toBe(true);
  });

  it("8. a verified piece of evidence stops counting once it is out of date", async () => {
    const m = await manager();
    const link = (await linksFor(m, m.organisationId!, { criterionIds: [crit("S01")], branchId: liverpool, status: "VERIFIED" }))[0]!;
    await db.cqcEvidenceLink.update({ where: { id: link.id }, data: { validUntil: new Date(Date.now() - 86_400_000) } });
    let g = await getAssessment(m, assessmentId);
    expect(g.readiness.criteria.find((c) => c.id === crit("S01"))!.score).toBe(50);
    expect(g.links.find((l) => l.id === link.id)!.effective).toBe("OUTDATED");
    await db.cqcEvidenceLink.update({ where: { id: link.id }, data: { validUntil: null } });
    g = await getAssessment(m, assessmentId);
    expect(g.readiness.criteria.find((c) => c.id === crit("S01"))!.score).toBe(100);
  });

  it("7. creates an improvement action through the corrective-action service", async () => {
    const m = await manager();
    const c = await coordinator();
    const a = await createImprovementAction(m, assessmentId, crit("E01"), { title: "Reassess needs for all Liverpool service users", ownerId: c.userId, dueDate: new Date(Date.now() - 2 * 86_400_000), priority: "HIGH", evidenceRequired: "Dated reassessments" });
    expect(a.cqcAssessmentId).toBe(assessmentId);
    expect(a.status).toBe("OPEN");
    const g = await getAssessment(m, assessmentId);
    // One overdue action: E01 drops from 50 to 40.
    expect(g.readiness.criteria.find((x) => x.id === crit("E01"))!.score).toBe(40);
    const list = await improvementActions(m, { status: "OVERDUE" });
    expect(list.some((x) => x.id === a.id && x.overdue && x.reference.endsWith("/A1"))).toBe(true);
  });

  it("9. critical findings stay visible whatever the score", async () => {
    const m = await manager();
    await incident(m, { category: "Safeguarding concern", severity: "CRITICAL", safeguarding: true, description: "A safeguarding concern was raised by a family member about unexplained bruising on the arm." });
    const ov = await cqcOverview(m, { branch: liverpool });
    expect(ov.warnings.some((w) => w.level === "critical" && /safeguarding/.test(w.text))).toBe(true);
    expect(ov.figures.safeguarding).toBeGreaterThan(0);
    expect(ov.assessment?.id).toBe(assessmentId);
  });

  it("10, 31. submits, refuses self-approval and stale approvals, approves and snapshots", async () => {
    const m = await manager();
    await expect(submitAssessment(m, assessmentId)).rejects.toThrow(/have no result yet/);
    for (const c of criteria) if (!["S01", "E01", "C01", "R01", "W01", "R11"].includes(c.code)) await recordResult(m, assessmentId, c.id, { result: c.code.endsWith("2") ? "PARTIALLY_MET" : "MET", rationale: "Checked against current records for the period." });
    const before = await getAssessment(m, assessmentId);
    expect(before.readiness.overall.confidence).toBe("HIGH");
    expect(before.readiness.overall.score).not.toBeNull();
    await submitAssessment(m, assessmentId);
    await expect(decideAssessment(m, assessmentId, { decision: "APPROVE", note: "" })).rejects.toBeInstanceOf(ForbiddenError);
    const lock = (await db.cqcAssessment.findUniqueOrThrow({ where: { id: assessmentId } })).lockVersion;
    await expect(decideAssessment(await approver(), assessmentId, { decision: "APPROVE", note: "ok", expectedLock: lock - 1 })).rejects.toBeInstanceOf(ConflictError);
    await decideAssessment(await approver(), assessmentId, { decision: "APPROVE", note: "Agreed", expectedLock: lock });
    const after = await getAssessment(m, assessmentId);
    expect(after.assessment.status).toBe("APPROVED");
    expect(after.snapshots.length).toBe(1);
    await expect(recordResult(m, assessmentId, crit("S01"), { result: "NOT_MET", rationale: "Changing after approval should fail." })).rejects.toBeInstanceOf(ConflictError);
    // Snapshots can never be edited.
    await expect(db.cqcReadinessSnapshot.update({ where: { id: after.snapshots[0]!.id }, data: { overall: 1 } })).rejects.toThrow();
    await saveSnapshot(m, assessmentId, "Board pack");
    const pdf = await cqcReportFile(m, "readiness", { id: assessmentId }, "pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
    const csv = await cqcReportFile(m, "readiness", { id: assessmentId }, "csv");
    expect(csv.body.toString()).toContain("Assessment area");
    expect(await db.auditLog.count({ where: { action: "report.cqc.generated" } })).toBe(2);
  });
});

describe("Root cause analysis", () => {
  let incidentId = "";
  let incidentRef = "";
  let rcaId = "";
  let actionId = "";

  it("11, 12 and 28. opens from an existing incident, keeps its reference and creates no duplicate", async () => {
    const m = await manager();
    const inc = await incident(m);
    incidentId = inc.id;
    incidentRef = inc.reference;
    const before = await db.incident.count();
    const r = await createRca(m, { title: "Missed morning visit", category: "Missed or late visit", severity: "HIGH", eventDate: today, dueDate: addDays(today, 14), ownerId: (await reviewer()).userId, managerId: (await approver()).userId, sources: [{ type: "INCIDENT", id: incidentId }], externalRef: "LA-SG-4471" });
    rcaId = r.id;
    expect(r.reference).toMatch(/^RCA-\d{4}-0001$/);
    expect(r.branchId).toBe(liverpool);
    expect(await db.incident.count()).toBe(before);
    const src = await db.rcaSourceLink.findFirstOrThrow({ where: { rcaId } });
    expect(src.sourceRef).toBe(incidentRef);
    expect(src.externalRef).toBe("LA-SG-4471");
    expect((await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).reference).toBe(incidentRef);
    await expect(createRca(m, { title: "Second look", category: "Missed or late visit", severity: "LOW", eventDate: today, dueDate: addDays(today, 7), ownerId: m.userId, managerId: m.userId, sources: [{ type: "INCIDENT", id: incidentId }] })).rejects.toThrow(/already investigating/);
    // 17. The investigator is told, and serious investigations alert managers.
    expect(await db.notification.count({ where: { type: "rca.assigned", userId: (await reviewer()).userId } })).toBe(1);
    expect(await db.notification.count({ where: { type: "rca.critical" } })).toBeGreaterThan(0);
    const n = await db.notification.findFirstOrThrow({ where: { type: "rca.assigned" }, include: { deliveries: true } });
    expect(n.body).toContain(r.reference);
    expect(n.body).not.toMatch(/breakfast|medication support/);
    expect(n.deliveries[0]!.status).toBe("PENDING");
  });

  it("13, 14, 15. records the timeline, contributing factors and supported findings", async () => {
    const rv = await reviewer();
    const lock = (await db.rcaInvestigation.findUniqueOrThrow({ where: { id: rcaId } })).lockVersion;
    await saveWhatHappened(rv, rcaId, { summary: "The 07:30 visit was not covered after the booked carer phoned in sick at 06:50.", harm: "LOW", immediateActions: "Coordinator sent a replacement carer at 09:10 and called the family.", expectedLock: lock });
    await expect(saveWhatHappened(rv, rcaId, { summary: "Stale edit should fail because the lock moved on.", harm: "LOW", expectedLock: lock })).rejects.toBeInstanceOf(ConflictError);
    await addTimelineEntry(rv, rcaId, { date: today, time: "06:50", text: "Carer phoned the office line to report sickness", kind: "FACT" });
    await addTimelineEntry(rv, rcaId, { date: today, time: "07:00", text: "On-call coordinator says no one answered the escalation phone", kind: "WITNESS" });
    await saveFactors(rv, rcaId, { factors: { SCHEDULING: { relevant: true, notes: "No cover carer was rostered for early calls." }, COMMUNICATION: { relevant: true, notes: "Sickness call went to an unmonitored line." } }, fiveWhys: ["The visit was missed", "No cover was arranged", "No contingency rota exists for early calls"] });
    await addFinding(rv, rcaId, { kind: "SYSTEMIC", factorArea: "SCHEDULING", text: "No contingency cover arrangements for early morning calls.", evidence: "Rota for the week shows no cover carer before 08:00." });
    await addFinding(rv, rcaId, { kind: "CONTRIBUTING", factorArea: "STAFF", text: "Carer did not follow the sickness reporting procedure.", evidence: "Only the investigator's assumption; no witness." });
    await saveConclusions(rv, rcaId, { immediateCause: "Carer sickness without cover", underlyingCauses: "No contingency planning", conclusions: "The main cause is the lack of early-morning cover arrangements." });
    const g = await getRca(rv, rcaId);
    expect(g.rca.status).toBe("INVESTIGATING");
    expect((g.rca.timeline as unknown[]).length).toBe(2);
    expect(g.findings.every((f) => f.status === "PROPOSED")).toBe(true);
  });

  it("16, 17. allocates corrective and preventative actions and needs escalation decisions before review", async () => {
    const rv = await reviewer();
    const c = await coordinator();
    const a = await addRcaAction(rv, rcaId, { title: "Set up an early-morning cover rota", ownerId: c.userId, dueDate: new Date(Date.now() + 7 * 86_400_000), actionType: "PREVENTATIVE", priority: "HIGH", evidenceRequired: "Published cover rota", findingId: (await db.rcaFinding.findFirstOrThrow({ where: { rcaId, kind: "SYSTEMIC" } })).id });
    actionId = a.id;
    expect(a.rcaId).toBe(rcaId);
    expect(await db.notification.count({ where: { type: "action.assigned", userId: c.userId } })).toBeGreaterThan(0);
    await expect(submitForReview(rv, rcaId)).rejects.toThrow(/escalation decisions/);
    for (const kind of Object.keys(ESCALATIONS)) await recordEscalation(rv, rcaId, { kind, decision: kind === "DUTY_OF_CANDOUR" ? "DONE" : "NOT_REQUIRED", rationale: "Considered with the registered manager on the day.", externalRef: kind === "DUTY_OF_CANDOUR" ? "DoC letter 12" : undefined });
    await submitForReview(rv, rcaId);
    expect(await db.notification.count({ where: { type: "rca.review", userId: (await approver()).userId } })).toBe(1);
  });

  it("18, 20. a manager other than the investigator confirms findings; actions are verified independently", async () => {
    const rv = await reviewer();
    const ap = await approver();
    await expect(managerReview(rv, rcaId, { decision: "APPROVE", note: "I approve my own work", confirmFindingIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
    const systemic = await db.rcaFinding.findFirstOrThrow({ where: { rcaId, kind: "SYSTEMIC" } });
    await managerReview(ap, rcaId, { decision: "APPROVE", note: "The scheduling finding is supported; the staff one is not.", confirmFindingIds: [systemic.id] });
    const g = await getRca(ap, rcaId);
    expect(g.rca.status).toBe("ACTIONS_IN_PROGRESS");
    expect(g.findings.find((f) => f.kind === "CONTRIBUTING")!.status).toBe("NOT_SUPPORTED");
    await expect(startEffectivenessReview(ap, rcaId)).rejects.toThrow(/not yet verified/);
    const c = await coordinator();
    await transitionAction(c, actionId, "COMPLETED", { note: "Cover rota published for all early calls" });
    await expect(transitionAction(c, actionId, "VERIFIED", { note: "self" })).rejects.toBeInstanceOf(ForbiddenError);
    await transitionAction(await manager(), actionId, "VERIFIED", { note: "Checked the published rota and two weeks of early calls" });
  });

  it("19, 20. effectiveness review, then closure with approval; linked incident stays as it was", async () => {
    const ap = await approver();
    const rv = await reviewer();
    await startEffectivenessReview(rv, rcaId);
    await expect(effectivenessReview(ap, rcaId, { decision: "EFFECTIVE", note: "Checks done over two weeks.", checks: { notRepeated: true } })).rejects.toThrow(/every check/);
    await effectivenessReview(ap, rcaId, { decision: "EFFECTIVE", note: "No repeat missed early calls in two weeks; cover used twice.", checks: { notRepeated: true, trainingDone: true, procedureUpdated: true, followUpSatisfactory: true, residualRiskAcceptable: true } });
    await expect(closeRca(rv, rcaId, { note: "Closing my own investigation should not be possible here." })).rejects.toBeInstanceOf(ForbiddenError);
    await closeRca(ap, rcaId, { note: "Actions verified and effective. Lessons shared at the team meeting." });
    const g = await getRca(ap, rcaId);
    expect(g.rca.status).toBe("CLOSED");
    expect((await db.incident.findUniqueOrThrow({ where: { id: incidentId } })).status).not.toBe("CLOSED");
    expect(g.reviews.map((r) => r.stage)).toEqual(["SUBMISSION", "MANAGER_REVIEW", "EFFECTIVENESS", "CLOSURE"]);
  });

  it("21. links the verified RCA to CQC areas; closing it changed no score by itself", async () => {
    const m = await manager();
    const a2 = await createAssessment(m, { branchId: liverpool, periodFrom: addDays(today, -30), periodTo: today, copyFromId: assessmentId });
    // W15 was copied as Met from the approved assessment, with no verified evidence yet: 50.
    const before = (await getAssessment(m, a2.id)).readiness.criteria.find((c) => c.id === crit("W15"))!.score;
    expect(before).toBe(50);
    await linkRcaToCqc(m, rcaId, [crit("S12"), crit("R07"), crit("W15")], "Missed visit learning");
    const mid = (await getAssessment(m, a2.id)).readiness.criteria.find((c) => c.id === crit("W15"))!.score;
    expect(mid).toBe(before);
    const link = (await linksFor(m, m.organisationId!, { sourceType: "RCA", sourceId: rcaId })).find((l) => l.criterionId === crit("W15"))!;
    await reviewEvidence(await approver(), link.id, { to: "VERIFIED" });
    const after = (await getAssessment(m, a2.id)).readiness.criteria.find((c) => c.id === crit("W15"))!.score;
    expect(after).toBe(100);
    const report = await cqcReportFile(m, "rca", { id: rcaId }, "pdf");
    expect(report.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("34. reopens with a reason and keeps the whole history", async () => {
    const ap = await approver();
    await expect(reopenRca(ap, rcaId, "short")).rejects.toBeInstanceOf(ValidationError);
    await reopenRca(ap, rcaId, "A second early call was missed on Friday, so the fix needs another look.");
    const g = await getRca(ap, rcaId);
    expect(g.rca.status).toBe("INVESTIGATING");
    expect(g.rca.reopenCount).toBe(1);
    expect(g.reviews.length).toBe(5);
    await expect(db.rcaReview.update({ where: { id: g.reviews[0]!.id }, data: { note: "rewrite" } })).rejects.toThrow();
    expect(g.history.some((h) => h.action === "rca.reopened")).toBe(true);
  });

  it("closes as an approved exception only, keeping open follow-up actions", async () => {
    const m = await manager();
    const ap = await approver();
    const r = await createRca(m, { title: "Late lunch visits", category: "Missed or late visit", severity: "LOW", eventDate: today, dueDate: addDays(today, 10), ownerId: (await coordinator()).userId, managerId: ap.userId });
    await saveWhatHappened(m, r.id, { summary: "Lunch visits ran 40 minutes late on three days this week.", harm: "NONE" });
    await addTimelineEntry(m, r.id, { date: today, time: "12:40", text: "Visit started late", kind: "FACT" });
    await addFinding(m, r.id, { kind: "IMMEDIATE", text: "Travel time between visits too short.", evidence: "Route times on the rota versus GPS-free travel estimates." });
    await saveConclusions(m, r.id, { conclusions: "Travel time needs to be increased on the lunch run." });
    await addRcaAction(m, r.id, { title: "Add travel time to the lunch run", ownerId: m.userId, dueDate: new Date(Date.now() + 30 * 86_400_000), actionType: "CORRECTIVE", priority: "MEDIUM", evidenceRequired: "Updated rota" });
    await submitForReview(m, r.id);
    await managerReview(ap, r.id, { decision: "APPROVE", note: "Agree with the finding and plan.", confirmFindingIds: [(await db.rcaFinding.findFirstOrThrow({ where: { rcaId: r.id } })).id] });
    await expect(closeRca(ap, r.id, { note: "Closing early while the rota change beds in over the month." })).rejects.toThrow(/approved exception/);
    await closeRca(ap, r.id, { note: "Closing early while the rota change beds in over the month.", exception: true, exceptionReason: "Action is long-running and is tracked on the improvement list with its due date." });
    const g = await getRca(ap, r.id);
    expect(g.rca.closureException).toBe(true);
    expect(g.actions[0]!.status).toBe("OPEN");
  });

  it("RCA dashboard figures come from the investigations the person can see", async () => {
    const d = await rcaDashboard(await manager());
    expect(d.total).toBe(2);
    expect(d.closed).toBe(1);
    expect(d.themes.find(([c]) => c === "Missed or late visit")?.[1]).toBe(2);
  });
});

describe("Security and reliability", () => {
  let restrictedId = "";

  it("22. keeps organisations apart", async () => {
    const o = await other();
    const rca = await db.rcaInvestigation.findFirstOrThrow({});
    await expect(getRca(o, rca.id)).rejects.toThrow();
    expect(await listRcas(o)).toEqual([]);
    await expect(getAssessment(o, assessmentId)).rejects.toThrow();
  });

  it("23. keeps branch-limited members to their branches", async () => {
    const m = await manager();
    const limited: Ctx = { ...m, branchIds: [portsmouth] };
    expect((await listRcas(limited)).length).toBe(1); // the organisation-wide one only
    await expect(getAssessment(limited, assessmentId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createAssessment(limited, { branchId: liverpool, periodFrom: today, periodTo: today })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("24, 26. keeps safeguarding investigations and their files confidential", async () => {
    const m = await manager();
    const inc = await incident(m, { category: "Safeguarding concern", severity: "HIGH", safeguarding: true, description: "Allegation of financial abuse reported by a neighbour during the evening visit." });
    const r = await createRca(m, { title: "Financial abuse allegation", category: "Safeguarding concern", severity: "HIGH", eventDate: today, dueDate: addDays(today, 5), ownerId: (await coordinator()).userId, managerId: m.userId, sources: [{ type: "INCIDENT", id: inc.id }] });
    restrictedId = r.id;
    expect(r.restricted).toBe(true);
    const rv = await reviewer();
    expect((await listRcas(rv)).some((x) => x.id === r.id)).toBe(false);
    await expect(getRca(rv, r.id)).rejects.toBeInstanceOf(NotFoundError);
    const c = await coordinator();
    expect((await getRca(c, r.id)).rca.title).toBe("Financial abuse allegation");
    const doc = await attachRcaEvidence(c, r.id, txt("Statement"), "Neighbour statement");
    // The investigator can open it without the general evidence permission; someone with evidence.read but no access to the case cannot.
    expect((await readEvidence(c, doc.id)).doc.id).toBe(doc.id);
    await expect(readEvidence(await author(), doc.id)).rejects.toBeInstanceOf(NotFoundError);
    const n = await db.notification.findMany({ where: { actionUrl: `/compliance/cqc/rca/${r.id}` } });
    expect(n.length).toBeGreaterThan(0);
    for (const x of n) expect(x.body).not.toMatch(/financial|abuse|neighbour/i);
  });

  it("25. checks role permissions on the server", async () => {
    const au = await author();
    await expect(createAssessment(au, { periodFrom: today, periodTo: today })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRca(au, { title: "Not allowed here", category: "Other significant service failure", severity: "LOW", eventDate: today, dueDate: today, ownerId: au.userId, managerId: au.userId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRcas(au)).rejects.toBeInstanceOf(ForbiddenError);
    const rv = await reviewer();
    await expect(createAssessment(rv, { periodFrom: today, periodTo: today })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("27. records email delivery honestly and retries failures", async () => {
    const n = await db.notification.findFirstOrThrow({ where: { type: "rca.assigned" }, include: { deliveries: true } });
    const d = n.deliveries[0]!;
    setEmailProvider({ name: "down", send: async () => { throw new Error("SMTP down"); } });
    await expect(deliverNotification(d.id, 1, 5)).rejects.toThrow();
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("FAILED");
    setEmailProvider({ name: "ok", send: async () => ({ messageId: "m-1" }) });
    await deliverNotification(d.id, 2, 5);
    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(after.status).toBe("SENT");
    expect(after.attempts).toBe(2);
  });

  it("reminders: overdue investigations and evidence gaps are sent once per due date", async () => {
    await db.rcaInvestigation.update({ where: { id: restrictedId }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } });
    const first = await sendCqcReminders();
    expect(first).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { type: "rca.overdue" } })).toBeGreaterThan(0);
    const second = await sendCqcReminders();
    expect(second).toBe(0);
  });

  it("29. keeps audit history for every change", async () => {
    const actions = (await db.auditLog.findMany({ where: { entityType: { in: ["RcaInvestigation", "CqcAssessment", "CqcEvidenceLink"] } }, select: { action: true } })).map((a) => a.action);
    for (const a of ["rca.created", "rca.submitted", "rca.approved", "rca.closed", "rca.reopened", "rca.escalation.recorded", "cqc.assessment.created", "cqc.result.recorded", "cqc.assessment.approved", "cqc.evidence.reviewed"]) expect(actions).toContain(a);
    const change = await db.auditLog.findFirstOrThrow({ where: { action: "cqc.evidence.reviewed" } });
    expect(change.data).toMatchObject({ from: "AWAITING_REVIEW", to: "VERIFIED" });
  });

  it("30. existing incidents, audits and corrective actions still work", async () => {
    const m = await manager();
    const inc = await incident(m, { severity: "LOW", category: "Other" });
    expect(inc.reference).toMatch(/^INC-/);
    const actions = await db.complianceAction.count({ where: { rcaId: null, cqcAssessmentId: null } });
    expect(actions).toBeGreaterThan(0);
  });

  it("32. reports never disclose data to people who may not see it", async () => {
    await expect(cqcReportFile(await author(), "actions", {}, "csv")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cqcReportFile(await other(), "rca", { id: restrictedId }, "pdf")).rejects.toThrow();
    const csv = (await cqcReportFile(await manager(), "actions", {}, "csv")).body.toString();
    expect(csv).toContain("Action reference");
    // The reviewer (no access to the restricted case) gets no actions from it.
    const rvActions = await improvementActions(await reviewer());
    expect(rvActions.some((a) => a.rcaId === restrictedId)).toBe(false);
  });
});

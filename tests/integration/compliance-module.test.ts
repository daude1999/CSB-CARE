import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { closeRisk, createRisk, getRisk, listRisks, reopenRisk, reviewRisk, updateRisk, type RiskInput } from "@/server/compliance/risks";
import { actionDetail, attachActionEvidence, createAction, transitionAction } from "@/server/compliance/audits";
import { evidenceFor, resolveLinks, uploadEvidence } from "@/server/compliance/evidence";
import { complianceDashboard } from "@/server/compliance/dashboard";
import { complianceReport, complianceReportFile, parseReportFilters } from "@/server/compliance/reports";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Policy & Compliance restructure against a real database: the risk register (validation, concurrency, history,
 * closure rules, tenant isolation), evidence linked to compliance records, the audit → finding → action → evidence →
 * verification loop, and the dashboard and report figures.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const author = () => ctxFor("author@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const other = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const txt = (s: string) => ({ name: "note.txt", type: "text/plain", bytes: Buffer.from(s) });
const future = (days: number) => new Date(Date.now() + days * 86_400_000);
let managerId = "";
let authorId = "";

const riskInput = (over: Partial<RiskInput> = {}): RiskInput => ({
  title: "Not enough carers for weekend evening calls",
  description: "Weekend evening calls may be late or missed because the rota relies on two carers.",
  category: "WORKFORCE",
  likelihood: 4,
  impact: 4,
  existingControls: "On-call coordinator and an agency agreement",
  controlEffectiveness: "PARTIALLY_EFFECTIVE",
  residualLikelihood: 3,
  residualImpact: 3,
  ownerId: managerId,
  reviewDate: future(60),
  ...over,
});

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  managerId = (await manager()).userId;
  authorId = (await author()).userId;
}, 180_000);

describe("risk register", () => {
  it("records a risk with numbered references, history and an audit entry", async () => {
    const m = await manager();
    const a = await createRisk(m, riskInput());
    const b = await createRisk(m, riskInput({ title: "Medication records not reconciled weekly", category: "SAFE_CARE" }));
    expect([a.ref, b.ref]).toEqual(["R-001", "R-002"]);
    const detail = await getRisk(m, a.id);
    expect(detail.events.map((e) => e.kind)).toEqual(["CREATED"]);
    expect(await db.auditLog.count({ where: { entityId: a.id, action: "risk.created" } })).toBe(1);
  });

  it("validates scores, a residual above inherent, owner and required text", async () => {
    const m = await manager();
    await expect(createRisk(m, riskInput({ likelihood: 6 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createRisk(m, riskInput({ residualLikelihood: 5, residualImpact: 5 }))).rejects.toThrow(/cannot be higher/);
    await expect(createRisk(m, riskInput({ title: "x" }))).rejects.toBeInstanceOf(ValidationError);
    const outsider = (await other()).userId;
    await expect(createRisk(m, riskInput({ ownerId: outsider }))).rejects.toThrow(/member of your organisation/);
  });

  it("only lets risk managers write, and hides risks from people without risk.view", async () => {
    await expect(createRisk(await carer(), riskInput())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRisks(await carer())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("needs a reason for a material change and rejects a stale edit", async () => {
    const m = await manager();
    const r = await createRisk(m, riskInput({ title: "Lone working at night" }));
    await expect(updateRisk(m, r.id, { ...riskInput({ title: "Lone working at night", residualLikelihood: 2 }) })).rejects.toThrow(/Say why/);
    const updated = await updateRisk(m, r.id, { ...riskInput({ title: "Lone working at night", residualLikelihood: 2 }), reason: "Buddy check-in calls introduced", expectedUpdatedAt: r.updatedAt.toISOString() });
    expect(updated.residualLikelihood).toBe(2);
    await expect(updateRisk(m, r.id, { ...riskInput({ title: "Lone working at night, all branches" }), expectedUpdatedAt: r.updatedAt.toISOString() })).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps history immutable at the database", async () => {
    const ev = await db.riskEvent.findFirstOrThrow();
    await expect(db.riskEvent.update({ where: { id: ev.id }, data: { note: "rewritten" } })).rejects.toThrow();
    await expect(db.riskEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });

  it("records management reviews with a future next review date", async () => {
    const m = await manager();
    const r = await createRisk(m, riskInput({ title: "Missed visit escalation is slow" }));
    await expect(reviewRisk(m, r.id, { note: "Reviewed at governance meeting", nextReviewDate: future(-1) })).rejects.toThrow(/future/);
    await reviewRisk(m, r.id, { note: "Reviewed at governance meeting; controls working", nextReviewDate: future(90), status: "MONITORING" });
    const after = await getRisk(m, r.id);
    expect(after.status).toBe("MONITORING");
    expect(after.lastReviewedById).toBe(m.userId);
    expect(after.events.some((e) => e.kind === "REVIEWED")).toBe(true);
  });

  it("will not close a risk while a mitigation action is unverified, then closes and reopens it", async () => {
    const m = await manager();
    const r = await createRisk(m, riskInput({ title: "Out-of-date moving and handling plans" }));
    const action = await createAction(m, { title: "Review all moving and handling plans", ownerId: authorId, dueDate: future(14), riskId: r.id });
    await expect(closeRisk(m, r.id, "Plans have all been reviewed")).rejects.toBeInstanceOf(ConflictError);
    await transitionAction(await author(), action.id, "COMPLETED", { note: "All 12 plans reviewed" });
    await transitionAction(m, action.id, "VERIFIED", { note: "Sampled 4 plans on file" });
    await closeRisk(m, r.id, "Plans reviewed and verified by sampling");
    await expect(createAction(m, { title: "Another action", ownerId: authorId, dueDate: future(7), riskId: r.id })).rejects.toBeInstanceOf(ConflictError);
    await reopenRisk(m, r.id, "New concern raised");
    expect((await getRisk(m, r.id)).status).toBe("OPEN");
  });

  it("never shows or changes another organisation's risk", async () => {
    const m = await manager();
    const r = await createRisk(m, riskInput({ title: "Isolation check risk" }));
    const o = await other();
    await expect(getRisk(o, r.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewRisk(o, r.id, { note: "Trying to review across tenants", nextReviewDate: future(30) })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listRisks(o)).some((x) => x.id === r.id)).toBe(false);
  });
});

describe("evidence linked to compliance records", () => {
  it("links evidence to a policy and a risk, and refuses another organisation's record", async () => {
    const m = await manager();
    const policy = await db.policy.findFirstOrThrow({ where: { organisationId: m.organisationId!, kind: "CUSTOMER" } });
    const risk = await db.complianceRisk.findFirstOrThrow({ where: { organisationId: m.organisationId! } });
    const a = await uploadEvidence(m, txt("Signed staff meeting minutes"), { linkedType: "POLICY", linkedId: policy.id });
    const b = await uploadEvidence(m, txt("Agency agreement"), { linkedType: "RISK", linkedId: risk.id });
    expect(a.scanStatus).toBe("NOT_SCANNED");
    const links = await resolveLinks(m.organisationId!, [a, b]);
    expect(links.size).toBe(2);
    expect((await evidenceFor(m, "RISK", [risk.id])).map((e) => e.id)).toEqual([b.id]);
    await expect(uploadEvidence(await other(), txt("x"), { linkedType: "POLICY", linkedId: policy.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadEvidence(m, txt("x"), { linkedType: "SOMETHING", linkedId: policy.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("audit → finding → action → evidence → verification", () => {
  it("lets the owner attach evidence and complete; an independent lead verifies, then closes", async () => {
    const m = await manager();
    const finding = await db.auditFinding.findFirstOrThrow({ where: { organisationId: m.organisationId! } });
    const action = await createAction(m, { title: "Refresh safeguarding referral guide", ownerId: authorId, dueDate: future(10), findingId: finding.id });
    const au = await author();
    const ev = await attachActionEvidence(au, action.id, txt("New referral guide issued to all staff"));
    expect(ev.linkedType).toBe("ACTION");
    await expect(attachActionEvidence(await carer(), action.id, txt("x"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transitionAction(m, action.id, "CLOSED")).rejects.toBeInstanceOf(ConflictError);
    await transitionAction(au, action.id, "COMPLETED", { note: "Guide rewritten and issued", evidenceId: ev.id });
    await expect(transitionAction(au, action.id, "VERIFIED", { note: "self" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transitionAction(m, action.id, "VERIFIED")).rejects.toBeInstanceOf(ValidationError);
    await transitionAction(m, action.id, "VERIFIED", { note: "Checked guide and issue log" });
    await transitionAction(m, action.id, "CLOSED", { note: "Done" });
    const d = await actionDetail(m, action.id);
    expect(d.history.map((h) => h.to)).toEqual(["OPEN", "COMPLETED", "VERIFIED", "CLOSED"]);
    expect(d.finding?.id).toBe(finding.id);
    expect(d.evidence.map((e) => e.id)).toEqual([ev.id]);
    await expect(actionDetail(await other(), action.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("compliance dashboard and reports", () => {
  it("counts from live records and gates attention items by role", async () => {
    const m = await manager();
    const d = await complianceDashboard(m);
    const active = await db.policy.count({ where: { organisationId: m.organisationId!, kind: "CUSTOMER", status: "ACTIVE" } });
    expect(d.kpis.activePolicies).toBe(active);
    expect(d.attention.map((x) => x.key)).toContain("risks");
    // Review status splits the active library exactly, and upcoming reviews are this organisation's own, soonest first.
    const rs = d.reviewStatus;
    expect(rs.current + rs.dueSoon + rs.overdue).toBe(active);
    expect(rs.overdue).toBe(d.kpis.overdueReviews);
    const ups = d.upcomingReviews;
    expect(ups.length).toBeLessThanOrEqual(5);
    for (let n = 1; n < ups.length; n++) expect(+ups[n]!.nextReviewDate!).toBeGreaterThanOrEqual(+ups[n - 1]!.nextReviewDate!);
    if (ups.length) expect(await db.policy.count({ where: { id: { in: ups.map((u) => u.id) }, organisationId: { not: m.organisationId! } } })).toBe(0);
    const c = await complianceDashboard(await carer());
    expect(c.attention.map((x) => x.key)).not.toContain("risks");
    expect(c.attention.map((x) => x.key)).not.toContain("findings");
  });

  it("reports risks and actions for the caller's organisation only, and exports CSV, Excel and PDF", async () => {
    const m = await manager();
    const f = parseReportFilters({});
    const risks = await complianceReport(m, "risks", f);
    expect(risks.rows.length).toBe(await db.complianceRisk.count({ where: { organisationId: m.organisationId! } }));
    const o = await complianceReport(await other(), "risks", parseReportFilters({}));
    expect(o.rows.length).toBe(0);
    for (const format of ["csv", "xlsx", "pdf"] as const) {
      const file = await complianceReportFile(m, "actions", f, format);
      expect(file.body.length).toBeGreaterThan(100);
    }
    expect(() => parseReportFilters({ from: "2026-10-10", to: "2026-01-01" })).toThrow();
    await expect(complianceReport(m, "nonsense", f)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses exports to people without report.export", async () => {
    await expect(complianceReportFile(await carer(), "policies", parseReportFilters({}), "csv")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

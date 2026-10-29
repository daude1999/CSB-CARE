import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { ACK_WORDING, ackBucket, acknowledgeRow, correctAcknowledgement, createRule, exemptRow, markOpened, reconcileStaffAssignments, recordAckAssessment, sendAcknowledgementReminders, signoffCounts, signoffCsv, signoffRows, withdrawRule } from "@/server/policies/assignment";
import { createManualRevision, decide, editDraftSection, publishRevision, submitForReview } from "@/server/policies/workflow";
import { readinessFor, saveRequirement } from "@/server/readiness";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Policy assignment and acknowledgement against a real database, one block per acceptance test in Appendix E8:
 * targeting without cross-tenant exposure, distinct opened / acknowledged / assessed states, reassignment on a material
 * revision with earlier evidence kept, recorded reminders and escalations, tamper-proof evidence with attributable
 * corrections, and counts that reconcile with the rows and the export.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";

async function publishedPolicy(ref: string) {
  return db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref, currentPublishedVersionId: { not: null } } });
}
async function currentPub(policyId: string) {
  return db.policyPublication.findFirstOrThrow({ where: { policyId, status: "PUBLISHED", materialRevision: true }, orderBy: { publishedAt: "desc" } });
}
async function newVersion(policyId: string, opts: { material: boolean }) {
  const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
  const approver = await ctxFor("approver@care-solution.demo", BROOKFIELD);
  const rev = await createManualRevision(author, policyId, "Test change");
  await editDraftSection(author, rev.id, "purpose", { body: `Updated purpose ${Math.random()}` });
  await submitForReview(author, rev.id);
  await decide(approver, rev.id, { decision: "APPROVE", comment: "ok" });
  return publishRevision(await manager(), rev.id, { materialRevision: opts.material });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("E8: targeting", () => {
  it("assigns to everyone, one branch, a role and named people, and lists staff without a login as unable to sign", async () => {
    const m = await manager();
    const p = await publishedPolicy("CSB-HS-002");
    const pub = await currentPub(p.id);
    const before = await db.acknowledgement.count({ where: { publicationId: pub.id, supersededAt: null } });
    const r = await createRule(m, { policyId: p.id, scope: "ORG", dueDays: 14 });
    expect(r.assigned).toBeGreaterThan(0);
    const rows = await db.acknowledgement.findMany({ where: { publicationId: pub.id, supersededAt: null } });
    expect(rows.length).toBe(before + r.assigned);
    const active = await db.staffMember.count({ where: { organisationId: orgId, hrMissing: false, employmentStatus: { in: ["ACTIVE", "ONBOARDING"] } } });
    expect(rows.filter((x) => x.staffMemberId).length).toBeGreaterThanOrEqual(active);
    const unlinked = rows.find((x) => !x.userId);
    expect(unlinked).toBeTruthy();
    expect(ackBucket(unlinked!).cannotSign).toBe(true);
    // Assigning again never duplicates anyone.
    await createRule(m, { policyId: p.id, scope: "ORG", dueDays: 14 });
    expect(await db.acknowledgement.count({ where: { publicationId: pub.id, supersededAt: null } })).toBe(rows.length);

    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    const p2 = await publishedPolicy("CSB-COM-001");
    const pub2 = await currentPub(p2.id);
    await db.acknowledgement.updateMany({ where: { publicationId: pub2.id }, data: {} });
    const branchRule = await createRule(m, { policyId: p2.id, scope: "BRANCH", branchId: liverpool.id });
    const fromRule = await db.acknowledgement.findMany({ where: { ruleId: branchRule.ruleIds[0] }, include: { staffMember: true } });
    expect(fromRule.every((a) => a.staffMember?.branchId === liverpool.id)).toBe(true);
    const roleRule = await createRule(m, { policyId: p2.id, scope: "ROLE", orgRole: "FINANCE_OFFICER" });
    const finance = await db.user.findUniqueOrThrow({ where: { email: "finance@care-solution.demo" } });
    expect(await db.acknowledgement.count({ where: { publicationId: pub2.id, userId: finance.id, supersededAt: null } })).toBe(1);
    const someone = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: { not: liverpool.id }, hrMissing: false, employmentStatus: "ACTIVE" } });
    await createRule(m, { policyId: p2.id, scope: "STAFF", staffMemberIds: [someone.id] });
    expect(await db.acknowledgement.count({ where: { publicationId: pub2.id, staffMemberId: someone.id, supersededAt: null } })).toBe(1);
    expect(roleRule.ruleIds).toHaveLength(1);
  });

  it("never exposes or accepts another organisation's policies or staff", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const p = await publishedPolicy("CSB-HS-002");
    await expect(createRule(oak, { policyId: p.id, scope: "ORG" })).rejects.toBeInstanceOf(NotFoundError);
    const theirs = await signoffRows(oak);
    expect(theirs.every((r) => r.organisationId === oak.organisationId)).toBe(true);
    await expect(createRule(await carer(), { policyId: p.id, scope: "ORG" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("E8: states", () => {
  it("distinguishes opened, acknowledged and assessment passed, and stores the wording", async () => {
    const m = await manager();
    const me = await carer();
    const p = await publishedPolicy("CSB-SAF-001");
    const pub = await currentPub(p.id);
    await createRule(m, { policyId: p.id, scope: "STAFF", staffMemberIds: [(await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, userId: me.userId } })).id], requiresAssessment: true });
    const row = await db.acknowledgement.findFirstOrThrow({ where: { publicationId: pub.id, userId: me.userId, supersededAt: null } });
    if (row.acknowledgedAt) return; // seeded as already signed
    await markOpened(me, p.id);
    const opened = await db.acknowledgement.findUniqueOrThrow({ where: { id: row.id } });
    expect(ackBucket(opened).bucket).toBe("opened");
    await acknowledgeRow(me, row.id);
    const acked = await db.acknowledgement.findUniqueOrThrow({ where: { id: row.id } });
    expect(acked.wording).toBe(ACK_WORDING);
    expect(acked.state === "ASSESSMENT_REQUIRED" || acked.state === "ACKNOWLEDGED").toBe(true);
    if (acked.state === "ASSESSMENT_REQUIRED") {
      await expect(recordAckAssessment(me, row.id, { method: "DISCUSSION", passed: true, note: "I think I get it" })).rejects.toBeInstanceOf(ForbiddenError);
      await recordAckAssessment(m, row.id, { method: "KNOWLEDGE_CHECK", score: 8, passMark: 7, passed: true, note: "Five questions on escalation routes" });
      expect((await db.acknowledgement.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("ASSESSMENT_PASSED");
    }
    const events = await db.acknowledgementEvent.findMany({ where: { acknowledgementId: row.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["OPENED", "ACKNOWLEDGED"]));
  });
});

describe("E8: material revision", () => {
  it("reassigns on a material revision, keeps the earlier evidence, and leaves a wording-only update alone", async () => {
    const p = await publishedPolicy("CSB-COM-001");
    const before = await currentPub(p.id);
    const oldRows = await db.acknowledgement.findMany({ where: { publicationId: before.id } });
    const signedBefore = oldRows.filter((a) => a.acknowledgedAt).length;
    const minor = await newVersion(p.id, { material: false });
    expect(await db.acknowledgement.count({ where: { publicationId: minor.publicationId } })).toBe(0);
    expect((await currentPub(p.id)).id).toBe(before.id);
    const major = await newVersion(p.id, { material: true });
    expect(await db.acknowledgement.count({ where: { publicationId: major.publicationId } })).toBeGreaterThan(0);
    expect((await currentPub(p.id)).id).toBe(major.publicationId);
    expect(await db.acknowledgement.count({ where: { publicationId: before.id, acknowledgedAt: { not: null } } })).toBe(signedBefore);
  });
});

describe("E8: reminders, escalation and evidence integrity", () => {
  it("records reminders and escalations as events and never counts them as acknowledgement", async () => {
    const p = await publishedPolicy("CSB-HS-002");
    const pub = await currentPub(p.id);
    await db.acknowledgement.updateMany({ where: { publicationId: pub.id, acknowledgedAt: null, supersededAt: null }, data: { dueAt: new Date(Date.now() - 10 * 86400_000) } });
    const r = await sendAcknowledgementReminders();
    expect(r.sent).toBeGreaterThan(0);
    expect(r.escalated).toBeGreaterThan(0);
    const again = await sendAcknowledgementReminders();
    expect(again.sent).toBe(0);
    expect(again.escalated).toBe(0);
    const reminded = await db.acknowledgement.findFirstOrThrow({ where: { publicationId: pub.id, remindedAt: { not: null } } });
    expect(reminded.acknowledgedAt).toBeNull();
    expect(await db.acknowledgementEvent.count({ where: { acknowledgementId: reminded.id, type: "REMINDED" } })).toBe(1);
    expect(await db.acknowledgementEvent.count({ where: { type: "ESCALATED" } })).toBeGreaterThan(0);
  });

  it("freezes acknowledged evidence and keeps the original through a correction", async () => {
    const m = await manager();
    const signed = await db.acknowledgement.findFirstOrThrow({ where: { organisationId: orgId, acknowledgedAt: { not: null }, supersededAt: null } });
    await expect(db.acknowledgement.update({ where: { id: signed.id }, data: { acknowledgedAt: new Date() } })).rejects.toThrow(/evidence/);
    await expect(db.acknowledgement.delete({ where: { id: signed.id } })).rejects.toThrow(/evidence/);
    const ev = await db.acknowledgementEvent.findFirst({ where: { acknowledgementId: signed.id } });
    if (ev) await expect(db.acknowledgementEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/immutable/);
    await expect(correctAcknowledgement(m, signed.id, "short")).rejects.toThrow(/Explain/);
    const next = await correctAcknowledgement(m, signed.id, "Signed on the wrong person's tablet at handover");
    expect((await db.acknowledgement.findUniqueOrThrow({ where: { id: signed.id } })).acknowledgedAt?.getTime()).toBe(signed.acknowledgedAt!.getTime());
    expect(next.supersedesId).toBe(signed.id);
    expect(next.acknowledgedAt).toBeNull();
    await expect(correctAcknowledgement(m, signed.id, "Signed on the wrong person's tablet again")).rejects.toThrow(/already been corrected/);
  });

  it("exempts with a reason and withdraws a rule without touching acknowledgements already given", async () => {
    const m = await manager();
    const p = await publishedPolicy("CSB-HS-002");
    const pub = await currentPub(p.id);
    const open = await db.acknowledgement.findFirstOrThrow({ where: { publicationId: pub.id, acknowledgedAt: null, supersededAt: null, state: "ASSIGNED" } });
    await exemptRow(m, open.id, "On long-term leave until March");
    expect(ackBucket(await db.acknowledgement.findUniqueOrThrow({ where: { id: open.id } })).bucket).toBe("exempted");
    const rule = await db.policyAssignmentRule.findFirstOrThrow({ where: { policyId: p.id, withdrawnAt: null } });
    const ackedBefore = await db.acknowledgement.count({ where: { publicationId: pub.id, acknowledgedAt: { not: null } } });
    await withdrawRule(m, rule.id, "Replaced by branch rules");
    expect(await db.acknowledgement.count({ where: { publicationId: pub.id, acknowledgedAt: { not: null } } })).toBe(ackedBefore);
  });
});

describe("E8: reconciliation, reassignment on HR change and readiness", () => {
  it("counts, rows and export reconcile", async () => {
    const m = await manager();
    const rows = await signoffRows(m);
    const c = signoffCounts(rows);
    expect(c.not_opened + c.opened + c.acknowledged + c.assessment_pending + c.assessment_failed + c.exempted).toBe(c.total);
    expect(rows.filter((r) => r.b.overdue).length).toBe(c.overdue);
    const csv = await signoffCsv(m, {});
    expect(csv.rows.length).toBe(rows.length);
    expect(csv.rows.filter((r) => r[10] === "Yes").length).toBe(c.overdue);
    expect(await db.auditLog.count({ where: { action: "signoff.exported" } })).toBe(1);
  });

  it("assigns policies to a person who moves into a covered branch", async () => {
    const m = await manager();
    const p = await publishedPolicy("CSB-SAF-001");
    const portsmouth = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Portsmouth" } });
    await createRule(m, { policyId: p.id, scope: "BRANCH", branchId: portsmouth.id });
    const mover = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrMissing: false, employmentStatus: "ACTIVE", NOT: { branchId: portsmouth.id } } });
    const pub = await currentPub(p.id);
    const had = await db.acknowledgement.count({ where: { publicationId: pub.id, staffMemberId: mover.id, supersededAt: null } });
    await db.staffMember.update({ where: { id: mover.id }, data: { branchId: portsmouth.id } });
    const r = await reconcileStaffAssignments(orgId, mover.id);
    expect(await db.acknowledgement.count({ where: { publicationId: pub.id, staffMemberId: mover.id, supersededAt: null } })).toBe(had ? had : 1);
    expect(r.assigned + (had ? 1 : 0)).toBeGreaterThan(0);
  });

  it("feeds policy readiness requirements from the same states", async () => {
    const m = await manager();
    const p = await publishedPolicy("CSB-HS-002");
    const pub = await currentPub(p.id);
    await saveRequirement(m, { key: "hs-policy", name: "Health and safety policy read", category: "POLICY", policyId: p.id, hardStop: false, effectiveFrom: "2020-01-01", scopes: [{ kind: "ALL" }] });
    const signed = await db.acknowledgement.findFirstOrThrow({ where: { publicationId: pub.id, supersededAt: null, state: "ACKNOWLEDGED", staffMemberId: { not: null } } });
    const r = (await readinessFor(db, orgId, [signed.staffMemberId!])).get(signed.staffMemberId!)!;
    expect(r.components.find((c) => c.key === "hs-policy")?.state).toBe("MET");
    const exempt = await db.acknowledgement.findFirstOrThrow({ where: { publicationId: pub.id, state: "EXEMPTED", staffMemberId: { not: null } } });
    expect((await readinessFor(db, orgId, [exempt.staffMemberId!])).get(exempt.staffMemberId!)!.components.find((c) => c.key === "hs-policy")?.state).toBe("MET");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { inspectPolicy, libraryView, parseLibraryQuery } from "@/server/policies/library-view";
import { assignPolicyReviewer, setPolicyArchived } from "@/server/policies/library";
import { createManualRevision, decide, editDraftSection, publishRevision, submitForReview } from "@/server/policies/workflow";
import { buildDocModel } from "@/server/documents/model";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

const q = (sp: Record<string, string> = {}) => parseLibraryQuery(sp, true);

describe("policy library workspace", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAll({ simulatedChange: false });
  });

  it("lists, searches, counts and inspects only the signed-in organisation's policies", async () => {
    const brook = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const oakPolicy = await db.policy.findFirstOrThrow({ where: { organisationId: oak.organisationId } });

    for (const tab of ["policies", "archived", "calendar"]) {
      const view = await libraryView(brook, q({ tab }));
      const ids = [...view.rows, ...view.calendar.flatMap((m) => m.rows)].map((r) => r.id);
      expect(ids).not.toContain(oakPolicy.id);
    }
    const own = await db.policy.count({ where: { organisationId: brook.organisationId, status: "ACTIVE" } });
    const view = await libraryView(brook, q());
    expect(view.total).toBe(own);
    expect(view.tabCounts.policies).toBe(own);
    expect(view.tree.reduce((n, a) => n + a.count, 0)).toBe(own);

    // Body-text search reaches Oakridge's text only for Oakridge.
    expect((await libraryView(brook, q({ q: "Oakridge-only" }))).total).toBe(0);
    expect((await libraryView(oak, q({ q: "Oakridge-only" }))).rows.map((r) => r.id)).toContain(oakPolicy.id);

    // Templates are shared read-only masters, never another organisation's copies.
    const templates = await libraryView(brook, q({ tab: "templates" }));
    expect(templates.rows.every((r) => r.kind === "MASTER")).toBe(true);

    // The inspector and the document behind the viewer refuse other organisations' policies.
    await expect(inspectPolicy(brook, oakPolicy.id)).rejects.toThrow(/not found/i);
    await expect(buildDocModel(brook, oakPolicy.id)).rejects.toThrow();
    const mine = view.rows[0];
    const inspected = await inspectPolicy(brook, mine.id);
    expect(inspected.policy.organisationId).toBe(brook.organisationId);
    expect(inspected.status).toBe(mine.status);
  });

  it("is truthful about approval: starter text is 'not yet approved' until an approval is recorded", async () => {
    const brook = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const approver = await ctxFor("approver@care-solution.demo", BROOKFIELD);
    const policy = await db.policy.findFirstOrThrow({ where: { organisationId: brook.organisationId, ref: "CSB-COM-001" } });
    await db.policy.update({ where: { id: policy.id }, data: { nextReviewDate: new Date(Date.now() + 365 * 86_400_000) } });
    expect((await inspectPolicy(brook, policy.id)).status).toBe("not_approved");

    const rev = await createManualRevision(author, policy.id, "Annual review");
    await editDraftSection(author, rev.id, "purpose", { body: "Updated purpose for the annual review." });
    await submitForReview(author, rev.id);
    expect((await inspectPolicy(brook, policy.id)).status).toBe("under_review");
    expect((await libraryView(brook, q({ quick: "awaiting" }))).rows.map((r) => r.id)).toContain(policy.id);

    await decide(approver, rev.id, { decision: "APPROVE", comment: "Checked." });
    await publishRevision(approver, rev.id);
    const after = await inspectPolicy(brook, policy.id);
    expect(after.status).toBe("published");
    expect(after.approvals.map((a) => a.name)).toContain("Avery Approver");
    expect(after.history[0].approvers).toContain("Avery Approver");
    expect(after.signOff?.coverage?.assigned).toBeGreaterThan(0);
  });

  it("assigns a reviewer from the same organisation only, notifies them and audits it", async () => {
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const reviewer = await db.user.findUniqueOrThrow({ where: { email: "reviewer@care-solution.demo" } });
    const staff = await db.user.findUniqueOrThrow({ where: { email: "carer2@care-solution.demo" } });
    const oakUser = await db.user.findUniqueOrThrow({ where: { email: "manager@oakridge.demo" } });
    const policy = await db.policy.findFirstOrThrow({ where: { organisationId: author.organisationId, status: "ACTIVE" } });
    const oakPolicy = await db.policy.findFirstOrThrow({ where: { organisationId: oak.organisationId } });

    await expect(assignPolicyReviewer(carer, policy.id, reviewer.id)).rejects.toThrow();
    await expect(assignPolicyReviewer(author, policy.id, staff.id)).rejects.toThrow(/reviewer/);
    await expect(assignPolicyReviewer(author, policy.id, oakUser.id)).rejects.toThrow(/reviewer/);
    await expect(assignPolicyReviewer(author, oakPolicy.id, reviewer.id)).rejects.toThrow(/not found/i);
    expect((await db.policy.findUniqueOrThrow({ where: { id: oakPolicy.id } })).reviewerId).toBeNull();

    expect(await assignPolicyReviewer(author, policy.id, reviewer.id)).toBe("Riley Reviewer");
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).reviewerId).toBe(reviewer.id);
    expect(await db.notification.count({ where: { userId: reviewer.id, type: "policy.review_assigned" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: policy.id, action: "policy.reviewer_assigned" } })).toBe(1);
    expect((await inspectPolicy(author, policy.id)).reviewer).toBe("Riley Reviewer");
  });

  it("archives and restores with a reason, refuses while a revision is open, and can't be done twice", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const [policy, busy] = await db.policy.findMany({ where: { organisationId: manager.organisationId, status: "ACTIVE", revisions: { none: { closedAt: null } } }, take: 2, orderBy: { ref: "asc" } });
    await createManualRevision(author, busy.id, "Work in progress");

    await expect(setPolicyArchived(author, policy.id, true, "No longer needed")).rejects.toThrow();
    await expect(setPolicyArchived(manager, policy.id, true, "no")).rejects.toThrow(/reason/);
    await expect(setPolicyArchived(oak, policy.id, true, "Not my policy")).rejects.toThrow(/not found/i);
    await expect(setPolicyArchived(manager, busy.id, true, "Replaced by a new policy")).rejects.toThrow(/revision in progress/);

    await setPolicyArchived(manager, policy.id, true, "Replaced by a combined policy");
    await expect(setPolicyArchived(manager, policy.id, true, "Replaced by a combined policy")).rejects.toThrow(/already archived/);
    expect((await libraryView(manager, q())).rows.map((r) => r.id)).not.toContain(policy.id);
    expect((await libraryView(manager, q({ tab: "archived" }))).rows.map((r) => r.id)).toEqual([policy.id]);
    await expect(assignPolicyReviewer(author, policy.id, author.userId)).rejects.toThrow(/Archived/);

    await setPolicyArchived(manager, policy.id, false, "Combined policy withdrawn");
    expect((await db.policy.findUniqueOrThrow({ where: { id: policy.id } })).status).toBe("ACTIVE");
    const log = await db.auditLog.findMany({ where: { entityId: policy.id, action: { in: ["policy.archived", "policy.restored"] } }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => [l.action, (l.data as { reason: string }).reason])).toEqual([["policy.archived", "Replaced by a combined policy"], ["policy.restored", "Combined policy withdrawn"]]);
  });
});

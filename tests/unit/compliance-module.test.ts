import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Ctx } from "@/server/auth/rbac";
import { activeEntryHref } from "@/lib/navigation";
import { complianceItems, workspaceHome, workspaceTabs } from "@/components/compliance-nav";
import { riskBand, riskRating, riskReviewOverdue } from "@/server/compliance/risks";
import { signoffByGroup, type SignoffRow } from "@/server/policies/assignment";
import { policyStatus } from "@/server/policies/library-view";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });
const manager = ctx({ orgRoles: ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER"] });
const carer = ctx({ orgRoles: ["STAFF", "CARER"] });
const i = { size: 16 };
const p = (s = "") => new URLSearchParams(s);

describe("Policy & Compliance sidebar: six workspaces", () => {
  it("gives a manager exactly the six entries, in the agreed order", () => {
    expect(complianceItems(manager, i).map((x) => x.label)).toEqual(["Compliance Dashboard", "Policy Library", "Regulatory Monitoring", "Staff Sign-off", "Audits & Improvements", "Compliance Reports"]);
  });

  it("shows a carer only what they may open: no reports, no audits workspace, sign-off goes to their reading list", () => {
    const items = complianceItems(carer, i);
    expect(items.map((x) => x.label)).not.toContain("Compliance Reports");
    expect(items.find((x) => x.label === "Staff Sign-off")?.href).toBe("/acknowledgements");
    expect(workspaceTabs(carer, "signoff").map((t) => t.label)).toEqual(["My Reading List"]);
    expect(workspaceTabs(carer, "improvements").map((t) => t.label)).toEqual(["Corrective Actions"]);
  });

  it("lists every workspace's tabs for a manager", () => {
    expect(workspaceTabs(manager, "library").map((t) => t.label)).toEqual(["My Policies", "Templates", "Archived", "Review Calendar", "Review & Approval Queue"]);
    expect(workspaceTabs(manager, "regulatory").map((t) => t.href)).toEqual(["/changes", "/requirements", "/compliance/regulatory/sources"]);
    expect(workspaceTabs(manager, "signoff").map((t) => t.label)).toEqual(["Overview", "By Employee", "By Policy", "Overdue", "Assignment Rules", "My Reading List"]);
    expect(workspaceTabs(manager, "improvements").map((t) => t.label)).toEqual(["Audits & Inspections", "Corrective Actions", "Risk Register", "Evidence Library"]);
    expect(workspaceHome(manager, "improvements")).toBe("/audits");
  });

  it("keeps the right entry lit on old addresses and on each workspace's tab pages", () => {
    const entries = complianceItems(manager, i);
    expect(activeEntryHref(entries, "/", p())).toBe("/");
    expect(activeEntryHref(entries, "/queue", p())).toBe("/policies");
    expect(activeEntryHref(entries, "/revisions/abc", p())).toBe("/policies");
    expect(activeEntryHref(entries, "/changes/abc", p())).toBe("/compliance/regulatory");
    expect(activeEntryHref(entries, "/requirements", p())).toBe("/compliance/regulatory");
    expect(activeEntryHref(entries, "/compliance/regulatory/sources", p())).toBe("/compliance/regulatory");
    expect(activeEntryHref(entries, "/staff/rules", p())).toBe("/staff");
    expect(activeEntryHref(entries, "/acknowledgements", p())).toBe("/staff");
    expect(activeEntryHref(entries, "/actions/x1", p())).toBe("/compliance/improvements");
    expect(activeEntryHref(entries, "/evidence", p())).toBe("/compliance/improvements");
    expect(activeEntryHref(entries, "/compliance/risks/r1", p())).toBe("/compliance/improvements");
    expect(activeEntryHref(entries, "/compliance/reports", p("kind=risks"))).toBe("/compliance/reports");
    expect(activeEntryHref(entries, "/rota", p())).toBeUndefined();
  });
});

describe("risk scoring: 5 x 5 matrix", () => {
  it("multiplies likelihood by impact and rejects scores outside 1 to 5", () => {
    expect(riskRating(3, 4)).toBe(12);
    expect(() => riskRating(0, 3)).toThrow(/1 to 5/);
    expect(() => riskRating(6, 1)).toThrow(/1 to 5/);
    expect(() => riskRating(2.5, 2)).toThrow(/1 to 5/);
  });

  it("bands the rating at the documented boundaries", () => {
    expect([1, 3, 4, 6, 8, 12, 15, 25].map(riskBand)).toEqual(["LOW", "LOW", "MODERATE", "MODERATE", "HIGH", "HIGH", "EXTREME", "EXTREME"]);
  });

  it("treats a closed risk as never overdue for review", () => {
    const past = new Date("2026-01-01");
    const now = new Date("2026-06-01");
    expect(riskReviewOverdue({ status: "OPEN", reviewDate: past }, now)).toBe(true);
    expect(riskReviewOverdue({ status: "CLOSED", reviewDate: past }, now)).toBe(false);
    expect(riskReviewOverdue({ status: "MONITORING", reviewDate: new Date("2026-07-01") }, now)).toBe(false);
  });
});

describe("policy statuses are distinct", () => {
  const now = new Date("2026-11-01");
  const base = { currentPublishedVersion: { approved: true }, openRevision: null, nextReviewDate: new Date("2027-11-01") };
  it("separates starter template, draft, under review, approved, published, review due, overdue and archived", () => {
    expect(policyStatus({ ...base, starterTemplate: true }, now)).toBe("template");
    expect(policyStatus({ ...base, currentPublishedVersion: null }, now)).toBe("draft");
    expect(policyStatus({ ...base, openRevision: { submittedAt: now, draftStatus: "UNDER_REVIEW" } }, now)).toBe("under_review");
    expect(policyStatus({ ...base, openRevision: { submittedAt: now, draftStatus: "APPROVED" } }, now)).toBe("approved");
    expect(policyStatus(base, now)).toBe("published");
    expect(policyStatus({ ...base, nextReviewDate: new Date("2026-11-20") }, now)).toBe("review_due");
    expect(policyStatus({ ...base, nextReviewDate: new Date("2026-10-01") }, now)).toBe("overdue");
    expect(policyStatus({ ...base, archived: true, starterTemplate: true }, now)).toBe("archived");
  });
});

describe("sign-off by branch and role", () => {
  const row = (branch: string | null, bucket: string, extra: Partial<SignoffRow["b"]> = {}) =>
    ({ staffMember: branch ? { branch: { name: branch }, jobTitle: "Carer" } : null, b: { bucket, outstanding: bucket !== "acknowledged" && bucket !== "exempted", overdue: false, cannotSign: false, ...extra } }) as unknown as SignoffRow;
  it("counts completion against people still required to read, and leaves out superseded rows", () => {
    const g = signoffByGroup([row("Liverpool", "acknowledged"), row("Liverpool", "not_opened", { overdue: true }), row("Liverpool", "exempted"), row("Liverpool", "superseded"), row(null, "acknowledged")], "branch");
    expect(g[0]).toMatchObject({ name: "Liverpool", assigned: 3, acknowledged: 1, overdue: 1, completion: 50 });
    expect(g[1]).toMatchObject({ name: "No branch recorded", assigned: 1, completion: 100 });
  });
});

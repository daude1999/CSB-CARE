import { describe, expect, it } from "vitest";
import { canOnPolicy, hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { verifyQuote } from "@/server/ai/citations";
import { applyEdits } from "@/server/policies/revise";
import { mergeMasterUpdate } from "@/server/policies/sync";
import { diffPolicySections } from "@/server/policies/versions";
import { backoffMs } from "@/server/jobs/queue";
import { auditScore } from "@/server/compliance/audits";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], ...over });

describe("authorisation", () => {
  it("separates author and approver permissions", () => {
    const author = ctx({ orgRoles: ["POLICY_AUTHOR"] });
    expect(hasOrgPermission(author, "policy.author")).toBe(true);
    expect(hasOrgPermission(author, "policy.approve")).toBe(false);
  });
  it("denies access to another organisation's policy regardless of role", () => {
    const admin = ctx({ orgRoles: ["ORG_ADMIN", "POLICY_APPROVER"] });
    expect(canOnPolicy(admin, { kind: "CUSTOMER", organisationId: "org2" }, "read")).toBe(false);
    expect(canOnPolicy(admin, { kind: "CUSTOMER", organisationId: "org1" }, "approve")).toBe(true);
  });
  it("governs master templates by platform roles only", () => {
    const orgAdmin = ctx({ orgRoles: ["ORG_ADMIN", "POLICY_AUTHOR"] });
    expect(canOnPolicy(orgAdmin, { kind: "MASTER", organisationId: null }, "read")).toBe(true);
    expect(canOnPolicy(orgAdmin, { kind: "MASTER", organisationId: null }, "author")).toBe(false);
    expect(canOnPolicy(ctx({ platformRoles: ["REGULATORY_REVIEWER"] }), { kind: "MASTER", organisationId: null }, "approve")).toBe(true);
  });
});

describe("citation verification", () => {
  const sections = [{ ref: "a", heading: "A", text: "Providers must notify the team within 24 hours of a concern." }];
  it("verifies verbatim quotes", () => {
    expect(verifyQuote("notify the team within 24 hours", sections, "a").verified).toBe(true);
  });
  it("rejects invented quotes", () => {
    const r = verifyQuote("Providers must notify within 12 hours", sections, "a");
    expect(r.verified).toBe(false);
    expect(r.note).toMatch(/NOT found/);
  });
  it("notes a wrong section reference", () => {
    expect(verifyQuote("notify the team within 24 hours", sections, "zzz").note).toMatch(/not the cited/);
  });
});

describe("revision edit validation", () => {
  const base = [
    { key: "purpose", heading: "Purpose", body: "Keep people safe." },
    { key: "procedure", heading: "Procedure", body: "Refer within 48 hours." },
    { key: "local", heading: "Local contacts", body: "Call 01632 960000", isLocal: true },
  ];
  const source = [{ ref: "r", heading: "R", text: "Providers must refer within 24 hours." }];
  const cite = [{ sectionRef: "r", quote: "Providers must refer within 24 hours." }];
  const edit = (e: object) => ({ summary: "s", conflicts: [], uncertainties: [], edits: [{ operation: "modify" as const, heading: null, insertAfterKey: null, rationale: "r", citations: cite, newBody: "x", sectionKey: "procedure", ...e }] });

  it("applies a supported minimal edit and leaves other sections untouched", () => {
    const { sections, validation } = applyEdits(base, edit({ newBody: "Refer within 24 hours." }), source, { provider: "t", simulated: true });
    expect(sections.find((s) => s.key === "procedure")?.body).toBe("Refer within 24 hours.");
    expect(sections.find((s) => s.key === "purpose")?.body).toBe("Keep people safe.");
    expect(validation.unchangedSectionsVerified).toBe(true);
    expect(validation.applied).toHaveLength(1);
  });
  it("never modifies customer-specific sections", () => {
    const { sections, validation } = applyEdits(base, edit({ sectionKey: "local", newBody: "Call someone else" }), source, { provider: "t", simulated: true });
    expect(sections.find((s) => s.key === "local")?.body).toBe("Call 01632 960000");
    expect(validation.rejected[0]?.reason).toMatch(/Customer-specific/);
  });
  it("rejects edits whose citations cannot be verified", () => {
    const { validation } = applyEdits(base, edit({ newBody: "Refer within 6 hours.", citations: [{ sectionRef: "r", quote: "Providers must refer within 6 hours." }] }), source, { provider: "t", simulated: true });
    expect(validation.applied).toHaveLength(0);
    expect(validation.rejected[0]?.reason).toMatch(/verified/);
  });
  it("rejects edits without citations and to unknown sections", () => {
    expect(applyEdits(base, edit({ citations: [] }), source, { provider: "t", simulated: true }).validation.rejected[0]?.reason).toMatch(/no supporting citation/);
    expect(applyEdits(base, edit({ sectionKey: "nope" }), source, { provider: "t", simulated: true }).validation.rejected[0]?.reason).toMatch(/does not exist/);
  });
  it("warns about large rewrites and unsupported statements", () => {
    const { validation } = applyEdits(base, edit({ newBody: "Completely different wording describing quarterly governance committee arrangements and budgets." }), source, { provider: "t", simulated: true });
    expect(validation.warnings.join(" ")).toMatch(/rewritten/);
    expect(validation.unsupportedStatements.length).toBeGreaterThan(0);
  });
});

describe("policy diff", () => {
  it("shows added, removed and modified sections", () => {
    const d = diffPolicySections(
      [{ key: "a", heading: "A", body: "one two" }, { key: "b", heading: "B", body: "gone" }],
      [{ key: "a", heading: "A", body: "one three" }, { key: "c", heading: "C", body: "new" }],
    );
    expect(d.map((x) => [x.key, x.status])).toEqual([["a", "modified"], ["c", "added"], ["b", "removed"]]);
    expect(d[0]?.parts.some((p) => p.added && p.value.includes("three"))).toBe(true);
  });
});

describe("master to customer merge", () => {
  const m0 = [
    { key: "purpose", heading: "Purpose", body: "P0" },
    { key: "procedure", heading: "Procedure", body: "Refer within 48 hours." },
    { key: "records", heading: "Records", body: "R0" },
  ];
  const m1 = [
    { key: "purpose", heading: "Purpose", body: "P1" },
    { key: "procedure", heading: "Procedure", body: "Refer within 24 hours." },
    { key: "records", heading: "Records", body: "R0" },
    { key: "training", heading: "Training", body: "New training section" },
  ];
  const customer = [
    { key: "purpose", heading: "Purpose", body: "P0", masterKey: "purpose" },
    { key: "procedure", heading: "Procedure", body: "Refer within 48 hours, using our local form.", masterKey: "procedure" },
    { key: "records", heading: "Records", body: "R0", masterKey: "records" },
    { key: "local.contacts", heading: "Local contacts", body: "Call Morgan", isLocal: true },
  ];
  it("applies safe changes, preserves customisations and local sections, and flags conflicts", () => {
    const { sections, report } = mergeMasterUpdate(m0, m1, customer);
    expect(sections.find((s) => s.key === "purpose")?.body).toBe("P1");
    expect(sections.find((s) => s.key === "procedure")?.body).toBe("Refer within 48 hours, using our local form.");
    expect(sections.find((s) => s.key === "local.contacts")?.body).toBe("Call Morgan");
    expect(sections.some((s) => s.key === "training")).toBe(true);
    expect(report.conflicts.map((c) => c.key)).toEqual(["procedure"]);
    expect(report.safeApplied.map((c) => c.masterKey)).toEqual(["purpose"]);
  });
});

describe("misc", () => {
  it("backoff grows exponentially with bounded jitter", () => {
    expect(backoffMs(1, 1000, 1e9, () => 0.5)).toBe(1000);
    expect(backoffMs(3, 1000, 1e9, () => 0.5)).toBe(4000);
    expect(backoffMs(30, 1000, 5000, () => 0.5)).toBe(5000);
  });
  it("audit score ignores not-applicable answers", () => {
    expect(auditScore([{ response: "MET" }, { response: "NOT_MET" }, { response: "NOT_APPLICABLE" }])).toBe(50);
    expect(auditScore([])).toBeNull();
  });
  it("audit score is withheld while any question is unanswered, so nothing defaults to met", () => {
    expect(auditScore([{ response: "MET" }], 20)).toBeNull();
    expect(auditScore([{ response: "MET" }, { response: "NOT_APPLICABLE" }], 2)).toBe(100);
    expect(auditScore([{ response: "NOT_APPLICABLE" }], 1)).toBeNull();
  });
});

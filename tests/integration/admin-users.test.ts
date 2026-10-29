import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { auditCsv, auditPage } from "@/server/admin/audit-viewer";
import { createResetLink, deactivateMember, describeToken, inviteMember, listMembers, reactivateMember, redeemToken, revokeInvite, updateMember } from "@/server/admin/users";
import { ctxFromToken, login } from "@/server/auth/session";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** User administration and the audit log against a real database: invitations, roles, deactivation, resets, scope. */
const admin = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const PASSWORD = "a long enough password 2026";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("invitations", () => {
  it("invites a new person who sets their own password and joins with the given roles and branches", async () => {
    const liverpool = await db.branch.findFirstOrThrow({ where: { organisationId: orgId, name: "Liverpool" } });
    await expect(inviteMember(await admin(), { email: "not-an-email", name: "Sam", roles: ["CARER"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(inviteMember(await admin(), { email: "sam@example.test", name: "Sam", roles: ["SUPERUSER"] })).rejects.toBeInstanceOf(ValidationError);
    const { token } = await inviteMember(await admin(), { email: "Sam.New@Example.test", name: "Sam New", roles: ["CARE_COORDINATOR"], branchIds: [liverpool.id] });
    // Only the hash is stored.
    expect(await db.accountToken.count({ where: { tokenHash: token } })).toBe(0);
    expect((await describeToken(token))?.needsName).toBe(true);
    await expect(redeemToken(token, { password: "short" })).rejects.toBeInstanceOf(ValidationError);
    await redeemToken(token, { password: PASSWORD, name: "Sam New" });
    await expect(redeemToken(token, { password: PASSWORD })).rejects.toThrow(/expired or has already been used/);
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "sam.new@example.test" } }, include: { branches: true } });
    expect(m.roles).toEqual(["CARE_COORDINATOR"]);
    expect(m.branches.map((b) => b.branchId)).toEqual([liverpool.id]);
    const s = await login("sam.new@example.test", PASSWORD);
    expect((await ctxFromToken(s.token))?.branchIds).toEqual([liverpool.id]);
  });

  it("refuses inviting an existing member, and a revoked invitation cannot be used", async () => {
    await expect(inviteMember(await admin(), { email: "coordinator@care-solution.demo", name: "Again", roles: ["CARER"] })).rejects.toBeInstanceOf(ConflictError);
    const { token } = await inviteMember(await admin(), { email: "revoked@example.test", name: "Revoked", roles: ["STAFF"] });
    const invite = (await listMembers(await admin())).invites.find((i) => i.email === "revoked@example.test")!;
    await revokeInvite(await admin(), invite.id);
    expect(await describeToken(token)).toBeNull();
    await expect(redeemToken(token, { password: PASSWORD })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("members", () => {
  it("changes roles, keeps at least one admin and never lets an admin deactivate themselves", async () => {
    const me = await admin();
    const mine = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: me.userId } });
    await expect(deactivateMember(me, mine.id, "Leaving")).rejects.toBeInstanceOf(ForbiddenError);
    const admins = await db.membership.findMany({ where: { organisationId: orgId, roles: { has: "ORG_ADMIN" }, deactivatedAt: null } });
    if (admins.length === 1) await expect(updateMember(me, mine.id, { roles: ["CARE_MANAGER"] })).rejects.toBeInstanceOf(ConflictError);
    const coord = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await updateMember(me, coord.id, { roles: ["CARE_COORDINATOR", "CARER"], jobTitle: "Senior coordinator" });
    expect((await db.membership.findUniqueOrThrow({ where: { id: coord.id } })).jobTitle).toBe("Senior coordinator");
    await updateMember(me, coord.id, { roles: coord.roles, jobTitle: coord.jobTitle ?? "" });
  });

  it("deactivates a member: roles cleared, sessions ended, sign-in no longer reaches the organisation; reactivation restores roles", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "sam.new@example.test" } } });
    const s = await login("sam.new@example.test", PASSWORD);
    await expect(deactivateMember(await admin(), m.id, "")).rejects.toBeInstanceOf(ValidationError);
    await deactivateMember(await admin(), m.id, "Left the company");
    expect(await ctxFromToken(s.token)).toBeNull();
    const again = await login("sam.new@example.test", PASSWORD);
    const ctx = await ctxFromToken(again.token);
    expect(ctx?.organisationId).toBeNull();
    expect(ctx?.orgRoles).toEqual([]);
    await reactivateMember(await admin(), m.id);
    expect((await db.membership.findUniqueOrThrow({ where: { id: m.id } })).roles).toEqual(["CARE_COORDINATOR"]);
  });

  it("creates a one-time reset link that changes the password and ends sessions; demo accounts are refused", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "sam.new@example.test" } } });
    const s = await login("sam.new@example.test", PASSWORD);
    const { token } = await createResetLink(await admin(), m.id);
    await redeemToken(token, { password: "a different long password" });
    expect(await ctxFromToken(s.token)).toBeNull();
    await expect(login("sam.new@example.test", PASSWORD)).rejects.toThrow();
    const demo = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "coordinator@care-solution.demo" } } });
    await expect(createResetLink(await admin(), demo.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not let one organisation's admin change another organisation's members", async () => {
    const other = await db.membership.findFirstOrThrow({ where: { organisation: { slug: OAKRIDGE } } });
    await expect(updateMember(await admin(), other.id, { roles: ["STAFF"] })).rejects.toThrow(/not found/i);
    await expect(deactivateMember(await admin(), other.id, "Not mine")).rejects.toThrow(/not found/i);
    await expect(listMembers(await ctxFor("coordinator@care-solution.demo", BROOKFIELD))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("audit log viewer", () => {
  it("shows only this organisation's entries, filters them and audits the export", async () => {
    const page = await auditPage(await admin(), { action: "admin.member" });
    expect(page.total).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.organisationId === orgId && r.action.includes("admin.member"))).toBe(true);
    const csv = await auditCsv(await admin(), { action: "admin.member.deactivated" });
    expect(csv.split("\n")[0]).toBe("When (UTC),Who,Action,Record type,Record id,Details");
    expect(csv).toContain("admin.member.deactivated");
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "admin.audit.exported" } })).toBe(1);
    await expect(auditPage(await ctxFor("coordinator@care-solution.demo", BROOKFIELD), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

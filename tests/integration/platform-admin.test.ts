import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createResetLink, describeToken, redeemToken, updateMember } from "@/server/admin/users";
import { ctxFromToken, ctxForUser, login } from "@/server/auth/session";
import { hasOrgPermission } from "@/server/auth/rbac";
import { hashPassword } from "@/server/auth/password";
import { AiUnavailableError, type LlmProvider } from "@/server/ai/provider";
import { meteredProvider, noteAiTokens, runForTenant } from "@/server/ai/metering";
import { ensureCustomerAccounts, getClient, listClients, updateCompanyDetails, markCqcChecked } from "@/server/platform/customers";
import { provisionClient, type OnboardingInput } from "@/server/platform/onboarding";
import { changeSubscription, savePlan, setCustomerStatus, subscriptionHistory } from "@/server/platform/subscriptions";
import { setClientModule, setClientModuleLimits } from "@/server/platform/modules";
import {
  deactivateAccount, getAccount, platformResetLink, requirePasswordReset, revokeAllSessions, setPlatformRoles, updateMembershipAsPlatform,
} from "@/server/platform/accounts";
import { decideSupportAccess, emergencySupportAccess, requestSupportAccess, requireSupportScope, revokeSupportAccess } from "@/server/platform/support";
import { getSetting, updateSettings } from "@/server/platform/settings";
import { clientAudit, securityAudit } from "@/server/platform/activity";
import { aiUsage } from "@/server/platform/usage";
import { platformHealth } from "@/server/platform/health";
import { recurringRevenue } from "@/server/platform/subscriptions";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Evantix Platform Admin Centre against a real database, on synthetic clients and fictional people only:
 * onboarding, client records, subscriptions, module entitlements, account recovery, roles, AI metering, support access,
 * settings and the security audit, with the tenant and platform boundaries they must keep.
 */
const DEMO_PW = "DemoPassword!2026";
const PW = "a long enough password 2026";
const platform = () => ctxFor("admin@csb.demo");
const orgAdmin = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let csbId = "";
let oakId = "";
let planId = "";

const key = () => randomBytes(12).toString("hex");
function onboarding(over: Partial<OnboardingInput> & { legalName?: string; adminEmail?: string } = {}): OnboardingInput {
  const { legalName, adminEmail, ...rest } = over;
  return {
    onboardingKey: key(),
    company: { legalName: legalName ?? "Fictional Homecare Ltd", tradingName: null, companyNumber: null, address: "1 Example Street, Testtown", contactEmail: "office@fictional.example", contactPhone: "01234 567890", country: "England", mainContactName: "Alex Example", serviceTypes: ["Domiciliary care"], cqcProviderId: "1-000000001", cqcLocationIds: [] },
    subscription: { planId, status: "TRIAL", billingPeriod: "MONTHLY", trialEndsAt: new Date(Date.now() + 30 * 86400_000), renewsAt: null, userAllowance: 10, branchAllowance: 2, storageMb: 500, aiRequestsPerMonth: 100 },
    modules: ["ROTA", "SERVICE_USERS", "HR", "POLICY", "REPORTING"],
    admin: { name: "Robin Fictional", email: adminEmail ?? "robin@fictional.example", jobTitle: "Registered manager", roles: ["ORG_ADMIN"] },
    branches: ["North office", "South office"],
    ...rest,
  };
}

/** A non-demo person (demo accounts refuse resets) with a password, in one or more organisations. */
async function person(email: string, orgs: { id: string; roles: ("ORG_ADMIN" | "CARER" | "CARE_COORDINATOR")[] }[], platformRoles: ("PLATFORM_ADMIN")[] = []) {
  const u = await db.user.create({ data: { email, name: email.split("@")[0]!, passwordHash: await hashPassword(PW), isDemo: false, platformRoles } });
  for (const o of orgs) await db.membership.create({ data: { userId: u.id, organisationId: o.id, roles: o.roles } });
  return u;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
  await ensureCustomerAccounts();
  csbId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  oakId = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
  planId = (await savePlan(await platform(), null, { code: "CORE", name: "Core (synthetic)", description: null, monthlyPricePence: null, annualPricePence: null, includedUsers: 25, includedBranches: 3, storageMb: 1000, aiRequestsPerMonth: 200, modules: ["ROTA", "SERVICE_USERS", "HR", "POLICY"], supportLevel: null, addOns: [], active: true })).id;
}, 180_000);

describe("who can use the Admin Centre", () => {
  it("refuses every platform function to an organisation administrator, however the request is made", async () => {
    const a = await orgAdmin();
    await expect(listClients(a)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getClient(a, oakId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(provisionClient(a, onboarding())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setClientModule(a, oakId, "ROTA", { enabled: false, reason: "trying" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(platformResetLink(a, (await db.user.findUniqueOrThrow({ where: { email: "manager@oakridge.demo" } })).id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(aiUsage(a)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gives the platform administrator no organisation permission, so care and service-user records stay closed", async () => {
    const p = await ctxForUser((await db.user.findUniqueOrThrow({ where: { email: "admin@csb.demo" } })).id, null);
    expect(p.organisationId).toBeNull();
    expect(hasOrgPermission(p, "serviceUser.view")).toBe(false);
    expect(hasOrgPermission(p, "medication.view")).toBe(false);
  });

  it("gives every existing organisation a customer account with a reference, and a missing client is a 404", async () => {
    const accounts = await db.customerAccount.findMany({ where: { organisationId: { in: [csbId, oakId] } } });
    expect(accounts).toHaveLength(2);
    for (const a of accounts) expect(a.reference).toMatch(/^EVX-\d{4}$/);
    await expect(getClient(await platform(), "no-such-org")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Add New Client", () => {
  let created = "";

  it("creates the organisation, account, branches, subscription, modules and a one-time admin invitation in one go, with no password", async () => {
    const r = await provisionClient(await platform(), onboarding());
    created = r.organisationId;
    expect(r.reused).toBe(false);
    expect(r.token).toBeTruthy();
    const org = await db.organisation.findUniqueOrThrow({ where: { id: created }, include: { branches: true, customerAccount: true, subscriptions: true, moduleEntitlements: true, memberships: true } });
    expect(org.isDemo).toBe(false);
    expect(org.customerAccount?.status).toBe("TRIAL");
    expect(org.customerAccount?.cqcCheckedAt).toBeNull(); // a CQC ID is recorded, not treated as verified
    expect(org.branches.map((b) => b.name).sort()).toEqual(["North office", "South office"]);
    expect(org.subscriptions.filter((s) => s.isCurrent)).toHaveLength(1);
    expect(org.moduleEntitlements.find((m) => m.moduleKey === "AI_COORDINATOR")?.enabled).toBe(false);
    expect(org.memberships).toHaveLength(0); // nobody exists until the administrator accepts
    expect(await db.user.findUnique({ where: { email: "robin@fictional.example" } })).toBeNull();
    // Only the hash is stored, and the link works once.
    expect(await db.accountToken.count({ where: { tokenHash: r.token! } })).toBe(0);
    await redeemToken(r.token!, { password: PW, name: "Robin Fictional" });
    await expect(redeemToken(r.token!, { password: PW })).rejects.toBeInstanceOf(ValidationError);
    const s = await login("robin@fictional.example", PW);
    const c = await ctxFromToken(s.token);
    expect(c?.organisationId).toBe(created);
    expect(c?.orgRoles).toEqual(["ORG_ADMIN"]);
    expect(c && hasOrgPermission(c, "rota.view")).toBe(true);
    expect(c?.disabledModules).toContain("AI_COORDINATOR");
  });

  it("returns the same client on a retried submission and refuses a duplicate company", async () => {
    const input = onboarding({ legalName: "Retry Care Ltd", adminEmail: "retry@fictional.example" });
    const first = await provisionClient(await platform(), input);
    const again = await provisionClient(await platform(), input);
    expect(again.organisationId).toBe(first.organisationId);
    expect(again.reused).toBe(true);
    expect(again.token).toBeNull();
    expect(await db.customerAccount.count({ where: { legalName: "Retry Care Ltd" } })).toBe(1);
    await expect(provisionClient(await platform(), onboarding({ legalName: "retry care ltd" }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a first administrator without the organisation admin role, a trial without an end date and an inactive plan", async () => {
    const p = await platform();
    await expect(provisionClient(p, onboarding({ legalName: "No Admin Ltd", admin: { name: "Sam", email: "sam@fictional.example", jobTitle: null, roles: ["CARER"] } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(provisionClient(p, onboarding({ legalName: "No Trial End Ltd", subscription: { planId, status: "TRIAL", billingPeriod: "MONTHLY", trialEndsAt: null, renewsAt: null, userAllowance: null, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(provisionClient(p, onboarding({ legalName: "Bad Plan Ltd", subscription: { planId: "nope", status: "ACTIVE", billingPeriod: "MONTHLY", trialEndsAt: null, renewsAt: null, userAllowance: null, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null } }))).rejects.toBeInstanceOf(ValidationError);
    expect(await db.organisation.count({ where: { name: { in: ["No Admin Ltd", "No Trial End Ltd", "Bad Plan Ltd"] } } })).toBe(0);
  });

  it("finds clients by search, status and plan, sorts and pages them", async () => {
    const p = await platform();
    const all = await listClients(p, {});
    expect(all.total).toBeGreaterThanOrEqual(4);
    expect((await listClients(p, { q: "Fictional Homecare" })).rows.map((r) => r.id)).toEqual([created]);
    expect((await listClients(p, { status: "TRIAL" })).rows.every((r) => r.status === "TRIAL")).toBe(true);
    expect((await listClients(p, { plan: "none" })).rows.map((r) => r.id)).toEqual(expect.arrayContaining([csbId, oakId]));
    const byRef = await listClients(p, { sort: "reference" });
    expect(byRef.rows.map((r) => r.reference)).toEqual([...byRef.rows.map((r) => r.reference)].sort());
  });

  it("edits company details, keeps company numbers unique and clears the CQC check when the provider ID changes", async () => {
    const p = await platform();
    const base = { legalName: "Fictional Homecare Ltd", tradingName: null, companyNumber: "FC123456", address: null, contactEmail: null, contactPhone: null, country: "England", mainContactName: null, serviceTypes: [], cqcProviderId: "1-000000001", cqcLocationIds: [] };
    await updateCompanyDetails(p, created, base);
    await markCqcChecked(p, created);
    expect((await db.customerAccount.findUniqueOrThrow({ where: { organisationId: created } })).cqcCheckedAt).not.toBeNull();
    await updateCompanyDetails(p, created, { ...base, cqcProviderId: "1-000000002" });
    expect((await db.customerAccount.findUniqueOrThrow({ where: { organisationId: created } })).cqcCheckedAt).toBeNull();
    await expect(updateCompanyDetails(p, oakId, { ...base, legalName: "Oakridge legal", companyNumber: "FC123456" })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateCompanyDetails(p, created, { ...base, cqcProviderId: "not an id" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("subscriptions, suspension and modules", () => {
  it("keeps every subscription period in the history, with one current period", async () => {
    const p = await platform();
    await changeSubscription(p, oakId, { planId, status: "ACTIVE", billingPeriod: "ANNUAL", trialEndsAt: null, renewsAt: new Date(Date.now() + 365 * 86400_000), userAllowance: null, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null }, "Signed annual contract");
    await changeSubscription(p, oakId, { planId, status: "ACTIVE", billingPeriod: "MONTHLY", trialEndsAt: null, renewsAt: null, userAllowance: 40, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null }, "Moved to monthly");
    const h = await subscriptionHistory(p, oakId);
    expect(h).toHaveLength(2);
    expect(h.filter((s) => s.isCurrent)).toHaveLength(1);
    expect(h.find((s) => !s.isCurrent)?.endedAt).not.toBeNull();
    await expect(changeSubscription(p, oakId, { planId, status: "ACTIVE", billingPeriod: "MONTHLY", trialEndsAt: null, renewsAt: null, userAllowance: null, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null }, "")).rejects.toBeInstanceOf(ValidationError);
    // Nothing is priced, so revenue is not configured rather than zero.
    expect((await recurringRevenue()).mrrPence).toBeNull();
  });

  it("suspends a client only with the administrator's password; its staff lose access and nothing is deleted; reinstating restores it", async () => {
    const p = await platform();
    const before = await db.membership.count({ where: { organisationId: oakId } });
    await expect(setCustomerStatus(p, oakId, "suspend", "Unpaid invoices (synthetic)", "wrong password")).rejects.toBeInstanceOf(ForbiddenError);
    await setCustomerStatus(p, oakId, "suspend", "Unpaid invoices (synthetic)", DEMO_PW);
    const oakAdmin = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    expect(oakAdmin.suspended).toBe(true);
    expect(hasOrgPermission(oakAdmin, "org.manage")).toBe(false);
    expect(oakAdmin.hrUserId).toBeNull();
    await expect(changeSubscription(p, oakId, { planId, status: "ACTIVE", billingPeriod: "MONTHLY", trialEndsAt: null, renewsAt: null, userAllowance: null, branchAllowance: null, storageMb: null, aiRequestsPerMonth: null }, "During suspension")).rejects.toBeInstanceOf(ConflictError);
    expect(await db.membership.count({ where: { organisationId: oakId } })).toBe(before);
    await setCustomerStatus(p, oakId, "reinstate", "Paid (synthetic)");
    expect((await ctxFor("manager@oakridge.demo", OAKRIDGE)).suspended).toBe(false);
    const log = await db.auditLog.findMany({ where: { organisationId: oakId, action: { startsWith: "platform.customer." } } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["platform.customer.suspended", "platform.customer.reinstated"]));
  });

  it("switches a module off on the server for that client only, asks for the client's name for a care module, and keeps the data", async () => {
    const p = await platform();
    await expect(setClientModule(p, oakId, "ROTA", { enabled: false, reason: "Client asked" })).rejects.toBeInstanceOf(ValidationError);
    await expect(setClientModule(p, oakId, "ROTA", { enabled: false, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    const visits = await db.visit.count({ where: { organisationId: oakId } });
    await setClientModule(p, oakId, "ROTA", { enabled: false, reason: "Client asked", confirmName: (await db.organisation.findUniqueOrThrow({ where: { id: oakId } })).name });
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    expect(hasOrgPermission(oak, "rota.view")).toBe(false);
    expect(hasOrgPermission(oak, "org.manage")).toBe(true);
    expect(hasOrgPermission(await orgAdmin(), "rota.view")).toBe(true); // other clients are untouched
    expect(await db.visit.count({ where: { organisationId: oakId } })).toBe(visits);
    await expect(setClientModule(p, oakId, "ROTA", { enabled: false, reason: "again" })).rejects.toBeInstanceOf(ConflictError);
    await setClientModule(p, oakId, "ROTA", { enabled: true, reason: "Restored" });
    expect(hasOrgPermission(await ctxFor("manager@oakridge.demo", OAKRIDGE), "rota.view")).toBe(true);
  });
});

describe("accounts, passwords and roles", () => {
  it("refuses an organisation reset for someone in two organisations, and a platform reset works, revokes earlier links and ends sessions", async () => {
    const u = await person("two.orgs@fictional.example", [{ id: csbId, roles: ["CARER"] }, { id: oakId, roles: ["CARER"] }]);
    const m = await db.membership.findFirstOrThrow({ where: { userId: u.id, organisationId: csbId } });
    await expect(createResetLink(await orgAdmin(), m.id)).rejects.toBeInstanceOf(ForbiddenError);
    const s = await login(u.email, PW);
    const first = await platformResetLink(await platform(), u.id);
    const second = await platformResetLink(await platform(), u.id);
    expect(await describeToken(first.token)).toBeNull(); // the earlier link was revoked
    expect(await db.accountToken.count({ where: { tokenHash: second.token } })).toBe(0);
    await redeemToken(second.token, { password: "a brand new password 2026" });
    expect(await ctxFromToken(s.token)).toBeNull();
    await login(u.email, "a brand new password 2026");
    // The audit records the action without the token or the password.
    const rows = await db.auditLog.findMany({ where: { OR: [{ entityId: u.id }, { data: { path: ["userId"], equals: u.id } }] } });
    expect(JSON.stringify(rows)).not.toContain(second.token);
    expect(JSON.stringify(rows)).not.toContain("a brand new password");
    // Never a password hash in the account view.
    expect(JSON.stringify(await getAccount(await platform(), u.id))).not.toContain("passwordHash");
  });

  it("limits how many reset links can be made in an hour and records the refusal", async () => {
    const u = await person("rate.limited@fictional.example", [{ id: oakId, roles: ["CARER"] }]);
    const p = await platform();
    const perHour = await getSetting("auth.resetLinksPerHour");
    for (let i = 0; i < perHour; i++) await platformResetLink(p, u.id);
    await expect(platformResetLink(p, u.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditLog.count({ where: { action: "platform.member.reset_link.blocked", data: { path: ["userId"], equals: u.id } } })).toBe(1);
  });

  it("refuses demo accounts, and 'require a password change' blocks sign-in until a new password is set", async () => {
    const p = await platform();
    await expect(platformResetLink(p, (await db.user.findUniqueOrThrow({ where: { email: "manager@oakridge.demo" } })).id)).rejects.toBeInstanceOf(ForbiddenError);
    const u = await person("must.change@fictional.example", [{ id: oakId, roles: ["CARER"] }]);
    const s = await login(u.email, PW);
    const r = await requirePasswordReset(p, u.id, "Suspected shared password");
    expect(await ctxFromToken(s.token)).toBeNull();
    await expect(login(u.email, PW)).rejects.toMatchObject({ code: "PASSWORD_RESET_REQUIRED" });
    await redeemToken(r.token, { password: "another long password 26" });
    await login(u.email, "another long password 26");
  });

  it("ends every session of a person on request", async () => {
    const u = await person("sessions@fictional.example", [{ id: oakId, roles: ["CARER"] }]);
    const a = await login(u.email, PW);
    const b = await login(u.email, PW);
    await revokeAllSessions(await platform(), u.id, "Lost phone");
    expect(await ctxFromToken(a.token)).toBeNull();
    expect(await ctxFromToken(b.token)).toBeNull();
  });

  it("keeps at least one platform administrator and asks for the administrator's own password to change platform roles", async () => {
    const p = await platform();
    await expect(setPlatformRoles(p, p.userId, [], DEMO_PW, "Testing")).rejects.toBeInstanceOf(ConflictError);
    const helper = await person("second.admin@fictional.example", [], []);
    await expect(setPlatformRoles(p, helper.id, ["PLATFORM_ADMIN"], "wrong", "New colleague")).rejects.toBeInstanceOf(ForbiddenError);
    await setPlatformRoles(p, helper.id, ["PLATFORM_ADMIN"], DEMO_PW, "New colleague");
    const s = await login(helper.email, PW);
    await setPlatformRoles(p, helper.id, [], DEMO_PW, "Left the team");
    expect(await ctxFromToken(s.token)).toBeNull(); // sessions end when roles are taken away
  });

  it("keeps at least one organisation administrator when the platform changes roles or deactivates accounts", async () => {
    const p = await platform();
    const owner = await person("sole.admin@fictional.example", []);
    const r = await provisionClient(p, onboarding({ legalName: "Sole Admin Care Ltd", adminEmail: owner.email }));
    await redeemToken(r.token!, { password: PW });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: r.organisationId, userId: owner.id } });
    await expect(updateMembershipAsPlatform(p, r.organisationId, m.id, { roles: ["CARER"] })).rejects.toBeInstanceOf(ConflictError);
    await expect(deactivateAccount(p, owner.id, "Leaving", DEMO_PW)).rejects.toBeInstanceOf(ConflictError);
    // An organisation administrator still cannot reach another organisation's members.
    await expect(updateMember(await orgAdmin(), m.id, { roles: ["CARER"] })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AI usage", () => {
  const fake = { name: "fake", isSimulated: true, answer: async () => { noteAiTokens({ input_tokens: 1200, output_tokens: 300 }); return { text: "ok" }; } } as unknown as LlmProvider;

  it("records each request per tenant as metadata only, and refuses AI to a client without the module or over its allowance", async () => {
    const p = await platform();
    const ai = meteredProvider(fake);
    const input = { question: "a confidential question about a person" } as unknown as Parameters<LlmProvider["answer"]>[0];
    await runForTenant(oakId, () => ai.answer(input));
    const ev = await db.aiUsageEvent.findFirstOrThrow({ where: { organisationId: oakId }, orderBy: { createdAt: "desc" } });
    expect(ev).toMatchObject({ feature: "answer", success: true, inputTokens: 1200, outputTokens: 300 });
    expect(JSON.stringify(ev)).not.toContain("confidential");
    expect((await aiUsage(p, { organisationId: oakId })).requests).toBe(1);
    expect((await aiUsage(p, { organisationId: oakId })).estimatedCostPence).toBeNull(); // no prices configured

    await setClientModuleLimits(p, oakId, "AI_COORDINATOR", { monthlyRequests: 1, monthlySpendPence: null });
    await expect(runForTenant(oakId, () => ai.answer(input))).rejects.toBeInstanceOf(AiUnavailableError);
    await setClientModule(p, oakId, "AI_COORDINATOR", { enabled: false, reason: "Not in contract" });
    await expect(runForTenant(oakId, () => ai.answer(input))).rejects.toMatchObject({ reason: "not-licensed" });
    // Another client is not affected.
    await runForTenant(csbId, () => ai.answer(input));
  });
});

describe("support access", () => {
  it("needs the client's approval, is limited to its scope and time, is visible and audited, and can be revoked", async () => {
    const p = await platform();
    await expect(clientAudit(p, csbId, { full: true })).rejects.toBeInstanceOf(ForbiddenError);
    const { grant } = await requestSupportAccess(p, csbId, { purpose: "Investigate a configuration question", scopes: ["ACTIVITY_LOG"], hours: 2 });
    await expect(requireSupportScope(p, csbId, "ACTIVITY_LOG")).rejects.toBeInstanceOf(ForbiddenError);
    // Another organisation's administrator cannot approve it.
    await expect(decideSupportAccess(await ctxFor("manager@oakridge.demo", OAKRIDGE), grant.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await decideSupportAccess(await orgAdmin(), grant.id, true);
    await clientAudit(p, csbId, { full: true });
    await expect(requireSupportScope(p, csbId, "CONFIGURATION")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { organisationId: csbId, action: "platform.support.used" } })).toBeGreaterThan(0);
    await revokeSupportAccess(await orgAdmin(), grant.id, "No longer needed");
    await expect(clientAudit(p, csbId, { full: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows emergency access only with the administrator's password, for at most 4 hours, and expiry ends it", async () => {
    const p = await platform();
    const input = { purpose: "Urgent outage affecting sign-in", scopes: ["CONFIGURATION"], hours: 2 };
    await expect(emergencySupportAccess(p, oakId, { ...input, hours: 8 }, DEMO_PW)).rejects.toBeInstanceOf(ValidationError);
    await expect(emergencySupportAccess(p, oakId, input, "wrong")).rejects.toBeInstanceOf(ForbiddenError);
    const g = await emergencySupportAccess(p, oakId, input, DEMO_PW);
    await requireSupportScope(p, oakId, "CONFIGURATION");
    await db.supportAccessGrant.update({ where: { id: g.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(requireSupportScope(p, oakId, "CONFIGURATION")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("settings, health and the security audit", () => {
  it("asks for the password for sign-in settings, audits before and after, and the new invitation expiry takes effect", async () => {
    const p = await platform();
    await expect(updateSettings(p, "authentication", { "auth.inviteExpiryDays": 3 }, "wrong")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSettings(p, "authentication", { "auth.passwordMinLength": 6 }, DEMO_PW)).rejects.toBeInstanceOf(ValidationError);
    await updateSettings(p, "authentication", { "auth.inviteExpiryDays": 3 }, DEMO_PW);
    expect(await getSetting("auth.inviteExpiryDays")).toBe(3);
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "platform.settings.updated" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(row.data)).toContain('"before":7');
    const r = await provisionClient(p, onboarding({ legalName: "Short Invite Ltd", adminEmail: "short@fictional.example" }));
    const t = await db.accountToken.findFirstOrThrow({ where: { organisationId: r.organisationId, kind: "INVITE" } });
    expect(Math.round((t.expiresAt.getTime() - Date.now()) / 86400_000)).toBe(3);
    await updateSettings(p, "authentication", { "auth.inviteExpiryDays": 7 }, DEMO_PW);
  });

  it("never reports backups as successful without a recorded restore test", async () => {
    const h = await platformHealth(await platform());
    const backup = h.checks.find((c) => /backup/i.test(c.name));
    expect(backup?.measure).toBe("not configured");
  });

  it("lists platform security events across clients for the platform, and an organisation administrator cannot read it", async () => {
    const page = await securityAudit(await platform(), {});
    expect(page.entries.some((r) => r.action.startsWith("platform."))).toBe(true);
    await expect(securityAudit(await orgAdmin(), {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});


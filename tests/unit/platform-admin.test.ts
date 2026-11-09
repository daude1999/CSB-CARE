import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import { hasOrgPermission, hasPlatformPermission, ORG_PERMISSIONS, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { canUsePortal } from "@/server/auth/portals";
import { MODULE_KEYS, moduleInfo, moduleOfPermission } from "@/lib/platform-modules";
import { effectivePermissions, levelOf, permissionDiff } from "@/server/platform/permissions";
import { billingStatus } from "@/server/platform/billing";
import { maskIp, tokenState } from "@/server/platform/accounts";
import { coerceSetting, SETTINGS } from "@/server/platform/settings";
import { grantState } from "@/server/platform/support";

/** Pure rules of the Evantix Platform Admin Centre: module enforcement, suspension, permission levels, masking. */
const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });

describe("module entitlements in permission checks", () => {
  it("maps every organisation permission to at most one module, and rota, care and AI permissions to theirs", () => {
    expect(moduleOfPermission("rota.view")).toBe("ROTA");
    expect(moduleOfPermission("serviceUser.view")).toBe("SERVICE_USERS");
    expect(moduleOfPermission("careIntake.upload" as OrgPermission)).toBe("AI_COORDINATOR");
    expect(moduleOfPermission("policy.read")).toBe("POLICY");
    expect(moduleOfPermission("org.manage")).toBeNull();
    for (const p of Object.keys(ORG_PERMISSIONS)) {
      const m = moduleOfPermission(p);
      if (m) expect(MODULE_KEYS).toContain(m);
    }
  });

  it("refuses a permission whose module is switched off for the organisation, server-side, and keeps the rest", () => {
    const manager = ctx({ orgRoles: ["ORG_ADMIN"] });
    expect(hasOrgPermission(manager, "rota.view")).toBe(true);
    const noRota = ctx({ orgRoles: ["ORG_ADMIN"], disabledModules: ["ROTA"] });
    expect(hasOrgPermission(noRota, "rota.view")).toBe(false);
    expect(hasOrgPermission(noRota, "policy.read")).toBe(true);
    expect(hasOrgPermission(noRota, "org.manage")).toBe(true);
  });

  it("closes the Policy portal when Policy & Compliance is switched off", () => {
    expect(canUsePortal(ctx({ orgRoles: ["ORG_ADMIN"] }), "policy")).toBe(true);
    expect(canUsePortal(ctx({ orgRoles: ["ORG_ADMIN"], disabledModules: ["POLICY"] }), "policy")).toBe(false);
  });

  it("refuses every organisation permission and every portal but Overview while the organisation is suspended", () => {
    const s = ctx({ orgRoles: ["ORG_ADMIN"], suspended: true });
    expect(hasOrgPermission(s, "org.manage")).toBe(false);
    expect(hasOrgPermission(s, "policy.read")).toBe(false);
    for (const p of ["policy", "rota", "hr", "reporting", "admin"] as const) expect(canUsePortal(s, p)).toBe(false);
  });

  it("keeps platform permissions for platform administrators only; an organisation administrator has none", () => {
    expect(hasPlatformPermission(ctx({ platformRoles: ["PLATFORM_ADMIN"] }), "platform.customers")).toBe(true);
    expect(hasPlatformPermission(ctx({ orgRoles: ["ORG_ADMIN"] }), "platform.view")).toBe(false);
    expect(hasPlatformPermission(ctx({ platformRoles: ["CONTENT_EDITOR"] }), "platform.accounts")).toBe(false);
  });

  it("marks the day-to-day care modules as critical so switching them off needs confirmation", () => {
    expect(moduleInfo("ROTA")?.critical).toBe(true);
    expect(moduleInfo("SERVICE_USERS")?.critical).toBe(true);
    expect(moduleInfo("REPORTING")?.critical).toBe(false);
  });
});

describe("permission levels for the role matrix", () => {
  it("derives levels from real permissions and shows exactly what a role change adds and removes", () => {
    expect(levelOf("org.manage")).toBe("Administrative");
    expect(levelOf("policy.read")).toBe("View");
    const carer = effectivePermissions(["CARER"]);
    const admin = effectivePermissions(["ORG_ADMIN"]);
    expect(admin.find((g) => g.group === "Administration")?.level).toBe("Administrative");
    expect(carer.find((g) => g.group === "Administration")?.level).toBe("No access");
    const diff = permissionDiff(["CARER"], ["CARER", "ORG_ADMIN"]);
    expect(diff.added).toContain("org.manage");
    expect(diff.removed).toEqual([]);
  });
});

describe("billing, masking and settings", () => {
  afterEach(() => { delete process.env.BILLING_PROVIDER; });

  it("says billing is not connected and never claims payments when no provider is implemented", () => {
    expect(billingStatus().connected).toBe(false);
    process.env.BILLING_PROVIDER = "stripe";
    const s = billingStatus();
    expect(s.connected).toBe(false);
    expect(s.message).toMatch(/Nothing is charged/);
  });

  it("masks network addresses and states link status", () => {
    expect(maskIp("81.2.69.160")).toBe("81.2.x.x");
    expect(maskIp("2001:db8:1:2::1")).toBe("2001:db8:1:…");
    const past = new Date(Date.now() - 1000), future = new Date(Date.now() + 60_000);
    expect(tokenState({ usedAt: past, revokedAt: null, expiresAt: future })).toBe("used");
    expect(tokenState({ usedAt: null, revokedAt: past, expiresAt: future })).toBe("revoked");
    expect(tokenState({ usedAt: null, revokedAt: null, expiresAt: past })).toBe("expired");
    expect(tokenState({ usedAt: null, revokedAt: null, expiresAt: future })).toBe("active");
    expect(grantState({ status: "ACTIVE", expiresAt: past })).toBe("EXPIRED");
  });

  it("documents the effect of every setting, keeps the password minimum at 12 or more and stores no secrets", () => {
    for (const s of Object.values(SETTINGS)) expect(s.effect.length).toBeGreaterThan(10);
    expect(SETTINGS["auth.passwordMinLength"].schema.safeParse(8).success).toBe(false);
    expect(Object.keys(SETTINGS).some((k) => /^(api)?key$|secret|^token$|^password$/i.test(k.split(".")[1] ?? ""))).toBe(false);
    expect(coerceSetting("auth.inviteExpiryDays", "")).toBeNull();
    expect(coerceSetting("notifications.securityAlerts", "on")).toBe(true);
  });
});

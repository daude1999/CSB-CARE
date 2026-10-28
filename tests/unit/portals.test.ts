import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import type { Ctx } from "@/server/auth/rbac";
import { canUsePortal, portalsFor } from "@/server/auth/portals";
import { portalForPath } from "@/lib/portals";
import { withBase } from "@/hr/nav";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });

describe("portal access", () => {
  it("gives a manager every portal, HR included when they have an HR account", () => {
    const manager = ctx({ orgRoles: ["ORG_ADMIN", "COMPLIANCE_LEAD"], hrUserId: "admin" });
    expect(portalsFor(manager).map((p) => p.id)).toEqual(["overview", "service-users", "policy", "rota", "hr", "reporting", "admin"]);
  });

  it("limits care staff to Overview and Policy & Compliance", () => {
    const carer = ctx({ orgRoles: ["STAFF"] });
    expect(portalsFor(carer).map((p) => p.id)).toEqual(["overview", "policy"]);
    expect(canUsePortal(carer, "admin")).toBe(false);
    expect(canUsePortal(carer, "hr")).toBe(false);
  });

  it("opens HR & Workforce only with an HR account inside an organisation", () => {
    expect(canUsePortal(ctx({ orgRoles: ["ORG_ADMIN"] }), "hr")).toBe(false);
    expect(canUsePortal(ctx({ orgRoles: ["STAFF"], hrUserId: "liverpool-hr" }), "hr")).toBe(true);
    expect(canUsePortal(ctx({ organisationId: null, hrUserId: "admin" }), "hr")).toBe(false);
  });

  it("lets platform admins reach Administration and Reporting without an organisation", () => {
    const admin = ctx({ organisationId: null, platformRoles: ["PLATFORM_ADMIN"] });
    expect(canUsePortal(admin, "admin")).toBe(true);
    expect(canUsePortal(admin, "reporting")).toBe(true);
    expect(canUsePortal(admin, "rota")).toBe(false);
  });
});

describe("portal routes", () => {
  it("keeps existing policy addresses in Policy & Compliance", () => {
    for (const p of ["/", "/policies", "/policies/abc", "/changes", "/audits", "/staff", "/acknowledgements"]) expect(portalForPath(p)).toBe("policy");
  });
  it("maps each portal's own addresses", () => {
    expect(portalForPath("/overview")).toBe("overview");
    expect(portalForPath("/hr/people/emp-1")).toBe("hr");
    expect(portalForPath("/reports")).toBe("reporting");
    expect(portalForPath("/admin/jobs")).toBe("admin");
    expect(portalForPath("/settings")).toBe("admin");
    expect(portalForPath("/rota")).toBe("rota");
    expect(portalForPath("/hrx")).toBe("policy");
  });
  it("prefixes HR Hub links with /hr but leaves files and APIs alone", () => {
    expect(withBase("/people?branch=all")).toBe("/hr/people?branch=all");
    expect(withBase("/hr/people")).toBe("/hr/people");
    expect(withBase("/api/hr/hub")).toBe("/api/hr/hub");
    expect(withBase("/brand/csb-logo.png")).toBe("/brand/csb-logo.png");
    expect(withBase("mailto:a@example.com")).toBe("mailto:a@example.com");
  });
});

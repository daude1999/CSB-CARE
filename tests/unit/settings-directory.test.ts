import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Ctx } from "@/server/auth/rbac";
import { settingsDirectory } from "@/components/settings-directory";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });
const hrefs = (c: Ctx) => settingsDirectory(c).flatMap((g) => g.entries.map((e) => e.href));

describe("All Settings", () => {
  it("lists every settings screen once for an organisation admin with an HR account", () => {
    const all = hrefs(ctx({ orgRoles: ["ORG_ADMIN"], hrUserId: "admin" }));
    for (const h of ["/admin/users", "/admin/branches", "/rota/settings", "/hr/settings", "/hr/recruitment/settings", "/staff/rules", "/admin/audit"]) expect(all).toContain(h);
    expect(new Set(all).size).toBe(all.length);
    // Areas and carer logins are tabs of Branches & Areas and Users & Logins, not separate entries.
    expect(all).not.toContain("/admin/areas");
    expect(all).not.toContain("/admin/workforce");
  });

  it("lists only the screens a person may open", () => {
    const all = hrefs(ctx({ orgRoles: ["ORG_ADMIN"] }));
    expect(all).not.toContain("/hr/settings");
    expect(hrefs(ctx({ orgRoles: ["STAFF"] }))).toEqual([]);
  });
});

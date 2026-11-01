import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import { rotaItems } from "@/components/rota-nav";
import { groupPages } from "@/components/portal-switcher";
import { mostSpecificActive } from "@/lib/navigation";
import type { Ctx } from "@/server/auth/rbac";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });
const i = { size: 15 };

describe("the Rota side menu", () => {
  it("follows OnePlan's section order, with only Rota, Templates and Users open at first", () => {
    const groups = groupPages(rotaItems(ctx({ orgRoles: ["ORG_ADMIN"], hrUserId: "admin" }), i));
    expect(groups.map((g) => [g.name, g.fold])).toEqual([
      ["Rota", "open"], ["Templates", "open"], ["Users", "open"], ["Invoicing/Wages", "closed"], ["Reports", "closed"], ["Settings", "closed"], ["Help & Training", "closed"],
    ]);
  });

  it("shows the eight everyday Rota pages, with the extra CSB pages in the folded More list", () => {
    const [rota] = groupPages(rotaItems(ctx({ orgRoles: ["ORG_ADMIN"] }), i));
    expect(rota!.rows.map((r) => r.label)).toEqual(["Rota Home", "Add Visit", "Daily Rota", "Advanced Rota", "Live Run Routes", "The Monitor", "Printable Rota", "Build Rota"]);
    expect(rota!.more?.name).toBe("More rota tools");
    expect(rota!.more?.rows.map((r) => r.label)).toEqual(["Weekly Planner", "Unassigned Visits", "Sickness & Holiday Cover", "Missed Calls", "Exceptions", "Visit Notes", "Generate & Optimise"]);
  });

  it("marks pages that are not built yet as Planned, never as links", () => {
    const items = rotaItems(ctx({ orgRoles: ["ORG_ADMIN"] }), i);
    const planned = items.filter((x) => x.planned).map((x) => x.label);
    expect(planned).toEqual(["Service User Absences", "Preference Manager", "Communication Log", "Holiday Report", "Guides and videos"]);
    for (const p of items.filter((x) => x.planned)) expect(p.href.startsWith("#")).toBe(true);
    for (const p of items.filter((x) => !x.planned)) expect(p.href.startsWith("/")).toBe(true);
  });

  it("lists staff time off only for people with an HR Hub login, as the page itself requires", () => {
    expect(rotaItems(ctx({ orgRoles: ["ORG_ADMIN"], hrUserId: "admin" }), i).map((x) => x.label)).toContain("Staff Time Off");
    expect(rotaItems(ctx({ orgRoles: ["ORG_ADMIN"] }), i).map((x) => x.label)).not.toContain("Staff Time Off");
  });

  it("keeps the permission checks: a carer sees only their visits and incident reporting, a finance officer no rota tools", () => {
    expect(rotaItems(ctx({ orgRoles: ["STAFF", "CARER"] }), i).filter((x) => !x.planned).map((x) => x.label)).toEqual(["Incidents", "My Visits"]);
    const finance = rotaItems(ctx({ orgRoles: ["FINANCE_OFFICER"] }), i);
    expect(finance.map((x) => x.label)).toContain("Invoicing");
    expect(finance.map((x) => x.label)).not.toContain("Build Rota");
    expect(finance.map((x) => x.label)).not.toContain("Guides and videos");
  });

  it("lights Bank Holidays, not Tariffs & Funders, on the bank holiday tab", () => {
    const hrefs = rotaItems(ctx({ orgRoles: ["ORG_ADMIN"] }), i).filter((x) => !x.planned).map((x) => x.href);
    expect(mostSpecificActive(hrefs, "/rota/finance/rates", new URLSearchParams("tab=holidays"))).toBe("/rota/finance/rates?tab=holidays");
    expect(mostSpecificActive(hrefs, "/rota/finance/rates", new URLSearchParams("tab=funders"))).toBe("/rota/finance/rates");
  });
});

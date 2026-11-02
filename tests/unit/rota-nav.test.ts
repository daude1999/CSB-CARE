import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import { rotaItems, rotaWorkspaceTabs, type RotaWorkspace } from "@/components/rota-nav";
import { activeEntryHref } from "@/lib/navigation";
import type { Ctx } from "@/server/auth/rbac";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });
const i = { size: 15 };
const admin = ctx({ orgRoles: ["ORG_ADMIN"], hrUserId: "admin" });
// Staff & Workforce left the Rota menu (HR & Workforce owns the employee); its operational pages are Daily Rota tabs.
const DESTINATIONS = ["Rota Home", "Daily Rota", "Visits Needing Attention", "The Monitor", "Daily Templates", "Service Users", "Finance", "Reports"];

/** Every page the old Rota menu linked to (PR #38), with the destination that must now lead to it. */
const FORMER: [string, string][] = [
  ["/rota", "Rota Home"],
  ["/rota/visits/new", "Daily Rota"],
  ["/rota/visits", "Daily Rota"],
  ["/rota/advanced", "Daily Rota"],
  ["/rota/routes", "Daily Rota"],
  ["/rota/monitor", "The Monitor"],
  ["/rota/print", "Daily Rota"],
  ["/rota/build", "Daily Rota"],
  ["/rota/planner", "Daily Rota"],
  ["/rota/unassigned", "Visits Needing Attention"],
  ["/rota/cover", "Daily Rota"],
  ["/rota/missed", "Visits Needing Attention"],
  ["/rota/exceptions", "The Monitor"],
  ["/rota/notes", "Service Users"],
  ["/rota/optimise", "Daily Rota"],
  ["/rota/templates", "Daily Templates"],
  ["/rota/templates/planner", "Daily Templates"],
  ["/rota/routes/templates", "Daily Templates"],
  ["/rota/staff", "Daily Rota"],
  ["/rota/service-users", "Service Users"],
  ["/rota/care-plans", "Service Users"],
  ["/rota/risks", "Service Users"],
  ["/rota/incidents", "Service Users"],
  ["/rota/readiness", "Daily Rota"],
  ["/rota/finance/invoices", "Finance"],
  ["/rota/finance/payroll", "Finance"],
  ["/rota/finance/timesheets", "Finance"],
  ["/rota/finance/mileage", "Finance"],
  ["/rota/finance/rates", "Finance"],
  ["/rota/finance/rates?tab=holidays", "Finance"],
  ["/rota/finance", "Finance"],
  ["/rota/reports", "Reports"],
  ["/rota/insights", "Reports"],
  ["/rota/settings", "Settings"],
];

const lit = (c: Ctx, href: string) => {
  const items = rotaItems(c, i);
  const [path, query = ""] = href.split("?");
  const h = activeEntryHref(items, path!, new URLSearchParams(query));
  return items.find((x) => x.href === h)?.label;
};

describe("the Rota side menu", () => {
  it("shows exactly the eight destinations, with Settings set apart at the foot", () => {
    const items = rotaItems(admin, i);
    expect(items.map((x) => x.label)).toEqual([...DESTINATIONS, "Settings"]);
    expect(items.at(-1)).toMatchObject({ href: "/rota/settings", separated: true });
    expect(items.filter((x) => x.separated)).toHaveLength(1);
  });

  it("has no groups, folded lists or Planned rows", () => {
    for (const x of rotaItems(admin, i)) {
      expect(x.group).toBeUndefined();
      expect(x.fold).toBeUndefined();
      expect(x.more).toBeUndefined();
      expect(x.planned).toBeUndefined();
      expect(x.href.startsWith("/")).toBe(true);
    }
  });

  it("lights the right destination for every page the old menu listed, and for their sub-pages", () => {
    for (const [href, label] of FORMER) expect(lit(admin, href), href).toBe(label);
    expect(lit(admin, "/rota/attention"), "attention").toBe("Visits Needing Attention");
    expect(lit(admin, "/rota/missed/abc"), "a missed call case").toBe("Visits Needing Attention");
    expect(lit(admin, "/rota/incidents/abc"), "an incident").toBe("Service Users");
    expect(lit(admin, "/rota/care-plans/su1"), "a care plan").toBe("Service Users");
    expect(lit(admin, "/rota/service-users/su1"), "a profile").toBe("Service Users");
    expect(lit(admin, "/rota/staff/s1"), "a staff profile").toBe("Daily Rota");
    expect(lit(admin, "/rota/routes/r1"), "a live route").toBe("Daily Rota");
    expect(lit(admin, "/rota/routes/templates/r1"), "a template route").toBe("Daily Templates");
    expect(lit(admin, "/rota/visits/v1"), "a visit").toBe("Daily Rota");
  });

  it("keeps every former page reachable as a tab of its destination (or, for Add Visit and Rota Home, its own page)", () => {
    const all = (["daily", "attention", "monitor", "templates", "people", "finance", "reports"] as RotaWorkspace[]).flatMap((w) => rotaWorkspaceTabs(admin, w).map((t) => t.href));
    for (const [href] of FORMER) {
      if (["/rota", "/rota/visits/new", "/rota/settings"].includes(href)) continue;
      expect(all, href).toContain(href);
    }
  });

  it("has no staff administration: HR pages stay in HR, the rota keeps its operational staff views", () => {
    const all = (["daily", "attention", "monitor", "templates", "people", "finance", "reports"] as RotaWorkspace[]).flatMap((w) => rotaWorkspaceTabs(admin, w));
    expect(all.filter((t) => !t.href.startsWith("/rota"))).toEqual([]);
    expect(rotaItems(admin, i).map((x) => x.label)).not.toContain("Staff & Workforce");
    expect(rotaWorkspaceTabs(admin, "daily").map((t) => t.label)).toEqual(expect.arrayContaining(["Staff & Eligibility", "Staff Readiness"]));
    // The operational staff pages need their own permission, as the pages check on the server.
    expect(rotaWorkspaceTabs(ctx({ orgRoles: ["CARE_COORDINATOR"] }), "daily").map((t) => t.href)).toEqual(expect.arrayContaining(["/rota/staff", "/rota/readiness"]));
  });

  it("keeps the permission checks for each role", () => {
    // A carer has no office pages: their own visits, and incident reporting under its own name.
    expect(rotaItems(ctx({ orgRoles: ["STAFF", "CARER"] }), i).map((x) => [x.label, x.href])).toEqual([["Incidents", "/rota/incidents"], ["My Visits", "/carer"]]);
    // A finance officer: Finance only. The staff tabs alone never make a Daily Rota entry for someone with no rota page.
    expect(rotaItems(ctx({ orgRoles: ["FINANCE_OFFICER"] }), i).map((x) => x.label)).toEqual(["Finance"]);
    // A coordinator has no Finance and no Settings; Build Rota stays a Daily Rota tab.
    const coord = ctx({ orgRoles: ["CARE_COORDINATOR"] });
    expect(rotaItems(coord, i).map((x) => x.label)).toEqual(DESTINATIONS.filter((n) => n !== "Finance"));
    expect(rotaWorkspaceTabs(coord, "daily").map((t) => t.label)).toContain("Build Rota");
    // A compliance lead cannot build rotas.
    expect(rotaWorkspaceTabs(ctx({ orgRoles: ["COMPLIANCE_LEAD"] }), "daily").map((t) => t.label)).not.toContain("Build Rota");
  });
});

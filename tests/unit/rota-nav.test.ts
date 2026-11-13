import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), usePathname: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import { rotaItems, rotaWorkspaceTabs } from "@/components/rota-nav";
import { activeEntryHref } from "@/lib/navigation";
import type { Ctx } from "@/server/auth/rbac";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });
const i = { size: 15 };
const admin = ctx({ orgRoles: ["ORG_ADMIN"], hrUserId: "admin" });
// Harbour (owner's decision, 13 Nov 2026): nine Care & Rostering entries; grouped pages are sub-tabs. Rota Reports and
// Rota Insights stay in Reporting & Analytics, where they have always had their home.
const DESTINATIONS = ["Rota Home", "Daily Rota", "Needs attention", "Plan the rota", "Templates & runs", "Service users", "Carers", "Finance", "Rota Settings"];

/** Every Care & Rostering page, with the entry that must lead to it. Every address is unchanged. */
const PAGES: [string, string][] = [
  ["/rota", "Rota Home"],
  ["/rota/monitor", "Rota Home"],
  ["/rota/visits", "Daily Rota"],
  ["/rota/visits/new", "Daily Rota"],
  ["/rota/attention", "Needs attention"],
  ["/rota/unassigned", "Needs attention"],
  ["/rota/cover", "Needs attention"],
  ["/rota/missed", "Needs attention"],
  ["/rota/exceptions", "Needs attention"],
  ["/rota/planner", "Plan the rota"],
  ["/rota/advanced", "Plan the rota"],
  ["/rota/build", "Plan the rota"],
  ["/rota/optimise", "Plan the rota"],
  ["/rota/print", "Plan the rota"],
  ["/rota/templates", "Templates & runs"],
  ["/rota/templates/planner", "Templates & runs"],
  ["/rota/routes", "Templates & runs"],
  ["/rota/routes/templates", "Templates & runs"],
  ["/rota/service-users", "Service users"],
  ["/rota/coordinator", "Service users"],
  ["/rota/care-plans", "Service users"],
  ["/rota/risks", "Service users"],
  ["/rota/incidents", "Service users"],
  ["/rota/notes", "Service users"],
  ["/rota/staff", "Carers"],
  ["/rota/readiness", "Carers"],
  ["/rota/finance", "Finance"],
  ["/rota/finance/invoices", "Finance"],
  ["/rota/finance/payroll", "Finance"],
  ["/rota/finance/timesheets", "Finance"],
  ["/rota/finance/mileage", "Finance"],
  ["/rota/finance/rates", "Finance"],
  ["/rota/finance/rates?tab=holidays", "Finance"],
  ["/rota/settings", "Rota Settings"],
];

const lit = (c: Ctx, href: string) => {
  const items = rotaItems(c, i);
  const [path, query = ""] = href.split("?");
  const h = activeEntryHref(items, path!, new URLSearchParams(query));
  return items.find((x) => x.href === h)?.label;
};
const tabsOf = (c: Ctx, label: string) => rotaItems(c, i).find((x) => x.label === label)?.tabs?.map((t) => t.label) ?? [];

describe("the Care & Rostering menu", () => {
  it("lights a page's own entry rather than a workspace that only lists it as a tab", () => {
    const entries = [{ href: "/rota/reports", match: ["/rota/insights"] }, { href: "/rota/insights" }];
    expect(activeEntryHref(entries, "/rota/insights", new URLSearchParams())).toBe("/rota/insights");
    expect(activeEntryHref([...entries].reverse(), "/rota/insights", new URLSearchParams())).toBe("/rota/insights");
    expect(activeEntryHref(entries, "/rota/reports", new URLSearchParams())).toBe("/rota/reports");
  });

  it("shows exactly the nine entries, in order", () => {
    expect(rotaItems(admin, i).map((x) => x.label)).toEqual(DESTINATIONS);
    for (const x of rotaItems(admin, i)) {
      expect(x.planned).toBeUndefined();
      expect(x.href.startsWith("/")).toBe(true);
    }
  });

  it("groups the pages as the Harbour brief lists them, keeping every address", () => {
    expect(tabsOf(admin, "Rota Home")).toEqual(["Today", "The Monitor"]);
    expect(tabsOf(admin, "Daily Rota")).toEqual([]);
    expect(tabsOf(admin, "Needs attention")).toEqual(["Visits Needing Attention", "Unassigned Visits", "Sickness & Holiday Cover", "Missed Calls", "Exceptions"]);
    expect(tabsOf(admin, "Plan the rota")).toEqual(["Weekly Planner", "Advanced Rota", "Build Rota", "Generate & Optimise", "Printable Rota"]);
    expect(tabsOf(admin, "Templates & runs")).toEqual(["Daily Templates", "Advanced Templates", "Live Run Routes", "Template Run Routes"]);
    expect(tabsOf(admin, "Service users")).toEqual(["All service users", "Care Coordinator", "Care Plans", "Risk Assessments", "Incidents", "Visit Notes"]);
    expect(tabsOf(admin, "Finance")).toEqual(["This week", "Invoicing", "Wages", "Timesheets", "Mileage", "Tariffs & Funders", "Bank Holidays"]);
  });

  it("lights the right entry for every page, and for their sub-pages", () => {
    for (const [href, label] of PAGES) expect(lit(admin, href), href).toBe(label);
    expect(lit(admin, "/rota/missed/abc"), "a missed call case").toBe("Needs attention");
    expect(lit(admin, "/rota/incidents/abc"), "an incident").toBe("Service users");
    expect(lit(admin, "/rota/care-plans/su1"), "a care plan").toBe("Service users");
    expect(lit(admin, "/rota/service-users/su1"), "a profile").toBe("Service users");
    expect(lit(admin, "/rota/coordinator/ci1"), "an intake").toBe("Service users");
    expect(lit(admin, "/rota/staff/s1"), "a staff profile").toBe("Carers");
    expect(lit(admin, "/rota/routes/r1"), "a live route").toBe("Templates & runs");
    expect(lit(admin, "/rota/routes/templates/r1"), "a template route").toBe("Templates & runs");
    expect(lit(admin, "/rota/visits/v1"), "a visit").toBe("Daily Rota");
  });

  it("keeps Rota Reports in Reporting & Analytics, with its own tabs there", () => {
    expect(rotaWorkspaceTabs(admin, "reports").map((t) => t.label)).toEqual(["Rota Reports", "Rota Insights"]);
    expect(rotaItems(admin, i).map((x) => x.href)).not.toContain("/rota/reports");
  });

  it("has no staff administration: HR pages stay in HR, the rota keeps its operational staff views", () => {
    const all = rotaItems(admin, i).flatMap((x) => x.tabs ?? [{ href: x.href }]);
    expect(all.filter((t) => !t.href.startsWith("/rota") && t.href !== "/carer")).toEqual([]);
    expect(tabsOf(ctx({ orgRoles: ["CARE_COORDINATOR"] }), "Carers")).toEqual(expect.arrayContaining(["Staff & Eligibility", "Staff Readiness"]));
  });

  it("keeps the permission checks for each role", () => {
    // A carer has no office pages: their own visits, and incident reporting under its own name.
    expect(rotaItems(ctx({ orgRoles: ["STAFF", "CARER"] }), i).map((x) => [x.label, x.href])).toEqual([["Incidents", "/rota/incidents"], ["My Visits", "/carer"]]);
    // A finance officer: Finance only. The staff pages alone never make a Carers entry for someone with no rota page.
    expect(rotaItems(ctx({ orgRoles: ["FINANCE_OFFICER"] }), i).map((x) => x.label)).toEqual(["Finance"]);
    // A coordinator has no Finance and no Settings; Build Rota stays under Plan the rota.
    const coord = ctx({ orgRoles: ["CARE_COORDINATOR"] });
    expect(rotaItems(coord, i).map((x) => x.label)).toEqual(DESTINATIONS.filter((n) => n !== "Finance" && n !== "Rota Settings"));
    expect(tabsOf(coord, "Plan the rota")).toContain("Build Rota");
    // A compliance lead cannot build rotas.
    expect(tabsOf(ctx({ orgRoles: ["COMPLIANCE_LEAD"] }), "Plan the rota")).not.toContain("Build Rota");
  });
});

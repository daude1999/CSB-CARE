import { describe, expect, it } from "vitest";
import { locate, WORKSPACES } from "@/components/platform/nav-config";
import { listUrl, returnTo } from "@/components/platform/ui";

/** The redesigned Admin Centre's navigation: six workspaces, every earlier URL still reachable, and safe return links. */
describe("Admin Centre navigation", () => {
  it("has the six workspaces of the brief, in order", () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(["Overview", "Clients", "Accounts & Access", "Subscriptions & Billing", "Platform Operations", "Settings & Security"]);
  });

  it("keeps every page of the first Admin Centre inside a workspace", () => {
    const pages = WORKSPACES.flatMap((w) => w.pages.map((p) => p.href));
    for (const path of ["clients", "clients/new", "onboarding", "users", "administrators", "passwords", "roles", "sessions", "subscriptions", "plans", "billing", "renewals", "health", "jobs", "ai", "modules", "storage", "settings", "security", "support", "notifications", "activity"]) {
      expect(pages).toContain(`/platform-admin/${path}`);
    }
  });

  it("finds the most specific page for a path, and a client's own workspace belongs to Clients", () => {
    expect(locate("/platform-admin/clients/new").page?.href).toBe("/platform-admin/clients/new");
    expect(locate("/platform-admin/clients").page?.href).toBe("/platform-admin/clients");
    expect(locate("/platform-admin/users/abc").workspace.key).toBe("accounts");
    const client = locate("/platform-admin/clients/abc123");
    expect(client.workspace.key).toBe("clients");
    expect(client.page).toBeNull();
    expect(locate("/platform-admin").workspace.key).toBe("overview");
  });

  it("returns only to Admin Centre paths, so a crafted back link cannot leave the platform", () => {
    expect(returnTo("/platform-admin/clients?status=TRIAL&page=2", "/x")).toBe("/platform-admin/clients?status=TRIAL&page=2");
    expect(returnTo("https://evil.example/", "/platform-admin/clients")).toBe("/platform-admin/clients");
    expect(returnTo("//evil.example/platform-admin", "/platform-admin/clients")).toBe("/platform-admin/clients");
    expect(returnTo("/overview", "/platform-admin/users")).toBe("/platform-admin/users");
    expect(returnTo(undefined, "/platform-admin/users")).toBe("/platform-admin/users");
    expect(returnTo("/platform-adminx", "/platform-admin")).toBe("/platform-admin");
  });

  it("builds list URLs with only the filters in use", () => {
    expect(listUrl("/platform-admin/clients", { q: "oak", status: undefined, page: "2" })).toBe("/platform-admin/clients?q=oak&page=2");
    expect(listUrl("/platform-admin/clients", {})).toBe("/platform-admin/clients");
  });
});

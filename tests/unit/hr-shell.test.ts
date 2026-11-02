import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { AtRule, type Node, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { crossesHubEdge, isHubPath } from "@/lib/portals";
import { hrItems } from "@/components/hr-nav";
import { activeEntryHref, isActiveHref } from "@/lib/navigation";
import { hrTabs } from "@/components/hr-tabs";
import type { Ctx } from "@/server/auth/rbac";

const ctx = (over: Partial<Ctx>): Ctx => ({ userId: "u", userName: "U", organisationId: "org1", branchId: null, branchIds: null, orgRoles: [], platformRoles: [], hrUserId: null, ...over });

describe("the HR Hub inside the platform shell", () => {
  it("treats only /hr addresses as HR Hub pages, so only crossing that edge reloads the page", () => {
    expect(isHubPath("/hr")).toBe(true);
    expect(isHubPath("/hr/people/emp-1")).toBe(true);
    expect(isHubPath("/hrx")).toBe(false);
    expect(isHubPath("/workforce/absences")).toBe(false);
    expect(crossesHubEdge("/rota", "/hr/dashboard")).toBe(true);
    expect(crossesHubEdge("/hr/people", "/workforce/availability")).toBe(true);
    expect(crossesHubEdge("/hr/people", "/hr/compliance")).toBe(false);
    expect(crossesHubEdge("/rota", "/overview")).toBe(false);
  });

  it("shows seven HR destinations (owner's brief, 1 Nov 2026), with Recruitment and Time Off only for HR accounts", () => {
    const i = { size: 15 };
    expect(hrItems(ctx({ hrUserId: "admin" }), i).map((x) => x.label)).toEqual([
      "HR Dashboard", "People", "Recruitment", "Checks & Training", "Documents", "Time Off & Availability", "Settings",
    ]);
    const withoutHr = hrItems(ctx({}), i).map((x) => x.label);
    expect(withoutHr).not.toContain("Recruitment");
    expect(withoutHr).not.toContain("Time Off & Availability");
  });

  it("keeps every former menu screen one click away, at its old address", () => {
    const tabs = (["home", "checks", "timeoff", "settings"] as const).flatMap((s) => hrTabs(s, { hrLogin: true }).map((t) => t.href));
    const menu = hrItems(ctx({ hrUserId: "admin" }), { size: 15 }).map((x) => x.href);
    for (const old of ["/hr/dashboard", "/hr/people", "/hr/alerts?view=tasks", "/hr/recruitment", "/hr/compliance", "/hr/documents", "/hr/training", "/workforce/absences", "/workforce/availability", "/hr/branches", "/hr/alerts", "/hr/settings"])
      expect([...menu, ...tabs]).toContain(old);
    expect(hrTabs("timeoff", { hrLogin: false })).toEqual([]);
  });

  it("lights the destination that owns a page: tasks and alerts under HR Dashboard, checks under Checks & Training", () => {
    const entries = hrItems(ctx({ hrUserId: "admin" }), { size: 15 });
    const lit = (path: string, q = "") => activeEntryHref(entries, path, new URLSearchParams(q));
    expect(lit("/hr/alerts", "view=tasks")).toBe("/hr/dashboard");
    expect(lit("/hr/compliance")).toBe("/hr/training");
    expect(lit("/workforce/availability")).toBe("/workforce/absences");
    expect(lit("/hr/branches")).toBe("/hr/settings");
    expect(lit("/hr/recruitment/abc")).toBe("/hr/recruitment");
    expect(lit("/hr/people/emp-1")).toBe("/hr/people");
    expect(isActiveHref("/hr/people", "/hr/people/emp-1", new URLSearchParams())).toBe(true);
  });

  it("confines every rule of the HR Hub's own style sheet to the HR Hub's root, and keeps no automatic dark scheme", () => {
    const css = readFileSync(resolve(__dirname, "../../public/hr/hr-hub.css"), "utf8");
    const loose: string[] = [];
    postcss.parse(css).walkRules((rule: Rule) => {
      for (let p: Node | undefined = rule.parent; p; p = p.parent) if (p instanceof AtRule && (p.name === "layer" || /keyframes$/.test(p.name))) return;
      for (const s of rule.selectors) if (!/^(\.|\[|:where\()/.test(s) || s.startsWith(":root")) loose.push(s);
    });
    expect(loose).toEqual([]);
    expect(css).not.toMatch(/:root:not\(\[data-theme=["']?light/);
    // Its tokens live on its root, so the platform's --font-sans, --radius-* and --focus are never replaced.
    expect(css).toMatch(/\.cs\{[^}]*--font-sans:/);
  });

  it("keeps the platform's element styles and shared class names away from the HR Hub's screens", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
    for (const sel of ["h1", "h2", "h3", "a", ".panel", ".card", ".label", ".muted", ".skeleton"]) expect(css).toContain(`${sel}:where(:not(.cs *))`);
  });
});

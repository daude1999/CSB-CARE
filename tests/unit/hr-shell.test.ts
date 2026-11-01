import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { AtRule, type Node, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { crossesHubEdge, isHubPath } from "@/lib/portals";
import { hrItems } from "@/components/hr-nav";
import { isActiveHref, mostSpecificActive } from "@/lib/navigation";
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

  it("lists the HR Hub's screens in the side menu in its original order (Recruitment added under People), with workforce and recruitment pages only for HR accounts", () => {
    const i = { size: 15 };
    expect(hrItems(ctx({ hrUserId: "admin" }), i).map((x) => x.label)).toEqual([
      "HR Dashboard", "People", "My Tasks", "Recruitment", "Compliance", "Documents", "Training", "Holidays & Sickness", "Availability", "Branches", "Alerts", "Settings",
    ]);
    const withoutHr = hrItems(ctx({}), i);
    expect(withoutHr.map((x) => x.label)).not.toContain("Availability");
    expect(withoutHr.map((x) => x.label)).not.toContain("Recruitment");
    // Every group still opens with its heading.
    expect(withoutHr.filter((x) => x.group).map((x) => x.group)).toEqual(["Home", "People", "HR Management", "Organisation"]);
  });

  it("marks My Tasks, not Alerts, on the tasks view", () => {
    const hrefs = hrItems(ctx({}), { size: 15 }).map((x) => x.href);
    expect(mostSpecificActive(hrefs, "/hr/alerts", new URLSearchParams("view=tasks&branch=all"))).toBe("/hr/alerts?view=tasks");
    expect(mostSpecificActive(hrefs, "/hr/alerts", new URLSearchParams("branch=all"))).toBe("/hr/alerts");
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

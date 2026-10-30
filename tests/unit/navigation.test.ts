import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isActiveHref, mostSpecificActive, pageTarget, splitHref, type LinkClick } from "@/lib/navigation";
import { MOTION } from "@/lib/motion";

const here = new URL("https://csb.example/rota/visits?date=2026-10-29");
const click = (href: string, over: Partial<LinkClick> = {}): LinkClick => ({ href, target: null, optOut: false, button: 0, modified: false, defaultPrevented: true, ...over });

describe("navigation feedback: which clicks open a page in this tab", () => {
  it("counts links to other pages, including query-string changes and the HR Hub's full page loads", () => {
    expect(pageTarget(click("/rota"), here)).toBe("/rota");
    expect(pageTarget(click("/rota/visits?date=2026-10-30"), here)).toBe("/rota/visits?date=2026-10-30");
    expect(pageTarget(click("https://csb.example/hr/dashboard", { defaultPrevented: false }), here)).toBe("/hr/dashboard");
  });

  it("ignores the page already open, in-page anchors, new tabs, modified clicks and other buttons", () => {
    expect(pageTarget(click("/rota/visits?date=2026-10-29"), here)).toBeNull();
    expect(pageTarget(click("#main-content"), here)).toBeNull();
    expect(pageTarget(click("/rota", { target: "_blank" }), here)).toBeNull();
    expect(pageTarget(click("/rota", { modified: true }), here)).toBeNull();
    expect(pageTarget(click("/rota", { button: 1 }), here)).toBeNull();
  });

  it("ignores downloads, API routes, static files and other sites, which never replace the page", () => {
    expect(pageTarget(click("/api/policies/p1/download?format=pdf"), here)).toBeNull();
    expect(pageTarget(click("/policies/p1", { optOut: true }), here)).toBeNull();
    expect(pageTarget(click("/brand/csb-monogram.png"), here)).toBeNull();
    expect(pageTarget(click("/sample-policy.pdf"), here)).toBeNull();
    expect(pageTarget(click("https://www.cqc.org.uk/guidance"), here)).toBeNull();
    expect(pageTarget(click("mailto:office@csb.example"), here)).toBeNull();
  });
});

describe("sidebar active state", () => {
  const p = (q = "") => new URLSearchParams(q);
  it("matches a section and everything under it, but the dashboard only on itself", () => {
    expect(isActiveHref("/policies", "/policies/abc", p())).toBe(true);
    expect(isActiveHref("/", "/policies", p())).toBe(false);
    expect(isActiveHref("/", "/", p())).toBe(true);
    expect(isActiveHref("/rota/visits?unassigned=1", "/rota/visits", p("unassigned=1&date=x"))).toBe(true);
    expect(isActiveHref("/rota/visits?unassigned=1", "/rota/visits", p())).toBe(false);
  });

  it("lights only the most specific entry", () => {
    const hrefs = ["/rota", "/rota/templates", "/rota/templates/planner"];
    expect(mostSpecificActive(hrefs, "/rota/templates/planner", p())).toBe("/rota/templates/planner");
    expect(mostSpecificActive(hrefs, "/rota/templates/abc", p())).toBe("/rota/templates");
    expect(mostSpecificActive(hrefs, "/rota/monitor", p())).toBe("/rota");
    expect(mostSpecificActive(hrefs, "/policies", p())).toBeUndefined();
  });

  it("reads a pending address the same way as the current one", () => {
    const { path, params } = splitHref("/rota/visits?unassigned=1");
    expect(path).toBe("/rota/visits");
    expect(params.get("unassigned")).toBe("1");
  });
});

describe("motion tokens", () => {
  it("are the same in CSS and in script, and stay inside the agreed range", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
    expect(token("motion-fast")).toBe(`${MOTION.fast}ms`);
    expect(token("motion-base")).toBe(`${MOTION.base}ms`);
    expect(token("motion-slow")).toBe(`${MOTION.slow}ms`);
    expect(token("motion-rise")).toBe(`${MOTION.rise}px`);
    expect(token("ease-out")).toBe(MOTION.easeOut);
    expect(token("ease-standard")).toBe(MOTION.easeStandard);
    // The brief: page entrance 180–220ms, 4–6px of travel.
    expect(MOTION.base).toBeGreaterThanOrEqual(180);
    expect(MOTION.base).toBeLessThanOrEqual(220);
    expect(MOTION.rise).toBeGreaterThanOrEqual(4);
    expect(MOTION.rise).toBeLessThanOrEqual(6);
  });

  it("switch off for people who ask for reduced motion", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
    // One rule for every element, including the HR Hub's screens, which now live inside the platform's pages.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\*, \*::before, \*::after \{ animation-duration: 0\.01ms !important/);
  });
});

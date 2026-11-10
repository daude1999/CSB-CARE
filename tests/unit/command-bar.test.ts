import { describe, expect, it } from "vitest";
import { buildRows, matchesLink, type CommandPage } from "@/components/command-bar";
import type { CommandLink, CommandResults } from "@/server/search/command";

/** How the command bar turns results, pages and actions into its grouped rows (approved redesign, 10 Nov 2026). */
const pages: CommandPage[] = [
  { label: "Rostering & Care Management", href: "/rota", hint: "Module", home: true },
  { label: "Daily Rota", href: "/rota/visits", hint: "Rostering & Care Management" },
  { label: "Policy & Compliance", href: "/", hint: "Module", home: true },
  { label: "Policy Library", href: "/policies", hint: "Policy & Compliance" },
];
const actions: CommandLink[] = [
  { label: "Add a visit", href: "/rota/visits/new", hint: "Rota" },
  { label: "Open notifications", href: "/notifications", hint: "Alerts" },
];
const results = (over: Partial<CommandResults> = {}): CommandResults => ({ q: "marg", serviceUsers: [], staff: [], visitsToday: [], referenceProblem: null, ...over });
const su = { id: "s1", title: "Margaret Example", detail: "North · next visit 16:30", href: "/rota/service-users/s1", addVisitHref: "/rota/visits/new?serviceUserId=s1", carePlanHref: "/rota/service-users/s1?tab=care-plans" };

describe("command bar rows", () => {
  it("matches every typed word against the label or its hint, in any case", () => {
    expect(matchesLink(pages[1]!, "daily")).toBe(true);
    expect(matchesLink(pages[1]!, "ROTA daily")).toBe(true);
    expect(matchesLink(pages[1]!, "rostering daily")).toBe(true);
    expect(matchesLink(pages[1]!, "daily policy")).toBe(false);
  });

  it("lists only the modules and the actions before anything is typed", () => {
    const rows = buildRows("", null, pages, actions);
    expect(rows.map((r) => [r.group, r.title])).toEqual([["Pages", "Rostering & Care Management"], ["Pages", "Policy & Compliance"], ["Actions", "Add a visit"], ["Actions", "Open notifications"]]);
  });

  it("keeps the groups in order: service users, staff, visits today, pages, actions", () => {
    const rows = buildRows("rota", results({ q: "rota", serviceUsers: [su], staff: [{ id: "t1", title: "Rota Person", detail: "Care Worker", href: "/rota/staff/t1" }], visitsToday: [{ id: "v1", hour: "12", title: "Margaret Example · Lunch call 12:00", detail: "Needs a carer", href: "/rota/visits/v1" }] }), pages, actions);
    expect([...new Set(rows.map((r) => r.group))]).toEqual(["Service users", "Staff", "Visits today", "Pages", "Actions"]);
  });

  it("puts the first service user's actions first, and leaves out Add a visit when it is not allowed", () => {
    const rows = buildRows("marg", results({ serviceUsers: [su] }), pages, actions).filter((r) => r.group === "Actions");
    expect(rows.map((r) => [r.title, r.href])).toEqual([["Add a visit for Margaret Example", su.addVisitHref], ["Open care plans for Margaret Example", su.carePlanHref]]);
    const readOnly = buildRows("marg", results({ serviceUsers: [{ ...su, addVisitHref: null }] }), pages, actions).filter((r) => r.group === "Actions");
    expect(readOnly.map((r) => r.title)).toEqual(["Open care plans for Margaret Example"]);
  });

  it("ignores record results until two letters are typed", () => {
    expect(buildRows("m", results({ serviceUsers: [su] }), pages, actions).some((r) => r.group === "Service users")).toBe(false);
  });
});

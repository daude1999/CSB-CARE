import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { arrange, overviewOrder, saveOverviewOrder, OVERVIEW_MODULES } from "@/server/overview/layout";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Each member arranges the Overview's module boxes for themselves. The order is stored on the session's own
 * membership, never anyone else's, and only known modules are accepted.
 */
beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
});

describe("arrange", () => {
  it("keeps the standard order when nothing is saved", () => {
    expect(arrange([...OVERVIEW_MODULES], [])).toEqual(["policy", "rota", "hr", "reporting", "admin"]);
  });
  it("puts saved modules first and keeps the rest in their standard order", () => {
    expect(arrange(["policy", "rota", "hr", "reporting", "admin"], ["hr", "admin"])).toEqual(["hr", "admin", "policy", "rota", "reporting"]);
  });
  it("ignores saved modules the person can no longer open", () => {
    expect(arrange(["policy", "reporting"], ["hr", "reporting", "policy"])).toEqual(["reporting", "policy"]);
  });
});

describe("saveOverviewOrder", () => {
  it("saves the order on the member's own membership only", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    await saveOverviewOrder(manager, ["admin", "policy", "rota", "hr", "reporting"]);
    expect(await overviewOrder(manager)).toEqual(["admin", "policy", "rota", "hr", "reporting"]);
    expect(await overviewOrder(author)).toEqual([]);
    // The same person in another organisation keeps a separate order.
    const other = await db.membership.findFirst({ where: { user: { email: "manager@care-solution.demo" }, organisation: { slug: OAKRIDGE } } });
    if (other) expect(other.overviewOrder).toEqual([]);
  });

  it("restores the standard order with an empty list", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    await saveOverviewOrder(manager, []);
    expect(await overviewOrder(manager)).toEqual([]);
  });

  it("rejects unknown modules, duplicates and non-lists", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    await expect(saveOverviewOrder(manager, ["policy", "payroll"])).rejects.toBeInstanceOf(ValidationError);
    await expect(saveOverviewOrder(manager, ["policy", "policy"])).rejects.toBeInstanceOf(ValidationError);
    await expect(saveOverviewOrder(manager, "policy")).rejects.toBeInstanceOf(ValidationError);
    expect(await overviewOrder(manager)).toEqual([]);
  });

  it("needs an active organisation", async () => {
    const admin = await ctxFor("admin@csb.demo");
    await expect(saveOverviewOrder(admin, ["policy"])).rejects.toBeInstanceOf(ValidationError);
    expect(await overviewOrder(admin)).toEqual([]);
  });
});

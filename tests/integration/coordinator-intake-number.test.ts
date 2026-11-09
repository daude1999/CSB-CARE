import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { createIntake } from "@/server/care/coordinator/intake";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Live bug, 7 Nov 2026: after an intake was deleted, every new intake failed because its number was already taken. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
}, 180_000);

describe("intake numbers", () => {
  it("still starts a new intake after an earlier one was deleted, with the next unused number", async () => {
    const c = await coordinator();
    const made = [];
    for (const t of ["First referral", "Second referral", "Third referral"]) made.push(await createIntake(c, { title: t, mode: "NEW" }));
    expect(made.map((i) => i.reference)).toEqual(["CI-0001", "CI-0002", "CI-0003"]);
    // Remove the middle one, as the clean-up of a test record did on the live site.
    await db.careIntakeSection.deleteMany({ where: { intakeId: made[1]!.id } });
    await db.careIntake.delete({ where: { id: made[1]!.id } });
    const next = await createIntake(c, { title: "Fourth referral", mode: "NEW" });
    expect(next.reference).toBe("CI-0004");
  });
});

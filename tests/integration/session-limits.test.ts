import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ctxFromToken, login, SESSION_MAX_AGE_MS } from "@/server/auth/session";
import { DEMO_PASSWORD } from "@/server/seed/demo";
import { resetDb, seedAll } from "../helpers";

/** Brief section 4.4: a session cannot live forever, and one network address cannot try many accounts. */
beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
}, 180_000);

describe("session limits", () => {
  it("ends a session 7 days after sign-in, however active it is", async () => {
    const { token } = await login("manager@care-solution.demo", DEMO_PASSWORD);
    expect(await ctxFromToken(token)).not.toBeNull();
    const s = await db.session.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    // Six days old and idle for ten minutes: still valid, and the extension never passes the 7-day end.
    await db.session.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - 6.9 * 86_400_000), lastSeenAt: new Date(Date.now() - 600_000) } });
    expect(await ctxFromToken(token)).not.toBeNull();
    const after = await db.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(after.createdAt.getTime() + SESSION_MAX_AGE_MS);
    // Past 7 days: refused even though the idle expiry is still in the future.
    await db.session.update({ where: { id: s.id }, data: { createdAt: new Date(Date.now() - SESSION_MAX_AGE_MS - 1000), expiresAt: new Date(Date.now() + 3_600_000) } });
    expect(await ctxFromToken(token)).toBeNull();
  });

  it("blocks one address after 30 failed sign-ins across different accounts, but not other addresses", async () => {
    const ip = "203.0.113.7, 10.0.0.1";
    for (let i = 0; i < 30; i++) await login(`nobody${i}@example.invalid`, "wrong", { ip }).catch(() => {});
    await expect(login("coordinator@care-solution.demo", DEMO_PASSWORD, { ip: "203.0.113.7" })).rejects.toThrow(/Too many/);
    await expect(login("coordinator@care-solution.demo", DEMO_PASSWORD, { ip: "198.51.100.2" })).resolves.toHaveProperty("token");
  });
});

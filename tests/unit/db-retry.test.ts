import { describe, expect, it, vi } from "vitest";
import { describeDbError, isTransientDbError, withDbRetry } from "@/lib/db-retry";
import { isSameOrigin } from "@/server/auth/current";

vi.mock("server-only", () => ({}));

const prismaError = (code: string, message = "boom") => Object.assign(new Error(message), { code, name: "PrismaClientKnownRequestError" });

describe("isTransientDbError", () => {
  it("recognises connection failures from Prisma and the pooler", () => {
    expect(isTransientDbError(prismaError("P1001"))).toBe(true);
    expect(isTransientDbError(prismaError("P2024"))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error("x"), { name: "PrismaClientInitializationError" }))).toBe(true);
    expect(isTransientDbError(new Error("FATAL: Max client connections reached"))).toBe(true);
    expect(isTransientDbError(new Error("(EMAXCONNSESSION) max clients reached in session mode"))).toBe(true);
    expect(isTransientDbError(new Error('FATAL: too many connections for role "app"'))).toBe(true);
  });

  it("leaves real query errors alone", () => {
    expect(isTransientDbError(prismaError("P2002"))).toBe(false);
    expect(isTransientDbError(prismaError("P2025"))).toBe(false);
    expect(isTransientDbError(new Error("Cross-origin request rejected"))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("retries a connection failure and returns the later result", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(prismaError("P1001")).mockResolvedValueOnce("ok");
    await expect(withDbRetry(fn, [1, 1])).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured retries", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(prismaError("P2024"));
    await expect(withDbRetry(fn, [1, 1])).rejects.toMatchObject({ code: "P2024" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never repeats a query that reached the database", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(prismaError("P2002"));
    await expect(withDbRetry(fn, [1, 1])).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("describeDbError", () => {
  it("keeps the class and code and masks credentials", () => {
    const d = describeDbError(Object.assign(new Error("cannot reach postgresql://user:secret@db.example:5432/x"), { code: "P1001" }));
    expect(d.code).toBe("P1001");
    expect(d.message).not.toContain("secret");
  });
});

describe("isSameOrigin", () => {
  it("accepts same-host and header-less requests and rejects others, including an unreadable origin", () => {
    expect(isSameOrigin("https://evantix.example", "evantix.example")).toBe(true);
    expect(isSameOrigin(null, "evantix.example")).toBe(true);
    expect(isSameOrigin("https://other.example", "evantix.example")).toBe(false);
    expect(isSameOrigin("null", "evantix.example")).toBe(false);
  });
});

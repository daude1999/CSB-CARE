import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { databaseRefusal } = await import("@/server/care/coordinator/prepare");

describe("database refusal text", () => {
  it("names the code, table and fields, never the data", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on secret value 'Ada Fictional'", { code: "P2002", clientVersion: "6", meta: { modelName: "CareTask", target: ["organisationId", "name"] } });
    expect(databaseRefusal(e)).toBe("P2002 CareTask organisationId, name");
  });
  it("covers a closed transaction", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Transaction already closed", { code: "P2028", clientVersion: "6" });
    expect(databaseRefusal(e)).toBe("P2028");
  });
  it("ignores other errors", () => {
    expect(databaseRefusal(new Error("x"))).toBeNull();
  });
});

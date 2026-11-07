import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/current", () => ({ requireCtx: vi.fn() }));
import { ValidationError } from "@/lib/errors";
import { errorReference, step } from "@/app/action-kit";

/** An unexpected failure is reported with what happened and a reference that matches the server log (7 Nov 2026). */
describe("action steps", () => {
  it("replaces an unexpected error with the step's own message and a reference, never the raw database text", async () => {
    const dbError = Object.assign(new Error("Unique constraint failed on the fields: (`organisationId`,`reference`)"), { code: "P2002" });
    const p = step("create-intake", "The intake could not be started. Nothing was saved and no document was stored.", async () => { throw dbError; });
    await expect(p).rejects.toBeInstanceOf(ValidationError);
    await expect(p).rejects.toThrow(/^The intake could not be started\. Nothing was saved and no document was stored\. Error reference: ERR-[0-9A-F]{8}\.$/);
  });
  it("passes our own messages through unchanged and returns the result when nothing fails", async () => {
    await expect(step("x", "Failed.", async () => { throw new ValidationError("Choose the person this intake updates"); })).rejects.toThrow("Choose the person this intake updates");
    await expect(step("x", "Failed.", async () => 42)).resolves.toBe(42);
  });
  it("makes a fresh reference each time", () => {
    expect(errorReference()).not.toBe(errorReference());
  });
});

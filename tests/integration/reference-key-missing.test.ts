import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { referenceKeyConfigured, registerCheckInTx } from "@/server/care/external-references";

// A live site without CSB_REFERENCE_SECRET must still read documents: the reference check says it could not run.
describe("reference register without its key", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the check as not done instead of stopping", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CSB_REFERENCE_SECRET", "");
    expect(referenceKeyConfigured()).toBe(false);
    const r = await db.$transaction((tx) => registerCheckInTx(tx, "org-none", null, { type: "COUNCIL_CLIENT", issuer: "Example Council", value: "9900176" }));
    expect(r).toMatchObject({ unchecked: true, onThisProfile: false, sameOnOtherProfiles: 0 });
  });

  it("checks normally when the key is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CSB_REFERENCE_SECRET", "test-secret");
    expect(referenceKeyConfigured()).toBe(true);
  });
});

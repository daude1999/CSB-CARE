import { describe, expect, it } from "vitest";

// PROOF ONLY: a deliberately failing test to show the Quality gate turns red. Reverted in the next commit.
describe("quality gate proof", () => {
  it("fails on purpose", () => {
    expect(1 + 1).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { coordinatorIntent } from "@/lib/coordinator-chat-intent";

describe("AI CSB Coordinator supported action routing", () => {
  it("keeps a simple greeting as ordinary Claude conversation", () => {
    expect(coordinatorIntent("Hello")).toBeNull();
    expect(coordinatorIntent("What can you do?")).toBeNull();
  });
  it("recognises explicit requests to process uploaded care documents", () => {
    expect(coordinatorIntent("Please process this support plan")).toBe("process-plan");
    expect(coordinatorIntent("I have uploaded a plan - build everything in the system")).toBe("process-plan");
    expect(coordinatorIntent("Extract the care package for this intake")).toBe("process-plan");
  });
  it("never treats publication and approval instructions as permission to modify records", () => {
    expect(coordinatorIntent("Approve all the care records")).toBeNull();
    expect(coordinatorIntent("Publish this rota")).toBeNull();
    expect(coordinatorIntent("Delete the service user")).toBeNull();
  });
});

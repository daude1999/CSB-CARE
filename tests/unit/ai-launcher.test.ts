import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pageContext, suggestedActions } from "@/components/coordinator/ai-launcher";

const all = { intake: true, createServiceUser: true, carePlans: true, buildRota: true };
const SU = "cmabcdefghij0123";

describe("AI CSB Coordinator suggested actions", () => {
  it("offers the four actions, each opening an existing screen", () => {
    expect(suggestedActions(all, "/overview").map((a) => [a.title, a.href])).toEqual([
      ["Process Support Plan", "/rota/coordinator"],
      ["Create Service User", "/rota/service-users/new"],
      ["Prepare Care Plan", "/rota/care-plans"],
      ["Build Rota", "/rota/build"],
    ]);
  });
  it("uses the service user or intake open on the page", () => {
    const su = suggestedActions(all, `/rota/service-users/${SU}`);
    expect(su.find((a) => a.key === "care-plan")?.href).toBe(`/rota/care-plans/${SU}`);
    expect(su.find((a) => a.key === "rota")?.href).toBe(`/rota/service-users/${SU}?tab=rota`);
    expect(suggestedActions(all, `/rota/coordinator/${SU}`)[0]?.href).toBe(`/rota/coordinator/${SU}`);
  });
  it("leaves out what the employee may not use", () => {
    expect(suggestedActions({ intake: false, createServiceUser: false, carePlans: true, buildRota: false }, "/rota").map((a) => a.key)).toEqual(["care-plan"]);
  });
  it("ignores addresses that are not record ids", () => {
    expect(pageContext("/rota/service-users/new")).toEqual({ intakeId: null, serviceUserId: null });
    expect(pageContext("/rota/coordinator/shift")).toEqual({ intakeId: null, serviceUserId: null });
  });
});

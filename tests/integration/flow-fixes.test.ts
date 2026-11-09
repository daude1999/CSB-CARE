import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { createServiceUser, setServiceUserStatus } from "@/server/care/service-users";
import { createRule } from "@/server/policies/assignment";
import { confirmBuild, suggestBuildWeek, templateRotaGap } from "@/server/rota/build";
import { createTemplate } from "@/server/rota/templates";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/** Server-side rules behind the review fixes of 9 Nov 2026 (synthetic people only). */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("adding a service user", () => {
  const base = { firstName: "Iris", lastName: "Fixture", carerGenderPreference: "ANY" as const };

  it("refuses a date of birth in the future", async () => {
    await expect(createServiceUser(await manager(), { ...base, dateOfBirth: addDays(londonDate(), 1) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a second record with the same NHS number", async () => {
    const m = await manager();
    await createServiceUser(m, { ...base, lastName: "Nhs", nhsNumber: "943 476 5919" });
    await expect(createServiceUser(m, { ...base, firstName: "Other", lastName: "Person", nhsNumber: "9434765919" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses the same name and date of birth unless confirmed as a different person", async () => {
    const m = await manager();
    const input = { ...base, lastName: "Twin", dateOfBirth: "1940-01-02" };
    await createServiceUser(m, input);
    await expect(createServiceUser(m, { ...input, firstName: "IRIS" })).rejects.toThrow(/same name and date of birth/);
    const second = await createServiceUser(m, input, { confirmNotDuplicate: true });
    expect(second.id).toBeTruthy();
    expect(await db.serviceUser.count({ where: { organisationId: orgId, lastName: "Twin" } })).toBe(2);
  });
});

describe("assigning a policy", () => {
  it("refuses a branch, role, job title or person that does not match the chosen target, and assigns nobody", async () => {
    const m = await manager();
    const p = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, kind: "CUSTOMER", currentPublishedVersionId: { not: null } } });
    const branch = await db.branch.findFirstOrThrow({ where: { organisationId: orgId } });
    const before = await db.policyAssignmentRule.count({ where: { policyId: p.id } });
    await expect(createRule(m, { policyId: p.id, scope: "ORG", branchId: branch.id })).rejects.toThrow(/Nothing was assigned/);
    await expect(createRule(m, { policyId: p.id, scope: "BRANCH", branchId: branch.id, orgRole: "CARER" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRule(m, { policyId: p.id, scope: "JOB_TITLE", jobTitle: "Carer", staffMemberIds: ["x"] })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.policyAssignmentRule.count({ where: { policyId: p.id } })).toBe(before);
    await createRule(m, { policyId: p.id, scope: "BRANCH", branchId: branch.id });
    expect(await db.policyAssignmentRule.count({ where: { policyId: p.id } })).toBe(before + 1);
  });
});

describe("a template added after the weeks are built", () => {
  it("is reported as missing from the built weeks until Create Future Rota adds it", async () => {
    const m = await manager();
    // Make sure next week is built for every area, as an office would have done.
    for (let i = 0; i < 2; i++) {
      const next = await suggestBuildWeek(m);
      if (next.weekStart <= addDays(londonDate(), 7)) await confirmBuild(m, { weekStart: next.weekStart });
    }
    const area = await db.area.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
    const su = await createServiceUser(m, { firstName: "Gap", lastName: "Fixture", areaId: area.id, carerGenderPreference: "ANY" });
    await setServiceUserStatus(m, su.id, "ACTIVE", "Assessment complete");
    const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId } });
    const t = await createTemplate(m, { serviceUserId: su.id, callTypeId: callType.id, cycleWeeks: [1, 2, 3, 4], weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 21 * 60 + 30, durationMin: 30, carersRequired: 1, effectiveFrom: londonDate() });
    const gap = await templateRotaGap(m, t.id);
    expect(gap?.missing).toBeGreaterThan(0);
    expect(gap?.serviceUserId).toBe(su.id);
  });
});

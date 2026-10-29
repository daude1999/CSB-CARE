import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { PLAN_SECTIONS, acknowledgePlan, approvePlan, carerCarePlan, discardDraft, draftFingerprint, returnPlan, saveDraft, startDraft, submitPlan } from "@/server/care/care-plans";
import { archiveRisk, createRisk, reviewRisk } from "@/server/care/risks";
import { closeIncident, getIncident, listIncidents, reportIncident, triageIncident } from "@/server/care/incidents";
import { myStaff } from "@/server/workforce/link";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** Care plans, risk assessments and incidents against a real database, including the database's care plan guards. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

const filled = (n: string) => Object.fromEntries(PLAN_SECTIONS.map((s) => [s.key, { body: `${s.title} for ${n}: what carers do.` }]));

async function fingerprint(planId: string) {
  const p = await db.carePlan.findUniqueOrThrow({ where: { id: planId }, include: { sections: true } });
  return draftFingerprint(p, p.sections);
}

describe("demo seed", () => {
  it("writes care records through the services: approved plans, one awaiting approval, risks and incidents", async () => {
    expect(await db.carePlan.count({ where: { organisationId: orgId, status: "ACTIVE" } })).toBe(8);
    expect(await db.carePlan.count({ where: { organisationId: orgId, status: "IN_REVIEW" } })).toBe(1);
    expect(await db.riskAssessment.count({ where: { organisationId: orgId } })).toBeGreaterThanOrEqual(10);
    expect(await db.incident.count({ where: { organisationId: orgId, status: "CLOSED" } })).toBe(1);
  });
});

describe("care plans", () => {
  it("drafts, refuses a stale save, needs every section, and needs a second person to approve", async () => {
    const c = await coordinator();
    const m = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, carePlans: { none: {} } }, orderBy: { reference: "asc" } });
    const plan = await startDraft(c, su.id);
    await expect(startDraft(c, su.id)).rejects.toBeInstanceOf(ConflictError);
    const fp = await fingerprint(plan.id);
    await saveDraft(c, plan.id, { fingerprint: fp, summary: "Summary", reviewDue: addDays(londonDate(), 90), sections: { about_me: { body: "Only this one" } } });
    await expect(saveDraft(c, plan.id, { fingerprint: fp, summary: "Other", reviewDue: addDays(londonDate(), 90), sections: {} })).rejects.toBeInstanceOf(ConflictError);
    await expect(submitPlan(c, plan.id)).rejects.toThrow(/Still empty/);
    await saveDraft(c, plan.id, { fingerprint: await fingerprint(plan.id), summary: "Summary", reviewDue: addDays(londonDate(), 90), sections: filled(su.firstName) });
    await submitPlan(c, plan.id);
    await expect(approvePlan(c, plan.id)).rejects.toBeInstanceOf(ForbiddenError); // coordinators cannot approve
    // A manager who submitted it cannot approve it either.
    await returnPlan(m, plan.id, "Check the mobility section");
    await submitPlan(m, plan.id);
    await expect(approvePlan(m, plan.id)).rejects.toThrow(/someone else must approve/);
  });

  it("supersedes the previous version on approval, freezes approved content in the database, and tells visiting carers", async () => {
    const m = await manager();
    const active = await db.carePlan.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } });
    const c = await coordinator();
    const next = await startDraft(c, active.serviceUserId);
    await saveDraft(c, next.id, { fingerprint: await fingerprint(next.id), summary: "Updated summary", reviewDue: addDays(londonDate(), 100), sections: {} });
    await submitPlan(c, next.id);
    await approvePlan(m, next.id);
    expect((await db.carePlan.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("SUPERSEDED");
    expect((await db.carePlan.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("ACTIVE");
    await expect(db.carePlan.update({ where: { id: next.id }, data: { summary: "Sneaky edit" } })).rejects.toThrow(/immutable/);
    await expect(db.carePlanSection.updateMany({ where: { carePlanId: next.id }, data: { body: "Sneaky" } })).rejects.toThrow(/cannot change/);
    await expect(db.carePlan.delete({ where: { id: active.id } })).rejects.toThrow();
    await expect(discardDraft(c, next.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lets a carer read and confirm only the plans of people they visit", async () => {
    const me = await carer();
    const staff = await myStaff(me);
    const visited = await db.visit.findFirst({ where: { organisationId: orgId, publishedAt: { not: null }, date: { gte: new Date(`${londonDate()}T00:00:00Z`) }, assignments: { some: { staffId: staff.id, removedAt: null } }, serviceUser: { carePlans: { some: { status: "ACTIVE" } } } } });
    expect(visited).not.toBeNull();
    const view = await carerCarePlan(me, visited!.serviceUserId);
    expect(view.plan?.status).toBe("ACTIVE");
    expect(await acknowledgePlan(me, visited!.serviceUserId, view.plan!.id)).toBe(true);
    expect(await acknowledgePlan(me, visited!.serviceUserId, view.plan!.id)).toBe(false);
    const stranger = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, visits: { none: { assignments: { some: { staffId: staff.id } } } } } });
    await expect(carerCarePlan(me, stranger.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("risk assessments", () => {
  it("validates, reviews with a version check, keeps the person's level in step, and archives instead of deleting", async () => {
    const c = await coordinator();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, risks: { none: {} } } });
    await expect(createRisk(c, su.id, { type: "FALLS", title: "x", hazards: "short", controls: "short", level: "HIGH", reviewDue: addDays(londonDate(), 30) })).rejects.toBeInstanceOf(ValidationError);
    const r = await createRisk(c, su.id, { type: "FALLS", title: "Falls at night", hazards: "Gets up in the night to use the toilet.", controls: "Leave the night light on and the frame by the bed.", level: "HIGH", reviewDue: addDays(londonDate(), 30) });
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).riskLevel).toBe("HIGH");
    await reviewRisk(c, r.id, 1, { type: "FALLS", title: "Falls at night", hazards: "Gets up in the night to use the toilet.", controls: "Night light on, frame by the bed, commode in the room.", level: "MEDIUM", reviewDue: addDays(londonDate(), 60) });
    await expect(reviewRisk(c, r.id, 1, { type: "FALLS", title: "Stale", hazards: "Gets up in the night to use the toilet.", controls: "Night light on, frame by the bed.", level: "LOW", reviewDue: addDays(londonDate(), 60) })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).riskLevel).toBe("MEDIUM");
    await archiveRisk(c, r.id, "Moved to a ground-floor bedroom");
    expect((await db.riskAssessment.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ARCHIVED");
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).riskLevel).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "RiskAssessment", entityId: r.id } })).toBe(3);
  });

  it("keeps another organisation out", async () => {
    const other = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(createRisk(other, su.id, { type: "OTHER", title: "Cross-tenant", hazards: "Should never be saved.", controls: "Should never be saved.", level: "LOW", reviewDue: addDays(londonDate(), 30) })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.riskAssessment.count({ where: { title: "Cross-tenant" } })).toBe(0);
  });
});

describe("incidents", () => {
  it("lets a carer report about people they visit, alerts managers for serious ones, and shows reporters only their own", async () => {
    const me = await carer();
    const staff = await myStaff(me);
    const visited = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, assignments: { some: { staffId: staff.id } } } });
    const stranger = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, visits: { none: { assignments: { some: { staffId: staff.id } } } } } });
    const base = { date: londonDate(), time: "00:01", category: "Fall", severity: "HIGH", description: "Found on the floor by the bed, conscious and talking, holding their wrist." } as const;
    await expect(reportIncident(me, { ...base, serviceUserId: stranger.id })).rejects.toBeInstanceOf(NotFoundError);
    const inc = await reportIncident(me, { ...base, serviceUserId: visited.serviceUserId, visitId: visited.id });
    expect(inc.staffId).toBe(staff.id);
    expect(await db.notification.count({ where: { type: "incident.reported", actionUrl: `/rota/incidents/${inc.id}` } })).toBeGreaterThan(0);
    const mine = await listIncidents(me, { status: "all" });
    expect(mine.every((i) => i.reportedById === me.userId)).toBe(true);
    const others = await db.incident.findFirstOrThrow({ where: { organisationId: orgId, reportedById: { not: me.userId } } });
    await expect(getIncident(me, others.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(triageIncident(me, inc.id, inc.version, { severity: "LOW", safeguarding: false, notifiable: false, note: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("needs an outcome to close, and confirmation for a possibly notifiable incident", async () => {
    const m = await manager();
    const inc = await db.incident.findFirstOrThrow({ where: { organisationId: orgId, status: "OPEN", severity: "HIGH" } });
    await triageIncident(m, inc.id, inc.version, { severity: "HIGH", safeguarding: false, notifiable: true, note: "Wrist X-ray needed; may need notifying." });
    await expect(triageIncident(m, inc.id, inc.version, { severity: "LOW", safeguarding: false, notifiable: false, note: "Stale" })).rejects.toBeInstanceOf(ConflictError);
    await expect(closeIncident(m, inc.id, inc.version + 1, "Too short", true)).rejects.toBeInstanceOf(ValidationError);
    await expect(closeIncident(m, inc.id, inc.version + 1, "Hospital confirmed a sprain only. Falls risk assessment reviewed.", false)).rejects.toThrow(/notifiable/);
    await closeIncident(m, inc.id, inc.version + 1, "Hospital confirmed a sprain only. Falls risk assessment reviewed.", true);
    expect((await db.incident.findUniqueOrThrow({ where: { id: inc.id } })).status).toBe("CLOSED");
  });
});

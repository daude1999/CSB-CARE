import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { archiveRisk, createRisk, getRisk, listRisks, reviewRisk, reviewState } from "@/server/care/risks";
import { getIncident, reportIncident, triageIncident } from "@/server/care/incidents";
import { serviceUserCompliance, serviceUserVisitNotes } from "@/server/care/su-records";
import { addVisitNote } from "@/server/care/visit-record";
import { getServiceUser } from "@/server/care/service-users";
import { createVisit } from "@/server/rota/visits";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Service user profile records against the real schema: risk assessment versions (kept and frozen), required actions,
 * review markers, who was told about an incident, the risk-review prompt, a person's visit notes and the compliance
 * summary, and that none of it leaks to another person or another organisation. All data is synthetic.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let suId = "";
let otherSuId = "";
let callTypeId = "";

const RISK = { type: "FALLS", title: "Falls on the stairs", hazards: "Unsteady on the stairs in the evening when tired.", controls: "Walk behind on the stairs and keep the landing light on.", level: "MEDIUM", reviewDue: addDays(londonDate(), 120) };

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const people = await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null } }, orderBy: { lastName: "asc" }, take: 2 });
  suId = people[0]!.id;
  otherSuId = people[1]!.id;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
}, 240_000);

describe("risk assessments keep every version", () => {
  it("saves a version on create, review and archive, and earlier versions never change", async () => {
    const ctx = await manager();
    const r = await createRisk(ctx, suId, { ...RISK, requiredActions: "Ask the OT about a second stair rail", responsiblePerson: "Care coordinator" });
    await reviewRisk(ctx, r.id, 1, { ...RISK, level: "HIGH", controls: "Two carers on the stairs until the rail is fitted.", requiredActions: "Chase the OT referral", responsiblePerson: "Registered manager" });
    // A stale review is refused, not merged.
    await expect(reviewRisk(ctx, r.id, 1, RISK)).rejects.toBeInstanceOf(ConflictError);
    await archiveRisk(ctx, r.id, "Moved to a ground-floor flat");
    const { risk, versions } = await getRisk(ctx, r.id);
    expect(risk.version).toBe(3);
    expect(versions.map((v) => [v.version, v.change, v.level, v.status])).toEqual([
      [3, "ARCHIVED", "HIGH", "ARCHIVED"],
      [2, "REVIEWED", "HIGH", "ACTIVE"],
      [1, "CREATED", "MEDIUM", "ACTIVE"],
    ]);
    const v1 = versions.find((v) => v.version === 1)!;
    expect(v1.controls).toBe(RISK.controls);
    expect(v1.requiredActions).toBe("Ask the OT about a second stair rail");
    expect(v1.responsiblePerson).toBe("Care coordinator");
    expect(versions[0]!.reason).toBe("Moved to a ground-floor flat");
    // The database refuses to edit or delete a saved version.
    await expect(db.riskAssessmentVersion.update({ where: { id: v1.id }, data: { controls: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.riskAssessmentVersion.delete({ where: { id: v1.id } })).rejects.toThrow(/cannot be deleted/);
    // Archived assessments are listed separately and never disappear.
    expect((await listRisks(ctx, { serviceUserId: suId, archived: true })).map((x) => x.id)).toContain(r.id);
    expect((await listRisks(ctx, { serviceUserId: suId })).map((x) => x.id)).not.toContain(r.id);
  });

  it("needs a responsible person when actions are required", async () => {
    const ctx = await manager();
    await expect(createRisk(ctx, suId, { ...RISK, requiredActions: "Fit a grab rail" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("marks reviews as overdue, due soon or in date", () => {
    const today = "2026-11-02";
    expect(reviewState(new Date("2026-11-01T00:00:00Z"), today)).toBe("OVERDUE");
    expect(reviewState(new Date("2026-11-02T00:00:00Z"), today)).toBe("DUE_SOON");
    expect(reviewState(new Date("2026-12-02T00:00:00Z"), today)).toBe("DUE_SOON");
    expect(reviewState(new Date("2026-12-03T00:00:00Z"), today)).toBe("IN_DATE");
  });

  it("only lists the selected person's assessments", async () => {
    const ctx = await manager();
    const mine = await createRisk(ctx, suId, { ...RISK, title: "Only for the first person" });
    const theirs = await listRisks(ctx, { serviceUserId: otherSuId });
    expect(theirs.map((x) => x.id)).not.toContain(mine.id);
    expect(theirs.every((x) => x.serviceUserId === otherSuId)).toBe(true);
  });
});

describe("incidents on the profile", () => {
  it("records who was told, keeps changes to it in the timeline, and prompts a risk review", async () => {
    const ctx = await manager();
    const yesterday = addDays(londonDate(), -1);
    const inc = await reportIncident(ctx, { serviceUserId: suId, date: yesterday, time: "10:15", category: "Fall", severity: "LOW", description: "Found sitting on the bedroom floor. No injury seen, helped up with the frame.", peopleNotified: "Daughter by phone at 10:30" });
    expect(inc.peopleNotified).toBe("Daughter by phone at 10:30");
    const prompts = await db.notification.findMany({ where: { organisationId: orgId, type: "risk.review.prompt", dedupeKey: { startsWith: `risk-prompt:${inc.id}:` } } });
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]!.actionUrl).toBe(`/rota/service-users/${suId}?tab=risks`);
    await triageIncident(ctx, inc.id, 1, { severity: "LOW", safeguarding: false, notifiable: false, note: "Checked with the GP", peopleNotified: "Daughter by phone at 10:30; GP surgery" });
    const { incident, history } = await getIncident(ctx, inc.id);
    expect(incident.peopleNotified).toBe("Daughter by phone at 10:30; GP surgery");
    const triaged = history.find((h) => h.action === "incident.triaged")!;
    expect(triaged.data).toMatchObject({ peopleNotified: { from: "Daughter by phone at 10:30", to: "Daughter by phone at 10:30; GP surgery" } });
  });

  it("does not prompt a risk review for an incident that is not about a person", async () => {
    const ctx = await manager();
    const inc = await reportIncident(ctx, { date: addDays(londonDate(), -1), time: "09:00", category: "Fall", severity: "LOW", description: "A carer slipped on ice outside the office car park. No injury." });
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `risk-prompt:${inc.id}:` } } })).toBe(0);
  });
});

describe("a person's visit notes and records summary", () => {
  it("shows only this person's notes, with the visit and who wrote them", async () => {
    const ctx = await manager();
    const day = addDays(londonDate(), -2);
    const mine = await createVisit(ctx, { serviceUserId: suId, callTypeId, date: day, startMinute: 23 * 60, durationMin: 30, carersRequired: 1 });
    const theirs = await createVisit(ctx, { serviceUserId: otherSuId, callTypeId, date: day, startMinute: 23 * 60, durationMin: 30, carersRequired: 1 });
    await addVisitNote(ctx, mine.id, { category: "CONCERN", text: "Synthetic: seemed more breathless than usual" });
    await addVisitNote(ctx, theirs.id, { category: "GENERAL", text: "Synthetic: note for someone else" });
    const res = await serviceUserVisitNotes(ctx, suId);
    expect(res!.notes.some((n) => n.text === "Synthetic: seemed more breathless than usual")).toBe(true);
    expect(res!.notes.some((n) => n.text === "Synthetic: note for someone else")).toBe(false);
    const n = res!.notes.find((x) => x.visit.id === mine.id)!;
    expect(n.fromOffice).toBe(true);
    expect(n.visit.scheduledStart).toEqual(mine.scheduledStart);
    const concerns = await serviceUserVisitNotes(ctx, suId, { category: "CONCERN" });
    expect(concerns!.notes.every((x) => x.category === "CONCERN")).toBe(true);
  });

  it("counts the summary from real records", async () => {
    const ctx = await manager();
    const su = await getServiceUser(ctx, suId);
    const rows = await serviceUserCompliance(ctx, su);
    const by = new Map(rows.map((r) => [r.key, r]));
    expect([...by.keys()]).toEqual(["care-plan", "risks", "incidents", "notes"]);
    const active = await db.riskAssessment.count({ where: { serviceUserId: suId, status: "ACTIVE" } });
    expect(by.get("risks")!.detail).toContain(`${active} active`);
    const open = await db.incident.count({ where: { serviceUserId: suId, status: { not: "CLOSED" } } });
    expect(by.get("incidents")!.value).toBe(open ? `${open} open` : "None open");
    expect(by.get("notes")!.value).toMatch(/concern/);
    expect(by.get("care-plan")!.href).toBe(`/rota/service-users/${suId}?tab=care-plans`);
  });

  it("never shows another organisation's person or notes", async () => {
    const other = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(getServiceUser(other, suId)).rejects.toThrow();
    const res = await serviceUserVisitNotes(other, suId);
    expect(res!.notes).toEqual([]);
    expect(await listRisks(other, { serviceUserId: suId })).toEqual([]);
  });
});

import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { AiUnavailableError } from "@/server/ai/provider";
import { SimulatedProvider } from "@/server/ai/simulated";
import { DatabaseStorage, setStorageForTests } from "@/server/storage";
import { addObservationNote, assignObservationReviewer, bodyMapCounts, listObservations, observationAudit, readObservationPhoto, recordObservation, reviewObservation } from "@/server/care/body-map";
import {
  acceptRecommendation, autoRecommend, bodyMapAiAvailability, createTaskFromRecommendation, dismissRecommendation, escalationPrompts, generateRecommendations, guardRecommendations,
  recommendationContext, recommendationRuns, setBodyMapAiEnabled, startRecommendationReview,
} from "@/server/care/body-map-ai";
import { closeBodyMapTask, createBodyMapTask } from "@/server/care/body-map-tasks";
import { linkedRecords } from "@/server/care/body-map-links";
import { addMedication, approveMedication, setMedicationEnabled } from "@/server/care/medication";
import { applicationSites, endApplicationSite, recordApplicationSite } from "@/server/care/medication-sites";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Digital Body Map enhancements against a real database: manual notes, reviewer and review tasks, medication
 * application sites, and AI-Assisted Recommendations with human review. AI output comes from the labelled simulated
 * provider or from deterministic test providers; nothing calls a real AI service.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

const png = (fill = 1) => ({ name: "photo.png", type: "image/png", bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, fill)]) });
const today = londonDate();
const yesterday = addDays(today, -1);
const input = (over: Record<string, unknown> = {}) => ({ view: "FRONT", x: 59, y: 80, region: "Left shin", category: "Bruising", date: yesterday, time: "09:50", description: "Purple bruise on the left lower leg, skin intact.", size: "6 cm x 4 cm", appearance: "Purple", pain: "MILD", actionTaken: "Informed the office", personNotified: "Care coordinator", followUpRequired: "yes", followUpOn: addDays(today, 7), ...over });

let orgId = "";
let suId = "";
let su2Id = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setStorageForTests(new DatabaseStorage());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const people = await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { reference: "asc" }, take: 2 });
  suId = people[0]!.id;
  su2Id = people[1]!.id;
}, 180_000);

afterEach(() => setAiProviderForTests(undefined));

async function aiOn() {
  await setBodyMapAiEnabled(await manager(), true, "Test DPIA and clinical safety review, 3 Nov 2026");
  setAiProviderForTests(new SimulatedProvider());
}

describe("manual recording and notes", () => {
  it("records a long description, several photos, a reviewer and a follow-up, and validates the follow-up switch", async () => {
    const c = await coordinator();
    const m = await manager();
    const long = `Large bruise. ${"Observed carefully and described in full. ".repeat(90)}`.slice(0, 3990).trim();
    const o = await recordObservation(c, suId, input({ description: long, reviewerId: m.userId }), [png(1), png(2)]);
    const [row] = (await listObservations(c, suId)).filter((x) => x.id === o.id);
    expect(row!.description).toBe(long);
    expect(row!.photos).toHaveLength(2);
    expect(row!.reviewerId).toBe(m.userId);
    await expect(recordObservation(c, suId, input({ followUpOn: "" }))).rejects.toThrow(/follow-up date/);
    const none = await recordObservation(c, suId, input({ followUpRequired: "no", followUpOn: addDays(today, 3) }));
    expect((await db.bodyMapObservation.findUniqueOrThrow({ where: { id: none.id } })).followUpOn).toBeNull();
    await expect(recordObservation(c, suId, input({ reviewerId: c.userId }))).rejects.toBeInstanceOf(ValidationError);
    await expect(recordObservation(c, suId, input({ description: "x".repeat(4001) }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("adds notes on top without changing the observation; notes cannot be edited; photos stay private", async () => {
    const c = await coordinator();
    const o = await recordObservation(c, suId, input());
    const before = await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id } });
    const n = await addObservationNote(c, o.id, "Reviewed today. Bruising appears smaller and the service user reports no discomfort.", png(3));
    await addObservationNote(c, o.id, "Second update: no change.");
    const after = await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id }, include: { notes: true, photos: true } });
    expect(after.description).toBe(before.description);
    expect(after.notes.map((x) => x.text)).toHaveLength(2);
    expect(after.notes[0]!.authorId).toBe(c.userId);
    expect(after.photos.find((p) => p.noteId === n.id)).toBeTruthy();
    await expect(db.bodyMapNote.update({ where: { id: n.id }, data: { text: "changed" } })).rejects.toThrow();
    await expect(addObservationNote(c, o.id, "")).rejects.toBeInstanceOf(ValidationError);
    await expect(addObservationNote(await carer(), o.id, "Carer note")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addObservationNote(await otherOrg(), o.id, "Other organisation")).rejects.toBeInstanceOf(NotFoundError);
    const photo = after.photos[0]!;
    await expect(readObservationPhoto(await carer(), photo.id)).rejects.toBeInstanceOf(ForbiddenError);
    const audit = await observationAudit(c, o.id);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["bodyMap.recorded", "bodyMap.noteAdded"]));
  });

  it("assigns a reviewer with optimistic locking and tells them", async () => {
    const c = await coordinator();
    const m = await manager();
    const o = await recordObservation(c, suId, input());
    await expect(assignObservationReviewer(c, o.id, o.version, m.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await assignObservationReviewer(m, o.id, o.version, m.userId);
    await expect(assignObservationReviewer(m, o.id, o.version, m.userId)).rejects.toBeInstanceOf(ConflictError);
    expect((await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id } })).reviewerId).toBe(m.userId);
  });
});

describe("escalation prompts (fixed rules, not AI)", () => {
  const base = { category: "Bruising", pain: "MILD", description: "Bruise, skin intact.", appearance: null };
  it("prompts for severe pain, burns, pressure sores, open skin, unexplained marks and repeats", () => {
    expect(escalationPrompts(base, 0)).toEqual([]);
    expect(escalationPrompts({ ...base, pain: "SEVERE" }, 0).map((p) => p.code)).toEqual(["SEVERE_PAIN"]);
    expect(escalationPrompts({ ...base, category: "Burn" }, 0).map((p) => p.code)).toEqual(["BURN"]);
    expect(escalationPrompts({ ...base, category: "Pressure sore" }, 0).map((p) => p.code)).toEqual(["PRESSURE_SORE"]);
    expect(escalationPrompts({ ...base, description: "Skin tear that is bleeding a little." }, 0).map((p) => p.code)).toEqual(["OPEN_SKIN"]);
    expect(escalationPrompts({ ...base, description: "No bleeding, skin not broken." }, 0)).toEqual([]);
    const u = escalationPrompts({ ...base, description: "Unexplained bruise; she does not know how it happened." }, 0);
    expect(u.map((p) => p.kind)).toEqual(["SAFEGUARDING"]);
    expect(escalationPrompts(base, 2).map((p) => p.code)).toEqual(["REPEATED"]);
  });
});

describe("AI-Assisted Recommendations", () => {
  it("is off by default: nothing is generated automatically and asking is refused, while saving still works", async () => {
    const c = await coordinator();
    expect((await bodyMapAiAvailability(c)).state).toBe("off");
    const o = await recordObservation(c, suId, input());
    expect(await autoRecommend(c, o.id)).toBeNull();
    await expect(generateRecommendations(c, o.id, "MANUAL")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.bodyMapRecommendationRun.count({ where: { observationId: o.id } })).toBe(0);
  });

  it("generates labelled, cited suggestions after saving, never twice for the same information, and refreshes when the record changes", async () => {
    await aiOn();
    const c = await coordinator();
    const o = await recordObservation(c, suId, input({ followUpRequired: "no" }));
    const auto = await autoRecommend(c, o.id);
    expect(auto?.status).toBe("CREATED");
    const runs = await recommendationRuns(c, o.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.trigger).toBe("AUTO");
    expect(runs[0]!.isSimulated).toBe(true);
    const recs = runs[0]!.recommendations;
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.title.startsWith("[SIMULATED]")).toBe(true);
      expect(r.sources.length).toBeGreaterThan(0);
    }
    expect(recs.map((r) => r.category)).toEqual(expect.arrayContaining(["OBSERVATION_FOLLOW_UP", "INCIDENT_SAFEGUARDING"]));
    // Same information again: nothing new.
    expect((await generateRecommendations(c, o.id, "MANUAL")).status).toBe("UP_TO_DATE");
    // A note changes the information: a new run supersedes the old one without changing it.
    await addObservationNote(c, o.id, "Bruise now 4 cm x 3 cm.");
    expect((await generateRecommendations(c, o.id, "MANUAL")).status).toBe("CREATED");
    const after = await recommendationRuns(c, o.id);
    expect(after).toHaveLength(2);
    expect(after[1]!.supersededAt).not.toBeNull();
    expect(after[1]!.recommendations.map((r) => r.title)).toEqual(recs.map((r) => r.title));
    expect(after[0]!.sources.some((s) => s.kind === "Note")).toBe(true);
    // The text shown to the reviewer cannot be rewritten.
    await expect(db.bodyMapRecommendation.update({ where: { id: recs[0]!.id }, data: { title: "Rewritten" } })).rejects.toThrow();
    const audit = await observationAudit(c, o.id);
    expect(audit.filter((a) => a.action === "bodyMap.ai.generated")).toHaveLength(2);
  });

  it("sends no photographs or names and states what was missing", async () => {
    await aiOn();
    const c = await coordinator();
    const o = await recordObservation(c, su2Id, input({ view: "BACK", x: 50, y: 42, region: "Base of spine (sacrum)", category: "Pressure sore" }), png(4));
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: su2Id } });
    const { input: sent, limits } = await recommendationContext(c, o.id);
    const text = JSON.stringify(sent);
    expect(text).not.toContain(su.lastName);
    expect(text).not.toMatch(/storageKey|sha256|photo\.png/);
    expect(sent.observation.photoCount).toBe(1);
    expect(limits.join(" ")).toMatch(/Photographs are never sent/);
    expect(limits.join(" ")).toMatch(/Medication records were not considered/);
  });

  it("records an outage or a malformed answer as a failed attempt, and the observation is unaffected", async () => {
    await aiOn();
    const c = await coordinator();
    const o = await recordObservation(c, suId, input());
    setAiProviderForTests(Object.assign(new SimulatedProvider(), { recommendBodyMap: async () => { throw new AiUnavailableError("Provider down"); } }));
    const r1 = await generateRecommendations(c, o.id, "MANUAL");
    expect(r1.status).toBe("FAILED");
    setAiProviderForTests(Object.assign(new SimulatedProvider(), { recommendBodyMap: async () => ({ recommendations: [{ category: "NOT_A_CATEGORY" }], gaps: [] }) as never }));
    const r2 = await generateRecommendations(c, o.id, "MANUAL");
    expect(r2.status).toBe("FAILED");
    expect(await autoRecommend(c, o.id)).toMatchObject({ status: "FAILED" });
    const saved = await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved.status).toBe("OPEN");
    expect(await db.bodyMapRecommendation.count({ where: { observationId: o.id } })).toBe(0);
    // A failed attempt does not block a later successful one with the same information.
    setAiProviderForTests(new SimulatedProvider());
    expect((await generateRecommendations(c, o.id, "MANUAL")).status).toBe("CREATED");
  });

  it("drops uncited, invented or unsafe suggestions and says so", async () => {
    const out = guardRecommendations({
      recommendations: [
        { category: "RISK_REVIEW", title: "Consider risk review", explanation: "Records show a bruise.", suggestedAction: "Review", actionKind: "RISK_REVIEW", facts: [], sources: ["O1"] },
        { category: "RISK_REVIEW", title: "Invented", explanation: "From a record that was not sent.", suggestedAction: "Review", actionKind: null, facts: [], sources: ["R9"] },
        { category: "INCIDENT_SAFEGUARDING", title: "Abuse has occurred", explanation: "Abuse has occurred.", suggestedAction: "Report", actionKind: null, facts: [], sources: ["O1"] },
        { category: "MEDICATION_REVIEW", title: "Increase the dose", explanation: "x", suggestedAction: "Increase the dose of the cream", actionKind: null, facts: [], sources: ["O1"] },
        { category: "OBSERVATION_FOLLOW_UP", title: "Diagnosis", explanation: "This is a grade 2 pressure ulcer", suggestedAction: "x", actionKind: null, facts: [], sources: ["O1"] },
      ],
      gaps: [],
    }, new Set(["O1"]));
    expect(out.kept.map((k) => k.title)).toEqual(["Consider risk review"]);
    expect(out.dropped).toBe(4);
    // A model that returns nothing reliable: a clear "none" result instead of invented text.
    return undefined;
  });

  it("records 'no reliable recommendation' instead of inventing one", async () => {
    await aiOn();
    setAiProviderForTests(Object.assign(new SimulatedProvider(), { recommendBodyMap: async () => ({ recommendations: [], gaps: ["Too little recorded to suggest anything."] }) }));
    const c = await coordinator();
    const o = await recordObservation(c, suId, input());
    expect((await generateRecommendations(c, o.id, "MANUAL")).status).toBe("NONE");
    const [run] = await recommendationRuns(c, o.id);
    expect(run!.gaps).toContain("Too little recorded to suggest anything.");
  });

  it("lets a manager review, accept, dismiss (with a reason where required) and create a task; never anyone else", async () => {
    await aiOn();
    const c = await coordinator();
    const m = await manager();
    const o = await recordObservation(c, suId, input({ followUpRequired: "no" }));
    await generateRecommendations(c, o.id, "MANUAL");
    const recs = (await recommendationRuns(c, o.id))[0]!.recommendations;
    const follow = recs.find((r) => r.category === "OBSERVATION_FOLLOW_UP")!;
    const incident = recs.find((r) => r.category === "INCIDENT_SAFEGUARDING")!;
    const risk = recs.find((r) => r.category === "RISK_REVIEW")!;
    await expect(acceptRecommendation(c, follow.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(acceptRecommendation(await otherOrg(), follow.id)).rejects.toBeInstanceOf(NotFoundError);
    await startRecommendationReview(m, follow.id);
    await expect(startRecommendationReview(m, follow.id)).rejects.toBeInstanceOf(ConflictError);
    await acceptRecommendation(m, follow.id, "Agreed, set a follow-up");
    await expect(dismissRecommendation(m, incident.id)).rejects.toBeInstanceOf(ValidationError);
    await dismissRecommendation(m, incident.id, "Known cause recorded; incident decision made separately.");
    await expect(acceptRecommendation(m, incident.id)).rejects.toBeInstanceOf(ConflictError);
    // Accepted suggestions can still become a task; the task uses the normal permissions.
    await expect(createTaskFromRecommendation(m, follow.id, { assigneeId: c.userId, dueOn: addDays(today, -1) })).rejects.toBeInstanceOf(ValidationError);
    const task = await createTaskFromRecommendation(m, follow.id, { assigneeId: c.userId, dueOn: addDays(today, 2) });
    expect(task.kind).toBe("FOLLOW_UP");
    expect((await db.bodyMapRecommendation.findUniqueOrThrow({ where: { id: follow.id } })).status).toBe("ACTION_CREATED");
    await expect(createTaskFromRecommendation(m, follow.id, { assigneeId: c.userId, dueOn: addDays(today, 2) })).rejects.toBeInstanceOf(ConflictError);
    // A risk review request must go to someone who can do it.
    await expect(createTaskFromRecommendation(m, risk.id, { assigneeId: c.userId, dueOn: addDays(today, 2) })).rejects.toBeInstanceOf(ValidationError);
    await createTaskFromRecommendation(m, risk.id, { assigneeId: m.userId, dueOn: addDays(today, 2) });
    expect(await db.notification.count({ where: { userId: c.userId, type: "bodyMap.task", dedupeKey: `body-map-task:${task.id}` } })).toBe(1);
    // The assignee closes it with an outcome; a second close is refused.
    await expect(closeBodyMapTask(c, task.id, task.version, { outcome: "", done: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(closeBodyMapTask(c, task.id, task.version, { outcome: "Not needed", done: false })).rejects.toBeInstanceOf(ForbiddenError);
    await closeBodyMapTask(c, task.id, task.version, { outcome: "Follow-up booked for Friday", done: true });
    await expect(closeBodyMapTask(c, task.id, task.version, { outcome: "Again", done: true })).rejects.toBeInstanceOf(ConflictError);
    // Nothing about the observation's clinical content or status changed.
    const saved = await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved.status).toBe("OPEN");
    expect(saved.incidentDecision).toBeNull();
    const counts = await bodyMapCounts(m, suId);
    expect(counts!.openTasks.RISK_REVIEW).toBeGreaterThanOrEqual(1);
    const actions = (await observationAudit(m, o.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["bodyMap.ai.reviewStarted", "bodyMap.ai.accepted", "bodyMap.ai.dismissed", "bodyMap.taskCreated", "bodyMap.taskDone"]));
  });

  it("keeps organisations and branches apart", async () => {
    await aiOn();
    const c = await coordinator();
    const o = await recordObservation(c, suId, input());
    const x = await otherOrg();
    await expect(generateRecommendations(x, o.id, "MANUAL")).rejects.toThrow();
    await expect(recommendationRuns(x, o.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(linkedRecords(x, o.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createBodyMapTask(x, o.id, { kind: "FOLLOW_UP", assigneeId: x.userId, dueOn: today })).rejects.toBeInstanceOf(NotFoundError);
    await expect(recommendationRuns(await carer(), o.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("care records and medication", () => {
  it("uses the person's risk assessments and care plan, and medication only when switched on; sites never create a MAR record", async () => {
    const c = await coordinator();
    const m = await manager();
    await aiOn();
    await db.riskAssessment.create({ data: { organisationId: orgId, serviceUserId: suId, type: "PRESSURE_SKIN", title: "Skin integrity", hazards: "Fragile skin on the lower legs", controls: "Check skin at each personal care visit", level: "MEDIUM", reviewDue: new Date(`${addDays(today, 30)}T00:00:00Z`), assessedById: m.userId } });
    const o = await recordObservation(c, suId, input());
    const links = await linkedRecords(c, o.id);
    expect(links.risks.map((r) => r.title)).toContain("Skin integrity");
    expect(links.medication.enabled).toBe(false);
    const ctxBefore = await recommendationContext(c, o.id);
    expect(ctxBefore.input.records.some((r) => r.kind === "Risk assessment")).toBe(true);
    expect(ctxBefore.input.records.some((r) => r.kind.startsWith("Medication") || r.kind.startsWith("Topical"))).toBe(false);

    // Sites need the medication switch, a manager, and an approved topical medicine.
    await expect(recordApplicationSite(m, suId, { medicationId: "x", view: "FRONT", x: 59, y: 80 })).rejects.toThrow(/switched off/);
    await setMedicationEnabled(m, true, "Clinical review by test nurse, 3 Nov 2026");
    const tablet = await addMedication(m, suId, { name: "Paracetamol", dose: "1 tablet", route: "ORAL", support: "PROMPT", timeRanges: ["MORNING"], startDate: addDays(today, -1) });
    const cream = await addMedication(m, suId, { name: "Emollient cream", dose: "Thin layer", route: "TOPICAL", support: "ASSIST", timeRanges: ["MORNING"], instructions: "Both lower legs", startDate: addDays(today, -1) });
    await expect(recordApplicationSite(m, suId, { medicationId: cream.id, view: "FRONT", x: 59, y: 80 })).rejects.toThrow(/approved/);
    await approveMedication(c.userId === m.userId ? m : { ...m, userId: c.userId }, cream.id);
    await approveMedication({ ...m, userId: c.userId }, tablet.id);
    await expect(recordApplicationSite(m, suId, { medicationId: tablet.id, view: "FRONT", x: 59, y: 80 })).rejects.toThrow(/creams, ointments and patches/);
    await expect(recordApplicationSite(c, suId, { medicationId: cream.id, view: "FRONT", x: 59, y: 80 })).rejects.toBeInstanceOf(ForbiddenError);
    const marBefore = await db.marRecord.count();
    const site = await recordApplicationSite(m, suId, { medicationId: cream.id, view: "FRONT", x: 59, y: 80, region: "Left shin" });
    expect((await applicationSites(m, suId)).sites.map((s) => s.id)).toContain(site.id);
    const linked = await linkedRecords(m, o.id);
    expect(linked.medication.sameArea.map((s) => s.medication.name)).toContain("Emollient cream");
    await addObservationNote(c, o.id, "Rechecked.");
    await generateRecommendations(c, o.id, "MANUAL");
    const recs = (await recommendationRuns(c, o.id))[0]!.recommendations;
    expect(recs.some((r) => r.category === "MEDICATION_REVIEW")).toBe(true);
    for (const r of recs) expect(`${r.title} ${r.explanation} ${r.suggestedAction}`).not.toMatch(/\b(administer|increase|decrease|stop the|start the)\b/i);
    expect(await db.marRecord.count()).toBe(marBefore);
    await expect(endApplicationSite(m, site.id, "")).rejects.toBeInstanceOf(ValidationError);
    await endApplicationSite(m, site.id, "Course finished");
    await expect(endApplicationSite(m, site.id, "Again")).rejects.toBeInstanceOf(ConflictError);
    await setMedicationEnabled(m, false, "");
  });

  it("keeps existing follow-ups working alongside notes", async () => {
    const c = await coordinator();
    const o = await recordObservation(c, suId, input());
    await reviewObservation(c, o.id, o.version, { outcome: "Smaller today", nextFollowUpOn: addDays(today, 3) });
    await addObservationNote(c, o.id, "Daughter informed of progress.");
    const row = (await listObservations(c, suId)).find((x) => x.id === o.id)!;
    expect(row.reviews).toHaveLength(1);
    expect(row.notes).toHaveLength(1);
  });
});

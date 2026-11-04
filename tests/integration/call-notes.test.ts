import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import type { CallNoteOrganisation } from "@/server/ai/schemas";
import {
  closeFollowUp, correctCallNote, createCallNote, createFollowUp, draftForReview, duplicateCandidates, linkRecord, listCallNotes, recordEscalation, resolveRoutedItem, reviewCallNote,
  sendCallNoteReminders, submitOrganised, supersedeCallNote, withdrawDraft, type CallNoteInput,
} from "@/server/care/call-notes";
import { activeReminders } from "@/server/rota/dashboard";
import { serviceUserVisitNotes } from "@/server/care/su-records";
import { addManualFact, createIntake, decideSection, getIntake, submitIntake } from "@/server/care/coordinator/intake";
import { applySection } from "@/server/care/coordinator/apply";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Service user Call Notes against a real database, synthetic people only: create, organise (with and without AI),
 * classify, duplicate checks, routing, review, follow-ups, reminders, corrections, isolation and the Care Coordinator.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const secondManager = () => ctxFor("reviewer@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

const EXAMPLE = "Spoke to the daughter today. She said her mother has not been sleeping well, she would prefer carers to arrive slightly earlier in the morning and she is waiting for the GP to call about her medication.";

let orgId = "";
let suId = "";
let otherSuId = "";
let coordinatorId = "";
let managerId = "";
const today = londonDate();

const base = (over: Partial<CallNoteInput> = {}): CallNoteInput => ({ submissionKey: randomUUID(), date: today, time: "09:30", method: "TELEPHONE", contactName: "Jane Example", contactRole: "Daughter", details: EXAMPLE, ...over });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const reviewer = await db.user.findUniqueOrThrow({ where: { email: "reviewer@care-solution.demo" } });
  await db.membership.update({ where: { userId_organisationId: { userId: reviewer.id, organisationId: orgId } }, data: { roles: { push: "CARE_MANAGER" } } });
  coordinatorId = (await coordinator()).userId;
  managerId = (await manager()).userId;
  const people = await db.serviceUser.findMany({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null } }, orderBy: { lastName: "asc" }, select: { id: true, areaId: true } });
  suId = people[0]!.id;
  otherSuId = people.find((p) => p.areaId !== people[0]!.areaId)!.id;
}, 180_000);

describe("1. Manual notes", () => {
  it("a coordinator records a note for the right person, with the original text kept, and it goes for review", async () => {
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ summary: "Wellbeing and morning visit time", followUpRequired: true, followUpText: "Confirm the requested visit time with the family", followUpOwnerId: coordinatorId, followUpDueOn: addDays(today, 1) }));
    expect(note.reference).toMatch(/^CALL-\d{4}-000001$/);
    expect(note).toMatchObject({ serviceUserId: suId, organisationId: orgId, createdById: coordinatorId, status: "AWAITING_REVIEW", origin: "MANUAL", originalText: EXAMPLE });
    const tasks = await db.callNoteTask.findMany({ where: { callNoteId: note.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assigneeId: coordinatorId, status: "OPEN" });
    const log = await db.auditLog.findFirst({ where: { entityType: "CallNote", entityId: note.id, action: "callNote.created" } });
    expect(log).not.toBeNull();
  });

  it("a repeated or retried submission returns the same note, never a second one, and references are never reused", async () => {
    const c = await coordinator();
    const key = randomUUID();
    const a = await createCallNote(c, suId, base({ submissionKey: key, summary: "Retry test" }));
    const b = await createCallNote(c, suId, base({ submissionKey: key, summary: "Retry test" }));
    expect(b.repeated).toBe(true);
    expect(b.note.id).toBe(a.note.id);
    expect(await db.callNote.count({ where: { submissionKey: key } })).toBe(1);
    const second = await createCallNote(c, suId, base({ summary: "Another" }));
    expect(second.note.reference).not.toBe(a.note.reference);
  });

  it("a manager's own typed note (no AI) is recorded as approved; invalid input is refused with a clear message", async () => {
    const m = await manager();
    const { note } = await createCallNote(m, suId, base({ summary: "Manager spoke to the social worker", details: "Social worker confirmed the annual review is booked." }));
    expect(note.status).toBe("APPROVED");
    await expect(createCallNote(m, suId, base({ contactName: "" }))).rejects.toThrow(ValidationError);
    await expect(createCallNote(m, suId, base({ date: addDays(today, 2) }))).rejects.toThrow(/future/);
    await expect(createCallNote(m, suId, base({ summary: "", details: "" }))).rejects.toThrow(/summary or the conversation notes/);
  });

  it("works with no AI provider at all", async () => {
    setAiProviderForTests(null);
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ organise: true }));
    expect(note).toMatchObject({ status: "DRAFT", origin: "BASIC_ORGANISER", reader: "basic-organiser" });
    setAiProviderForTests(new SimulatedProvider());
  });
});

describe("2. Organising, classification, duplicates and routing", () => {
  let draftId = "";
  it("organises the text into accurate bullets copied from the original, classified and routed, with duplicates found", async () => {
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ organise: true, summary: "" }));
    draftId = note.id;
    const d = (await draftForReview(c, note.id))!;
    expect(d.items.map((i) => [i.text, i.kind, i.destination])).toEqual([
      ["Spoke to the daughter today.", "CONFIRMED_FACT", "CALL_NOTE"],
      ["She said her mother has not been sleeping well.", "THIRD_PARTY_REPORT", "CALL_NOTE"],
      ["She would prefer carers to arrive slightly earlier in the morning.", "PREFERENCE_REQUEST", "ROTA"],
      ["She is waiting for the GP to call about her medication.", "UNVERIFIED", "MEDICATION"],
    ]);
    expect(d.items.every((i) => i.quoteFound)).toBe(true);
    // The first manual note already recorded the same conversation: the duplicate check says so.
    expect(d.items.filter((i) => i.duplicate !== "NEW").length).toBeGreaterThan(0);
    expect(d.followUps.join(" ")).toMatch(/no medication change is authorised/);
  });

  it("saves the coordinator's checked version: wellbeing stays, rota and medication are sent for review, edits are audited", async () => {
    const c = await coordinator();
    const d = (await draftForReview(c, draftId))!;
    const items = d.items.map((i) => ({ id: i.id, text: i.text, kind: i.kind as never, destination: i.destination as never, decision: (i.destination === "CALL_NOTE" ? "KEEP" : "ROUTE") as never }));
    items[1]!.text = "Daughter reported her mother has not been sleeping well.";
    const saved = await submitOrganised(c, draftId, d.note.lockVersion, { summary: "Spoke with the service user's daughter about wellbeing and care arrangements.", items, followUps: [{ description: "Confirm the requested visit time with the family", assigneeId: coordinatorId, dueOn: addDays(today, 1) }] });
    expect(saved.status).toBe("AWAITING_REVIEW");
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: draftId, action: "callNote.submitted" } });
    expect(log.data).toMatchObject({ routed: 2, summaryEdited: true });
    expect((log.data as { humanEdits: number }).humanEdits).toBeGreaterThanOrEqual(1);
    // The proposal and original text are frozen once saved (database trigger).
    await expect(db.callNote.update({ where: { id: draftId }, data: { originalText: "changed" } })).rejects.toThrow();
    await expect(db.callNote.delete({ where: { id: draftId } })).rejects.toThrow();
    // Saving twice is refused.
    await expect(submitOrganised(c, draftId, saved.lockVersion, { summary: "x y z", items })).rejects.toThrow(ConflictError);
  });

  it("the author cannot approve their own note; another manager approves and routed items reach the review queue", async () => {
    await expect(reviewCallNote(await coordinator(), draftId, 1, { decision: "APPROVE" })).rejects.toThrow(ForbiddenError);
    const note = await db.callNote.findUniqueOrThrow({ where: { id: draftId } });
    const approved = await reviewCallNote(await manager(), draftId, note.lockVersion, { decision: "APPROVE" });
    expect(approved.status).toBe("APPROVED");
    const routed = await db.careIntakeReviewItem.findMany({ where: { sourceRef: note.reference }, orderBy: { category: "asc" } });
    expect(routed.map((r) => [r.category, r.restricted, r.status])).toEqual([["MEDICATION", true, "OPEN"], ["ROTA", false, "OPEN"]]);
    expect(routed.every((r) => /not verified/.test(r.description))).toBe(true);
    // Nothing structured changed: no medication, no template or visit was touched by the note.
    expect(await db.auditLog.count({ where: { entityId: draftId, action: { startsWith: "medication" } } })).toBe(0);
    const links = await db.callNoteLink.findMany({ where: { callNoteId: draftId, targetType: "REVIEW_ITEM" } });
    expect(links).toHaveLength(2);
  });

  it("a routed item is closed only by someone who can work on that record, with what was done", async () => {
    const note = await db.callNote.findUniqueOrThrow({ where: { id: draftId } });
    const med = await db.careIntakeReviewItem.findFirstOrThrow({ where: { sourceRef: note.reference, category: "MEDICATION" } });
    const rota = await db.careIntakeReviewItem.findFirstOrThrow({ where: { sourceRef: note.reference, category: "ROTA" } });
    // The coordinator cannot see restricted (medication) review items, so it does not exist for them.
    await expect(resolveRoutedItem(await coordinator(), med.id, "Checked with the GP")).rejects.toThrow(NotFoundError);
    await expect(resolveRoutedItem(await coordinator(), rota.id, "ok")).rejects.toThrow(ValidationError);
    await resolveRoutedItem(await coordinator(), rota.id, "Reviewed the rota: 08:30 is possible from Monday; family to confirm.");
    await resolveRoutedItem(await manager(), med.id, "GP confirmed no change to medication.");
    await expect(resolveRoutedItem(await manager(), med.id, "again and again")).rejects.toThrow(ConflictError);
  });

  it("an exact duplicate is linked to the existing record instead of being copied again", async () => {
    const c = await coordinator();
    const risk = await db.riskAssessment.findFirst({ where: { organisationId: orgId, serviceUserId: suId, status: "ACTIVE" } });
    const candidates = await duplicateCandidates(c, suId);
    expect(candidates.some((x) => x.ref.startsWith("CallNote:"))).toBe(true);
    if (risk) expect(candidates.some((x) => x.ref === `RiskAssessment:${risk.id}`)).toBe(true);
    const { note } = await createCallNote(c, suId, base({ organise: true, details: "She would prefer carers to arrive slightly earlier in the morning." }));
    const d = (await draftForReview(c, note.id))!;
    expect(d.items[0]).toMatchObject({ duplicate: "EXACT", decision: "LINK" });
    await submitOrganised(c, note.id, d.note.lockVersion, { summary: "Repeat of the visit time request", items: d.items.map((i) => ({ id: i.id, text: i.text, kind: i.kind as never, destination: i.destination as never, decision: i.decision as never })) });
    const link = await db.callNoteLink.findFirstOrThrow({ where: { callNoteId: note.id, targetType: "CALL_NOTE" } });
    expect(link.targetId).toBe(draftId);
  });

  it("a possible duplicate stays for the coordinator to decide; nothing is merged", async () => {
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ organise: true, details: "Her daughter says she would prefer an earlier morning carer visit, maybe from next week." }));
    const d = (await draftForReview(c, note.id))!;
    expect(["POSSIBLE", "UPDATE", "EXACT"]).toContain(d.items[0]!.duplicate);
    expect(await db.callNote.count({ where: { id: draftId } })).toBe(1);
    await withdrawDraft(c, note.id);
    expect((await db.callNote.findUniqueOrThrow({ where: { id: note.id } })).status).toBe("WITHDRAWN");
  });
});

describe("3. AI provider: proposals are checked, never trusted", () => {
  it("uses the AI only with the switch on; a bullet whose quote is not in the text is left out, and missed urgent flags are added", async () => {
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: new Date() } });
    const ai: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-organiser", isSimulated: false,
      async organiseCallNote(): Promise<CallNoteOrganisation> {
        return {
          summary: "Spoke with the service user's daughter regarding wellbeing and care arrangements.",
          items: [
            { text: "Daughter reported difficulty sleeping.", kind: "THIRD_PARTY_REPORT", destination: "CALL_NOTE", quote: "her mother has not been sleeping well", urgent: null },
            { text: "GP has stopped the evening tablets.", kind: "AUTHORISED_INSTRUCTION", destination: "MEDICATION", quote: "GP stopped the evening tablets", urgent: null },
            { text: "Mother fell in the bathroom.", kind: "THIRD_PARTY_REPORT", destination: "INCIDENT", quote: "she fell in the bathroom", urgent: null },
          ],
          followUps: ["Confirm the requested visit time."], clarifications: [], urgent: [],
        };
      },
    });
    setAiProviderForTests(ai);
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ organise: true, details: `${EXAMPLE} She fell in the bathroom last night.` }));
    expect(note).toMatchObject({ origin: "AI_ASSISTED", reader: "test-organiser" });
    expect(note.urgentKinds).toContain("SAFETY");
    const d = (await draftForReview(c, note.id))!;
    expect(d.items.map((i) => [i.quoteFound, i.decision])).toEqual([[true, "KEEP"], [false, "LEAVE_OUT"], [true, "ROUTE"]]);
    // The proposal is stored exactly as produced, for comparison with what the coordinator saves.
    expect((note.proposal as { summary: string }).summary).toMatch(/daughter regarding wellbeing/);
    // With the switch off, the AI is not used even though a provider is configured.
    await db.rotaSettings.update({ where: { organisationId: orgId }, data: { careCoordinatorAiEnabledAt: null } });
    const off = await createCallNote(c, suId, base({ organise: true }));
    expect(off.note.origin).toBe("BASIC_ORGANISER");
    setAiProviderForTests(new SimulatedProvider());
  });
});

describe("4. Urgent concerns", () => {
  it("a safeguarding concern is flagged, restricted, and managers are notified in the app at once", async () => {
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ summary: "Call from a neighbour", details: "The neighbour said her son took her money and she is frightened of him." }));
    expect(note.urgentKinds).toContain("SAFEGUARDING");
    expect(note.restricted).toBe(true);
    const n = await db.notification.findMany({ where: { type: "callNote.urgent", dedupeKey: { startsWith: `call-note-urgent:${note.id}` } } });
    expect(n.map((x) => x.userId)).toContain(managerId);
    expect(n.every((x) => !x.body.includes("son took"))).toBe(true);
    expect(await db.notificationDelivery.count({ where: { notificationId: { in: n.map((x) => x.id) } } })).toBe(0);
    await recordEscalation(await manager(), note.id, { action: "Safeguarding concern raised with the local authority duty team." });
    expect((await db.callNote.findUniqueOrThrow({ where: { id: note.id } })).escalationNote).toMatch(/duty team/);
  });

  it("restricted notes are hidden from people without sensitive access, except their author, and search does not reveal them", async () => {
    const m = await secondManager();
    const c = await coordinator();
    // A restricted note written by a manager: the coordinator cannot see it, and is told one is hidden.
    const { note } = await createCallNote(await manager(), suId, base({ summary: "Restricted family matter", details: "Private family matter about finances.", restricted: true }));
    const forCoordinator = await listCallNotes(c, suId, { q: "finances" });
    expect(forCoordinator.notes.find((x) => x.id === note.id)).toBeUndefined();
    expect((await listCallNotes(c, suId)).hidden).toBeGreaterThan(0);
    expect((await listCallNotes(m, suId, { q: "finances" })).notes.map((x) => x.id)).toContain(note.id);
  });
});

describe("5. Review, corrections and superseding", () => {
  it("returns a note for clarification, then a correction keeps the previous version and goes back for review", async () => {
    const c = await coordinator();
    const { note } = await createCallNote(c, suId, base({ summary: "First version of the summary", details: "Called the social worker about the review date." }));
    await expect(reviewCallNote(await manager(), note.id, note.lockVersion, { decision: "CLARIFY" })).rejects.toThrow(/clarifying/);
    const back = await reviewCallNote(await manager(), note.id, note.lockVersion, { decision: "CLARIFY", note: "Which review: care plan or council?" });
    expect(back.status).toBe("CLARIFICATION_REQUESTED");
    const fixed = await correctCallNote(c, note.id, back.lockVersion, { summary: "Social worker: council annual review date", reason: "Clarified which review" });
    expect(fixed).toMatchObject({ status: "AWAITING_REVIEW", version: 2, originalText: "Called the social worker about the review date." });
    const rev = await db.callNoteRevision.findFirstOrThrow({ where: { callNoteId: note.id } });
    expect((rev.snapshot as { summary: string }).summary).toBe("First version of the summary");
    await expect(db.callNoteRevision.update({ where: { id: rev.id }, data: { reason: "x" } })).rejects.toThrow();
    // A stale form (old lock version) is refused rather than overwriting.
    await expect(correctCallNote(c, note.id, back.lockVersion, { summary: "Stale", reason: "Stale edit" })).rejects.toThrow(ConflictError);
    const rejected = await reviewCallNote(await manager(), note.id, fixed.lockVersion, { decision: "REJECT", note: "Duplicate of the manager's note" });
    expect(rejected.status).toBe("REJECTED");
  });

  it("a manager marks a note superseded by a later one; both stay", async () => {
    const m = await manager();
    const a = await createCallNote(m, suId, base({ summary: "Old arrangement", details: "Family visits on Tuesdays." }));
    const b = await createCallNote(m, suId, base({ summary: "New arrangement", details: "Family now visits on Thursdays." }));
    await supersedeCallNote(await secondManager(), a.note.id, { byReference: b.note.reference, reason: "Arrangement changed" });
    expect((await db.callNote.findUniqueOrThrow({ where: { id: a.note.id } })).status).toBe("SUPERSEDED");
  });
});

describe("6. Follow-up tasks and reminders", () => {
  it("assigns a task with priority, notifies the assignee, lists it in Active Reminders, reminds when overdue and closes only with a note", async () => {
    const m = await manager();
    const { note } = await createCallNote(m, suId, base({ summary: "Daughter asked for a call back", details: "Daughter asked for a call back about the morning visit." }));
    const task = await createFollowUp(m, note.id, { description: "Contact the daughter to confirm the new morning visit request", assigneeId: coordinatorId, dueOn: addDays(today, 1), priority: "HIGH", evidenceRequired: false });
    expect(await db.notification.count({ where: { userId: coordinatorId, dedupeKey: `call-note-task:${task.id}` } })).toBe(1);
    const reminders = await activeReminders(await coordinator(), { windowDays: 14 });
    expect(reminders.some((r) => r.text.includes(note.reference))).toBe(true);
    // Overdue: an in-app reminder once per due date, never an e-mail.
    await db.callNoteTask.update({ where: { id: task.id }, data: { dueOn: new Date(`${addDays(today, -2)}T00:00:00Z`) } });
    expect(await sendCallNoteReminders()).toBeGreaterThan(0);
    expect(await sendCallNoteReminders()).toBe(0);
    const overdue = await db.notification.findFirstOrThrow({ where: { type: "callNote.taskOverdue", userId: coordinatorId } });
    expect(await db.notificationDelivery.count({ where: { notificationId: overdue.id } })).toBe(0);
    // Not closed automatically; a carer cannot; the assignee closes it with a note.
    await expect(closeFollowUp(await carer(), task.id, 1, { done: true, note: "done" })).rejects.toThrow();
    await expect(closeFollowUp(await coordinator(), task.id, 1, { done: false, note: "not needed" })).rejects.toThrow(ForbiddenError);
    await closeFollowUp(await coordinator(), task.id, 1, { done: true, note: "Daughter confirmed 08:30 is fine." });
    await expect(closeFollowUp(await coordinator(), task.id, 1, { done: true, note: "again" })).rejects.toThrow(ConflictError);
  });

  it("a task that needs evidence cannot be completed without a document of this person", async () => {
    const m = await manager();
    const { note } = await createCallNote(m, suId, base({ summary: "Council will send a letter", details: "Council will post the revised support plan." }));
    const task = await createFollowUp(m, note.id, { description: "File the revised support plan", assigneeId: managerId, dueOn: today, evidenceRequired: true });
    await expect(closeFollowUp(m, task.id, 1, { done: true, note: "Filed" })).rejects.toThrow(/needs evidence/);
  });
});

describe("7. Search, filters, order and links", () => {
  it("lists newest first, searches summary, content, person and reference, and filters", async () => {
    const m = await manager();
    const older = await createCallNote(m, suId, base({ date: addDays(today, -10), summary: "Ten days ago: pharmacy call", contactName: "Example Pharmacy", contactRole: "Pharmacist", method: "TELEPHONE", details: "Pharmacy confirmed delivery day." }));
    const email = await createCallNote(m, suId, base({ date: addDays(today, -1), summary: "Email from the social worker", contactName: "Sam Worker", contactRole: "Social worker", method: "EMAIL", details: "Social worker emailed about the annual review." }));
    const all = await listCallNotes(m, suId);
    const times = all.notes.map((n) => n.communicationAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect((await listCallNotes(m, suId, { q: "pharmacy" })).notes.map((n) => n.id)).toContain(older.note.id);
    expect((await listCallNotes(m, suId, { q: older.note.reference })).notes.map((n) => n.id)).toEqual([older.note.id]);
    expect((await listCallNotes(m, suId, { q: "annual review" })).notes.map((n) => n.id)).toContain(email.note.id);
    expect((await listCallNotes(m, suId, { method: "EMAIL" })).notes.every((n) => n.method === "EMAIL")).toBe(true);
    expect((await listCallNotes(m, suId, { contact: "Sam" })).notes.map((n) => n.id)).toEqual([email.note.id]);
    expect((await listCallNotes(m, suId, { from: addDays(today, -11), to: addDays(today, -9) })).notes.map((n) => n.id)).toEqual([older.note.id]);
    expect((await listCallNotes(m, suId, { by: coordinatorId })).notes.every((n) => n.createdById === coordinatorId)).toBe(true);
    expect((await listCallNotes(m, suId, { followUp: "yes" })).notes.every((n) => n.tasks.some((t) => t.status === "OPEN"))).toBe(true);
    expect((await listCallNotes(m, suId, { status: "SUPERSEDED" })).notes.every((n) => n.status === "SUPERSEDED")).toBe(true);
    // Pagination: 20 a page.
    expect(all.notes.length).toBeLessThanOrEqual(20);
  });

  it("links a note to one of the person's records; another person's record is refused; links open only when allowed", async () => {
    const m = await manager();
    const { note } = await createCallNote(m, suId, base({ summary: "Link test", details: "About the contact on record." }));
    const contact = await db.serviceUserContact.findFirst({ where: { serviceUserId: suId } });
    const foreign = await db.serviceUserContact.findFirst({ where: { serviceUserId: otherSuId } });
    if (contact) {
      await linkRecord(m, note.id, `Contact:${contact.id}`, `Contact: ${contact.name}`);
      const n = (await listCallNotes(m, suId, { q: note.reference })).notes[0]!;
      expect(n.links.map((l) => l.href)).toContain(`/rota/service-users/${suId}?tab=people`);
    }
    if (foreign) await expect(linkRecord(m, note.id, `Contact:${foreign.id}`, "x")).rejects.toThrow(ValidationError);
  });
});

describe("8. Isolation and permissions", () => {
  it("another organisation, a carer and an out-of-area coordinator cannot read or write", async () => {
    await expect(listCallNotes(await otherOrg(), suId)).rejects.toThrow(NotFoundError);
    await expect(createCallNote(await otherOrg(), suId, base())).rejects.toThrow(NotFoundError);
    await expect(listCallNotes(await carer(), suId)).rejects.toThrow(ForbiddenError);
    const c = await coordinator();
    const membership = await db.membership.findUniqueOrThrow({ where: { userId_organisationId: { userId: coordinatorId, organisationId: orgId } } });
    const area = (await db.serviceUser.findUniqueOrThrow({ where: { id: otherSuId } })).areaId!;
    await db.membershipArea.create({ data: { membershipId: membership.id, areaId: area } });
    try {
      await expect(listCallNotes(c, suId)).rejects.toThrow(NotFoundError);
      await expect(createCallNote(c, suId, base())).rejects.toThrow(NotFoundError);
    } finally {
      await db.membershipArea.delete({ where: { membershipId_areaId: { membershipId: membership.id, areaId: area } } });
    }
  });
});

describe("9. Care Coordinator integration and existing records", () => {
  it("a meeting note added to an intake becomes an approved Call Note, linked to the intake, only after a manager approves the section", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Synthetic review meeting", mode: "EXISTING", serviceUserId: suId });
    await addManualFact(c, intake.id, { destination: "callnote", value: { summary: "Review meeting: family asked for the same carers each week.", contactName: "Family", method: "MEETING", date: today } });
    await submitIntake(c, intake.id);
    const view = await getIntake(await manager(), intake.id);
    expect(view.facts.some((f) => f.section === "CALL_NOTES")).toBe(true);
    await expect(applySection(c, intake.id, "CALL_NOTES")).rejects.toThrow(/not been approved|not approved/);
    await decideSection(await manager(), intake.id, "CALL_NOTES", { decision: "APPROVED" });
    await applySection(c, intake.id, "CALL_NOTES");
    const note = await db.callNote.findFirstOrThrow({ where: { intakeId: intake.id } });
    expect(note).toMatchObject({ status: "APPROVED", origin: "INTAKE", serviceUserId: suId });
    expect(await db.callNoteLink.count({ where: { callNoteId: note.id, targetType: "INTAKE", targetId: intake.id } })).toBe(1);
    // Applying again does not create a second note.
    await applySection(c, intake.id, "CALL_NOTES");
    expect(await db.callNote.count({ where: { intakeId: intake.id } })).toBe(1);
  });

  it("Visit Notes are unchanged and separate", async () => {
    const notes = await serviceUserVisitNotes(await coordinator(), suId);
    expect(notes).not.toBeNull();
    expect(await db.visitNote.count({ where: { text: { contains: "sleeping well" } } })).toBe(0);
  });
});

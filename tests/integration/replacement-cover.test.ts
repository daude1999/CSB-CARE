import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, londonDate, londonTime, londonToUtc } from "@/lib/london";
import { setMemberBranches } from "@/server/admin/branches";
import { closeContactFollowUp, communicationView, correctContactAttempt, coverContacts, outstandingCommunication, recordContactAttempt, type AttemptInput } from "@/server/rota/cover-communication";
import { bookCover, coverWorkspace, type BookCoverInput, type VisitCover } from "@/server/rota/replacement-cover";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";
import { makeMissedCall } from "../support/missed-fixture";

/**
 * Find Replacement Cover (fill, replace, recovery) and its Contact & Communication record, against the real schema.
 * Visits are synthetic, on a day the demo rota does not use, each at its own hour so bookings in one test never
 * collide with another's.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
type Ctx = Awaited<ReturnType<typeof manager>>;
const DAY = addDays(londonDate(), 9);
let orgId = "";
let suId = "";
let areaId = "";
let callTypeId = "";
let coordinatorId = "";
let hour = 6;
const contact: Record<string, string> = {};

async function futureVisit(carers: 1 | 2 = 1) {
  const start = hour++ * 60;
  return db.visit.create({
    data: { organisationId: orgId, reference: `RC-${start}-${DAY}`, serviceUserId: suId, callTypeId, areaId, date: dbDate(DAY), scheduledStart: londonToUtc(DAY, start), scheduledEnd: londonToUtc(DAY, start + 30), carersRequired: carers, status: "SCHEDULED", publishedAt: new Date() },
  });
}

async function workspace(ctx: Ctx, visitId: string, mode: "fill" | "replace", opts: { slot?: "PRIMARY" | "SECOND" | "SHADOW"; staffId?: string } = {}): Promise<VisitCover> {
  const w = await coverWorkspace(ctx, { mode, id: visitId, slot: opts.slot }, { staffId: opts.staffId });
  if (w.kind !== "visit") throw new Error("Expected visit cover");
  return w;
}

/** Reviews the carer exactly as the panel does, then books with what the review showed. */
async function book(ctx: Ctx, visitId: string, mode: "fill" | "replace", opts: { slot?: "PRIMARY" | "SECOND"; staffId?: string; skip?: string[] } = {}, over: Partial<BookCoverInput> = {}) {
  const w = await workspace(ctx, visitId, mode, opts);
  const staffId = opts.staffId ?? w.recommended.find((c) => !(opts.skip ?? []).includes(c.id))?.id;
  if (!staffId) throw new Error("No carer to pick in the demo data");
  const r = await workspace(ctx, visitId, mode, { slot: w.slot ?? undefined, staffId });
  const input: BookCoverInput = {
    mode: r.mode, visitId, slot: r.slot ?? "", staffId, lockVersion: r.lockVersion, expectStaffId: r.current?.staffId ?? "",
    acknowledged: r.selected!.result.warnings.map((x) => x.message), warningReason: "Known to the service user and free that morning", replaceReason: mode === "replace" ? "Carer off sick" : undefined, ...over,
  };
  return { result: await bookCover(ctx, input), staffId, input };
}

const attempt = (visitId: string, over: Partial<AttemptInput> = {}): AttemptInput => ({ visitId, recipient: "su", via: "phone", method: "PHONE", outcome: "NO_ANSWER", clientToken: randomUUID(), ...over });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  coordinatorId = (await db.user.findUniqueOrThrow({ where: { email: "coordinator@care-solution.demo" } })).id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", areaId: { not: null }, riskLevel: { not: "HIGH" } }, orderBy: { lastName: "asc" } });
  suId = su.id;
  areaId = su.areaId!;
  callTypeId = (await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } })).id;
  // Synthetic contact details: the service user, a primary daughter with recorded LPA, next of kin without authority, and a neighbour with no number.
  await db.serviceUser.update({ where: { id: suId }, data: { phone: "020 7946 0001", altPhone: "07700 900001", email: null, preferredContactMethod: "PHONE" } });
  await db.serviceUserContact.deleteMany({ where: { serviceUserId: suId } });
  const mk = async (key: string, data: Parameters<typeof db.serviceUserContact.create>[0]["data"]) => (contact[key] = (await db.serviceUserContact.create({ data })).id);
  await mk("daughter", { organisationId: orgId, serviceUserId: suId, kind: "FAMILY", name: "Test Daughter", relationship: "Daughter", phone: "07700 900002", altPhone: "020 7946 0002", email: "daughter@example.test", preferredContactMethod: "SMS", isPrimary: true, canReceiveUpdates: true, authorityType: "LPA_HEALTH", authorityScope: "Health and welfare decisions" });
  await mk("nok", { organisationId: orgId, serviceUserId: suId, kind: "NEXT_OF_KIN", name: "Test Son", relationship: "Son", phone: "07700 900003", canReceiveUpdates: false });
  await mk("neighbour", { organisationId: orgId, serviceUserId: suId, kind: "OTHER", name: "Test Neighbour", relationship: "Neighbour" });
}, 240_000);

describe("Contact & Communication: contact details", () => {
  it("shows the service user separately, primary contact first, and authority only where recorded", async () => {
    const c = (await coverContacts(await coordinator(), suId))!;
    expect(c.serviceUser).toMatchObject({ phone: "020 7946 0001", altPhone: "07700 900001", email: null, preferredContactMethod: "PHONE" });
    expect(c.contacts.map((x) => x.name)[0]).toBe("Test Daughter");
    const daughter = c.contacts.find((x) => x.id === contact.daughter)!;
    expect(daughter).toMatchObject({ isPrimary: true, canReceiveUpdates: true, altPhone: "020 7946 0002", preferredContactMethod: "SMS" });
    expect(daughter.authority).toMatchObject({ type: "LPA_HEALTH", scope: "Health and welfare decisions" });
    // Being next of kin gives no authority and no permission to receive updates.
    expect(c.contacts.find((x) => x.id === contact.nok)!).toMatchObject({ authority: null, canReceiveUpdates: false });
    expect(c.contacts.find((x) => x.id === contact.neighbour)!).toMatchObject({ phone: null, altPhone: null, email: null });
    expect(c.canEdit).toBe(true);
  });

  it("refuses contact details to a role without rota editing", async () => {
    const coord = await coordinator();
    const noView: Ctx = { ...coord, orgRoles: [] };
    await expect(coverContacts(noView, suId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Contact & Communication: attempts", () => {
  it("keeps every attempt in order with a snapshot; a message left is never informed", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    expect((await communicationView(ctx, { visitId: v.id })).state.kind).toBe("NOT_CONTACTED");
    await recordContactAttempt(ctx, attempt(v.id, { outcome: "NO_ANSWER" }));
    await recordContactAttempt(ctx, attempt(v.id, { recipient: contact.daughter, via: "altPhone", outcome: "MESSAGE_LEFT", notes: "Left voicemail" }));
    let view = await communicationView(ctx, { visitId: v.id });
    expect(view.state.kind).toBe("ATTEMPTED");
    expect(view.attempts.map((a) => [a.recipientName, a.recipientAddress, a.outcome])).toEqual([
      [expect.stringContaining(""), "020 7946 0001", "NO_ANSWER"],
      ["Test Daughter", "020 7946 0002", "MESSAGE_LEFT"],
    ]);
    expect(view.attempts[1]).toMatchObject({ recipientRelationship: "Daughter", recipientAuthority: expect.stringContaining("health and welfare"), createdById: coordinatorId });
    // A later profile edit does not rewrite what was recorded.
    await db.serviceUserContact.update({ where: { id: contact.daughter }, data: { altPhone: "020 7946 0999" } });
    await recordContactAttempt(ctx, attempt(v.id, { recipient: contact.daughter, via: "phone", method: "SMS", outcome: "INFORMED" }));
    view = await communicationView(ctx, { visitId: v.id });
    expect(view.attempts[1]!.recipientAddress).toBe("020 7946 0002");
    expect(view.state.kind).toBe("INFORMED");
    // Audit entries hold ids and outcomes, never numbers or notes.
    const audits = await db.auditLog.findMany({ where: { organisationId: orgId, entityId: v.id, action: "rota.cover.contact.recorded" } });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits.map((a) => a.data))).not.toMatch(/07700|020 7946|voicemail|Daughter/);
    await db.serviceUserContact.update({ where: { id: contact.daughter }, data: { altPhone: "020 7946 0002" } });
  });

  it("refuses a number that is not recorded and a not-applicable outcome without a reason", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    await expect(recordContactAttempt(ctx, attempt(v.id, { recipient: contact.neighbour, via: "phone" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(recordContactAttempt(ctx, attempt(v.id, { via: "email", method: "EMAIL" }))).rejects.toThrow(/no email address/);
    await expect(recordContactAttempt(ctx, attempt(v.id, { outcome: "NOT_APPLICABLE" }))).rejects.toThrow(/not applicable/);
    const na = await recordContactAttempt(ctx, attempt(v.id, { outcome: "NOT_APPLICABLE", notApplicableReason: "In hospital until Friday" }));
    expect((await communicationView(ctx, { visitId: v.id })).state).toMatchObject({ kind: "NOT_APPLICABLE", reason: "In hospital until Friday" });
    expect(na.duplicate).toBe(false);
  });

  it("saves a repeated submission once", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    const a = attempt(v.id);
    const [x, y] = await Promise.all([recordContactAttempt(ctx, a), recordContactAttempt(ctx, a)]);
    expect(x.id).toBe(y.id);
    expect(await db.coverContactAttempt.count({ where: { visitId: v.id } })).toBe(1);
  });

  it("corrects by adding an entry that keeps the original, and the database refuses silent edits", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    const first = await recordContactAttempt(ctx, attempt(v.id, { outcome: "INFORMED" }));
    await expect(correctContactAttempt(ctx, first.id, { ...attempt(v.id, { outcome: "MESSAGE_LEFT" }), reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    const fix = await correctContactAttempt(ctx, first.id, { ...attempt(v.id, { outcome: "MESSAGE_LEFT" }), reason: "It was the answerphone, not her" });
    const rows = await db.coverContactAttempt.findMany({ where: { visitId: v.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.outcome, r.correctsId])).toEqual([["INFORMED", null], ["MESSAGE_LEFT", first.id]]);
    // The correction keeps the original time of contact.
    expect(londonTime(rows[1]!.contactedAt)).toBe(londonTime(rows[0]!.contactedAt));
    const view = await communicationView(ctx, { visitId: v.id });
    expect(view.state.kind).toBe("ATTEMPTED");
    expect(view.correctedBy.get(first.id)).toBe(fix.id);
    await expect(correctContactAttempt(ctx, first.id, { ...attempt(v.id), reason: "Second go at the same entry" })).rejects.toBeInstanceOf(ConflictError);
    await expect(db.$executeRaw`UPDATE "CoverContactAttempt" SET outcome = 'NO_ANSWER' WHERE id = ${first.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "CoverContactAttempt" SET notes = 'changed' WHERE id = ${first.id}`).rejects.toThrow();
  });

  it("tracks a follow-up with owner and due time, shows it as outstanding, and closes it once", async () => {
    const ctx = await coordinator();
    const mgr = await manager();
    const v = await futureVisit();
    const due = addDays(londonDate(), 1);
    const a = await recordContactAttempt(ctx, attempt(v.id, { outcome: "NO_ANSWER", followUp: true, followUpOwnerId: mgr.userId, followUpDate: due, followUpTime: "09:30" }));
    const row = await db.coverContactAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ followUpRequired: true, followUpOwnerId: mgr.userId, followUpDueAt: londonToUtc(due, 9 * 60 + 30) });
    const out = await outstandingCommunication(ctx);
    const item = out.items.find((i) => i.visitId === v.id)!;
    expect(item).toMatchObject({ ownerId: mgr.userId, dueAt: londonToUtc(due, 9 * 60 + 30) });
    expect(item.owner).not.toBe("Not assigned");
    // A follow-up can only go to a coordinator or manager in the organisation.
    await expect(recordContactAttempt(ctx, attempt(v.id, { followUp: true, followUpOwnerId: "not-a-member", followUpDate: due, followUpTime: "10:00" }))).rejects.toBeInstanceOf(ValidationError);
    await closeContactFollowUp(ctx, a.id, "Daughter phoned back");
    await expect(closeContactFollowUp(ctx, a.id, "Again")).rejects.toBeInstanceOf(ConflictError);
    expect((await db.coverContactAttempt.findUniqueOrThrow({ where: { id: a.id } })).followUpDoneNote).toBe("Daughter phoned back");
  });
});

describe("Find Replacement Cover: booking", () => {
  it("books cover with communication still outstanding, and lists it for the coordinator who booked", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    const { staffId } = await book(ctx, v.id, "fill");
    expect((await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, removedAt: null } })).staffId).toBe(staffId);
    const item = (await outstandingCommunication(ctx)).items.find((i) => i.visitId === v.id)!;
    expect(item).toMatchObject({ ownerId: coordinatorId, state: expect.objectContaining({ kind: "NOT_CONTACTED" }) });
    // Telling them clears it; changing the carer afterwards means they need telling again.
    await recordContactAttempt(ctx, attempt(v.id, { outcome: "INFORMED" }));
    expect((await outstandingCommunication(ctx)).items.some((i) => i.visitId === v.id)).toBe(false);
    await book(ctx, v.id, "replace", { skip: [staffId] });
    const again = (await communicationView(ctx, { visitId: v.id })).state;
    expect(again.kind).toBe("UPDATE_NEEDED");
    expect((await outstandingCommunication(ctx)).items.find((i) => i.visitId === v.id)?.state.kind).toBe("UPDATE_NEEDED");
  });

  it("refuses a stale view: the place was taken, or the visit changed", async () => {
    const ctx = await coordinator();
    const v = await futureVisit();
    const w = await workspace(ctx, v.id, "fill");
    const [a, b] = w.recommended;
    if (!a || !b) throw new Error("Need two carers in the demo data");
    const ra = await workspace(ctx, v.id, "fill", { staffId: a.id });
    const rb = await workspace(ctx, v.id, "fill", { staffId: b.id });
    const input = (r: VisitCover, staffId: string): BookCoverInput => ({ mode: "fill", visitId: v.id, slot: "PRIMARY", staffId, lockVersion: r.lockVersion, expectStaffId: "", acknowledged: r.selected!.result.warnings.map((x) => x.message), warningReason: "Nearest carer free" });
    // Two coordinators confirm at the same moment: exactly one booking goes through.
    const results = await Promise.allSettled([bookCover(ctx, input(ra, a.id)), bookCover(await manager(), input(rb, b.id))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictError);
    expect(String(failed.reason.message)).toMatch(/just booked|changed since/);
    expect(await db.visitAssignment.count({ where: { visitId: v.id, removedAt: null } })).toBe(1);
    // A repeat of the winning submission does not book twice.
    const winner = results[0]!.status === "fulfilled" ? input(ra, a.id) : input(rb, b.id);
    const won = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, removedAt: null } });
    expect(await bookCover(ctx, { ...winner, lockVersion: (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).lockVersion })).toMatchObject({ assignmentId: won.id, duplicate: true });

    const v2 = await futureVisit();
    const r2 = await workspace(ctx, v2.id, "fill", { staffId: a.id });
    await db.visit.update({ where: { id: v2.id }, data: { lockVersion: { increment: 1 } } });
    await expect(bookCover(ctx, { ...input(r2, a.id), visitId: v2.id })).rejects.toThrow(/changed since you opened/);
  });

  it("replaces only the chosen place on a double-up and records why", async () => {
    const ctx = await coordinator();
    const v = await futureVisit(2);
    const first = await book(ctx, v.id, "fill", { slot: "PRIMARY" });
    const second = await book(ctx, v.id, "fill", { slot: "SECOND", skip: [first.staffId] });
    await expect(book(ctx, v.id, "replace", { slot: "SECOND", skip: [first.staffId, second.staffId] }, { replaceReason: "" })).rejects.toBeInstanceOf(ValidationError);
    const rep = await book(ctx, v.id, "replace", { slot: "SECOND", skip: [first.staffId, second.staffId] });
    const live = await db.visitAssignment.findMany({ where: { visitId: v.id, removedAt: null }, orderBy: { slot: "asc" } });
    expect(live.map((x) => [x.slot, x.staffId])).toEqual([["PRIMARY", first.staffId], ["SECOND", rep.staffId]]);
    const removed = await db.visitAssignment.findFirstOrThrow({ where: { visitId: v.id, staffId: second.staffId } });
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removeReason).toContain("Carer off sick");
    // The replaced carer is shown but cannot be chosen as their own replacement.
    const w = await workspace(ctx, v.id, "replace", { slot: "SECOND" });
    expect(w.current?.staffId).toBe(rep.staffId);
    expect(w.list.find((c) => c.id === rep.staffId)?.state ?? "NOT_ELIGIBLE").toBe("NOT_ELIGIBLE");
  });
});

describe("Find Replacement Cover: recovery after a missed call", () => {
  it("records communication on the case and never changes the missed visit", async () => {
    const ctx = await coordinator();
    const m = await makeMissedCall(orgId, { serviceUserId: suId, minutesAgo: 40 });
    const before = await db.visit.findUniqueOrThrow({ where: { id: m.visitId } });
    const w = await coverWorkspace(ctx, { mode: "recovery", id: m.caseId });
    expect(w.kind).toBe("recovery");
    expect(w.comms).toEqual({ visitId: m.visitId, caseId: m.caseId });
    await recordContactAttempt(ctx, attempt(m.visitId, { caseId: m.caseId, recipient: contact.daughter, outcome: "INFORMED" }));
    const c = await db.missedCallCase.findUniqueOrThrow({ where: { id: m.caseId } });
    expect(c.suInformedStatus).toBe("REPRESENTATIVE_INFORMED");
    const after = await db.visit.findUniqueOrThrow({ where: { id: m.visitId } });
    expect([after.status, after.scheduledStart.getTime(), after.lockVersion]).toEqual([before.status, before.scheduledStart.getTime(), before.lockVersion]);
    // The case must belong to the visit.
    const other = await futureVisit();
    await expect(recordContactAttempt(ctx, attempt(other.id, { caseId: m.caseId }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Find Replacement Cover: access", () => {
  it("keeps other organisations, other branches and read-only roles out", async () => {
    const v = await futureVisit();
    const oak = await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } });
    const oakMember = await db.membership.findFirst({ where: { organisationId: oak.id, roles: { hasSome: ["CARE_COORDINATOR", "CARE_MANAGER", "ORG_ADMIN"] } }, include: { user: true } });
    if (oakMember) {
      const outsider = await ctxFor(oakMember.user.email, OAKRIDGE);
      await expect(coverWorkspace(outsider, { mode: "fill", id: v.id })).rejects.toBeInstanceOf(NotFoundError);
      await expect(recordContactAttempt(outsider, attempt(v.id))).rejects.toBeInstanceOf(NotFoundError);
      await expect(coverContacts(outsider, suId)).rejects.toBeInstanceOf(NotFoundError);
    }
    const coord = await coordinator();
    const readOnly: Ctx = { ...coord, orgRoles: ["COMPLIANCE_LEAD"] };
    await expect(coverWorkspace(readOnly, { mode: "fill", id: v.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordContactAttempt(readOnly, attempt(v.id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(bookCover(readOnly, { mode: "fill", visitId: v.id, slot: "PRIMARY", staffId: "x", lockVersion: 0 })).rejects.toBeInstanceOf(ForbiddenError);

    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: suId } });
    const otherBranch = await db.branch.findFirst({ where: { organisationId: orgId, id: { not: su.branchId ?? "" } } });
    if (!otherBranch || !su.branchId) return;
    const mgr = await manager();
    const membership = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, userId: coord.userId } });
    await setMemberBranches(mgr, membership.id, [otherBranch.id]);
    try {
      const limited = await coordinator();
      await expect(coverWorkspace(limited, { mode: "fill", id: v.id })).rejects.toThrow();
      await expect(recordContactAttempt(limited, attempt(v.id))).rejects.toBeInstanceOf(NotFoundError);
      await expect(coverContacts(limited, suId)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await setMemberBranches(mgr, membership.id, []);
    }
  });
});

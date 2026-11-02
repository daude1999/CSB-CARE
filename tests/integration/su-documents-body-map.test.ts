import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { DatabaseStorage, setStorageForTests } from "@/server/storage";
import { documentCounts, getDocument, listDocuments, readDocumentFile, replaceDocument, setDocumentArchived, updateDocumentDetails, uploadDocument, MAX_DOCUMENT_BYTES } from "@/server/care/su-documents";
import { addObservationPhoto, bodyMapCounts, decideIncident, listObservations, nearestRegion, readObservationPhoto, recordObservation, reviewObservation } from "@/server/care/body-map";
import { reportIncident } from "@/server/care/incidents";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Council Documents, Other Documents and the Digital Body Map against a real database, with files kept in the
 * database-backed private storage used on the live site.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD); // registered manager + admin: may open sensitive files
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);

const pdf = (text = "council plan") => ({ name: "support-plan.pdf", type: "application/pdf", bytes: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`) });
const png = () => ({ name: "photo.png", type: "image/png", bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]) });
const docx = () => ({ name: "letter.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(32)]) });

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

const today = londonDate();

describe("council and other documents", () => {
  it("uploads, keeps sections apart, previews and downloads from private storage, and audits each step", async () => {
    const c = await coordinator();
    const doc = await uploadDocument(c, suId, "COUNCIL", { name: "Support plan 2026", category: "COUNCIL_SUPPORT_PLAN", issuingAuthority: "Liverpool City Council", receivedOn: today, effectiveFrom: today, expiresOn: addDays(today, 365) }, pdf());
    expect(await db.storedObject.count()).toBeGreaterThan(0);
    const council = await listDocuments(c, suId, "COUNCIL");
    const other = await listDocuments(c, suId, "OTHER");
    expect(council.map((d) => d.id)).toContain(doc.id);
    expect(other.map((d) => d.id)).not.toContain(doc.id);
    expect(council[0]!.categoryLabel).toBe("Council Support Plan");

    const preview = await readDocumentFile(c, doc.id, { mode: "preview" });
    expect(preview.inline).toBe(true);
    expect(preview.bytes.toString()).toContain("council plan");
    const dl = await readDocumentFile(c, doc.id, { mode: "download" });
    expect(dl.inline).toBe(false);
    const actions = (await db.auditLog.findMany({ where: { entityId: doc.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["suDocument.uploaded", "suDocument.previewed", "suDocument.downloaded"]);
  });

  it("prompts managers to review the care plan when a Council Support Plan arrives, without changing the plan", async () => {
    const plansBefore = await db.carePlan.findMany({ where: { serviceUserId: suId }, select: { id: true, status: true, version: true } });
    const notes = await db.notification.findMany({ where: { organisationId: orgId, type: "care.plan.review-prompt" } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.actionUrl).toContain(`/rota/service-users/${suId}`);
    expect(await db.carePlan.findMany({ where: { serviceUserId: suId }, select: { id: true, status: true, version: true } })).toEqual(plansBefore);
  });

  it("replacing adds a version and keeps every earlier file; stale replacements are refused", async () => {
    const c = await coordinator();
    const doc = await uploadDocument(c, suId, "COUNCIL", { name: "PO 1182", category: "PURCHASE_ORDER", issuingAuthority: "Liverpool City Council" }, pdf("po v1"));
    const v2 = await replaceDocument(c, doc.id, 1, pdf("po v2"), "Hours increased");
    expect(v2).toBe(2);
    await expect(replaceDocument(c, doc.id, 1, pdf("po stale"))).rejects.toBeInstanceOf(ConflictError);
    const d = await getDocument(c, doc.id);
    expect(d.versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await readDocumentFile(c, doc.id, { version: 1, mode: "download" })).bytes.toString()).toContain("po v1");
    expect((await readDocumentFile(c, doc.id, { mode: "download" })).bytes.toString()).toContain("po v2");
    // Version rows can never be edited, even directly in the database.
    await expect(db.serviceUserDocumentVersion.updateMany({ where: { documentId: doc.id }, data: { filename: "x.pdf" } })).rejects.toThrow();
  });

  it("records detail changes with old and new values, and archives instead of deleting", async () => {
    const c = await coordinator();
    const doc = await uploadDocument(c, suId, "COUNCIL", { name: "Review letter", category: "COUNCIL_REVIEW" }, docx());
    await updateDocumentDetails(c, doc.id, 1, { name: "Annual review letter", category: "COUNCIL_REVIEW", expiresOn: addDays(today, -1) });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: doc.id, action: "suDocument.updated" } });
    expect(log.data).toMatchObject({ changes: { name: { from: "Review letter", to: "Annual review letter" } } });
    await expect(setDocumentArchived(c, doc.id, 2, true, "")).rejects.toBeInstanceOf(ValidationError);
    await setDocumentArchived(c, doc.id, 2, true, "Superseded");
    const rows = await listDocuments(c, suId, "COUNCIL");
    expect(rows.find((r) => r.id === doc.id)?.archivedAt).toBeTruthy();
    expect(await db.serviceUserDocumentVersion.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it("refuses wrong file types, disguised files, oversized files and bad dates", async () => {
    const c = await coordinator();
    await expect(uploadDocument(c, suId, "OTHER", { name: "Thing", category: "SIGNED_CONSENT" }, { name: "x.exe", type: "application/pdf", bytes: Buffer.from("MZ\u0090\u0000 not a pdf") })).rejects.toThrow(/not allowed/);
    await expect(uploadDocument(c, suId, "OTHER", { name: "Thing", category: "SIGNED_CONSENT" }, { name: "big.pdf", type: "application/pdf", bytes: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_DOCUMENT_BYTES)]) })).rejects.toThrow(/4 MB/);
    await expect(uploadDocument(c, suId, "OTHER", { name: "Thing", category: "PURCHASE_ORDER" }, pdf())).rejects.toBeInstanceOf(ValidationError); // council category in Other
    await expect(uploadDocument(c, suId, "OTHER", { name: "Thing", category: "SIGNED_CONSENT", effectiveFrom: today, expiresOn: addDays(today, -3) }, pdf())).rejects.toThrow(/expiry/);
  });

  it("restricts sensitive documents to the registered manager and administrators", async () => {
    const c = await coordinator();
    const m = await manager();
    const passport = await uploadDocument(c, suId, "OTHER", { name: "Passport", category: "IDENTIFICATION" }, png());
    expect(passport.sensitive).toBe(true);
    const asCoordinator = (await listDocuments(c, suId, "OTHER")).find((d) => d.id === passport.id)!;
    expect(asCoordinator.restricted).toBe(true);
    expect(asCoordinator.name).toBe("Restricted document");
    await expect(readDocumentFile(c, passport.id, { mode: "download" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDocument(c, passport.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await readDocumentFile(m, passport.id, { mode: "preview" })).inline).toBe(true);
    // A coordinator cannot mark an ordinary document sensitive (it would hide it from themselves).
    await expect(uploadDocument(c, suId, "OTHER", { name: "Consent", category: "SIGNED_CONSENT", markSensitive: true }, pdf())).rejects.toBeInstanceOf(ForbiddenError);
    const consent = await uploadDocument(m, suId, "OTHER", { name: "Consent", category: "SIGNED_CONSENT", markSensitive: true }, pdf());
    expect(consent.sensitive).toBe(true);
  });

  it("keeps other organisations and roles without access out", async () => {
    const c = await coordinator();
    const doc = (await listDocuments(c, suId, "COUNCIL"))[0]!;
    await expect(readDocumentFile(await otherOrg(), doc.id, { mode: "download" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listDocuments(await otherOrg(), suId, "COUNCIL")).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadDocument(await otherOrg(), suId, "COUNCIL", { name: "x", category: "PURCHASE_ORDER" }, pdf())).rejects.toBeInstanceOf(NotFoundError);
    await expect(listDocuments(await carer(), suId, "COUNCIL")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await documentCounts(await carer(), suId)).toBeNull();
  });

  it("counts uploaded, missing required council documents and expired documents from real records", async () => {
    const c = await coordinator();
    const counts = (await documentCounts(c, suId))!;
    expect(counts.council.missing).toEqual([]); // support plan and PO both held
    expect(counts.council.expired).toBe(0); // the expired review letter is archived
    expect(counts.other.missing).toEqual([]); // nothing in Other Documents is required
    const fresh = (await documentCounts(c, su2Id))!;
    expect(fresh.council.uploaded).toBe(0);
    expect(fresh.council.missing.map((m) => m.key)).toEqual(["COUNCIL_SUPPORT_PLAN", "PURCHASE_ORDER"]);
    expect(fresh.other.missing).toEqual([]);
    await uploadDocument(c, su2Id, "COUNCIL", { name: "Old PO", category: "PURCHASE_ORDER", expiresOn: addDays(today, -1) }, pdf());
    const after = (await documentCounts(c, su2Id))!;
    expect(after.council.missing.map((m) => m.key)).toEqual(["COUNCIL_SUPPORT_PLAN"]);
    expect(after.council.expired).toBe(1);
  });
});

describe("digital body map", () => {
  const input = (over: Record<string, unknown> = {}) => ({ view: "FRONT", x: 20, y: 38, category: "Bruising", date: today, time: "08:30", description: "Purple bruise on the forearm, skin not broken.", size: "4 cm x 2 cm", appearance: "Purple", pain: "MILD", actionTaken: "Told the office", personNotified: "Daughter by phone", followUpOn: addDays(today, 2), ...over });

  it("records an observation with the nearest body area, a private photo, a manager alert and an audit entry", async () => {
    const c = await coordinator();
    expect(nearestRegion("FRONT", 20, 38)).toBe("Right forearm");
    const o = await recordObservation(c, suId, input(), { ...png(), caption: "Day 1" });
    expect(o.region).toBe("Right forearm");
    const [listed] = await listObservations(c, suId);
    expect(listed!.photos).toHaveLength(1);
    const photo = await readObservationPhoto(c, listed!.photos[0]!.id);
    expect(photo.contentType).toBe("image/png");
    expect(await db.notification.count({ where: { type: "bodyMap.review-needed", dedupeKey: { startsWith: `body-map:${o.id}` } } })).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { entityId: o.id, action: "bodyMap.recorded" } })).toBe(1);
    // Not an incident by itself.
    expect(o.incidentId).toBeNull();
    expect(o.incidentDecision).toBeNull();
  });

  it("validates observations and refuses a mark with no position, a future time or a bad category", async () => {
    const c = await coordinator();
    await expect(recordObservation(c, suId, input({ x: "", y: "" }))).rejects.toThrow(/Mark where/);
    await expect(recordObservation(c, suId, input({ category: "Fracture" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(recordObservation(c, suId, input({ date: addDays(today, 1) }))).rejects.toThrow(/future/);
  });

  it("keeps the original observation unchanged and adds follow-ups as history", async () => {
    const c = await coordinator();
    const o = (await listObservations(c, suId))[0]!;
    await expect(db.bodyMapObservation.update({ where: { id: o.id }, data: { description: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(reviewObservation(c, o.id, o.version, { outcome: "Fading", resolved: false })).rejects.toThrow(/next follow-up/);
    await reviewObservation(c, o.id, o.version, { outcome: "Bruise fading, now yellow.", nextFollowUpOn: addDays(today, 3) });
    await expect(reviewObservation(c, o.id, o.version, { outcome: "Stale", resolved: true })).rejects.toBeInstanceOf(ConflictError);
    let counts = (await bodyMapCounts(c, suId))!;
    expect(counts.outstanding).toBe(1);
    expect(counts.awaitingDecision).toBe(1);
    const fresh = (await listObservations(c, suId))[0]!;
    await reviewObservation(c, o.id, fresh.version, { outcome: "Gone.", resolved: true });
    const done = (await listObservations(c, suId))[0]!;
    expect(done.status).toBe("RESOLVED");
    expect(done.reviews.map((r) => r.outcome)).toEqual(["Bruise fading, now yellow.", "Gone."]);
    expect(done.description).toBe(o.description);
    counts = (await bodyMapCounts(c, suId))!;
    expect(counts.outstanding).toBe(0);
    expect(counts.reviewed).toBe(1);
  });

  it("lets only a manager decide on an incident: link an existing one about the same person, report a new one, or record none needed", async () => {
    const c = await coordinator();
    const m = await manager();
    const o = await recordObservation(c, suId, input({ view: "BACK", x: 50, y: 42, category: "Pressure sore", description: "Red area at base of spine, skin intact." }));
    expect(o.region).toBe("Base of spine (sacrum)");
    await expect(decideIncident(c, o.id, o.version, { kind: "NOT_REQUIRED", note: "Known" })).rejects.toBeInstanceOf(ForbiddenError);
    // An incident about someone else cannot be linked.
    const elsewhere = await reportIncident(m, { serviceUserId: su2Id, date: today, time: "07:00", category: "Fall", severity: "LOW", description: "Slipped in the kitchen, no injury seen at the time." });
    await expect(decideIncident(m, o.id, o.version, { kind: "LINK", incidentId: elsewhere.id })).rejects.toBeInstanceOf(NotFoundError);
    const newId = await decideIncident(m, o.id, o.version, { kind: "NEW", category: "Injury", severity: "MODERATE", description: "Body map: pressure sore observed at base of spine, skin intact.", safeguarding: false });
    const inc = await db.incident.findUniqueOrThrow({ where: { id: newId! } });
    expect(inc.serviceUserId).toBe(suId);
    const linked = await db.bodyMapObservation.findUniqueOrThrow({ where: { id: o.id } });
    expect(linked.incidentDecision).toBe("LINKED");
    expect(linked.incidentId).toBe(inc.id);
    await expect(decideIncident(m, o.id, o.version, { kind: "NOT_REQUIRED", note: "stale" })).rejects.toBeInstanceOf(ConflictError);
    await decideIncident(m, o.id, linked.version, { kind: "NOT_REQUIRED", note: "Cause known, recorded in the care plan" });
    expect(await db.auditLog.count({ where: { entityId: o.id, action: { in: ["bodyMap.incidentLinked", "bodyMap.incidentNotRequired"] } } })).toBe(2);
    // The database also refuses a link to another person's incident.
    await expect(db.bodyMapObservation.update({ where: { id: o.id }, data: { incidentId: elsewhere.id } })).rejects.toThrow(/same person/);
  });

  it("keeps photos and observations inside the organisation and away from roles without access", async () => {
    const c = await coordinator();
    const o = (await listObservations(c, suId)).find((x) => x.photos.length)!;
    await expect(readObservationPhoto(await otherOrg(), o.photos[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listObservations(await otherOrg(), suId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordObservation(await carer(), suId, input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addObservationPhoto(await otherOrg(), o.id, png())).rejects.toBeInstanceOf(NotFoundError);
    await expect(addObservationPhoto(c, o.id, pdf())).rejects.toThrow(/images/);
    expect(await bodyMapCounts(await carer(), suId)).toBeNull();
  });
});

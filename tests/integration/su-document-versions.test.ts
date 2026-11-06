import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { addDays, londonDate } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { prepareDrafts } from "@/server/care/coordinator/prepare";
import { compareWithPrevious, decideVersion, documentHistory, versionInForce } from "@/server/care/document-versions";
import { replaceDocument, uploadDocument } from "@/server/care/su-documents";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { supportPlanPdf } from "../support/coordinator-fixture";

/** Support plan version control (phase 8): V1, V2, V3 with their own dates and an append-only status history. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
let orgId = "";
let suId = "";
let plan: Buffer;
const pdf = (n: string) => ({ name: `${n}.pdf`, type: "application/pdf", bytes: Buffer.from(`%PDF-1.4\n% ${n}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`) });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  suId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } })).id;
  plan = await supportPlanPdf();
}, 180_000);

describe("document versions", () => {
  it("keeps V1 and V2 with their dates and statuses when a file is replaced by hand", async () => {
    const c = await coordinator();
    const doc = await uploadDocument(c, suId, "OTHER", { name: "Occupational therapy report", category: "OTHER_SUPPORTING", receivedOn: addDays(londonDate(), -10), effectiveFrom: addDays(londonDate(), -10) }, pdf("ot-v1"));
    await replaceDocument(c, doc.id, doc.lockVersion, pdf("ot-v2"), "Updated after review");
    const h = await documentHistory(c, doc.id);
    expect(h.versions.map((v) => [v.label, v.status])).toEqual([["V2", "CURRENT"], ["V1", "SUPERSEDED"]]);
    expect(h.versions[1]!.receivedOn).toBe(addDays(londonDate(), -10));
    expect(h.versions[1]!.history.map((s) => s.status)).toEqual(["CURRENT", "SUPERSEDED"]);
    // The status log is history: the database refuses an edit.
    const row = await db.serviceUserDocumentVersionStatus.findFirstOrThrow({ where: { documentId: doc.id } });
    await expect(db.serviceUserDocumentVersionStatus.update({ where: { id: row.id }, data: { status: "REJECTED" } })).rejects.toThrow();
    const cmp = await compareWithPrevious(c, doc.id, 2);
    expect(cmp.previous?.label).toBe("V1");
    expect(cmp.fields.find((f) => f.label === "File")?.changed).toBe(true);
  });

  it("files a revised support plan as a version waiting for review; the plan in force stays current until approved", async () => {
    const c = await coordinator();
    const v1 = await uploadDocument(c, suId, "COUNCIL", { name: "Council support plan", category: "COUNCIL_SUPPORT_PLAN", receivedOn: "2026-08-01", effectiveFrom: "2026-08-01" }, pdf("plan-v1"));
    const intake = await createIntake(c, { title: "Revised plan", mode: "EXISTING", serviceUserId: suId });
    await addDocuments(c, intake.id, [{ name: "Revised support plan.pdf", type: "application/pdf", bytes: plan }]);
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId: intake.id } });
    await db.careIntakeDocument.update({ where: { id: doc.id }, data: { section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN" } });
    const { fileDocuments } = await import("@/server/care/coordinator/apply");
    expect(await fileDocuments(c, intake.id)).toBe(1);
    let h = await documentHistory(c, v1.id);
    expect(h.versions.map((v) => [v.label, v.status])).toEqual([["V2", "PENDING_REVIEW"], ["V1", "CURRENT"]]);
    expect(h.versions[0]!.intakeId).toBe(intake.id);
    expect((await db.serviceUserDocument.findUniqueOrThrow({ where: { id: v1.id } })).currentVersion).toBe(1);
    expect((await versionInForce(c, v1.id, londonDate()))?.label).toBe("V1");
    // A carer cannot decide; rejecting needs a reason; approving makes V2 current and V1 superseded.
    await expect(decideVersion(await carer(), v1.id, 2, { decision: "APPROVE" })).rejects.toThrow();
    await expect(decideVersion(c, v1.id, 2, { decision: "REJECT" })).rejects.toBeInstanceOf(ValidationError);
    await decideVersion(await manager(), v1.id, 2, { decision: "APPROVE", note: "Checked against the council's letter" });
    h = await documentHistory(c, v1.id);
    expect(h.versions.map((v) => [v.label, v.status])).toEqual([["V2", "CURRENT"], ["V1", "SUPERSEDED"]]);
    expect(h.versions[0]!.approvedAt).not.toBeNull();
    expect((await db.serviceUserDocument.findUniqueOrThrow({ where: { id: v1.id } })).currentVersion).toBe(2);
    // V2 is effective from the date on the revised plan (15 Sep 2026); before that V1 was in force, and before V1 nothing.
    expect(h.versions[0]!.effectiveFrom).toBe("2026-09-15");
    expect((await versionInForce(c, v1.id, "2026-09-01"))?.label).toBe("V1");
    expect((await versionInForce(c, v1.id, "2026-09-20"))?.label).toBe("V2");
    expect(await versionInForce(c, v1.id, "2026-07-01")).toBeNull();
    await expect(decideVersion(c, v1.id, 2, { decision: "APPROVE" })).rejects.toBeInstanceOf(ConflictError);
    // Withdrawing V2 puts V1 back in force, and both decisions stay in the history.
    await decideVersion(await manager(), v1.id, 2, { decision: "WITHDRAW", note: "Council sent it in error" });
    h = await documentHistory(c, v1.id);
    expect(h.versions.map((v) => [v.label, v.status])).toEqual([["V2", "WITHDRAWN"], ["V1", "CURRENT"]]);
    expect(h.versions[1]!.history.map((s) => s.status)).toEqual(["CURRENT", "SUPERSEDED", "CURRENT"]);
    expect(await db.auditLog.count({ where: { organisationId: orgId, entityId: v1.id, action: { in: ["suDocument.version.approved", "suDocument.version.withdrawn"] } } })).toBe(2);
  });

  it("a supporting document intake (option C) for someone with a plan files a revised plan for review, not as a new document", async () => {
    const c = await coordinator();
    const plans = await db.serviceUserDocument.count({ where: { serviceUserId: suId, category: "COUNCIL_SUPPORT_PLAN" } });
    const intake = await createIntake(c, { title: "Another plan", mode: "DOCUMENT", serviceUserId: suId });
    await addDocuments(c, intake.id, [{ name: "Plan again.pdf", type: "application/pdf", bytes: Buffer.concat([plan, Buffer.from("\n% v3\n")]) }]);
    await db.careIntakeDocument.updateMany({ where: { intakeId: intake.id }, data: { section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN" } });
    const r = await prepareDrafts(c, intake.id);
    expect(r.filed).toBe(1);
    expect(await db.serviceUserDocument.count({ where: { serviceUserId: suId, category: "COUNCIL_SUPPORT_PLAN" } })).toBe(plans);
  });
});

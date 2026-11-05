import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { FormSchema, readAnswers } from "@/lib/forms/schema";
import { PILOT_FORMS, syncPilotForms } from "@/server/forms/pilots";
import { approveRecord, digitalForms, formRecordLists, getFormRecord, returnRecord, saveDraft, startForm, startableByRef, submitRecord, voidRecord } from "@/server/forms/records";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Forms PR 2/3: on-screen forms. Version-pinned records, draft → submit → return → resubmit → approve, voiding,
 * who can see what, and the rules the database enforces. Fictional demo people only.
 */
const declaration = (over: Record<string, string> = {}) => ({
  new_conduct: "no", registration_conditions: "no", relationships: "no", other_work: "yes", other_work_details: "Weekend shop work, 8 hours", business_interests: "no", confirm: "on", ...over,
});

let defId = "";
beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
  defId = (await db.formDefinition.findFirstOrThrow({ where: { ref: "CSB-FRM-020", organisationId: null } })).id;
}, 180_000);

describe("form definitions and versions", () => {
  it("seeds the pilot forms once, with a valid published version 1", async () => {
    expect(await syncPilotForms()).toBe(0);
    const defs = await db.formDefinition.findMany({ where: { organisationId: null }, include: { currentVersion: true } });
    expect(defs.map((d) => d.ref).sort()).toEqual(PILOT_FORMS.map((p) => p.ref).sort());
    for (const d of defs) {
      expect(d.currentVersion).toMatchObject({ versionNumber: 1, status: "PUBLISHED" });
      expect(FormSchema.safeParse(d.currentVersion!.schemaJson).success).toBe(true);
    }
  });

  it("refuses an invalid schema: duplicate keys, conditions on unknown fields, unknown types", () => {
    expect(FormSchema.safeParse([{ type: "text", key: "a", label: "A" }, { type: "text", key: "a", label: "B" }]).success).toBe(false);
    expect(FormSchema.safeParse([{ type: "text", key: "a", label: "A", showIf: { field: "zz", equals: true } }]).success).toBe(false);
    expect(FormSchema.safeParse([{ type: "script", key: "a", label: "A" }]).success).toBe(false);
    expect(FormSchema.safeParse([{ type: "text", key: "a", label: "A", onChange: "alert(1)" }]).success).toBe(false);
  });

  it("never lets a published version change", async () => {
    const v = await db.formVersion.findFirstOrThrow({ where: { definitionId: defId } });
    await expect(db.formVersion.update({ where: { id: v.id }, data: { instructions: "changed" } })).rejects.toThrow();
    await expect(db.formVersion.delete({ where: { id: v.id } })).rejects.toThrow();
  });

  it("reads answers: required, conditional, typed and unknown fields", () => {
    const schema = FormSchema.parse(PILOT_FORMS[0]!.fields);
    const partial = readAnswers(schema, { new_conduct: "yes" }, { final: false });
    expect(partial.errors).toEqual({});
    const final = readAnswers(schema, { new_conduct: "yes", hacked: "x" }, { final: true });
    expect(Object.keys(final.errors)).toEqual(expect.arrayContaining(["conduct_details", "registration_conditions", "confirm"]));
    expect(final.answers).not.toHaveProperty("hacked");
    // A follow-up question that does not apply is neither asked nor stored.
    const ok = readAnswers(schema, declaration({ conduct_details: "should be dropped" }), { final: true });
    expect(ok.errors).toEqual({});
    expect(ok.answers).not.toHaveProperty("conduct_details");
    expect(ok.answers.new_conduct).toBe(false);
    expect(readAnswers(schema, { new_conduct: "maybe" }, { final: false }).errors.new_conduct).toBeTruthy();
  });
});

describe("filling in, reviewing and approving", () => {
  it("runs draft → submit → return → resubmit → approve, pinned to its version, with full history", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    expect((await startableByRef(carer)).get("CSB-FRM-020")).toBe(defId);
    expect((await startableByRef(carer)).has("CSB-FRM-013")).toBe(false);

    const rec = await startForm(carer, defId);
    expect(rec).toMatchObject({ status: "DRAFT", subjectType: "USER", subjectId: carer.userId });
    expect(rec.reference).toMatch(/^FRM-020-\d{4}-0001$/);

    await saveDraft(carer, rec.id, { new_conduct: "no" }, 0);
    await expect(submitRecord(carer, rec.id, { new_conduct: "no" }, 1)).rejects.toBeInstanceOf(ValidationError);
    // A save from an older copy (another tab) is refused, not merged.
    await expect(saveDraft(carer, rec.id, declaration(), 0)).rejects.toBeInstanceOf(ConflictError);
    await submitRecord(carer, rec.id, declaration(), 1);

    // Answers are frozen in the database once submitted.
    await expect(db.formRecord.update({ where: { id: rec.id }, data: { answers: { new_conduct: true } } })).rejects.toThrow();
    await expect(saveDraft(carer, rec.id, declaration(), 2)).rejects.toBeInstanceOf(ConflictError);

    const queue = await formRecordLists(manager);
    expect(queue.queue.map((r) => r.id)).toContain(rec.id);
    await expect(returnRecord(manager, rec.id, 2, "no")).rejects.toBeInstanceOf(ValidationError);
    await returnRecord(manager, rec.id, 2, "Please add the shop's name to your other work");
    const returned = await getFormRecord(carer, rec.id);
    expect(returned.record).toMatchObject({ status: "RETURNED", returnReason: "Please add the shop's name to your other work" });
    expect(returned.can.edit).toBe(true);

    await submitRecord(carer, rec.id, declaration({ other_work_details: "Fictional Corner Shop, 8 hours" }), 3);
    await approveRecord(manager, rec.id, 4);
    const done = await getFormRecord(manager, rec.id);
    expect(done.record).toMatchObject({ status: "APPROVED", reviewerId: manager.userId });
    expect(done.record.answers.other_work_details).toBe("Fictional Corner Shop, 8 hours");
    expect(done.version.number).toBe(1);
    expect(done.events.map((e) => e.type)).toEqual(["CREATED", "SAVED", "SUBMITTED", "RETURNED", "RESUBMITTED", "APPROVED"]);
    // History records which questions changed, never the answers themselves.
    expect(JSON.stringify(done.events)).not.toContain("Corner Shop");
    expect(await db.auditLog.count({ where: { entityType: "FormRecord", entityId: rec.id } })).toBe(5);
    await expect(db.formRecordEvent.update({ where: { id: done.events[0]!.id }, data: { note: "x" } })).rejects.toThrow();
    // An approved record cannot go back to draft, even directly in the database.
    await expect(db.formRecord.update({ where: { id: rec.id }, data: { status: "DRAFT" } })).rejects.toThrow();
  });

  it("keeps records private to their author and the form's reviewers, and enforces separation of duties", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const other = await ctxFor("carer2@care-solution.demo", BROOKFIELD);
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const rec = await startForm(carer, defId);
    await expect(getFormRecord(other, rec.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getFormRecord(oak, rec.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveDraft(manager, rec.id, declaration(), 0)).rejects.toBeInstanceOf(ForbiddenError);
    await submitRecord(carer, rec.id, declaration(), 0);
    await expect(approveRecord(carer, rec.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveRecord(other, rec.id, 1)).rejects.toBeInstanceOf(NotFoundError);

    // A reviewer's own declaration needs another reviewer.
    const own = await startForm(manager, defId);
    await submitRecord(manager, own.id, declaration(), 0);
    await expect(approveRecord(manager, own.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await formRecordLists(manager)).queue.some((r) => r.id === own.id)).toBe(false);

    // The subject access log is for office roles only.
    const sar = (await digitalForms(manager)).find((f) => f.ref === "CSB-FRM-013")!;
    await expect(startForm(carer, sar.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(startForm(oak, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("voids with a reason: the author for a draft, a reviewer at any stage; a voided record is final", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const rec = await startForm(carer, defId);
    await expect(voidRecord(carer, rec.id, "x")).rejects.toBeInstanceOf(ValidationError);
    await voidRecord(carer, rec.id, "Started by mistake");
    await expect(voidRecord(manager, rec.id, "Again please")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.formRecord.update({ where: { id: rec.id }, data: { voidReason: "edited" } })).rejects.toThrow();

    const submitted = await startForm(carer, defId);
    await submitRecord(carer, submitted.id, declaration(), 0);
    await expect(voidRecord(carer, submitted.id, "Changed my mind")).rejects.toBeInstanceOf(ForbiddenError);
    await voidRecord(manager, submitted.id, "Duplicate of an earlier declaration");
    expect((await getFormRecord(carer, submitted.id)).record.status).toBe("VOIDED");
  });

  it("keeps old records on their version when a form changes", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const rec = await startForm(carer, defId);
    const pilot = PILOT_FORMS.find((p) => p.ref === "CSB-FRM-020")!;
    const original = pilot.instructions;
    pilot.instructions = original + " Updated for this test.";
    try {
      expect(await syncPilotForms()).toBe(1);
    } finally {
      pilot.instructions = original;
    }
    const def = await db.formDefinition.findUniqueOrThrow({ where: { id: defId }, include: { currentVersion: true } });
    expect(def.currentVersion!.versionNumber).toBe(2);
    const view = await getFormRecord(carer, rec.id);
    expect(view.version).toMatchObject({ number: 1, isCurrent: false, status: "SUPERSEDED" });
    // New records use the new version; the database refuses a record on a superseded version.
    expect((await startForm(carer, defId)).versionId).toBe(def.currentVersionId);
    await expect(db.formRecord.create({ data: { organisationId: rec.organisationId, definitionId: defId, versionId: rec.versionId, reference: "TEST-OLD", createdById: carer.userId } })).rejects.toThrow();
  });
});

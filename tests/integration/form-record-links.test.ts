import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formsForServiceUser, formsForStaffMember, linkRecord, parseLinkChoice, recordLinks, startFormAbout, unlinkRecord } from "@/server/forms/record-links";
import { getFormRecord, startForm, submitRecord, voidRecord } from "@/server/forms/records";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Forms PR 4: form records linked to the CRM record they are about. Fictional demo people only. Nothing about the
 * person is copied into the form; the link is shown only to people who may see both the form and the person.
 */
let sarId = "";
let declarationId = "";
let orgId = "";
let oakOrgId = "";
let suId = "";
let staffId = "";
let oakSuId = "";
beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  sarId = (await db.formDefinition.findFirstOrThrow({ where: { ref: "CSB-FRM-013", organisationId: null } })).id;
  declarationId = (await db.formDefinition.findFirstOrThrow({ where: { ref: "CSB-FRM-020", organisationId: null } })).id;
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  oakOrgId = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
  suId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId }, orderBy: { lastName: "asc" } })).id;
  oakSuId = (await db.serviceUser.create({ data: { organisationId: oakOrgId, reference: "SYN-FORMS-OAK", firstName: "Synthetic", lastName: "Oakperson", status: "ACTIVE" } })).id;
  staffId = (await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrMissing: false }, orderBy: { displayName: "asc" } })).id;
}, 180_000);

describe("linking forms to people", () => {
  it("starts a Subject Access Request log from a service user's record, linked, and shows it there", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const rec = await startFormAbout(manager, sarId, { entityType: "SERVICE_USER", entityId: suId });
    const links = await recordLinks(manager, rec.id);
    expect(links?.rows).toHaveLength(1);
    expect(links?.rows[0]).toMatchObject({ entityType: "SERVICE_USER", href: `/rota/service-users/${suId}?tab=documents&section=forms` });
    const onProfile = await formsForServiceUser(manager, suId);
    expect(onProfile.rows.map((r) => r.id)).toContain(rec.id);
    expect(onProfile.startable.map((f) => f.ref)).toEqual(["CSB-FRM-013"]);
    // The person's details are not copied into the form.
    expect(JSON.stringify((await getFormRecord(manager, rec.id)).record.answers)).toBe("{}");
    const view = await getFormRecord(manager, rec.id);
    expect(view.events.map((e) => e.type)).toEqual(["CREATED", "LINKED"]);
    expect(await db.auditLog.count({ where: { entityType: "FormRecord", entityId: rec.id, action: "form.record.linked" } })).toBe(1);
  });

  it("links and unlinks with a reason, refuses duplicates, other kinds of record and other organisations", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const rec = await startForm(manager, sarId);
    await linkRecord(manager, rec.id, { entityType: "STAFF_MEMBER", entityId: staffId });
    await expect(linkRecord(manager, rec.id, { entityType: "STAFF_MEMBER", entityId: staffId })).rejects.toBeInstanceOf(ConflictError);
    await expect(linkRecord(manager, rec.id, { entityType: "INCIDENT", entityId: staffId })).rejects.toBeInstanceOf(ValidationError);
    const oakSu = { id: oakSuId };
    await expect(linkRecord(manager, rec.id, { entityType: "SERVICE_USER", entityId: oakSu.id })).rejects.toBeInstanceOf(NotFoundError);
    // A declaration is about its author, so it takes no links.
    const own = await startForm(manager, declarationId);
    await expect(linkRecord(manager, own.id, { entityType: "SERVICE_USER", entityId: suId })).rejects.toBeInstanceOf(ValidationError);
    expect(await recordLinks(manager, own.id)).toBeNull();

    expect((await formsForStaffMember(manager, staffId))!.rows.map((r) => r.id)).toContain(rec.id);
    const link = (await recordLinks(manager, rec.id))!.rows[0]!;
    await expect(unlinkRecord(manager, rec.id, link.id, "no")).rejects.toBeInstanceOf(ValidationError);
    await unlinkRecord(manager, rec.id, link.id, "Linked to the wrong person");
    expect((await formsForStaffMember(manager, staffId))!.rows.map((r) => r.id)).not.toContain(rec.id);
    expect((await getFormRecord(manager, rec.id)).events.map((e) => e.type)).toEqual(["CREATED", "LINKED", "UNLINKED"]);
    // The removed link stays, and cannot be edited or brought back.
    const row = await db.formRecordLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row).toMatchObject({ removeReason: "Linked to the wrong person", removedById: manager.userId });
    await expect(db.formRecordLink.update({ where: { id: link.id }, data: { removedAt: null, removedById: null, removeReason: null } })).rejects.toThrow();
    await expect(db.formRecordLink.update({ where: { id: link.id }, data: { staffMemberId: null } })).rejects.toThrow();
  });

  it("enforces the rules in the database: same organisation, allowed kinds, no links on a voided form", async () => {
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const rec = await startForm(manager, sarId);
    const oakSu = { id: oakSuId };
    await expect(db.formRecordLink.create({ data: { organisationId: orgId, recordId: rec.id, entityType: "SERVICE_USER", serviceUserId: oakSu.id, createdById: manager.userId } })).rejects.toThrow();
    await expect(db.formRecordLink.create({ data: { organisationId: oakOrgId, recordId: rec.id, entityType: "SERVICE_USER", serviceUserId: oakSu.id, createdById: manager.userId } })).rejects.toThrow();
    const own = await startForm(manager, declarationId);
    await expect(db.formRecordLink.create({ data: { organisationId: orgId, recordId: own.id, entityType: "SERVICE_USER", serviceUserId: suId, createdById: manager.userId } })).rejects.toThrow();
    await voidRecord(manager, rec.id, "Started by mistake");
    await expect(db.formRecordLink.create({ data: { organisationId: orgId, recordId: rec.id, entityType: "SERVICE_USER", serviceUserId: suId, createdById: manager.userId } })).rejects.toThrow();
    await expect(linkRecord(manager, rec.id, { entityType: "SERVICE_USER", entityId: suId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows linked forms only to people who may open them, and lets only reviewers change links after submission", async () => {
    const coordinator = await ctxFor("coordinator@care-solution.demo", BROOKFIELD);
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const reviewer = await ctxFor("reviewer@care-solution.demo", BROOKFIELD);
    const rec = await startFormAbout(coordinator, sarId, { entityType: "SERVICE_USER", entityId: suId });
    await submitRecord(coordinator, rec.id, {
      received_on: "2026-10-01", received_how: "Email", requester_type: "The person themselves", requester_reference: "Fictional ref 1",
      information_requested: "Care notes for September", identity_verified: "no", authority_checked: "Not applicable", due_on: "2026-11-01", extended: "no", sent_on: "2026-10-20", sent_format: "Post",
    }, 0);
    // The author can no longer change links once submitted; a reviewer still can.
    expect((await recordLinks(coordinator, rec.id))!.canChange).toBe(false);
    await expect(linkRecord(coordinator, rec.id, { entityType: "STAFF_MEMBER", entityId: staffId })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await recordLinks(manager, rec.id))!.canChange).toBe(true);
    // Someone who is neither the author nor a reviewer sees nothing on the person's record (and cannot open the form).
    await expect(getFormRecord(reviewer, rec.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(formsForServiceUser(reviewer, suId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows a person's own declarations on their staff record once their sign-in is linked", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const manager = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const staff = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, hrMissing: false, userId: null, id: { not: staffId } }, orderBy: { displayName: "desc" } });
    await db.staffMember.update({ where: { id: staff.id }, data: { userId: carer.userId, linkedById: manager.userId, linkedAt: new Date() } });
    const rec = await startForm(carer, declarationId);
    const before = await db.formRecord.count({ where: { organisationId: orgId } });
    expect((await formsForStaffMember(manager, staff.id))!.rows.map((r) => r.id)).toContain(rec.id);
    // A declaration can't be started about someone else from their record.
    expect((await formsForStaffMember(manager, staff.id))!.startable.map((f) => f.ref)).not.toContain("CSB-FRM-020");
    await expect(startFormAbout(manager, declarationId, { entityType: "STAFF_MEMBER", entityId: staff.id })).rejects.toBeInstanceOf(ValidationError);
    // Starting a linked form leaves nothing behind when the link is refused.
    expect(await db.formRecord.count({ where: { organisationId: orgId } })).toBe(before);
  });

  it("reads posted link choices safely", () => {
    expect(parseLinkChoice("")).toBeNull();
    expect(parseLinkChoice("SERVICE_USER:abcdefgh12")).toEqual({ entityType: "SERVICE_USER", entityId: "abcdefgh12" });
    expect(() => parseLinkChoice("ORGANISATION:abcdefgh12")).toThrow(ValidationError);
    expect(() => parseLinkChoice("SERVICE_USER:../../x")).toThrow(ValidationError);
  });
});

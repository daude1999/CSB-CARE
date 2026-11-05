import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addResourceLink, backfillResourceLinks, linkedResourcesFor, placementsFor, resourceLinkAdmin, withdrawResourceLink } from "@/server/forms/links";
import { resourceRegister, resourceRegisterWhere } from "@/server/forms/catalogue";
import { adoptTemplate } from "@/server/policies/library";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Forms PR 1: explicit, audited links from a policy (or one of its procedure steps) to the forms and resources it
 * relies on, shown in the Policy Reader and the Forms & Resources register. Real database, fictional demo data only.
 */
let orgId = "";
let oakId = "";
const policyOf = (ref: string, organisationId: string | null) =>
  db.policy.findFirstOrThrow({ where: { ref, organisationId }, include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" } } } } } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  oakId = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
}, 180_000);

describe("backfill from existing Related policies text", () => {
  it("links the CSB master form to its master policy, and the organisation's copies to each other", async () => {
    const [mSaf, mFrm, oSaf, oFrm] = await Promise.all([policyOf("CSB-SAF-001", null), policyOf("CSB-FRM-001", null), policyOf("CSB-SAF-001", orgId), policyOf("CSB-FRM-001", orgId)]);
    const master = await db.policyResourceLink.findFirst({ where: { policyId: mSaf.id, resourceId: mFrm.id } });
    expect(master).toMatchObject({ organisationId: null, origin: "BACKFILL_RELATED_TEXT", sectionKey: null, withdrawnAt: null });
    const own = await db.policyResourceLink.findFirst({ where: { policyId: oSaf.id, resourceId: oFrm.id } });
    expect(own).toMatchObject({ organisationId: orgId, origin: "BACKFILL_RELATED_TEXT" });
    // No link ever crosses an organisation boundary.
    const crossing = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "PolicyResourceLink" l JOIN "Policy" p ON p.id = l."policyId" JOIN "Policy" r ON r.id = l."resourceId" WHERE p."organisationId" IS DISTINCT FROM l."organisationId" OR r."organisationId" IS DISTINCT FROM l."organisationId"`;
    expect(Number(crossing[0]!.n)).toBe(0);
  });

  it("is idempotent", async () => {
    const before = await db.policyResourceLink.count();
    expect(await backfillResourceLinks()).toBe(0);
    expect(await db.policyResourceLink.count()).toBe(before);
  });

  it("offers the form in the reader once, as an explicit link", async () => {
    const saf = await policyOf("CSB-SAF-001", orgId);
    const items = await linkedResourcesFor(saf, saf.currentPublishedVersion!.sections);
    const frm = items.filter((i) => i.ref === "CSB-FRM-001");
    expect(frm).toHaveLength(1);
    expect(frm[0]).toMatchObject({ source: "LINK", required: false, typeLabel: "Form" });
    expect(frm[0]!.uses).toEqual([expect.objectContaining({ placement: null, placementMissing: false })]);
  });
});

describe("managing links", () => {
  it("places a form at a procedure step, numbered like the reader, and audits it", async () => {
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const saf = await policyOf("CSB-SAF-001", orgId);
    const frm2 = await db.policy.findFirst({ where: { organisationId: orgId, docType: { in: ["FORM", "AUDIT_TOOL", "CHECKLIST", "TEMPLATE", "RISK_ASSESSMENT"] }, NOT: { ref: "CSB-FRM-001" } } });
    const form = frm2 ?? (await policyOf("CSB-FRM-001", orgId));
    const steps = placementsFor(saf.currentPublishedVersion!.sections);
    const reporting = steps.find((s) => s.sectionKey === "procedure.reporting")!;
    expect(reporting.step).toBeGreaterThan(0);
    const link = await addResourceLink(author, { policyId: saf.id, resourceId: form.id, sectionKey: "procedure.reporting", useWhen: "you make a referral", required: true });
    expect(link).toMatchObject({ origin: "MANUAL", organisationId: orgId, createdById: author.userId, required: true });
    const logged = await db.auditLog.findFirst({ where: { action: "policy.resource_link.added", entityId: saf.id } });
    expect(logged).not.toBeNull();

    const items = await linkedResourcesFor(saf, saf.currentPublishedVersion!.sections);
    const placed = items.flatMap((i) => i.uses).find((u) => u.linkId === link.id)!;
    expect(placed.placement).toEqual(reporting);
    expect(placed.useWhen).toBe("you make a referral");
    // Each resource is offered once, with all of its places.
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);

    await expect(addResourceLink(author, { policyId: saf.id, resourceId: form.id, sectionKey: "procedure.reporting" })).rejects.toBeInstanceOf(ConflictError);
    await expect(addResourceLink(author, { policyId: saf.id, resourceId: form.id, sectionKey: "procedure.not-a-step" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addResourceLink(author, { policyId: saf.id, resourceId: form.id, useWhen: "x".repeat(301) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses people without authoring rights, other organisations and master documents", async () => {
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const saf = await policyOf("CSB-SAF-001", orgId);
    const frm = await policyOf("CSB-FRM-001", orgId);
    const mFrm = await policyOf("CSB-FRM-001", null);
    const mSaf = await policyOf("CSB-SAF-001", null);
    await expect(addResourceLink(carer, { policyId: saf.id, resourceId: frm.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addResourceLink(oak, { policyId: saf.id, resourceId: frm.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addResourceLink(author, { policyId: saf.id, resourceId: mFrm.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(addResourceLink(author, { policyId: mSaf.id, resourceId: frm.id })).rejects.toBeInstanceOf(NotFoundError);
    // A resource cannot be the near end of a link.
    await expect(addResourceLink(author, { policyId: frm.id, resourceId: frm.id })).rejects.toBeInstanceOf(ValidationError);
    // The database itself refuses a link across organisations, whatever the app does.
    await expect(db.policyResourceLink.create({ data: { organisationId: orgId, policyId: saf.id, resourceId: mFrm.id, origin: "MANUAL" } })).rejects.toThrow();
    const oakAdmin = await resourceLinkAdmin(oak, mSaf.id);
    expect(oakAdmin.canManage).toBe(false);
    await expect(resourceLinkAdmin(oak, saf.id)).rejects.toBeInstanceOf(NotFoundError);
    const carerView = await resourceLinkAdmin(carer, saf.id);
    expect(carerView.canManage).toBe(false);
    expect(carerView.choices).toEqual([]);
  });

  it("withdraws a link once, keeps it in history, and never revives it from the text", async () => {
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const saf = await policyOf("CSB-SAF-001", orgId);
    const frm = await policyOf("CSB-FRM-001", orgId);
    const link = await db.policyResourceLink.findFirstOrThrow({ where: { policyId: saf.id, resourceId: frm.id, withdrawnAt: null } });
    await expect(withdrawResourceLink(author, { linkId: link.id, reason: "no" })).rejects.toBeInstanceOf(ValidationError);
    await withdrawResourceLink(author, { linkId: link.id, reason: "Replaced by the incident workflow" });
    await expect(withdrawResourceLink(author, { linkId: link.id, reason: "Replaced again" })).rejects.toBeInstanceOf(ConflictError);
    // Neither the explicit link nor the old text-based match shows it any more.
    const items = await linkedResourcesFor(saf, saf.currentPublishedVersion!.sections);
    expect(items.some((i) => i.id === frm.id)).toBe(false);
    expect(await backfillResourceLinks()).toBe(0);
    const admin = await resourceLinkAdmin(author, saf.id);
    expect(admin.withdrawn.map((l) => l.withdrawReason)).toContain("Replaced by the incident workflow");
    expect(await db.auditLog.count({ where: { action: "policy.resource_link.withdrawn", entityId: saf.id } })).toBe(1);
    // A withdrawn link is frozen in the database.
    await expect(db.policyResourceLink.update({ where: { id: link.id }, data: { withdrawReason: "edited" } })).rejects.toThrow();
    // An active link can only be withdrawn, not edited.
    const other = await db.policyResourceLink.findFirstOrThrow({ where: { organisationId: orgId, withdrawnAt: null } });
    await expect(db.policyResourceLink.update({ where: { id: other.id }, data: { required: !other.required } })).rejects.toThrow();
  });

  it("still offers a form named only in Related policies text, labelled as such, until a link exists", async () => {
    const [mSaf, mFrm] = await Promise.all([policyOf("CSB-SAF-001", null), policyOf("CSB-FRM-001", null)]);
    // Simulates a policy whose links have not been created yet.
    await db.policyResourceLink.deleteMany({ where: { policyId: mSaf.id, resourceId: mFrm.id } });
    const before = await linkedResourcesFor(mSaf, mSaf.currentPublishedVersion!.sections);
    expect(before.find((i) => i.id === mFrm.id)).toMatchObject({ source: "TEXT", uses: [] });
    expect(await backfillResourceLinks()).toBe(1);
    const after = await linkedResourcesFor(mSaf, mSaf.currentPublishedVersion!.sections);
    expect(after.find((i) => i.id === mFrm.id)?.source).toBe("LINK");
  });
});

describe("adopting templates and the register", () => {
  it("copies the CSB link when an organisation adopts both the form and the policy", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const [mSaf, mFrm] = await Promise.all([policyOf("CSB-SAF-001", null), policyOf("CSB-FRM-001", null)]);
    const form = await adoptTemplate(oak, mFrm.id);
    const policy = await adoptTemplate(oak, mSaf.id);
    const link = await db.policyResourceLink.findFirst({ where: { policyId: policy.policy.id, resourceId: form.policy.id } });
    expect(link).toMatchObject({ organisationId: oakId, origin: "TEMPLATE", withdrawnAt: null });
    const logged = await db.auditLog.findFirst({ where: { action: "policy.adopted_template", entityId: policy.policy.id } });
    expect(logged?.data).toMatchObject({ resourceLinksInherited: 1 });
  });

  it("lists each form once per organisation, with the policies it is linked to", async () => {
    const author = await ctxFor("author@care-solution.demo", BROOKFIELD);
    const reg = await resourceRegister(author, { q: "Safeguarding Concern", type: "", category: "", page: 1 });
    expect(reg.rows.filter((r) => r.ref === "CSB-FRM-001")).toHaveLength(1);
    expect(reg.rows.find((r) => r.ref === "CSB-FRM-001")?.kind).toBe("CUSTOMER");
    const count = await db.policy.count({ where: resourceRegisterWhere(author) });
    const full = await resourceRegister(author, { q: "", type: "", category: "", page: 1 });
    expect(full.total).toBe(count);
    // Oakridge adopted FRM-001 as a draft only, so the CSB template is not listed twice and the draft is hidden.
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const oakReg = await resourceRegister(oak, { q: "CSB-FRM-001", type: "", category: "", page: 1 });
    expect(oakReg.rows).toHaveLength(0);
    const linked = (await resourceRegister(author, { q: "CSB-FRM-", type: "FORM", category: "", page: 1 })).rows.flatMap((r) => r.policies.map((p) => p.ref));
    expect(linked.every((ref) => /^CSB-[A-Z]+-\d+$/.test(ref))).toBe(true);
  });
});

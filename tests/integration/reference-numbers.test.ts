import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import PDFDocument from "pdfkit";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addExternalReference, referencesFor, searchReferenceIds, supersedeExternalReference, verifyExternalReference } from "@/server/care/external-references";
import { referenceNumbersTab } from "@/server/care/reference-numbers";
import { listServiceUsers } from "@/server/care/service-users";
import { rotaSearch } from "@/server/rota/search";
import { addDocuments, createIntake, decideFact, getIntake } from "@/server/care/coordinator/intake";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Service User → Reference Numbers against a real database: the permanent CSB reference, the encrypted external
 * register (add, duplicates, conflicts, verification, correction), Frameworki reading in the Care Coordinator, search,
 * NHS restriction and tenant isolation. Every identifier here is fictional.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const TH = "Tower Hamlets Council";

let a = { id: "", csb: "", legacy: "" };
let b = { id: "" };

function pdf(pages: string[][]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  pages.forEach((lines, i) => {
    if (i) doc.addPage();
    doc.fontSize(9);
    for (const l of lines) doc.text(l, { width: 520 });
  });
  doc.end();
  return done;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const people = await listServiceUsers(await coordinator(), {});
  const [x, y] = people;
  a = { id: x!.id, csb: x!.csbReference!, legacy: x!.reference };
  b = { id: y!.id };
}, 180_000);

describe("permanent CSB reference", () => {
  it("every person has a unique CSB number, and the older SU- reference is kept beside it", async () => {
    const all = await db.serviceUser.findMany({ where: { organisation: { slug: BROOKFIELD } }, select: { reference: true, csbReference: true } });
    expect(all.every((s) => /^CSB-\d{6}$/.test(s.csbReference ?? ""))).toBe(true);
    expect(new Set(all.map((s) => s.csbReference)).size).toBe(all.length);
    expect(a.legacy).toMatch(/^SU-/);
    const tab = await referenceNumbersTab(await coordinator(), a.id);
    expect([tab.csbReference, tab.legacyReference]).toEqual([a.csb, a.legacy]);
  });
});

describe("adding references by hand", () => {
  it("saves a Tower Hamlets Frameworki number as an unverified string with its label, and never twice", async () => {
    const c = await coordinator();
    const r = await addExternalReference(c, a.id, { type: "COUNCIL_CLIENT", issuer: TH, systemLabel: "Frameworki", value: "0099017", sourcePage: 2, verificationNote: "Seen on the support plan" });
    expect(r.created).toBe(true);
    const again = await addExternalReference(c, a.id, { type: "COUNCIL_CLIENT", issuer: "tower  hamlets council", systemLabel: "Frameworki", value: "0099017" });
    expect(again).toMatchObject({ id: r.id, created: false });
    const rows = await db.serviceUserExternalReference.findMany({ where: { serviceUserId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valueCipher).not.toContain("0099017");
    const tab = await referenceNumbersTab(c, a.id);
    expect(tab.rows.map((x) => [x.value, x.systemLabel, x.state, x.sourcePage])).toEqual([["0099017", "Frameworki", "AWAITING", 2]]);
  });

  it("refuses a person-specific number that belongs to someone else, but allows a shared framework ID with a warning", async () => {
    const c = await coordinator();
    await expect(addExternalReference(c, b.id, { type: "COUNCIL_CLIENT", issuer: TH, value: "0099017" })).rejects.toBeInstanceOf(ConflictError);
    await addExternalReference(c, a.id, { type: "COUNCIL_FRAMEWORK", issuer: TH, value: "FW-2026-01" });
    const shared = await addExternalReference(c, b.id, { type: "COUNCIL_FRAMEWORK", issuer: TH, value: "FW-2026-01" });
    expect(shared.warnings.join(" ")).toMatch(/shared and never identifies one person/);
    const other = await addExternalReference(c, b.id, { type: "OTHER_EXTERNAL", issuer: "Example Hospital", value: "0099017" });
    expect(other.warnings.join(" ")).toMatch(/different type or issuer/);
  });

  it("links only this person's documents, and only documents the user may open", async () => {
    const c = await coordinator();
    const doc = await db.serviceUserDocument.create({ data: { organisationId: (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id, serviceUserId: b.id, section: "COUNCIL", name: "Support plan", category: "COUNCIL_SUPPORT_PLAN", createdById: c.userId } });
    await expect(addExternalReference(c, a.id, { type: "COUNCIL_PACKAGE", issuer: TH, value: "PKG-0001", sourceDocumentId: doc.id })).rejects.toBeInstanceOf(ValidationError);
    await db.serviceUserDocument.update({ where: { id: doc.id }, data: { sensitive: true } });
    await expect(addExternalReference(c, b.id, { type: "COUNCIL_PACKAGE", issuer: TH, value: "PKG-0002", sourceDocumentId: doc.id })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await addExternalReference(await manager(), b.id, { type: "COUNCIL_PACKAGE", issuer: TH, value: "PKG-0002", sourceDocumentId: doc.id, sourcePage: 1 });
    // The coordinator sees the row but not the restricted document's name or a link to it.
    const row = (await referenceNumbersTab(c, b.id)).rows.find((x) => x.id === ok.id)!;
    expect(row.source).toMatchObject({ kind: "document", restricted: true });
    expect(row.source && "name" in row.source ? row.source.name : "").not.toContain("Support plan");
    const asManager = (await referenceNumbersTab(await manager(), b.id)).rows.find((x) => x.id === ok.id)!;
    expect(asManager.source).toMatchObject({ kind: "document", name: "Support plan", restricted: false });
  });
});

describe("verification and correction", () => {
  it("only a manager verifies, with a reason, and the decision is audited", async () => {
    const [ref] = (await referencesFor(await manager(), a.id)).rows.filter((r) => r.type === "COUNCIL_CLIENT");
    await expect(verifyExternalReference(await coordinator(), ref!.id, true, "Checked")).rejects.toBeInstanceOf(ValidationError);
    await expect(verifyExternalReference(await manager(), ref!.id, true, "")).rejects.toBeInstanceOf(ValidationError);
    await verifyExternalReference(await manager(), ref!.id, true, "Checked against support plan page 2");
    const tab = await referenceNumbersTab(await manager(), a.id);
    expect(tab.rows.find((r) => r.id === ref!.id)).toMatchObject({ state: "VERIFIED", verifiedBy: expect.any(String) });
    expect(tab.history[0]).toMatchObject({ action: "serviceUser.externalReference.verified", verified: true, reason: "Checked against support plan page 2" });
  });

  it("corrects a wrong number without overwriting it: the original is kept as superseded", async () => {
    const m = await manager();
    const wrong = await addExternalReference(m, b.id, { type: "COUNCIL_CLIENT", issuer: TH, systemLabel: "Frameworki", value: "0099100" });
    await expect(supersedeExternalReference(m, wrong.id, { value: "0099100", reason: "typo" })).rejects.toBeInstanceOf(ValidationError);
    const r = await supersedeExternalReference(m, wrong.id, { value: "0099101", reason: "Typed one digit wrong" });
    const rows = await db.serviceUserExternalReference.findMany({ where: { id: { in: [wrong.id, r.replacedById!] } } });
    expect(rows.find((x) => x.id === wrong.id)).toMatchObject({ status: "SUPERSEDED", replacedById: r.replacedById, supersedeReason: "Typed one digit wrong" });
    expect(rows.find((x) => x.id === r.replacedById)).toMatchObject({ status: "ACTIVE", verified: false, systemLabel: "Frameworki" });
    await expect(verifyExternalReference(m, wrong.id, true, "Checked")).rejects.toBeInstanceOf(ConflictError);
    // Superseded numbers are not found by search; the corrected one is.
    expect(await searchReferenceIds(m, "0099100")).toEqual([]);
    expect(await searchReferenceIds(m, "0099101")).toEqual([b.id]);
    // And a superseded number no longer blocks someone else.
    await expect(addExternalReference(m, a.id, { type: "COUNCIL_CLIENT", issuer: TH, value: "0099100" })).resolves.toMatchObject({ created: true });
  });
});

describe("search", () => {
  it("finds a person by CSB number, legacy reference, Frameworki number with or without its label", async () => {
    const c = await coordinator();
    const ids = async (q: string) => (await listServiceUsers(c, { q })).map((s) => s.id);
    expect(await ids(a.csb)).toContain(a.id);
    expect(await ids(a.legacy)).toContain(a.id);
    // b holds the same digits as a hospital reference, so both are found; the screen says which reference matched.
    expect((await ids("0099017")).sort()).toEqual([a.id, b.id].sort());
    expect(await ids("Frameworki 0099017")).toContain(a.id);
    expect(await ids("LBTH Frameworki: 0099017")).toContain(a.id);
    expect(await ids("0099101")).toEqual([b.id]);
    const listed = (await listServiceUsers(c, { q: "FW-2026-01" })).map((s) => s.matchedReference);
    expect(listed).toHaveLength(2);
    expect(listed.every((x) => x?.includes("shared framework ID"))).toBe(true);
  });

  it("the rostering search finds external identifiers and the CSB number", async () => {
    const c = await coordinator();
    const r = await rotaSearch(c, "Frameworki 0099017");
    expect(r.serviceUsers.find((s) => s.id === a.id)!.detail).toContain("matched Tower Hamlets – Frameworki");
    expect((await rotaSearch(c, "0099101")).serviceUsers.map((s) => s.id)).toEqual([b.id]);
    expect((await rotaSearch(c, a.csb)).serviceUsers.map((s) => s.id)).toContain(a.id);
  });
});

describe("NHS numbers stay restricted", () => {
  it("only managers add, see or search NHS references; Personal details is compared, not overwritten", async () => {
    const m = await manager();
    const c = await coordinator();
    await expect(addExternalReference(c, a.id, { type: "NHS", issuer: "NHS England", value: "999 000 0019" })).rejects.toBeInstanceOf(ValidationError);
    await db.serviceUser.update({ where: { id: a.id }, data: { nhsNumber: "9990000027" } });
    await addExternalReference(m, a.id, { type: "NHS", issuer: "NHS England", value: "999 000 0019" });
    expect((await referenceNumbersTab(m, a.id)).nhs).toBe("DIFFERS");
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: a.id } })).nhsNumber).toBe("9990000027");
    const asCoordinator = await referenceNumbersTab(c, a.id);
    expect(asCoordinator.nhs).toBe("RESTRICTED");
    expect(asCoordinator.rows.find((r) => r.type === "NHS")).toMatchObject({ value: null, sourceQuote: null });
    expect(JSON.stringify(asCoordinator)).not.toContain("0019");
    expect(await searchReferenceIds(c, "9990000019")).toEqual([]);
    expect((await rotaSearch(c, "999 000 0019")).serviceUsers).toEqual([]);
    expect(await searchReferenceIds(m, "999 000 0019")).toEqual([a.id]);
    expect(await searchReferenceIds(m, "9990000019")).toEqual([a.id]);
  });
});

describe("isolation", () => {
  it("another organisation cannot read, search or change these references", async () => {
    const o = await otherOrg();
    await expect(referencesFor(o, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(referenceNumbersTab(o, a.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await searchReferenceIds(o, "0099017")).toEqual([]);
    await expect(addExternalReference(o, a.id, { type: "COUNCIL_CLIENT", issuer: TH, value: "0099999" })).rejects.toBeInstanceOf(NotFoundError);
    const ref = (await db.serviceUserExternalReference.findFirstOrThrow({ where: { serviceUserId: a.id } })).id;
    await expect(verifyExternalReference(o, ref, false, "Not ours")).rejects.toBeInstanceOf(NotFoundError);
    await expect(supersedeExternalReference(o, ref, { reason: "Not ours" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a member limited to another branch cannot find the person by reference", async () => {
    const c = await coordinator();
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: a.id } });
    const other = await db.branch.findFirstOrThrow({ where: { organisationId: su.organisationId, id: { not: su.branchId ?? "" } } });
    const m = await db.membership.findUniqueOrThrow({ where: { userId_organisationId: { userId: c.userId, organisationId: su.organisationId } } });
    await db.membershipBranch.create({ data: { membershipId: m.id, branchId: other.id } });
    try {
      expect(await searchReferenceIds(c, "0099017")).not.toContain(a.id);
      expect((await rotaSearch(c, a.csb)).serviceUsers.map((s) => s.id)).not.toContain(a.id);
      await expect(referenceNumbersTab(c, a.id)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await db.membershipBranch.deleteMany({ where: { membershipId: m.id } });
    }
  });
});

describe("Frameworki in the Care Coordinator", () => {
  it("reads the number from a Tower Hamlets support plan with its page, asks for the type, and spots one already linked", async () => {
    const c = await coordinator();
    const intake = await createIntake(c, { title: "Synthetic Tower Hamlets plan", mode: "EXISTING", serviceUserId: a.id });
    const plan = await pdf([
      ["Tower Hamlets Council - Adult Social Care", "Support Plan", "Date of plan: 01/10/2026", "Full name: Ada Fictional"],
      ["LBTH Frameworki 0099017", "Package reference: PO-55501"],
      ["Second number on file: Frameworki: 0099555"],
    ]);
    await addDocuments(c, intake.id, [{ name: "Support plan.pdf", type: "application/pdf", bytes: plan }]);
    const view = await getIntake(c, intake.id);
    const refs = view.facts.filter((f) => f.destination === "externalReference");
    expect(refs.map((f) => [(f.value as { value: string }).value, f.sourcePage, (f.value as { typeUnclear?: boolean }).typeUnclear])).toEqual([["0099017", 2, true], ["0099555", 3, true]]);
    const linked = refs[0]!;
    expect(linked.conflict).toMatch(/does not say what this number identifies/);
    expect(linked.conflict).toMatch(/Already on this person's Reference Numbers tab/);
    // The package reference stays its own fact; the Frameworki number is not proposed as the package reference.
    const pkg = view.facts.filter((f) => f.destination === "package.reference").map((f) => f.value);
    expect(pkg).toEqual(["PO-55501"]);
    // Approving without choosing the type is refused; editing to a type clears the doubt.
    const fresh = refs[1]!;
    await expect(decideFact(c, fresh.id, null, { decision: "APPROVED" })).rejects.toBeInstanceOf(ValidationError);
    await decideFact(c, fresh.id, null, { decision: "EDITED", value: { type: "COUNCIL_CLIENT", issuer: TH, value: "0099555", system: "Frameworki" } });
    const after = (await getIntake(c, intake.id)).facts.find((f) => f.id === fresh.id)!;
    expect(after.value).toEqual({ type: "COUNCIL_CLIENT", issuer: TH, value: "0099555", system: "Frameworki" });
    expect(after.verification).not.toBe("MANUAL");
  });
});

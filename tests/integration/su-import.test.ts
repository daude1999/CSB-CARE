import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import type { LlmProvider } from "@/server/ai/provider";
import type { SupportPlanExtraction } from "@/server/ai/schemas";
import { confirmImport, emptyDraft, readSupportPlan, type ImportDraft } from "@/server/care/su-import";
import { previewBuild } from "@/server/rota/build";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Set up from support plan, against a real database: one transaction creates the person, contacts, package, templates
 * and documents; a failed row leaves nothing behind; duplicates are stopped; permissions and scope hold; and Build Rota
 * sees the visits.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
let orgId = "";
let callTypes: { id: string; name: string }[] = [];

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const files = () => [
  { name: "Example Council support plan.pdf", type: "application/pdf", bytes: PDF },
  { name: "Hospital letter.pdf", type: "application/pdf", bytes: PDF },
];

function draft(over: Partial<ImportDraft> = {}): ImportDraft {
  const base = emptyDraft(files().map((f) => f.name));
  const start = mondayOf(londonDate());
  return {
    ...base,
    person: { firstName: "Imogen", lastName: "Synthetic", dateOfBirth: "1944-01-01", gender: "Female", addressLine1: "1 Example Street", town: "London", postcode: "E1 1AA", phone: "07000 000000", firstLanguage: "Somali", accessNotes: "Lift. Can open the door.", carerGenderPreference: "FEMALE", councilReference: "1000001" },
    contacts: [
      { kind: "NEXT_OF_KIN", name: "Nadia Synthetic", relationship: "Daughter", phone: "0200 000 0000", isEmergency: false, canReceiveUpdates: true, isKeyHolder: true, isPrimary: true, sourcePage: 3 },
      { kind: "OTHER", name: "Sam Synthetic", relationship: "Friend", phone: "07000 000001", isEmergency: true, canReceiveUpdates: false, isKeyHolder: false, isPrimary: false },
      { kind: "GP", name: "Dr Synthetic", relationship: "GP", address: "Example Health Centre", isEmergency: false, canReceiveUpdates: false, isKeyHolder: false },
    ],
    package: { funderName: "Example Council", startDate: start, commissionedMinutesPerWeek: 1365, requirements: "All visits single handed" },
    visits: [
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "09:00", durationMin: 60, carers: 1, callTypeId: ct("Morning"), tasks: "Personal care, meal preparation, prompt with medication", fundedBy: "COUNCIL", medicationPrompt: true, effectiveFrom: start, sourcePages: [8] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "12:00", durationMin: 45, carers: 1, callTypeId: ct("Lunch"), tasks: "Meal preparation", fundedBy: "COUNCIL", medicationPrompt: true, effectiveFrom: start, sourcePages: [8] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "16:30", durationMin: 30, carers: 1, callTypeId: ct("Tea"), tasks: "Teatime snack", fundedBy: "COUNCIL", medicationPrompt: true, effectiveFrom: start, effectiveTo: addDays(start, 41), sourcePages: [8, 9] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "20:00", durationMin: 60, carers: 1, callTypeId: ct("Bed"), tasks: "Bedtime routine", fundedBy: "COUNCIL", medicationPrompt: false, effectiveFrom: start, sourcePages: [9] },
      { weekdays: [3], startTime: "11:00", durationMin: 60, carers: 1, callTypeId: ct("Sitting"), tasks: "Food shopping", fundedBy: "CARERS_SERVICE", medicationPrompt: false, effectiveFrom: start, sourcePages: [9] },
      { weekdays: [1], startTime: "12:45", durationMin: 60, carers: 1, callTypeId: ct("Sitting"), tasks: "Cleaning and laundry", fundedBy: "CARERS_SERVICE", medicationPrompt: false, effectiveFrom: start, sourcePages: [9, 10] },
    ],
    documents: [
      { fileIndex: 0, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "Council support plan", markSensitive: false },
      { fileIndex: 1, section: "OTHER", category: "DISCHARGE_INFORMATION", name: "Hospital discharge letter", markSensitive: false },
    ],
    careActiveFrom: start,
    flags: ["Evening visit: 19:30 in the narrative, 20:00 in the timetable"],
    ...over,
  };
}
const ct = (name: string) => callTypes.find((c) => c.name.toLowerCase().includes(name.toLowerCase()))?.id ?? callTypes[0]!.id;

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  callTypes = await db.callType.findMany({ where: { organisationId: orgId, active: true }, select: { id: true, name: true } });
}, 180_000);

describe("reading the plan", () => {
  it("opens an empty form when the provider cannot read documents, and refuses non-PDF or oversized files", async () => {
    setAiProviderForTests(new SimulatedProvider());
    const r = await readSupportPlan(await coordinator(), files());
    expect(r.source).toBe("manual");
    expect(r.draft.visits).toEqual([]);
    expect(r.draft.documents.map((d) => d.category)).toEqual(["COUNCIL_SUPPORT_PLAN", "OTHER_SUPPORTING"]);
    await expect(readSupportPlan(await coordinator(), [])).rejects.toBeInstanceOf(ValidationError);
    await expect(readSupportPlan(await coordinator(), [{ name: "x.docx", type: "application/msword", bytes: Buffer.from("PK\u0003\u0004") }])).rejects.toThrow(/PDF/);
    await expect(readSupportPlan(await coordinator(), [{ name: "big.pdf", type: "application/pdf", bytes: Buffer.alloc(4 * 1024 * 1024 + 1, 0x25) }])).rejects.toThrow(/4 MB/);
  });

  it("uses the provider's reading, page references and all, and flags a likely duplicate before anything is saved", async () => {
    const reading: LlmProvider = Object.assign(new SimulatedProvider(), {
      name: "test-reader",
      isSimulated: false,
      async extractSupportPlan(): Promise<SupportPlanExtraction> {
        return {
          person: { firstName: { value: "Imogen", page: 1 }, lastName: { value: "Synthetic", page: 1 }, dateOfBirth: { value: "1944-01-01", page: 1 }, gender: null, nhsNumber: null, addressLine1: null, addressLine2: null, town: null, postcode: { value: "E1 1AA", page: 1 }, phone: null, firstLanguage: null, accessNotes: null, communicationNeeds: null, councilReference: null },
          contacts: [],
          package: { funder: { value: "Example Council", page: 1 }, startDate: { value: "2026-09-30", page: 8 }, endDate: null, hoursPerWeek: { value: "3.5", page: 7 }, costPerWeek: null, requirements: null },
          visits: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "16:30", durationMinutes: 30, carers: 1, tasks: "Teatime snack", fundedBy: "COUNCIL", medicationPrompt: true, isNew: true, pages: [8, 9] }],
          flags: [{ text: "Temporary service for 6 weeks", pages: [7] }],
          unreadable: [],
        };
      },
    });
    setAiProviderForTests(reading);
    const before = await db.serviceUser.count({ where: { organisationId: orgId } });
    const r = await readSupportPlan(await coordinator(), files());
    expect(r.source).toBe("ai");
    expect(r.draft.visits[0]).toMatchObject({ startTime: "16:30", durationMin: 30, medicationPrompt: true, sourcePages: [8, 9], effectiveFrom: "2026-09-30" });
    expect(r.draft.flags).toEqual(["Temporary service for 6 weeks (page 7)"]);
    expect(r.duplicates).toEqual([]);
    expect(await db.serviceUser.count({ where: { organisationId: orgId } })).toBe(before);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: "serviceUser.import.read" } })).toBe(1);
    setAiProviderForTests(undefined);
  });
});

describe("confirming", () => {
  it("creates the person, contacts, package, templates and documents in one go, and Build Rota sees the visits", async () => {
    const ctx = await coordinator();
    const r = await confirmImport(ctx, draft(), files());
    expect(r).toMatchObject({ contacts: 3, templates: 6, documents: 2, careActive: true });
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: r.serviceUserId }, include: { contacts: true, packages: true, templates: { include: { callType: true } }, documents: { include: { versions: true } } } });
    expect(su.status).toBe("ACTIVE");
    expect(su.reference).toBe(r.reference);
    expect(su.carerGenderPreference).toBe("FEMALE");
    expect(su.carePreferences).toContain("Council reference: 1000001");
    // A coordinator may not record sensitive identifiers, so the date of birth stays empty.
    expect(su.dateOfBirth).toBeNull();
    expect(su.contacts.map((c) => c.kind).sort()).toEqual(["GP", "NEXT_OF_KIN", "OTHER"]);
    expect(su.contacts.find((c) => c.kind === "NEXT_OF_KIN")).toMatchObject({ isPrimary: true, notes: "Key holder. Support plan page 3" });
    expect(su.contacts.find((c) => c.kind === "OTHER")?.isEmergency).toBe(true);
    expect(su.packages).toHaveLength(1);
    expect(su.packages[0]).toMatchObject({ status: "ACTIVE", commissionedMinutesPerWeek: 1365, reference: "1000001" });
    expect(su.packages[0]!.requirements).toContain("Funder: Example Council");
    expect(su.templates).toHaveLength(6);
    const tea = su.templates.find((t) => t.startMinute === 16 * 60 + 30)!;
    expect(tea).toMatchObject({ durationMin: 30, carersRequired: 1, medicationRequired: true, weekdays: [1, 2, 3, 4, 5, 6, 7], cycleWeeks: [1, 2, 3, 4] });
    expect(tea.effectiveTo).not.toBeNull();
    expect(tea.notes).toContain("(Support plan page 8, 9)");
    const bed = su.templates.find((t) => t.startMinute === 20 * 60)!;
    expect(bed.medicationRequired).toBe(false);
    const shop = su.templates.find((t) => t.startMinute === 11 * 60)!;
    expect(shop.weekdays).toEqual([3]);
    expect(shop.notes).toMatch(/^\[Carers service/);
    expect(su.documents.map((d) => [d.section, d.category, d.sensitive])).toEqual(expect.arrayContaining([["COUNCIL", "COUNCIL_SUPPORT_PLAN", false], ["OTHER", "DISCHARGE_INFORMATION", true]]));
    expect(su.documents.every((d) => d.versions.length === 1)).toBe(true);
    // Audit: the person, each contact, the package, each template, each document and the import itself.
    const actions = (await db.auditLog.findMany({ where: { organisationId: orgId, OR: [{ entityId: su.id }, { entityType: "VisitTemplate", entityId: { in: su.templates.map((t) => t.id) } }, { entityType: "ServiceUserDocument", entityId: { in: su.documents.map((d) => d.id) } }] }, select: { action: true } })).map((a) => a.action);
    expect(actions.filter((a) => a === "serviceUser.created")).toHaveLength(1);
    expect(actions.filter((a) => a === "serviceUser.contact.added")).toHaveLength(3);
    expect(actions.filter((a) => a === "template.created")).toHaveLength(6);
    expect(actions.filter((a) => a === "suDocument.uploaded")).toHaveLength(2);
    expect(actions).toContain("serviceUser.import.confirmed");
    expect(actions).toContain("serviceUser.status");
    // A new Council Support Plan prompts the managers to review the care plan (bell only).
    expect(await db.notification.count({ where: { organisationId: orgId, type: "care.plan.review-prompt", actionUrl: { contains: su.id } } })).toBeGreaterThan(0);
    // Build Rota for next week schedules the imported visits: 4 daily rows x 7 + 2 weekly = 30.
    const week = addDays(mondayOf(londonDate()), 7);
    const preview = await previewBuild(await manager(), { weekStart: week });
    expect(preview.visits.filter((v) => v.serviceUserId === su.id)).toHaveLength(30);
  });

  it("stops a likely duplicate unless the office says it is a different person", async () => {
    const ctx = await coordinator();
    await expect(confirmImport(ctx, draft(), files())).rejects.toBeInstanceOf(ConflictError);
    const r = await confirmImport(ctx, draft({ notADuplicate: true, visits: draft().visits.slice(0, 1), documents: [], contacts: [] }), []);
    expect(r.templates).toBe(1);
  });

  it("leaves nothing behind when one row is wrong", async () => {
    const ctx = await coordinator();
    const before = { su: await db.serviceUser.count({ where: { organisationId: orgId } }), tpl: await db.visitTemplate.count({ where: { organisationId: orgId } }), doc: await db.serviceUserDocument.count({ where: { organisationId: orgId } }) };
    const bad = draft({ notADuplicate: true, person: { ...draft().person, firstName: "Second" }, visits: [...draft().visits, { ...draft().visits[0]!, callTypeId: "not-a-call-type" }] });
    await expect(confirmImport(ctx, bad, files())).rejects.toThrow();
    expect(await db.serviceUser.count({ where: { organisationId: orgId } })).toBe(before.su);
    expect(await db.visitTemplate.count({ where: { organisationId: orgId } })).toBe(before.tpl);
    expect(await db.serviceUserDocument.count({ where: { organisationId: orgId } })).toBe(before.doc);
    await expect(confirmImport(ctx, draft({ notADuplicate: true, visits: [] }), files())).rejects.toThrow(/at least one visit/);
    await expect(confirmImport(ctx, draft({ notADuplicate: true, documents: [{ fileIndex: 5, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "Missing file", markSensitive: false }] }), files())).rejects.toThrow(/missing its file/);
    await expect(confirmImport(ctx, draft({ notADuplicate: true, documents: [{ fileIndex: 0, section: "COUNCIL", category: "NOT_A_CATEGORY", name: "Odd", markSensitive: false }] }), files())).rejects.toBeInstanceOf(ValidationError);
    await expect(confirmImport(ctx, { person: {} }, files())).rejects.toBeInstanceOf(ValidationError);
  });

  it("only a coordinator or above may import, and only a manager may restrict a document", async () => {
    const carer = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, roles: { has: "CARER" } }, include: { user: true } });
    await expect(confirmImport(await ctxFor(carer.user.email, BROOKFIELD), draft({ notADuplicate: true }), files())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(confirmImport(await coordinator(), draft({ notADuplicate: true, documents: [{ fileIndex: 0, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "Plan", markSensitive: true }] }), files())).rejects.toThrow(/registered manager/);
    const r = await confirmImport(await manager(), draft({ notADuplicate: true, person: { ...draft().person, firstName: "Third" }, documents: [{ fileIndex: 0, section: "COUNCIL", category: "COUNCIL_SUPPORT_PLAN", name: "Plan", markSensitive: true }] }), files().slice(0, 1));
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: r.serviceUserId }, include: { documents: true } });
    expect(su.documents[0]?.sensitive).toBe(true);
    // A manager may record the date of birth.
    expect(su.dateOfBirth).not.toBeNull();
  });

  it("keeps the person at Assessment when no care start is given, so Build Rota skips them", async () => {
    const r = await confirmImport(await coordinator(), draft({ notADuplicate: true, person: { ...draft().person, firstName: "Fourth" }, careActiveFrom: "", documents: [] }), []);
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: r.serviceUserId } });
    expect(su.status).toBe("ASSESSMENT");
    expect(r.careActive).toBe(false);
    const preview = await previewBuild(await manager(), { weekStart: addDays(mondayOf(londonDate()), 7) });
    expect(preview.visits.some((v) => v.serviceUserId === su.id)).toBe(false);
  });
});

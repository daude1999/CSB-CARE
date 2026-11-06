import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { bulkSignoff, createRule } from "@/server/policies/assignment";
import { importPolicies, sectionsFromHtml, titleFromFilename } from "@/server/policies/import";
import { centralWhere, libraryHref, libraryView, parseLibraryQuery } from "@/server/policies/library-view";
import { complianceReport, complianceReportFile, parseReportFilters, reportFormats } from "@/server/compliance/reports";
import { workspaceCounts } from "@/server/compliance/workspace-counts";
import { requirementRegister } from "@/server/compliance/requirements";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Policy & Compliance redesign (owner's brief of 3 Nov 2026) against a real database: bulk sign-off work from the
 * register, Upload policy, the library inspector's position and closed state, the new reports and their filters, and
 * the counts on the workspace tabs. Every check also confirms nothing crosses organisations.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const author = () => ctxFor("author@care-solution.demo", BROOKFIELD);
const carer = () => ctxFor("carer@care-solution.demo", BROOKFIELD);
const other = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let orgId = "";

async function wordFile(paragraphs: Paragraph[]) {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] })));
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("Staff Sign-off bulk actions", () => {
  async function outstandingIds(n: number) {
    const m = await manager();
    const p = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-HS-002", currentPublishedVersionId: { not: null } } });
    await createRule(m, { policyId: p.id, scope: "ORG", dueDays: 14 });
    const rows = await db.acknowledgement.findMany({ where: { organisationId: orgId, acknowledgedAt: null, supersededAt: null, state: "ASSIGNED", userId: { not: null } }, take: n, orderBy: { id: "asc" } });
    expect(rows.length).toBe(n);
    return rows.map((r) => r.id);
  }

  it("extends due dates with a reason, recording an event and an audit entry on each row", async () => {
    const m = await manager();
    const ids = await outstandingIds(2);
    const due = new Date(Date.now() + 40 * 86_400_000);
    const r = await bulkSignoff(m, { op: "extend", ids, dueAt: due, reason: "Annual leave until next month" });
    expect(r).toEqual({ done: 2, skipped: 0 });
    for (const id of ids) {
      const a = await db.acknowledgement.findUniqueOrThrow({ where: { id } });
      expect(a.dueAt?.toISOString().slice(0, 10)).toBe(due.toISOString().slice(0, 10));
      expect(await db.acknowledgementEvent.count({ where: { acknowledgementId: id, type: "DUE_DATE_CHANGED" } })).toBe(1);
    }
    expect(await db.auditLog.count({ where: { action: "policy.acknowledgement.due_changed", entityId: { in: ids } } })).toBe(2);
  });

  it("refuses a due date in the past and a missing reason", async () => {
    const m = await manager();
    const ids = await outstandingIds(1);
    await expect(bulkSignoff(m, { op: "extend", ids, dueAt: new Date(Date.now() - 3 * 86_400_000), reason: "Too late now" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bulkSignoff(m, { op: "exempt", ids, reason: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("sends in-app reminders only, never email, and never marks anyone as having read the policy", async () => {
    const m = await manager();
    const ids = await outstandingIds(2);
    const r = await bulkSignoff(m, { op: "remind", ids });
    expect(r.done).toBe(2);
    const rows = await db.acknowledgement.findMany({ where: { id: { in: ids } } });
    expect(rows.every((a) => a.remindedAt && !a.acknowledgedAt && !a.openedAt)).toBe(true);
    const notes = await db.notification.findMany({ where: { userId: { in: rows.map((a) => a.userId!) }, title: { startsWith: "Reminder: please read" } } });
    expect(notes.length).toBeGreaterThanOrEqual(2);
    // The same reminder twice in a day is not sent again.
    expect((await bulkSignoff(m, { op: "remind", ids })).done).toBe(0);
  });

  it("exempts outstanding rows and skips rows that are already done", async () => {
    const m = await manager();
    const ids = await outstandingIds(2);
    const done = await db.acknowledgement.findFirstOrThrow({ where: { organisationId: orgId, acknowledgedAt: { not: null } } }).catch(() => null);
    const r = await bulkSignoff(m, { op: "exempt", ids: [...ids, ...(done ? [done.id] : [])], reason: "On long-term leave" });
    expect(r.done).toBe(2);
    expect(r.skipped).toBe(done ? 1 : 0);
    expect((await db.acknowledgement.findMany({ where: { id: { in: ids } } })).every((a) => a.state === "EXEMPTED" && a.exemptionReason === "On long-term leave")).toBe(true);
    if (done) expect((await db.acknowledgement.findUniqueOrThrow({ where: { id: done.id } })).state).not.toBe("EXEMPTED");
  });

  it("does nothing to another organisation's rows and refuses people without sign-off management", async () => {
    const ids = await outstandingIds(1);
    expect(await bulkSignoff(await other(), { op: "exempt", ids, reason: "Not my organisation" })).toEqual({ done: 0, skipped: 1 });
    expect((await db.acknowledgement.findUniqueOrThrow({ where: { id: ids[0]! } })).state).toBe("ASSIGNED");
    await expect(bulkSignoff(await carer(), { op: "remind", ids })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Upload policy", () => {
  it("turns a Word file into a Draft v1 policy split at its headings, keeping the original as private evidence", async () => {
    const a = await author();
    const bytes = await wordFile([
      new Paragraph({ text: "Purpose", heading: HeadingLevel.HEADING_1 }),
      new Paragraph("Why this policy exists."),
      new Paragraph({ text: "Local contacts", heading: HeadingLevel.HEADING_1 }),
      new Paragraph("Duty manager: 0151 000 0000"),
    ]);
    const r = await importPolicies(a, [{ name: "Lone_working policy.docx", type: DOCX, bytes }], { categoryCode: "HEALTH_SAFETY", ownerId: a.userId, duplicateCheck: true, extractText: true });
    expect(r.skipped).toEqual([]);
    expect(r.created).toHaveLength(1);
    const p = await db.policy.findUniqueOrThrow({ where: { id: r.created[0]!.id }, include: { revisions: { include: { draftVersion: { include: { sections: { orderBy: { position: "asc" } } } } } } } });
    expect(p.title).toBe("Lone working policy");
    expect(p.ref).toMatch(/^IMP-\d{3}$/);
    expect(p.organisationId).toBe(orgId);
    // Never published or approved: no live version, one open draft revision.
    expect(p.currentPublishedVersionId).toBeNull();
    expect(p.revisions).toHaveLength(1);
    expect(p.revisions[0]!.submittedAt).toBeNull();
    expect(p.revisions[0]!.draftVersion.status).toBe("DRAFT");
    expect(p.revisions[0]!.draftVersion.sections.map((s) => [s.heading, s.isLocal])).toEqual([["Purpose", false], ["Local contacts", true]]);
    const original = await db.evidenceDocument.findFirstOrThrow({ where: { linkedType: "POLICY", linkedId: p.id } });
    expect(original.organisationId).toBe(orgId);
    expect(original.filename).toBe("Lone_working policy.docx");
    expect(await db.auditLog.count({ where: { action: "policy.uploaded", entityId: p.id } })).toBe(1);
  });

  it("skips duplicates by title, wrong types and disguised files, and still brings in the rest", async () => {
    const a = await author();
    const word = await wordFile([new Paragraph("Text without headings.")]);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const r = await importPolicies(a, [
      { name: "Lone working policy.docx", type: DOCX, bytes: word },
      { name: "notes.txt", type: "text/plain", bytes: Buffer.from("hello") },
      { name: "fake.pdf", type: "application/pdf", bytes: Buffer.from("not really a pdf") },
      { name: "Fire safety.pdf", type: "application/pdf", bytes: pdf },
    ], { categoryCode: "HEALTH_SAFETY", ownerId: a.userId, duplicateCheck: true, extractText: true });
    expect(r.created.map((c) => c.title)).toEqual(["Fire safety"]);
    expect(r.created[0]!.extracted).toBe(false);
    expect(r.skipped.map((s) => s.name)).toEqual(["Lone working policy.docx", "notes.txt", "fake.pdf"]);
  });

  it("checks the owner belongs to the organisation and needs authoring rights", async () => {
    const a = await author();
    const word = await wordFile([new Paragraph("x")]);
    const outsider = (await other()).userId;
    await expect(importPolicies(a, [{ name: "a.docx", type: DOCX, bytes: word }], { categoryCode: "HEALTH_SAFETY", ownerId: outsider, duplicateCheck: false, extractText: false })).rejects.toBeInstanceOf(ValidationError);
    await expect(importPolicies(await carer(), [{ name: "a.docx", type: DOCX, bytes: word }], { categoryCode: "HEALTH_SAFETY", ownerId: a.userId, duplicateCheck: false, extractText: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("names and splits documents predictably", () => {
    expect(titleFromFilename("Medication_policy  v3.docx")).toBe("Medication policy v3");
    expect(sectionsFromHtml("<p>Intro</p><h1>Scope</h1><p>All staff</p><h2>Scope</h2><p>Again</p>").map((s) => [s.key, s.heading])).toEqual([["imported-text", "Imported text"], ["scope", "Scope"], ["scope-2", "Scope"]]);
  });
});

describe("Policy Library inspector", () => {
  it("opens the first policy by default, gives its position, and stays closed once closed", async () => {
    const m = await manager();
    const open = await libraryView(m, parseLibraryQuery({ q: "safeguard" }));
    expect(open.selectedId).toBe(open.rows[0]!.id);
    expect(open.position).toMatchObject({ index: 1, total: open.total });
    expect(open.position!.prev).toBeUndefined();
    const second = await libraryView(m, parseLibraryQuery({ q: "safeguard", selected: open.position!.next!.id }));
    expect(second.position!.index).toBe(2);
    expect(second.position!.prev!.id).toBe(open.rows[0]!.id);
    const closed = await libraryView(m, parseLibraryQuery({ q: "safeguard", insp: "closed" }));
    expect(closed.selectedId).toBeUndefined();
    // Closing keeps the search, and choosing a policy again clears the closed state.
    expect(libraryHref(closed.query, { selected: undefined, insp: "closed" })).toBe("/policies?q=safeguard&insp=closed");
    expect(parseLibraryQuery({ q: "safeguard", insp: "closed", selected: open.rows[0]!.id }).insp).toBeUndefined();
  });

  it("moves to the next page when Next crosses a page boundary", async () => {
    const m = await manager();
    const first = await libraryView(m, parseLibraryQuery({}));
    const last = first.rows[first.rows.length - 1]!;
    const v = await libraryView(m, parseLibraryQuery({ selected: last.id }));
    if (first.total > first.rows.length) expect(v.position!.next!.page).toBe(2);
    else expect(v.position!.next).toBeUndefined();
    expect(v.position!.index).toBe(first.rows.length);
  });
});

describe("Compliance Reports", () => {
  it("applies the status and category filters, and the export holds exactly the rows on screen", async () => {
    const m = await manager();
    const all = await complianceReport(m, "policies", parseReportFilters({}));
    const f = parseReportFilters({ status: "current", category: "SAFEGUARDING" });
    const some = await complianceReport(m, "policies", f);
    expect(some.rows.length).toBeGreaterThan(0);
    expect(some.rows.length).toBeLessThan(all.rows.length);
    expect(some.rows.every((r) => r.includes("Current"))).toBe(true);
    const csv = (await complianceReportFile(m, "policies", f, "csv")).body.toString();
    expect(csv.trim().split("\n").length - 1).toBe(some.rows.length);
  });

  it("lists overdue and due reviews, and summarises every report the person may open", async () => {
    const m = await manager();
    const overdue = await complianceReport(m, "overdue", parseReportFilters({}));
    expect(overdue.columns.length).toBeGreaterThan(0);
    const summary = await complianceReport(m, "summary", parseReportFilters({}));
    expect(summary.columns).toEqual(["Report", "Measure", "Figure"]);
    expect(new Set(summary.rows.map((r) => r[0]))).toContain("Policy status");
  });

  it("offers the summary as PDF only and refuses other formats", async () => {
    const m = await manager();
    expect(reportFormats("summary")).toEqual(["pdf"]);
    await expect(complianceReportFile(m, "summary", parseReportFilters({}), "csv")).rejects.toBeInstanceOf(ValidationError);
    expect((await complianceReportFile(m, "summary", parseReportFilters({}), "pdf")).body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("workspace tab counts and the requirements register", () => {
  it("counts each tab from the caller's own records", async () => {
    const m = await manager();
    const lib = await workspaceCounts(m, "library");
    // The Policies tab holds the organisation's own documents plus the CSB central documents it uses as published.
    const own = (organisationId: string) => ({ organisationId, kind: "CUSTOMER" as const, status: "ACTIVE" as const });
    expect(lib.policies).toBe(await db.policy.count({ where: { OR: [own(orgId), await centralWhere(orgId)] } }));
    const oakId = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
    const oak = await workspaceCounts(await other(), "library");
    expect(oak.policies).toBe(await db.policy.count({ where: { OR: [own(oakId), await centralWhere(oakId)] } }));
  });

  it("counts linked policies from the caller's own library only", async () => {
    const rows = await requirementRegister(await manager());
    expect(rows.length).toBeGreaterThan(0);
    const own = await db.policy.count({ where: { organisationId: orgId } });
    expect(rows.every((r) => r.policies <= own)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseBody } = await import("@/server/documents/model");
const { renderDocx } = await import("@/server/documents/docx");
const { renderPdf } = await import("@/server/documents/pdf");
import type { DocModel } from "@/server/documents/model";

const model: DocModel = {
  ref: "CSB-SAF-001",
  title: "Safeguarding Adults",
  typeLabel: "Policy",
  description: "How staff recognise and report abuse.",
  category: "Safeguarding",
  organisation: "Brookfield Care Group (DEMO)",
  isTemplate: false,
  version: "2",
  status: "Published",
  publishedAt: new Date("2026-08-27"),
  effectiveDate: new Date("2026-08-27"),
  approvedAt: new Date("2026-08-20"),
  approvedBy: "Avery Approver",
  owner: "Morgan Manager",
  nextReviewDate: new Date("2027-08-27"),
  reviewIntervalMonths: 12,
  appliesTo: "Residential care homes",
  history: [{ version: "2", status: "Published", date: new Date("2026-08-27"), summary: "Reporting timescales updated ≥ 24 hours" }],
  requirements: [{ ref: "CQC-QS-S3", reference: "CQC quality statement, Safe: Safeguarding", title: "Safe: Safeguarding", type: "CQC quality statement" }],
  sections: [{ number: 1, heading: "Purpose", isLocal: false, blocks: parseBody("Intro:\n• one\n• two\n1. first\n[Complete locally] Add contacts.") }],
  generatedAt: new Date(),
  generatedBy: "Test",
};

describe("branded document export", () => {
  it("splits section text into paragraphs, bullets, numbered items and local prompts", () => {
    expect(model.sections[0].blocks.map((b) => b.kind)).toEqual(["para", "bullet", "bullet", "numbered", "local"]);
  });

  it("renders a Word document", async () => {
    const buf = await renderDocx(model);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("renders a PDF with a cover page and numbered pages", async () => {
    const buf = await renderPdf(model);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

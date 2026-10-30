import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { printableRota } from "@/server/rota/print";
import { marChartPdf } from "@/server/care/mar-pdf";
import { addMedication, approveMedication, setMedicationEnabled } from "@/server/care/medication";
import { inspectPdf, outside, overlaps } from "../support/pdf-inspect";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Document QA (V1 readiness brief, phase 5) for the PDFs outside the Policy Library: the printable rota and the MAR
 * chart. Each is read back with PDF.js the way a viewer sees it: embedded fonts, no text drawn over other text, nothing
 * clipped at the edges, and the expected content present. Set DOC_QA_DIR to keep the files for a manual look.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
const keep = (name: string, pdf: Buffer) => process.env.DOC_QA_DIR && writeFileSync(`${process.env.DOC_QA_DIR}/${name}`, pdf);

async function checkPdf(pdf: Buffer) {
  const raw = pdf.toString("latin1");
  expect(raw).toMatch(/\/FontFile2/);
  expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
  const pages = await inspectPdf(pdf);
  for (const [i, p] of pages.entries()) {
    expect(overlaps(p), `overlapping text on page ${i + 1}`).toEqual([]);
    expect(outside(p, 20).map((b) => b.str), `text outside page ${i + 1}`).toEqual([]);
  }
  return pages;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("printable rota", () => {
  it("prints every carer's week legibly with embedded fonts, one carer per page section", async () => {
    const carers = await db.staffMember.findMany({ where: { organisationId: orgId, assignments: { some: { removedAt: null } } }, select: { id: true, displayName: true }, take: 4 });
    const week = mondayOf(londonDate());
    const { pdf } = await printableRota(await manager(), { kind: "CARER", ids: carers.map((c) => c.id), from: week, to: addDays(week, 6), keySafe: true });
    keep("rota-carers.pdf", pdf);
    const pages = await checkPdf(pdf);
    const text = pages.map((p) => p.text).join(" ");
    for (const c of carers) expect(text).toContain(c.displayName);
  });

  it("prints a person's visits without surnames when asked", async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId }, orderBy: { reference: "asc" } });
    const week = mondayOf(londonDate());
    const { pdf } = await printableRota(await manager(), { kind: "SERVICE_USER", ids: [su.id], from: week, to: addDays(week, 6), excludeSurname: true });
    keep("rota-person.pdf", pdf);
    const pages = await checkPdf(pdf);
    expect(pages.map((p) => p.text).join(" ")).not.toContain(su.lastName);
  });
});

describe("MAR chart", () => {
  it("prints a month's chart legibly once medication is switched on after review", async () => {
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId }, orderBy: { reference: "asc" } });
    await setMedicationEnabled(await manager(), true, "Document QA test: reviewed by a registered nurse (synthetic)");
    const today = londonDate();
    const meds = [
      { name: "Paracetamol", strength: "500 mg", dose: "2 tablets", route: "ORAL", support: "PROMPT", timeRanges: ["MORNING", "TEA"], startDate: today, prescriber: "Dr Test (synthetic)" },
      { name: "Hydroxocobalamin and a deliberately long medicine name to test wrapping", strength: "1 mg/ml", dose: "1 ml", route: "OTHER", support: "ASSIST", timeRanges: ["LUNCH"], startDate: today, instructions: "Synthetic test instruction that is long enough to need wrapping across the width of the chart column." },
    ] as const;
    for (const m of meds) {
      const added = await addMedication(await manager(), su.id, { ...m, timeRanges: [...m.timeRanges] });
      // A second person approves (the coordinator, acting as a care manager, as in medication.test.ts).
      await approveMedication({ ...(await ctxFor("coordinator@care-solution.demo", BROOKFIELD)), orgRoles: ["CARE_MANAGER"] }, added.id);
    }
    const { pdf } = await marChartPdf(await manager(), su.id, today.slice(0, 7));
    keep("mar-chart.pdf", pdf);
    const pages = await checkPdf(pdf);
    expect(pages.map((p) => p.text).join(" ")).toContain("Paracetamol");
  });
});

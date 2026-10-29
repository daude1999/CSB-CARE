import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, londonDate, mondayOf } from "@/lib/london";
import { addBand, createRateCard } from "@/server/finance/rates";
import { adjustLine, decideTimesheet, generateTimesheets, submitTimesheet } from "@/server/finance/timesheets";
import { approveRun, getInvoiceRun, getPayRun, prepareInvoiceRun, preparePayRun, runCsv, voidRun } from "@/server/finance/runs";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/** Finance preparation against a real database: timesheets, pay and invoice runs, separation of duties and the frozen-run triggers. */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const finance = () => ctxFor("finance@care-solution.demo", BROOKFIELD);
let orgId = "";
const lastWeek = addDays(mondayOf(londonDate()), -7);

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 240_000);

describe("demo seed", () => {
  it("prepares last week through the services: approved timesheets and draft pay and invoice runs", async () => {
    const sheets = await db.timesheet.findMany({ where: { organisationId: orgId, periodStart: new Date(`${lastWeek}T00:00:00Z`) } });
    expect(sheets.length).toBeGreaterThan(5);
    expect(sheets.every((s) => s.status === "APPROVED")).toBe(true);
    expect(sheets.some((s) => s.exceptions > 0)).toBe(true);
    const pay = await db.payRun.findFirstOrThrow({ where: { organisationId: orgId, status: "DRAFT" } });
    expect(pay.totalPence).toBeGreaterThan(0);
    const inv = await db.invoiceRun.findFirstOrThrow({ where: { organisationId: orgId, status: "DRAFT" }, include: { invoices: true } });
    expect(inv.invoices.length).toBeGreaterThanOrEqual(3);
    expect((inv.exceptions as { kind: string }[]).some((e) => e.kind === "NO_FUNDER")).toBe(true);
  });
});

describe("timesheets", () => {
  it("refuses unfinished weeks, and lets only someone else decide a submitted timesheet", async () => {
    const c = await coordinator();
    await expect(generateTimesheets(c, mondayOf(londonDate()))).rejects.toBeInstanceOf(ValidationError);
    await expect(generateTimesheets(c, addDays(mondayOf(londonDate()), -6))).rejects.toThrow(/Monday/);
    // Regenerating leaves approved timesheets alone.
    const r = await generateTimesheets(c, lastWeek);
    expect(r.created + r.refreshed).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
  });

  it("adjusts a draft line with a reason and a version check, then needs a second person", async () => {
    const t = await db.timesheet.findFirstOrThrow({ where: { organisationId: orgId, status: "APPROVED" }, include: { lines: true } });
    // Test set-up only: put one approved timesheet back to submitted so the reject, adjust and resubmit path can run.
    await db.$executeRaw`UPDATE "Timesheet" SET status = 'SUBMITTED', "submittedById" = ${(await coordinator()).userId}, version = version + 1 WHERE id = ${t.id}`;
    const f = await finance();
    const sub = await db.timesheet.findUniqueOrThrow({ where: { id: t.id } });
    await decideTimesheet(f, t.id, sub.version, "REJECTED", "Check the short visit on Tuesday");
    const c = await coordinator();
    const rej = await db.timesheet.findUniqueOrThrow({ where: { id: t.id } });
    await expect(adjustLine(c, t.id, rej.version, t.lines[0]!.id, 10, "")).rejects.toBeInstanceOf(ValidationError);
    await adjustLine(c, t.id, rej.version, t.lines[0]!.id, 10, "Carer confirmed they left early");
    await expect(adjustLine(c, t.id, rej.version, t.lines[0]!.id, 12, "Stale")).rejects.toBeInstanceOf(ConflictError);
    const adj = await db.timesheet.findUniqueOrThrow({ where: { id: t.id }, include: { lines: true } });
    expect(adj.payableMinutes).toBe(adj.lines.reduce((n, l) => n + l.payableMinutes, 0));
    expect(adj.lines.find((l) => l.id === t.lines[0]!.id)?.exception).toMatch(/Adjusted from/);
    await submitTimesheet(f, t.id, adj.version);
    const again = await db.timesheet.findUniqueOrThrow({ where: { id: t.id } });
    await expect(decideTimesheet(f, t.id, again.version, "APPROVED", "")).rejects.toBeInstanceOf(ForbiddenError);
    await decideTimesheet(await manager(), t.id, again.version, "APPROVED", "");
    await expect(decideTimesheet(c, t.id, again.version + 1, "APPROVED", "")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("runs", () => {
  it("allows one open run a week, needs a second person to approve, numbers invoices, and freezes approved runs", async () => {
    const f = await finance();
    const m = await manager();
    await expect(preparePayRun(f, lastWeek)).rejects.toBeInstanceOf(ConflictError);
    const pay = await db.payRun.findFirstOrThrow({ where: { organisationId: orgId, status: "DRAFT" } });
    await expect(approveRun(f, "pay", pay.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(db.payRun.update({ where: { id: pay.id }, data: { status: "APPROVED", approvedById: pay.createdById } })).rejects.toThrow(/cannot approve/);
    await expect(runCsv(m, "pay", pay.id)).rejects.toBeInstanceOf(ValidationError);
    await approveRun(m, "pay", pay.id);
    await expect(db.payRun.update({ where: { id: pay.id }, data: { totalPence: 1 } })).rejects.toThrow(/cannot change/);
    await expect(db.payLine.deleteMany({ where: { runId: pay.id } })).rejects.toThrow(/cannot change/);
    const csv = await runCsv(m, "pay", pay.id);
    expect(csv.body.split("\r\n").length).toBeGreaterThan(10);

    const inv = await db.invoiceRun.findFirstOrThrow({ where: { organisationId: orgId, status: "DRAFT" } });
    await approveRun(m, "invoice", inv.id);
    const { run } = await getInvoiceRun(m, inv.id);
    const numbers = run.invoices.map((i) => i.number);
    expect(numbers.every((n) => /^CSB-\d{5}$/.test(n ?? ""))).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);

    await voidRun(f, "invoice", inv.id, "Wrong rate card for one council");
    const fresh = await prepareInvoiceRun(f, lastWeek);
    expect(fresh.status).toBe("DRAFT");
    await expect(db.invoiceRun.delete({ where: { id: inv.id } })).rejects.toThrow();
  });

  it("prices each visit on its band, and a used rate card can no longer change", async () => {
    const m = await manager();
    const { run } = await getPayRun(m, (await db.payRun.findFirstOrThrow({ where: { organisationId: orgId, status: "APPROVED" } })).id);
    for (const l of run.lines.filter((x) => x.kind === "VISIT")) expect(l.amountPence).toBe(Math.round((l.ratePence * l.minutes) / 60));
    const card = await db.rateCard.findFirstOrThrow({ where: { organisationId: orgId, kind: "PAY" } });
    await expect(addBand(m, card.id, { label: "Late night", weekdays: [1], from: "23:00", to: "24:00", bankHoliday: false, rate: "15", unit: "PER_HOUR" })).rejects.toBeInstanceOf(ConflictError);
    const fresh = await createRateCard(m, { kind: "PAY", name: "Care worker pay 2027", effectiveFrom: addDays(londonDate(), 30) });
    await addBand(m, fresh.id, { label: "Weekday", weekdays: [1, 2, 3, 4, 5], from: "00:00", to: "24:00", bankHoliday: false, rate: "13.10", unit: "PER_HOUR" });
  });

  it("keeps other organisations and other roles out", async () => {
    const outsider = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const pay = await db.payRun.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(getPayRun(outsider, pay.id)).rejects.toThrow();
    await expect(runCsv(await coordinator(), "pay", pay.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { setAiProviderForTests } from "@/server/ai";
import { SimulatedProvider } from "@/server/ai/simulated";
import { addDocuments, createIntake } from "@/server/care/coordinator/intake";
import { prepareDrafts } from "@/server/care/coordinator/prepare";
import { completeDischargeReview, listDischargeReviews, recordDischargeCheck } from "@/server/care/discharge-review";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";
import { dischargeLetterPdf } from "../support/coordinator-fixture";

/** Post-hospital discharge review (phase 7): opened from a filed discharge letter, linked to it, never authorising anything. */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let suId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  setAiProviderForTests(new SimulatedProvider());
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  suId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE" } })).id;
}, 180_000);

describe("hospital discharge review", () => {
  it("opens a review linked to the filed letter, changes no plan or medicine, and is completed only when every check is answered", async () => {
    const c = await coordinator();
    const m = await manager();
    const before = { plans: await db.carePlan.count({ where: { serviceUserId: suId } }), meds: await db.medication.count({ where: { serviceUserId: suId } }), docs: await db.serviceUserDocument.count({ where: { serviceUserId: suId, category: "COUNCIL_SUPPORT_PLAN" } }) };
    const intake = await createIntake(c, { title: "Discharge letter", mode: "DOCUMENT", serviceUserId: suId });
    await addDocuments(c, intake.id, [{ name: "Discharge summary.pdf", type: "application/pdf", bytes: await dischargeLetterPdf() }]);
    const doc = await db.careIntakeDocument.findFirstOrThrow({ where: { intakeId: intake.id } });
    expect(["HOSPITAL_DISCHARGE", "DISCHARGE_INFORMATION"]).toContain(doc.category);
    expect((await prepareDrafts(c, intake.id)).filed).toBe(1);

    // Discharge letters are restricted: a coordinator without restricted access sees no reviews.
    expect(await listDischargeReviews(c, suId)).toBeNull();
    const [r] = (await listDischargeReviews(m, suId))!;
    expect(r).toBeDefined();
    expect(r!.intakeId).toBe(intake.id);
    expect(r!.documentId).toBe((await db.careIntakeDocument.findUniqueOrThrow({ where: { id: doc.id } })).filedDocumentId);
    expect(r!.dischargeDate).toBe("2026-08-20");
    expect(r!.status).toBe("OPEN");
    expect(r!.checks.find((x) => x.key === "medication")?.finding).toMatch(/Read from the letter|Mentioned/);
    expect(r!.checks.find((x) => x.key === "skin")?.finding).not.toBeNull();
    // Managers are told in the CRM; nothing else changed.
    expect(await db.notification.count({ where: { organisationId: orgId, type: { in: ["care.discharge.review", "care.discharge.urgent"] } } })).toBeGreaterThan(0);
    expect({ plans: await db.carePlan.count({ where: { serviceUserId: suId } }), meds: await db.medication.count({ where: { serviceUserId: suId } }), docs: await db.serviceUserDocument.count({ where: { serviceUserId: suId, category: "COUNCIL_SUPPORT_PLAN" } }) }).toEqual(before);
    // Filing again opens no second review.
    await prepareDrafts(c, intake.id);
    expect(await db.dischargeReview.count({ where: { serviceUserId: suId } })).toBe(1);

    // Checks: the medicines check needs a note; completion needs every check answered.
    await expect(recordDischargeCheck(c, r!.id, r!.lockVersion, { key: "mobility", outcome: "NO_CHANGE" })).rejects.toThrow();
    await expect(recordDischargeCheck(m, r!.id, r!.lockVersion, { key: "medication", outcome: "UPDATED" })).rejects.toBeInstanceOf(ValidationError);
    let lock = r!.lockVersion;
    await expect(completeDischargeReview(m, r!.id, lock, "All checked")).rejects.toThrow(/Answer every check/);
    for (const ch of r!.checks) {
      await recordDischargeCheck(m, r!.id, lock, { key: ch.key, outcome: ch.key === "skin" ? "ACTION" : "NO_CHANGE", note: ch.key === "medication" ? "Checked with the GP surgery; MAR unchanged" : ch.key === "skin" ? "District nurse asked to check the sacrum" : undefined });
      lock++;
    }
    await completeDischargeReview(m, r!.id, lock, "Reviewed after discharge; skin check requested");
    const done = (await listDischargeReviews(m, suId))![0]!;
    expect(done.status).toBe("COMPLETED");
    expect(done.checks.every((x) => x.outcome)).toBe(true);
    expect(await db.auditLog.count({ where: { organisationId: orgId, action: { startsWith: "discharge.review." } } })).toBe(2 + r!.checks.length);
  });
});

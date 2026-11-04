import { db } from "@/lib/db";
import { CQC_CRITERIA_V1, CQC_FRAMEWORK_V1 } from "../../../prisma/seed-data/cqc-framework";

/**
 * The CQC framework mapping is shared reference data (organisationId-free, read-only to organisations). It is created
 * when first needed, so a hosted database that is only seeded once still gets it. A new CQC framework is added as a
 * new version (new rows) and made ACTIVE; existing assessments keep the version they were done against.
 */
let ensured: Promise<string> | null = null;

export async function ensureFramework(): Promise<string> {
  if (!ensured) ensured = seedFrameworkV1().catch((e) => { ensured = null; throw e; });
  return ensured;
}

async function seedFrameworkV1(): Promise<string> {
  const f = CQC_FRAMEWORK_V1;
  const fw = await db.cqcFramework.upsert({
    where: { version: f.version },
    create: { version: f.version, title: f.title, basis: f.basis, sourceUrl: f.sourceUrl, notes: f.notes, effectiveFrom: new Date(`${f.effectiveFrom}T00:00:00Z`), status: "ACTIVE" },
    update: {},
  });
  const have = await db.cqcCriterion.count({ where: { frameworkId: fw.id } });
  if (have < CQC_CRITERIA_V1.length) {
    await db.cqcCriterion.createMany({ data: CQC_CRITERIA_V1.map((c, position) => ({ ...c, frameworkId: fw.id, position })), skipDuplicates: true });
  }
  return fw.id;
}

/** The framework new assessments use. */
export async function activeFramework() {
  await ensureFramework();
  const fw = await db.cqcFramework.findFirst({ where: { status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" } });
  if (!fw) throw new Error("No active CQC framework");
  return fw;
}

export async function frameworkCriteria(frameworkId: string) {
  return db.cqcCriterion.findMany({ where: { frameworkId }, orderBy: { position: "asc" } });
}

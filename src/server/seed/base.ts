import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TEMPLATES, type TemplateVersion } from "../../../prisma/seed-data/templates";
import { SOURCES } from "../../../prisma/seed-data/sources";
import { REQUIREMENTS } from "../../../prisma/seed-data/library/requirements";
import { createDraftVersion } from "../policies/versions";
import { indexPolicyVersion } from "../search/index-chunks";

export const SERVICE_TYPES = [
  ["RESIDENTIAL", "Residential care home"],
  ["NURSING", "Care home with nursing"],
  ["DOMICILIARY", "Domiciliary (home) care"],
  ["SUPPORTED_LIVING", "Supported living"],
] as const;

export const CATEGORIES: [string, string][] = [
  ["SAFEGUARDING", "Safeguarding"],
  ["MEDICINES", "Medicines"],
  ["IPC", "Infection prevention and control"],
  ["COMPLAINTS", "Complaints"],
  ["INCIDENTS", "Incidents"],
  ["CONSENT", "Mental capacity and consent"],
  ["CANDOUR", "Duty of candour"],
  ["RECRUITMENT", "Recruitment"],
  ["TRAINING", "Training and competence"],
  ["HEALTH_SAFETY", "Health and safety"],
  ["WHISTLEBLOWING", "Whistleblowing"],
  ["DATA_PROTECTION", "Data protection"],
  ["GOVERNANCE", "Governance and quality"],
  ["RISK", "Risk management"],
  ["RECORDS", "Record keeping"],
  ["EQUALITY", "Equality and human rights"],
  ["FOOD", "Food and nutrition"],
  ["CARE", "Care planning and delivery"],
  ["CLINICAL", "Clinical care"],
  ["END_OF_LIFE", "End of life care"],
  ["WORKFORCE", "Workforce and conduct"],
];

const MONTH_MS = 30.44 * 86400_000;
export const monthsAgo = (m: number) => new Date(Date.now() - m * MONTH_MS);
const addMonths = (d: Date, m: number) => new Date(d.getTime() + m * MONTH_MS);

type SeedSection = { key: string; heading: string; body: string; isLocal?: boolean; masterKey?: string | null };

/**
 * Seeds a version as published WITHOUT an approval record. It is labelled as
 * seeded starter content; the UI shows that no approval exists. Any currently
 * published version is superseded. The caller indexes the final version.
 */
async function publishSeedVersion(
  policyId: string,
  organisationId: string | null,
  sections: SeedSection[],
  extra: { basedOnMasterVersionId?: string | null; changeSummary?: string; reasonForChange?: string; publishedAt?: Date; reviewIntervalMonths?: number; requiresAcknowledgement?: boolean } = {},
) {
  const publishedAt = extra.publishedAt ?? new Date();
  return db.$transaction(async (tx) => {
    const previous = await tx.policyVersion.findFirst({ where: { policyId, status: "PUBLISHED" } });
    const draft = await createDraftVersion(tx, {
      policyId,
      organisationId,
      sections,
      origin: "SEED",
      previousVersionId: previous?.id ?? null,
      basedOnMasterVersionId: extra.basedOnMasterVersionId,
      changeSummary: extra.changeSummary ?? "Seeded starter content. Not professionally reviewed; no approval record exists.",
      reasonForChange: extra.reasonForChange ?? "Initial seed",
    });
    if (previous) await tx.policyVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededAt: publishedAt } });
    for (const status of ["UNDER_REVIEW", "APPROVED", "PUBLISHED"] as const) await tx.policyVersion.update({ where: { id: draft.id }, data: { status, publishedAt: status === "PUBLISHED" ? publishedAt : undefined, effectiveDate: status === "PUBLISHED" ? publishedAt : undefined } });
    await tx.policy.update({ where: { id: policyId }, data: { currentPublishedVersionId: draft.id, nextReviewDate: addMonths(publishedAt, extra.reviewIntervalMonths ?? 12) } });
    await tx.policyPublication.create({ data: { policyId, organisationId, versionId: draft.id, status: "PUBLISHED", publishedAt, effectiveDate: publishedAt, publishedById: "seed", requiresAcknowledgement: extra.requiresAcknowledgement ?? false } });
    return draft;
  });
}

export async function seedPublishedVersion(policyId: string, organisationId: string | null, sections: SeedSection[], extra: Parameters<typeof publishSeedVersion>[3] = {}) {
  const v = await publishSeedVersion(policyId, organisationId, sections, extra);
  await indexPolicyVersion(v.id);
  return v;
}

/** Seeds a demo version history (oldest first); only the final version is indexed for search. */
export async function seedVersionHistory(policyId: string, organisationId: string | null, versions: TemplateVersion[], reviewIntervalMonths = 12) {
  let last = null;
  for (const v of versions) {
    last = await publishSeedVersion(policyId, organisationId, v.sections, {
      changeSummary: `${v.changeSummary} Seeded starter content; not professionally reviewed; no approval record exists.`,
      reasonForChange: v.reasonForChange,
      publishedAt: monthsAgo(v.publishedMonthsAgo),
      reviewIntervalMonths,
    });
  }
  if (last) await indexPolicyVersion(last.id);
  return last;
}

export async function seedBase() {
  for (const [code, name] of SERVICE_TYPES) await db.serviceType.upsert({ where: { code }, create: { code, name }, update: { name } });
  for (const [code, name] of CATEGORIES) await db.policyCategory.upsert({ where: { code }, create: { code, name }, update: { name } });
  for (const s of SOURCES) {
    const { key, config, active, ...rest } = s;
    await db.regulatorySource.upsert({
      where: { key },
      create: { key, ...rest, config: config as Prisma.InputJsonValue, active: active ?? true },
      update: { name: rest.name, monitoringNotes: rest.monitoringNotes, licence: rest.licence, reuseNotes: rest.reuseNotes },
    });
  }
  const masters: Record<string, string> = {};
  for (const t of TEMPLATES) {
    let p = await db.policy.findFirst({ where: { organisationId: null, ref: t.ref } });
    if (!p) {
      p = await db.policy.create({ data: { kind: "MASTER", ref: t.ref, title: t.title, description: t.description, categoryCode: t.category, serviceTypes: t.serviceTypes, reviewIntervalMonths: t.reviewIntervalMonths } });
      await seedVersionHistory(p.id, null, t.versions, t.reviewIntervalMonths);
    }
    masters[t.ref] = p.id;
  }
  await seedRequirements(masters);
  return masters;
}

async function seedRequirements(masters: Record<string, string>) {
  const sources = new Map((await db.regulatorySource.findMany({ select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const ids = new Map<string, string>();
  for (const r of REQUIREMENTS) {
    const existing = await db.regulatoryRequirement.findUnique({ where: { ref: r.ref } });
    if (existing) {
      ids.set(r.ref, existing.id);
      continue;
    }
    const sourceId = sources.get(r.source);
    if (!sourceId) throw new Error(`Requirement ${r.ref} refers to unknown source ${r.source}`);
    const req = await db.regulatoryRequirement.create({
      data: {
        ref: r.ref,
        title: r.title,
        sourceId,
        exactReference: r.exactReference,
        sourceSectionRef: r.sectionRef,
        sourceUrl: r.url,
        excerpt: `[Summary, not a quotation; verify against the source] ${r.summary}`,
        legalStatus: r.legalStatus,
        serviceTypes: r.serviceTypes ?? ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"],
        verificationStatus: "UNVERIFIED",
        applicabilityNotes: r.applicabilityNotes ?? "Applies to providers of regulated activities in England. Effective date and wording not yet verified in this register.",
        versions: { create: { version: 1, snapshot: { summary: r.summary }, reason: "Initial register entry" } },
      },
    });
    ids.set(r.ref, req.id);
  }
  for (const t of TEMPLATES) {
    for (const link of t.links) {
      const requirementId = ids.get(link.requirement)!;
      const policyId = masters[t.ref]!;
      const exists = await db.requirementPolicyLink.findFirst({ where: { requirementId, policyId, sectionKey: link.section } });
      if (exists) continue;
      const req = REQUIREMENTS.find((r) => r.ref === link.requirement)!;
      await db.requirementPolicyLink.create({ data: { requirementId, policyId, sectionKey: link.section, rationale: `${t.ref} section "${link.section}" sets out how the provider meets ${req.exactReference}.` } });
    }
  }
}

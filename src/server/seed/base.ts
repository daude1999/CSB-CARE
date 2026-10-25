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
  ["DEMENTIA", "Dementia care"],
  ["LEARNING_DISABILITY", "Learning disability and autism"],
  ["MENTAL_HEALTH", "Mental health"],
  ["HOME_CARE", "Home care"],
  ["SUPPORTED_LIVING", "Supported living"],
  ["CARE_HOMES", "Care homes"],
  ["WELLBEING", "Activities and wellbeing"],
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

/**
 * Library entries seeded for fast tests: the documents the demo and test
 * scenarios rely on. Pass `{ refs: CORE_REFS }` to seed only these.
 */
export const CORE_REFS = [
  "EVX-SAF-001", "EVX-MED-001", "EVX-MED-004", "EVX-COM-001", "EVX-IPC-001", "EVX-HS-002", "EVX-DP-002", "EVX-GOV-001", "EVX-FRM-001", "EVX-AUD-001",
];

export async function seedBase(opts: { refs?: string[] } = {}) {
  const templates = opts.refs ? TEMPLATES.filter((t) => opts.refs!.includes(t.ref)) : TEMPLATES;
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
  for (const t of templates) {
    let p = await db.policy.findFirst({ where: { organisationId: null, ref: t.ref } });
    if (!p) {
      p = await db.policy.create({ data: { kind: "MASTER", ref: t.ref, docType: t.docType, title: t.title, description: t.description, categoryCode: t.category, serviceTypes: t.serviceTypes, reviewIntervalMonths: t.reviewIntervalMonths } });
      await seedVersionHistory(p.id, null, t.versions, t.reviewIntervalMonths);
    }
    masters[t.ref] = p.id;
  }
  await seedRequirements(masters);
  await seedAuditTemplates(templates, masters);
  return masters;
}

/** Audit tools in the library double as Evantix master audit templates. */
async function seedAuditTemplates(templates: typeof TEMPLATES, masters: Record<string, string>) {
  for (const t of templates) {
    if (!t.auditQuestions?.length) continue;
    if (await db.auditTemplate.findFirst({ where: { organisationId: null, title: t.title } })) continue;
    const policyId = masters[t.ref];
    await db.auditTemplate.create({
      data: {
        organisationId: null,
        title: t.title,
        description: `${t.description} From library document ${t.ref}.`,
        questions: { create: t.auditQuestions.map((text, position) => ({ text, position, policyId })) },
      },
    });
  }
}

async function seedRequirements(masters: Record<string, string>) {
  const sources = new Map((await db.regulatorySource.findMany({ select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const existing = new Set((await db.regulatoryRequirement.findMany({ select: { ref: true } })).map((r) => r.ref));
  const missing = REQUIREMENTS.filter((r) => !existing.has(r.ref));
  for (const r of missing) if (!sources.get(r.source)) throw new Error(`Requirement ${r.ref} refers to unknown source ${r.source}`);
  // Bulk inserts keep test seeding fast; the register has a few hundred entries.
  await db.regulatoryRequirement.createMany({
    data: missing.map((r) => ({
      ref: r.ref,
      title: r.title,
      sourceId: sources.get(r.source)!,
      exactReference: r.exactReference,
      sourceSectionRef: r.sectionRef,
      sourceUrl: r.url,
      excerpt: `[Summary, not a quotation; verify against the source] ${r.summary}`,
      legalStatus: r.legalStatus,
      serviceTypes: r.serviceTypes ?? ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"],
      verificationStatus: "UNVERIFIED" as const,
      applicabilityNotes: r.applicabilityNotes ?? "Applies to providers of regulated activities in England. Effective date and wording not yet verified in this register.",
    })),
  });
  const ids = new Map((await db.regulatoryRequirement.findMany({ select: { id: true, ref: true } })).map((r) => [r.ref, r.id]));
  await db.requirementVersion.createMany({
    data: missing.map((r) => ({ requirementId: ids.get(r.ref)!, version: 1, snapshot: { summary: r.summary }, reason: "Initial register entry" })),
  });
  const policyIds = Object.values(masters);
  const linked = new Set((await db.requirementPolicyLink.findMany({ where: { policyId: { in: policyIds } }, select: { requirementId: true, policyId: true, sectionKey: true } })).map((l) => `${l.requirementId}|${l.policyId}|${l.sectionKey}`));
  const byRef = new Map(REQUIREMENTS.map((r) => [r.ref, r]));
  const links = [];
  for (const t of TEMPLATES) {
    const policyId = masters[t.ref];
    if (!policyId) continue;
    for (const link of t.links) {
      const requirementId = ids.get(link.requirement)!;
      if (linked.has(`${requirementId}|${policyId}|${link.section}`)) continue;
      links.push({ requirementId, policyId, sectionKey: link.section, rationale: `${t.ref} section "${link.section}" sets out how the provider meets ${byRef.get(link.requirement)!.exactReference}.` });
    }
  }
  await db.requirementPolicyLink.createMany({ data: links });
}

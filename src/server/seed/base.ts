import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TEMPLATES } from "../../../prisma/seed-data/templates";
import { SOURCES } from "../../../prisma/seed-data/sources";
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
];

/**
 * Seeds a version as published WITHOUT an approval record. It is labelled as
 * seeded starter content; the UI shows that no approval exists.
 */
export async function seedPublishedVersion(policyId: string, organisationId: string | null, sections: { key: string; heading: string; body: string; isLocal?: boolean; masterKey?: string | null }[], extra: { basedOnMasterVersionId?: string | null; changeSummary?: string } = {}) {
  const v = await db.$transaction(async (tx) => {
    const draft = await createDraftVersion(tx, {
      policyId,
      organisationId,
      sections,
      origin: "SEED",
      basedOnMasterVersionId: extra.basedOnMasterVersionId,
      changeSummary: extra.changeSummary ?? "Seeded starter content. Not professionally reviewed; no approval record exists.",
      reasonForChange: "Initial seed",
    });
    for (const status of ["UNDER_REVIEW", "APPROVED", "PUBLISHED"] as const) await tx.policyVersion.update({ where: { id: draft.id }, data: { status, publishedAt: status === "PUBLISHED" ? new Date() : undefined, effectiveDate: status === "PUBLISHED" ? new Date() : undefined } });
    await tx.policy.update({ where: { id: policyId }, data: { currentPublishedVersionId: draft.id, nextReviewDate: new Date(Date.now() + 365 * 86400_000) } });
    await tx.policyPublication.create({ data: { policyId, organisationId, versionId: draft.id, status: "PUBLISHED", publishedAt: new Date(), effectiveDate: new Date(), publishedById: "seed", requiresAcknowledgement: false } });
    return draft;
  });
  await indexPolicyVersion(v.id);
  return v;
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
      p = await db.policy.create({ data: { kind: "MASTER", ref: t.ref, title: t.title, description: t.description, categoryCode: t.category, serviceTypes: t.serviceTypes } });
      await seedPublishedVersion(p.id, null, t.sections);
    }
    masters[t.ref] = p.id;
  }
  await seedRequirements(masters);
  return masters;
}

async function seedRequirements(masters: Record<string, string>) {
  const leg = await db.regulatorySource.findUniqueOrThrow({ where: { key: "legislation-regulated-activities-2014" } });
  const leg2 = await db.regulatorySource.findUniqueOrThrow({ where: { key: "legislation-mca-care-act" } });
  const reqs = [
    { ref: "REQ-ENG-0001", title: "Protect people from abuse and improper treatment", source: leg, sectionRef: "/uksi/2014/2936/regulation/13", exactReference: "SI 2014/2936, regulation 13", policy: "EVX-SAF-001", section: "statement", summary: "Providers must have systems and processes to prevent abuse and to investigate allegations." },
    { ref: "REQ-ENG-0002", title: "Safe care and treatment, including proper and safe management of medicines", source: leg, sectionRef: "/uksi/2014/2936/regulation/12", exactReference: "SI 2014/2936, regulation 12", policy: "EVX-MED-001", section: "statement", summary: "Care must be provided in a safe way, including the proper and safe management of medicines." },
    { ref: "REQ-ENG-0003", title: "Receiving and acting on complaints", source: leg, sectionRef: "/uksi/2014/2936/regulation/16", exactReference: "SI 2014/2936, regulation 16", policy: "EVX-COM-001", section: "procedure", summary: "Complaints must be investigated and proportionate action taken; an accessible system must be in place." },
    { ref: "REQ-ENG-0004", title: "Good governance", source: leg, sectionRef: "/uksi/2014/2936/regulation/17", exactReference: "SI 2014/2936, regulation 17", policy: "EVX-GOV-001", section: "procedure", summary: "Systems must assess, monitor and improve quality and safety, and maintain accurate records." },
    { ref: "REQ-ENG-0005", title: "Fit and proper persons employed", source: leg, sectionRef: "/uksi/2014/2936/regulation/19", exactReference: "SI 2014/2936, regulation 19", policy: "EVX-REC-001", section: "procedure", summary: "Persons employed must be of good character and have the necessary qualifications, competence, skills and experience." },
    { ref: "REQ-ENG-0006", title: "Duty of candour", source: leg, sectionRef: "/uksi/2014/2936/regulation/20", exactReference: "SI 2014/2936, regulation 20", policy: "EVX-DOC-001", section: "procedure", summary: "Providers must act in an open and transparent way when a notifiable safety incident occurs." },
    { ref: "REQ-ENG-0007", title: "Principles of the Mental Capacity Act", source: leg2, sectionRef: "/ukpga/2005/9/section/1", exactReference: "Mental Capacity Act 2005, section 1", policy: "EVX-MCA-001", section: "statement", summary: "Statutory principles on presumption of capacity, supported decision making, unwise decisions, best interests and least restriction." },
    { ref: "REQ-ENG-0008", title: "Local authority safeguarding enquiries", source: leg2, sectionRef: "/ukpga/2014/23/section/42", exactReference: "Care Act 2014, section 42", policy: "EVX-SAF-001", section: "procedure.reporting", summary: "Duty on local authorities to make enquiries where an adult with care and support needs may be at risk of abuse or neglect." },
  ];
  for (const r of reqs) {
    const existing = await db.regulatoryRequirement.findUnique({ where: { ref: r.ref } });
    if (existing) continue;
    const req = await db.regulatoryRequirement.create({
      data: {
        ref: r.ref,
        title: r.title,
        sourceId: r.source.id,
        exactReference: r.exactReference,
        sourceSectionRef: r.sectionRef,
        sourceUrl: `https://www.legislation.gov.uk${r.sectionRef}`,
        excerpt: `[Summary, not a quotation; verify against the source] ${r.summary}`,
        legalStatus: "LEGISLATION",
        serviceTypes: ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"],
        verificationStatus: "UNVERIFIED",
        applicabilityNotes: "Applies to providers of regulated activities in England. Effective date and wording not yet verified in this register.",
        versions: { create: { version: 1, snapshot: { summary: r.summary }, reason: "Initial register entry" } },
      },
    });
    await db.requirementPolicyLink.create({ data: { requirementId: req.id, policyId: masters[r.policy]!, sectionKey: r.section, rationale: `${r.policy} sets out how the provider meets ${r.exactReference}.` } });
  }
}

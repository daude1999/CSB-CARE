import type { OrgRole, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "../auth/password";
import { ctxForUser } from "../auth/session";
import { drain } from "../jobs/queue";
import { checkSource } from "../sources/engine";
import { fixtureFetch, fixtureHttp, SIMULATED_PATH, simulatedGuidance } from "../testing/fixtures";
import { handlers } from "../../worker/handlers";
import { seedPublishedVersion } from "./base";
import { toSectionInputs } from "../policies/versions";
import { createManualRevision, editDraftSection } from "../policies/workflow";
import { addFinding, answerQuestion, createAction, startAudit } from "../compliance/audits";

export const DEMO_PASSWORD = "DemoPassword!2026";

async function user(email: string, name: string, platformRoles: PlatformRole[] = [], passwordHash?: string) {
  return db.user.upsert({ where: { email }, create: { email, name, platformRoles, isDemo: true, passwordHash }, update: {} });
}

export async function seedDemo(masters: Record<string, string>, opts: { simulatedChange?: boolean } = {}) {
  if (await db.organisation.findUnique({ where: { slug: "brookfield-demo" } })) return;
  const pw = await hashPassword(DEMO_PASSWORD);

  const admin = await user("admin@csb.demo", "Priya Admin (Platform)", ["PLATFORM_ADMIN"], pw);
  const regulatory = await user("regulatory@csb.demo", "Rowan Reviewer (Regulatory)", ["REGULATORY_REVIEWER"], pw);
  const content = await user("content@csb.demo", "Casey Content (Editor)", ["CONTENT_EDITOR"], pw);
  void admin;
  void content;

  const org = await db.organisation.create({ data: { name: "Brookfield Care Group (DEMO)", slug: "brookfield-demo", isDemo: true, settings: { requiredApprovals: 1 } } });
  const home = await db.branch.create({ data: { organisationId: org.id, name: "Brookfield House (DEMO care home)", services: { create: [{ serviceTypeCode: "RESIDENTIAL" }] } } });
  const dom = await db.branch.create({ data: { organisationId: org.id, name: "Brookfield Home Care (DEMO domiciliary)", services: { create: [{ serviceTypeCode: "DOMICILIARY" }] } } });

  const members: [string, string, OrgRole[], string | null, string][] = [
    ["manager@brookfield.demo", "Morgan Manager", ["ORG_ADMIN", "COMPLIANCE_LEAD"], null, "Registered manager"],
    ["author@brookfield.demo", "Alex Author", ["POLICY_AUTHOR"], null, "Quality officer"],
    ["reviewer@brookfield.demo", "Riley Reviewer", ["POLICY_REVIEWER"], null, "Deputy manager"],
    ["approver@brookfield.demo", "Avery Approver", ["POLICY_APPROVER"], null, "Nominated individual"],
    ["carer1@brookfield.demo", "Sam Carer", ["STAFF"], home.id, "Care assistant"],
    ["carer2@brookfield.demo", "Jo Carer", ["STAFF"], dom.id, "Home care worker"],
  ];
  const ids: Record<string, string> = {};
  for (const [email, name, roles, branchId, jobTitle] of members) {
    const u = await user(email, name, [], pw);
    ids[email] = u.id;
    await db.membership.create({ data: { userId: u.id, organisationId: org.id, roles, branchId, jobTitle } });
  }
  // Platform reviewer is also a member for viewing (no customer permissions beyond reading).
  void regulatory;

  // Second organisation, used to demonstrate and test tenant isolation.
  const other = await db.organisation.create({ data: { name: "Oakridge Support Services (DEMO)", slug: "oakridge-demo", isDemo: true } });
  await db.branch.create({ data: { organisationId: other.id, name: "Oakridge Supported Living (DEMO)", services: { create: [{ serviceTypeCode: "SUPPORTED_LIVING" }] } } });
  const oak = await user("manager@oakridge.demo", "Olu Manager", [], pw);
  await db.membership.create({ data: { userId: oak.id, organisationId: other.id, roles: ["ORG_ADMIN", "COMPLIANCE_LEAD", "POLICY_AUTHOR"] } });
  const oakPolicy = await db.policy.create({ data: { kind: "CUSTOMER", organisationId: other.id, ref: "OAK-CONF-01", title: "Oakridge Confidential Tenancy Procedure", description: "Private to Oakridge (DEMO).", categoryCode: "DATA_PROTECTION", isDemo: true } });
  await seedPublishedVersion(oakPolicy.id, other.id, [{ key: "procedure", heading: "Procedure", body: "Oakridge-only procedure text (DEMO). This must never be visible to Brookfield users." }]);

  // Brookfield adopts the starter templates that fit its services, with completed local sections.
  const localText: Record<string, string> = {
    "CSB-SAF-001": "Brookfield safeguarding lead: Morgan Manager, 01632 960001 (fictional). Out of hours: on-call manager 01632 960002 (fictional). Local authority safeguarding team: 01632 960003 (fictional).",
    "CSB-MED-001": "Supplying pharmacy: Brookfield Pharmacy (fictional), 01632 960010. Out of hours: NHS 111.",
    "CSB-COM-001": "Complaints are sent to the registered manager at complaints@brookfield.demo (fictional).",
    "CSB-IPC-001": "IPC lead: Riley Reviewer. Local health protection team: 01632 960020 (fictional).",
    "CSB-IPC-002": "Outbreak lead: Riley Reviewer. Report suspected outbreaks to the health protection team on 01632 960020 (fictional).",
    "CSB-MED-003": "Controlled drugs accountable officer (area team): 01632 960011 (fictional). Brookfield House CD lead: Riley Reviewer.",
    "CSB-WB-001": "Speak up to Avery Approver, nominated individual, on 01632 960004 (fictional), or to CQC.",
    "CSB-DP-001": "Data protection lead: Avery Approver, dataprotection@brookfield.demo (fictional).",
    "CSB-DP-002": "Report breaches immediately to dataprotection@brookfield.demo (fictional) or the on-call manager, 01632 960002 (fictional).",
    "CSB-HS-004": "Brookfield Home Care on-call coordinator: 01632 960030 (fictional), 24 hours a day.",
    "CSB-SAF-005": "Office (08:00 to 18:00): 01632 960031 (fictional). On-call coordinator out of hours: 01632 960030 (fictional).",
    "CSB-MCA-002": "DoLS team (supervisory body): 01632 960040 (fictional).",
    "CSB-CLN-003": "GP practice: Brookfield Medical Centre (fictional), 01632 960050. Out of hours: NHS 111. Emergencies: 999.",
  };
  const defaultLocal = "Policy lead for Brookfield: Morgan Manager (registered manager), 01632 960001 (fictional). Out of hours: on-call manager 01632 960002 (fictional).";
  const brookfieldServices = ["RESIDENTIAL", "DOMICILIARY"];
  const templates = await db.policy.findMany({
    where: { kind: "MASTER", organisationId: null, serviceTypes: { hasSome: brookfieldServices } },
    include: { currentPublishedVersion: { include: { sections: true } } },
    orderBy: { ref: "asc" },
  });
  // Policies where staff were asked to acknowledge the adopted version.
  const ackRefs = ["CSB-HS-002", "CSB-MED-004", "CSB-DP-002"];
  for (const [i, tpl] of templates.entries()) {
    const isPolicy = ["POLICY", "PROCEDURE", "GUIDANCE"].includes(tpl.docType);
    const local = localText[tpl.ref] ?? (isPolicy ? defaultLocal : "Brookfield logo added. Completed copies are returned to the registered manager, Morgan Manager (fictional).");
    const p = await db.policy.create({
      data: { kind: "CUSTOMER", organisationId: org.id, templateId: tpl.id, ref: tpl.ref, docType: tpl.docType, title: tpl.title, description: tpl.description, categoryCode: tpl.categoryCode, serviceTypes: tpl.serviceTypes.filter((t) => brookfieldServices.includes(t)), ownerId: ids["manager@brookfield.demo"], approverId: ids["approver@brookfield.demo"], isDemo: true },
    });
    const sections = toSectionInputs(tpl.currentPublishedVersion!.sections).map((s) => (s.isLocal ? { ...s, body: local, masterKey: null } : { ...s, masterKey: s.key }));
    const requiresAcknowledgement = ackRefs.includes(tpl.ref);
    const v = await seedPublishedVersion(p.id, org.id, sections, {
      basedOnMasterVersionId: tpl.currentPublishedVersionId,
      changeSummary: "DEMO: adopted from CSB starter template. Not professionally reviewed; no approval record exists.",
      publishedAt: new Date(Date.now() - (14 + (i % 9) * 9) * 86400_000),
      requiresAcknowledgement,
    });
    if (requiresAcknowledgement) {
      const pub = await db.policyPublication.findUniqueOrThrow({ where: { versionId: v.id } });
      const dueAt = new Date(Date.now() + (tpl.ref === "CSB-DP-002" ? -3 : 10) * 86400_000);
      await db.policyPublication.update({ where: { id: pub.id }, data: { acknowledgementDueAt: dueAt } });
      for (const [email, userId] of Object.entries(ids)) {
        const done = email !== "carer1@brookfield.demo" && email !== "carer2@brookfield.demo" ? true : tpl.ref === "CSB-HS-002" && email === "carer1@brookfield.demo";
        await db.acknowledgement.create({ data: { publicationId: pub.id, organisationId: org.id, userId, dueAt, acknowledgedAt: done ? new Date(Date.now() - 5 * 86400_000) : null } });
      }
    }
  }

  // An overdue review, so the dashboard has a real overdue item.
  await db.policy.updateMany({ where: { organisationId: org.id, ref: "CSB-IPC-001" }, data: { nextReviewDate: new Date(Date.now() - 10 * 86400_000) } });

  // Example manual draft revision.
  const authorCtx = await ctxForUser(ids["author@brookfield.demo"]!, org.id);
  const complaints = await db.policy.findFirstOrThrow({ where: { organisationId: org.id, ref: "CSB-COM-001" } });
  const rev = await createManualRevision(authorCtx, complaints.id, "DEMO: clarify acknowledgement timescale for verbal complaints");
  await editDraftSection(authorCtx, rev.id, "procedure", {
    body: "Acknowledge each complaint, whether written or verbal, within three working days. Agree with the complainant how it will be handled and when they can expect a response. Investigate fairly, respond in writing with the outcome and explain how to take the complaint further, including to the Local Government and Social Care Ombudsman where applicable.",
  });

  // Audit template, audit, findings and actions (DEMO).
  const reqSaf = await db.regulatoryRequirement.findUnique({ where: { ref: "REQ-ENG-0001" } });
  const tpl = await db.auditTemplate.create({
    data: {
      title: "Safeguarding practice audit (starter)",
      description: "Starter audit template. Results are an internal quality indicator, not proof of regulatory compliance.",
      isDemo: true,
      questions: {
        create: [
          { text: "Were all safeguarding concerns in the period referred within the timescale in our policy?", position: 0, policyId: masters["CSB-SAF-001"], requirements: reqSaf ? { create: { requirementId: reqSaf.id } } : undefined },
          { text: "Is each referral recorded with the local authority reference number?", position: 1, policyId: masters["CSB-SAF-001"] },
          { text: "Have all staff completed safeguarding training within the last two years?", position: 2 },
        ],
      },
    },
    include: { questions: true },
  });
  const mgrCtx = await ctxForUser(ids["manager@brookfield.demo"]!, org.id);
  const audit = await startAudit(mgrCtx, tpl.id, { title: "DEMO Q3 safeguarding audit — Brookfield House", branchId: home.id });
  await answerQuestion(mgrCtx, audit.id, tpl.questions[0]!.id, "PARTIALLY_MET", "DEMO: one referral was made after 3 days.");
  await answerQuestion(mgrCtx, audit.id, tpl.questions[1]!.id, "MET");
  await answerQuestion(mgrCtx, audit.id, tpl.questions[2]!.id, "NOT_MET", "DEMO: 4 staff overdue.");
  const finding = await addFinding(mgrCtx, audit.id, { description: "DEMO: four staff members overdue for safeguarding refresher training.", riskRating: "MEDIUM", questionId: tpl.questions[2]!.id });
  await createAction(mgrCtx, { title: "DEMO: book safeguarding refresher training for overdue staff", ownerId: ids["reviewer@brookfield.demo"]!, dueDate: new Date(Date.now() - 2 * 86400_000), findingId: finding.id });
  await createAction(mgrCtx, { title: "DEMO: remind shift leaders of referral timescale", ownerId: ids["author@brookfield.demo"]!, dueDate: new Date(Date.now() + 14 * 86400_000), findingId: finding.id });

  const training = await db.trainingRequirement.create({ data: { title: "Safeguarding adults refresher", renewalMonths: 24, requirements: reqSaf ? { create: { requirementId: reqSaf.id } } : undefined } });
  await db.trainingRecord.create({ data: { organisationId: org.id, userId: ids["carer1@brookfield.demo"]!, trainingId: training.id, completedAt: new Date(Date.now() - 400 * 86400_000), expiresAt: new Date(Date.now() + 330 * 86400_000) } });

  if (opts.simulatedChange !== false) await seedSimulatedChange(masters);
}

/** Runs the real monitoring engine twice against a SIMULATED fixture to produce a sample change. */
export async function seedSimulatedChange(masters: Record<string, string>) {
  const source = await db.regulatorySource.upsert({
    where: { key: "demo-simulated-guidance" },
    create: {
      key: "demo-simulated-guidance",
      name: "SIMULATED demonstration source (not real guidance)",
      canonicalUrl: `https://www.gov.uk${SIMULATED_PATH}`,
      category: "GOVERNMENT_GUIDANCE",
      serviceTypes: ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"],
      monitoringMethod: "GOVUK_CONTENT_API",
      coverage: "AUTOMATED",
      config: { basePaths: [SIMULATED_PATH] },
      isSimulated: true,
      active: false,
      licence: "Simulated content created for the demo",
      reuseNotes: "Simulated; not an official publication.",
      monitoringNotes: "SIMULATED. Served from built-in fixtures, never fetched from the internet. Kept separate from live monitoring results.",
    },
    update: {},
  });
  const v1 = fixtureFetch({ [`https://www.gov.uk/api/content${SIMULATED_PATH}`]: { body: simulatedGuidance(1) } });
  await checkSource(source.id, { trigger: "TEST", http: fixtureHttp(v1), force: true });
  const doc = await db.sourceDocument.findFirstOrThrow({ where: { sourceId: source.id } });
  const existing = await db.regulatoryRequirement.findUnique({ where: { ref: "REQ-SIM-001" } });
  if (!existing) {
    const req = await db.regulatoryRequirement.create({
      data: {
        ref: "REQ-SIM-001",
        title: "SIMULATED: timescale for referring safeguarding concerns",
        sourceId: source.id,
        sourceDocumentId: doc.id,
        sourceSectionRef: "reporting-concerns",
        exactReference: "SIMULATED guidance, section 'Reporting concerns'",
        sourceUrl: doc.url,
        excerpt: "Providers must notify the local authority safeguarding team within 48 hours of becoming aware of a concern.",
        legalStatus: "ADVISORY_GUIDANCE",
        serviceTypes: ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"],
        verificationStatus: "VERIFIED",
        lastVerifiedAt: new Date(),
        isSimulated: true,
        applicabilityNotes: "SIMULATED requirement for demonstration only.",
        versions: { create: { version: 1, snapshot: {}, reason: "Simulated demo requirement" } },
      },
    });
    await db.requirementPolicyLink.create({ data: { requirementId: req.id, policyId: masters["CSB-SAF-001"]!, sectionKey: "procedure.reporting", rationale: "The reporting procedure repeats the referral timescale (SIMULATED link)." } });
  }
  const v2 = fixtureFetch({ [`https://www.gov.uk/api/content${SIMULATED_PATH}`]: { body: simulatedGuidance(2) } });
  const summary = await checkSource(source.id, { trigger: "TEST", http: fixtureHttp(v2), force: true });
  await drain("seed", handlers, { types: ["change.analyse"] });
  return summary;
}

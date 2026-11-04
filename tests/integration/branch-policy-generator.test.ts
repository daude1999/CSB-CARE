import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { setAiProviderForTests } from "@/server/ai";
import { addLocalAuthority, listBranchProfiles, updateBranchProfile, verifyBranchProfile } from "@/server/policy-geo/branches";
import { proposeSource, referenceLibrary, reviewSource } from "@/server/policy-geo/reference";
import { assembleRequirements, generatePolicyDraft, recheckGaps, REVIEW_MARKER, resolveGap } from "@/server/policy-geo/generator";
import { coverageView } from "@/server/policy-geo/coverage";
import { crossBoundaryCases, recordIncidentLocation, recordSafeguardingDecision, recordServiceUserGeography } from "@/server/policy-geo/cross-boundary";
import { flagPoliciesForSourceChange } from "@/server/policy-geo/monitoring";
import { createManualRevision, decide, editDraftSection, publishRevision, submitForReview } from "@/server/policies/workflow";
import { createPolicy } from "@/server/policies/library";
import { analyseChange } from "@/server/changes/workflow";
import { checkSource } from "@/server/sources/engine";
import { fixtureFetch, fixtureHttp } from "@/server/testing/fixtures";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Branch-specific Policy Generator, one block per acceptance criterion group in the owner's brief (section 17):
 * branch configuration, policy generation, staff and safeguarding, regulatory monitoring, regression and security.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const author = () => ctxFor("author@care-solution.demo", BROOKFIELD);
const approver = () => ctxFor("approver@care-solution.demo", BROOKFIELD);
let orgId = "";
const branches: Record<string, string> = {};
const ALL = { governance: { localProcedures: true, contacts: true, sources: true, branches: true, criticalGaps: true } };

async function profile(name: string) {
  return (await listBranchProfiles(await manager())).find((b) => b.name === name)!;
}

/** Fills a branch's local details with clearly labelled TEST values (never real contacts) and verifies them. */
async function completeBranch(name: string) {
  const m = await manager();
  const b = await profile(name);
  await updateBranchProfile(m, b.id, {
    localAuthorityCode: b.policyProfile!.localAuthorityCode ?? "",
    regionCode: b.policyProfile!.regionCode ?? "",
    serviceTypes: ["DOMICILIARY"],
    safeguardingAdultsBoard: `${name} Safeguarding Adults Board (TEST)`,
    localProcedures: `TEST PROCEDURE for ${name}: raise the concern with the office, which refers it to the council's adult safeguarding team using the council's online form.`,
    safeguardingContacts: `TEST CONTACT for ${name} (not a real number)`,
    outOfHoursContacts: `TEST OUT-OF-HOURS for ${name} (not a real number)`,
    referralUrl: "https://example.org/test-referral",
    version: b.policyProfile!.version,
  });
  await verifyBranchProfile(m, b.id, { what: "contacts", note: "Checked against the official council page (TEST)" });
  await verifyBranchProfile(m, b.id, { what: "profile", note: "Checked against the official council page (TEST)", nextReviewDate: new Date(Date.now() + 180 * 86400_000) });
}

async function verifyAllSourcesFor(name: string) {
  const m = await manager();
  const b = await profile(name);
  const lib = await referenceLibrary(m, { la: b.policyProfile!.localAuthorityCode! });
  for (const s of lib.rows.filter((r) => r.geoLevel !== "NATIONAL")) await reviewSource(m, s.id, { status: "VERIFIED", note: "Opened the official page and checked it is current (TEST)", nextReviewDate: new Date(Date.now() + 90 * 86400_000) });
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  for (const b of await db.branch.findMany({ where: { organisationId: orgId } })) branches[b.name] = b.id;
}, 240_000);

describe("Branch configuration", () => {
  it("1-3: maps Tower Hamlets, Liverpool and Portsmouth to their own region and local arrangements", async () => {
    const list = await listBranchProfiles(await manager());
    const by = Object.fromEntries(list.map((b) => [b.name, b.policyProfile!]));
    expect(by["Tower Hamlets"]).toMatchObject({ localAuthorityCode: "tower-hamlets", regionCode: "LONDON", lastVerifiedAt: null });
    expect(by["Liverpool"]).toMatchObject({ localAuthorityCode: "liverpool", regionCode: "NORTH_WEST" });
    expect(by["Portsmouth"]).toMatchObject({ localAuthorityCode: "portsmouth", regionCode: "SOUTH_EAST" });
    const a = await assembleRequirements(await author(), { categoryCode: "SAFEGUARDING", branchIds: [branches["Tower Hamlets"]!, branches["Liverpool"]!, branches["Portsmouth"]!] });
    const names = (n: string) => { const b = a.branches.find((x) => x.name === n)!; return [...b.regional, ...b.local].map((s) => s.name).join(" | "); };
    expect(names("Tower Hamlets")).toMatch(/Pan-London/);
    expect(names("Tower Hamlets")).toMatch(/Tower Hamlets Council/);
    expect(names("Liverpool")).toMatch(/North West Safeguarding Adults Policy/);
    expect(names("Liverpool")).toMatch(/Liverpool Safeguarding Adults Board/);
    expect(names("Portsmouth")).toMatch(/4LSAB/);
    expect(names("Portsmouth")).toMatch(/Portsmouth City Council/);
  });

  it("4: Liverpool and Portsmouth never inherit Pan-London (or each other's) procedures", async () => {
    const a = await assembleRequirements(await author(), { categoryCode: "SAFEGUARDING", branchIds: [branches["Liverpool"]!, branches["Portsmouth"]!] });
    for (const b of a.branches) {
      const all = [...b.regional, ...b.local].map((s) => s.name).join(" | ");
      expect(all).not.toMatch(/London|Tower Hamlets/);
    }
    expect([...a.branches[0]!.regional, ...a.branches[0]!.local].map((s) => s.name).join()).not.toMatch(/4LSAB|Portsmouth/);
    // National sources are shared by every branch.
    expect(a.national.length).toBeGreaterThan(0);
  });

  it("refuses a local authority from another region than the one chosen, and stale edits", async () => {
    const m = await manager();
    const b = await profile("Liverpool");
    await expect(updateBranchProfile(m, b.id, { localAuthorityCode: "tower-hamlets", regionCode: "NORTH_WEST", version: b.policyProfile!.version })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateBranchProfile(m, b.id, { localAuthorityCode: "liverpool", version: b.policyProfile!.version + 5 })).rejects.toBeInstanceOf(ConflictError);
    await expect(verifyBranchProfile(m, b.id, { what: "contacts", note: "Checked the official page" })).rejects.toThrow(/Record the local safeguarding/);
  });

  it("5: administrators add a local authority and configure a new branch without code changes", async () => {
    const m = await manager();
    await addLocalAuthority(m, { name: "Test Borough of Example", regionCode: "EAST" });
    const nb = await db.branch.create({ data: { organisationId: orgId, name: "Example Branch (TEST)" } });
    const created = (await listBranchProfiles(m)).find((b) => b.id === nb.id)!;
    expect(created.policyProfile).toMatchObject({ localAuthorityCode: null });
    await updateBranchProfile(m, nb.id, { localAuthorityCode: "test-borough-of-example", serviceTypes: ["DOMICILIARY"], version: created.policyProfile!.version });
    expect((await db.branchPolicyProfile.findUniqueOrThrow({ where: { branchId: nb.id } })).regionCode).toBe("EAST");
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    await expect(updateBranchProfile(carer, nb.id, { version: 2 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Policy generation", () => {
  it("6: generates a national policy draft from a template with the legal framework and references", async () => {
    const tpl = await db.policy.findFirstOrThrow({ where: { kind: "MASTER", ref: "CSB-GOV-001" } });
    const [r] = await generatePolicyDraft(await author(), { basis: "TEMPLATE", basisPolicyId: tpl.id, mode: "NATIONAL", branchIds: [] });
    const v = await db.policyRevision.findUniqueOrThrow({ where: { id: r!.revisionId }, include: { draftVersion: { include: { sections: true } } } });
    expect(v.draftVersion.status).toBe("DRAFT");
    expect(v.draftVersion.origin).toBe("GENERATED");
    expect(v.draftVersion.sections.some((s) => s.key === "generated.references")).toBe(true);
    expect(r!.method).toBe("SOURCE_GUIDED");
    expect(await db.policyBranchScope.count({ where: { policyId: r!.policyId } })).toBe(0);
  });

  it("7-12: generates a shared safeguarding policy with Tower Hamlets, Liverpool and Portsmouth appendices, citations kept and gaps flagged", async () => {
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    const [r] = await generatePolicyDraft(await author(), { basis: "POLICY", basisPolicyId: company.id, mode: "SHARED_WITH_APPENDICES", branchIds: [branches["Tower Hamlets"]!, branches["Liverpool"]!, branches["Portsmouth"]!] });
    expect(r!.policyId).toBe(company.id);
    const draft = await db.policyRevision.findUniqueOrThrow({ where: { id: r!.revisionId }, include: { draftVersion: { include: { sections: { orderBy: { position: "asc" } } } } } });
    const s = draft.draftVersion.sections;
    const appx = (n: string) => s.find((x) => x.key.startsWith("appendix.") && x.heading.includes(n))!;
    expect(appx("Tower Hamlets").body).toMatch(/London Multi-Agency Adult Safeguarding/);
    expect(appx("Liverpool").body).not.toMatch(/London/);
    expect(appx("Portsmouth").body).toMatch(/4LSAB/);
    expect(appx("Portsmouth").isLocal).toBe(true);
    // Source citations retained: every appendix cites by [S#] and the references section lists the same labels.
    const refs = s.find((x) => x.key === "generated.references")!.body;
    for (const label of appx("Liverpool").body.match(/\[S\d+\]/g) ?? []) expect(refs).toContain(label);
    // Unverified sources and missing contacts are flagged, and nothing is invented.
    expect(appx("Tower Hamlets").body).toContain(REVIEW_MARKER);
    expect(appx("Tower Hamlets").body).not.toMatch(/0\d{3}[\s\d]{6,}/);
    const gaps = await db.policySourceGap.findMany({ where: { runId: r!.runId } });
    expect(gaps.filter((g) => g.severity === "CRITICAL").length).toBe(r!.criticalGaps);
    expect(gaps.some((g) => g.kind === "MISSING_CONTACTS")).toBe(true);
    expect(gaps.some((g) => g.kind === "UNVERIFIED_SOURCE")).toBe(true);
    expect(await db.policyBranchScope.count({ where: { policyId: company.id } })).toBe(3);
    expect(await db.policySourceLink.count({ where: { policyId: company.id, branchKey: branches["Liverpool"]! } })).toBeGreaterThan(0);
    // The published version stays in force; a second draft is refused while this one is open.
    expect((await db.policy.findUniqueOrThrow({ where: { id: company.id } })).currentPublishedVersionId).toBe(company.currentPublishedVersionId);
    await expect(generatePolicyDraft(await author(), { basis: "POLICY", basisPolicyId: company.id, mode: "SHARED_WITH_APPENDICES", branchIds: [branches["Liverpool"]!] })).rejects.toBeInstanceOf(ConflictError);
  });

  it("13-15: drafts with review markers cannot be submitted; once completed and verified, the existing approval workflow publishes it", async () => {
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    const run = await db.policyGenerationRun.findFirstOrThrow({ where: { policyId: company.id }, orderBy: { createdAt: "desc" } });
    const a = await author();
    await expect(submitForReview(a, run.revisionId!)).rejects.toThrow(/REVIEW REQUIRED/);
    for (const name of ["Tower Hamlets", "Liverpool", "Portsmouth"]) { await completeBranch(name); await verifyAllSourcesFor(name); }
    // Re-generate is refused while the draft is open, so the author completes the draft text instead.
    const rev = await db.policyRevision.findUniqueOrThrow({ where: { id: run.revisionId! }, include: { draftVersion: { include: { sections: true } } } });
    for (const s of rev.draftVersion.sections.filter((x) => x.body.includes(REVIEW_MARKER))) {
      await editDraftSection(a, rev.id, s.key, { body: s.body.replace(/\[REVIEW REQUIRED: [^\]]*\]/g, "Completed from the official source (TEST).") });
    }
    const re = await recheckGaps(a, run.id);
    expect(re.closed).toBeGreaterThan(0);
    for (const g of await db.policySourceGap.findMany({ where: { runId: run.id, resolvedAt: null } })) await resolveGap(a, g.id, "Checked the official source and completed the appendix (TEST)");
    await submitForReview(a, rev.id);
    // Separation of duties: the author cannot approve.
    await expect(decide(a, rev.id, { decision: "APPROVE", comment: "mine" })).rejects.toBeInstanceOf(ForbiddenError);
    await decide(await approver(), rev.id, { decision: "APPROVE", comment: "Checked" });
    const m = await manager();
    await expect(publishRevision(m, rev.id, { materialRevision: true })).rejects.toThrow(/confirm/);
    const pub = await publishRevision(m, rev.id, { materialRevision: true, ...ALL });
    const publication = await db.policyPublication.findUniqueOrThrow({ where: { id: pub.publicationId } });
    expect(publication.governanceChecks).toMatchObject({ confirmedBy: m.userId });
    expect((await db.policy.findUniqueOrThrow({ where: { id: company.id } })).scopeMode).toBe("SHARED_WITH_APPENDICES");
  });

  it("14: generates separate branch-specific policies linked to the company policy", async () => {
    const tpl = await db.policy.findFirstOrThrow({ where: { kind: "MASTER", ref: "CSB-COM-001" } });
    const res = await generatePolicyDraft(await author(), { basis: "TEMPLATE", basisPolicyId: tpl.id, mode: "BRANCH_SPECIFIC", branchIds: [branches["Liverpool"]!, branches["Portsmouth"]!] });
    expect(res).toHaveLength(2);
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-COM-001", branchId: null } });
    const variants = await db.policy.findMany({ where: { parentPolicyId: company.id } });
    expect(variants.map((v) => v.branchId).sort()).toEqual([branches["Liverpool"], branches["Portsmouth"]].sort());
    expect(variants.every((v) => v.scopeMode === "BRANCH_SPECIFIC")).toBe(true);
    const sections = await db.policySection.findMany({ where: { version: { policyId: variants.find((v) => v.branchId === branches["Liverpool"])!.id } } });
    expect(sections.some((s) => s.key === "branch.contacts" && s.body.includes("TEST CONTACT for Liverpool"))).toBe(true);
    expect(sections.some((s) => /London|Portsmouth/.test(s.body) && s.key.startsWith("branch."))).toBe(false);
  });

  it("validates AI output: contact details and unknown citations are rejected, verified wording is used", async () => {
    setAiProviderForTests({
      name: "test-ai",
      isSimulated: false,
      analyseChange: vi.fn(), assessImpact: vi.fn(), draftRevision: vi.fn(), answer: vi.fn(),
      draftBranchPolicy: async (input) => ({
        sections: [
          { key: "generated.legal-framework", heading: "Legal and regulatory framework", body: "Wording proposed from S1 for the test.", citations: [{ sourceRef: "S1", quote: null }] },
          { key: "generated.local-arrangements", heading: "Local arrangements", body: "Call 0151 233 3800 today.", citations: [{ sourceRef: "S1", quote: null }] },
          { key: "generated.references", heading: "Relevant references", body: "Made up.", citations: [{ sourceRef: "S999", quote: null }] },
        ].filter((s) => input.sections.some((x) => x.key === s.key)),
        uncertainties: ["Check the local procedure"],
      }),
    });
    try {
      const tpl = await db.policy.findFirstOrThrow({ where: { kind: "MASTER", ref: "CSB-IPC-001" } });
      const [r] = await generatePolicyDraft(await author(), { basis: "TEMPLATE", basisPolicyId: tpl.id, mode: "SHARED_WITH_APPENDICES", branchIds: [branches["Liverpool"]!] });
      expect(r!.method).toBe("AI");
      const rev = await db.policyRevision.findUniqueOrThrow({ where: { id: r!.revisionId }, include: { draftVersion: { include: { sections: true } } } });
      const body = rev.draftVersion.sections.map((s) => s.body).join("\n");
      expect(body).not.toContain("0151 233 3800");
      expect(body).not.toContain("Made up.");
      expect(rev.explanation).toMatch(/rejected/);
    } finally {
      setAiProviderForTests(undefined);
    }
  });
});

describe("Staff and safeguarding", () => {
  it("16-17, 19: assigns the published version to everyone who works in each branch, including staff based elsewhere, keeping earlier acknowledgements", async () => {
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" }, include: { publications: { orderBy: { createdAt: "asc" } } } });
    const rules = await db.policyAssignmentRule.findMany({ where: { policyId: company.id, scope: "WORKS_IN_BRANCH", withdrawnAt: null } });
    expect(rules.map((r) => r.branchId).sort()).toEqual([branches["Liverpool"], branches["Portsmouth"], branches["Tower Hamlets"]].sort());
    const latest = company.publications.at(-1)!;
    const rows = await db.acknowledgement.findMany({ where: { publicationId: latest.id, supersededAt: null }, include: { staffMember: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.acknowledgedAt === null)).toBe(true); // never acknowledged automatically
    // A Liverpool carer who also works a Tower Hamlets area is covered once, through either branch.
    const thArea = await db.area.findFirstOrThrow({ where: { organisationId: orgId, branchId: branches["Tower Hamlets"] } });
    const lpCarer = await db.staffMember.findFirstOrThrow({ where: { organisationId: orgId, branchId: branches["Liverpool"], hrMissing: false, employmentStatus: "ACTIVE" } });
    await db.staffArea.upsert({ where: { staffId_areaId: { staffId: lpCarer.id, areaId: thArea.id } }, create: { staffId: lpCarer.id, areaId: thArea.id, organisationId: orgId }, update: {} });
    const { worksInBranchWhere } = await import("@/server/policies/assignment");
    const thWorkers = await db.staffMember.findMany({ where: { organisationId: orgId, ...worksInBranchWhere(branches["Tower Hamlets"]!) }, select: { id: true } });
    expect(thWorkers.map((s) => s.id)).toContain(lpCarer.id);
    expect(rows.filter((r) => r.staffMemberId === lpCarer.id)).toHaveLength(1);
  });

  it("18: records cross-boundary locations, flags them and keeps the manager's decision with reasons", async () => {
    const m = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, branchId: branches["Liverpool"], status: "ACTIVE" } });
    await recordServiceUserGeography(m, su.id, { residenceLocalAuthorityCode: "sefton", careLocationLocalAuthorityCode: "sefton", fundingAuthority: "Liverpool City Council" });
    const before = await crossBoundaryCases(m);
    const row = before.rows.find((r) => r.person.id === su.id)!;
    expect(row.crosses).toBe(true);
    expect(row.decision).toBeNull();
    expect(row.flags[0]!.text).toMatch(/Sefton/);
    await expect(recordSafeguardingDecision(m, su.id, { safeguardingLocalAuthorityCode: "sefton", reasoning: "short" })).rejects.toBeInstanceOf(ValidationError);
    await recordSafeguardingDecision(m, su.id, { safeguardingLocalAuthorityCode: "sefton", reasoning: "The person lives and receives care in Sefton; the concern arose there. Liverpool funds the care but does not lead." });
    const after = await crossBoundaryCases(m);
    expect(after.rows.find((r) => r.person.id === su.id)!.decision).toMatchObject({ safeguardingLocalAuthorityCode: "sefton" });
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).fundingAuthority).toBe("Liverpool City Council");
    const inc = await db.incident.findFirst({ where: { organisationId: orgId } });
    if (inc) await recordIncidentLocation(m, inc.id, "knowsley");
    // A carer cannot record the decision.
    await expect(recordSafeguardingDecision(await ctxFor("carer@care-solution.demo", BROOKFIELD), su.id, { safeguardingLocalAuthorityCode: "liverpool", reasoning: "I think it should be Liverpool for this person." })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("20: rejects another organisation's access to policies, branches, people and gaps", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    await expect(generatePolicyDraft(oak, { basis: "POLICY", basisPolicyId: company.id, mode: "SHARED_WITH_APPENDICES", branchIds: [branches["Liverpool"]!] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateBranchProfile(oak, branches["Liverpool"]!, { version: 1 })).rejects.toBeInstanceOf(NotFoundError);
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(recordSafeguardingDecision(oak, su.id, { safeguardingLocalAuthorityCode: "liverpool", reasoning: "Trying to write into another organisation's record." })).rejects.toBeInstanceOf(NotFoundError);
    const gap = await db.policySourceGap.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(resolveGap(oak, gap.id, "Resolving another organisation's gap")).rejects.toBeInstanceOf(NotFoundError);
    const oakView = await coverageView(oak);
    expect(oakView.rows.some((r) => r.ref === "CSB-SAF-001")).toBe(false);
  });
});

describe("Regulatory monitoring", () => {
  it("21-25: a detected local source change resets verification, creates a review task, notifies the owner and keeps the published policy", async () => {
    const src = await db.regulatorySource.findFirstOrThrow({ where: { key: "geo-liverpool-sab-local-policies" } });
    const company = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    const published = company.currentPublishedVersionId;
    let body = "<!doctype html><html><body><main><h2>Local procedures</h2><p>Original local procedure text (SIMULATED).</p></main></body></html>";
    const http = fixtureHttp(fixtureFetch({ [src.canonicalUrl]: () => ({ body }) }));
    await checkSource(src.id, { trigger: "MANUAL", http, force: true });
    body = "<!doctype html><html><body><main><h2>Local procedures</h2><p>Updated local procedure text with a new referral step (SIMULATED).</p></main></body></html>";
    const run = await checkSource(src.id, { trigger: "MANUAL", http, force: true });
    expect(run.changeIds).toHaveLength(1);
    const result = await flagPoliciesForSourceChange(run.changeIds[0]!);
    expect(result.tasks).toBeGreaterThan(0);
    expect((await db.orgSourceReview.findUniqueOrThrow({ where: { organisationId_sourceId: { organisationId: orgId, sourceId: src.id } } })).status).toBe("NEEDS_REVIEW");
    const task = await db.complianceAction.findFirstOrThrow({ where: { organisationId: orgId, title: { contains: "CSB-SAF-001" }, description: { contains: run.changeIds[0]! } } });
    expect(task.description).toMatch(/Liverpool/);
    expect(await db.notification.count({ where: { organisationId: orgId, type: "policy.source_changed" } })).toBeGreaterThan(0);
    expect(await db.changePolicyCandidate.count({ where: { changeId: run.changeIds[0]!, policyId: company.id, reason: "SOURCE_LINK" } })).toBe(1);
    // Idempotent, and the published policy is untouched.
    await flagPoliciesForSourceChange(run.changeIds[0]!);
    expect(await db.complianceAction.count({ where: { organisationId: orgId, description: { contains: run.changeIds[0]! } } })).toBe(1);
    expect((await db.policy.findUniqueOrThrow({ where: { id: company.id } })).currentPublishedVersionId).toBe(published);
    // The coverage view now reports the policy as needing review, never as current.
    const view = await coverageView(await manager(), { category: "SAFEGUARDING" });
    const lp = view.rows.find((r) => r.ref === "CSB-SAF-001")!.cells.find((c) => c.branchId === branches["Liverpool"])!;
    expect(lp.state).toBe("approved_needs_review");
    // A replacement still needs approval: the existing pipeline accepts the change without publishing anything.
    await analyseChange(run.changeIds[0]!);
    expect((await db.policy.findUniqueOrThrow({ where: { id: company.id } })).currentPublishedVersionId).toBe(published);
  });

  it("34: a failing source check is shown as 'could not be checked', never as current", async () => {
    const src = await db.regulatorySource.findFirstOrThrow({ where: { key: "geo-portsmouth-report-concern" } });
    await db.regulatorySource.update({ where: { id: src.id }, data: { retrievalStatus: "FAILING" } });
    const lib = await referenceLibrary(await manager(), { la: "portsmouth" });
    expect(lib.rows.find((r) => r.id === src.id)!.trust).toBe("check_failed");
  });
});

describe("Reference library", () => {
  it("records each organisation's own verification, and validates new sources", async () => {
    const m = await manager();
    const src = await db.regulatorySource.findFirstOrThrow({ where: { key: "geo-4lsab-marm-framework" } });
    await expect(reviewSource(m, src.id, { status: "VERIFIED" })).rejects.toBeInstanceOf(ValidationError);
    await reviewSource(m, src.id, { status: "VERIFIED", note: "Opened the guide, checked date (TEST)", nextReviewDate: new Date(Date.now() + 86400_000 * 30) });
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    expect((await referenceLibrary(oak)).rows.find((r) => r.id === src.id)!.trust).toBe("unverified");
    await expect(proposeSource(m, { name: "A local procedure", issuingOrganisation: "Council", canonicalUrl: "http://insecure.example", geoLevel: "LOCAL", localAuthorityCodes: ["liverpool"] })).rejects.toBeInstanceOf(ValidationError);
    const s = await proposeSource(m, { name: "Sefton safeguarding adults procedure (TEST)", issuingOrganisation: "Sefton Council", canonicalUrl: "https://example.org/sefton-test", geoLevel: "LOCAL", localAuthorityCodes: ["sefton"], topics: ["SAFEGUARDING"] });
    expect(s.coverage).toBe("MANUAL_REVIEW_ONLY");
  });
});

describe("Regression", () => {
  it("26-28: manual policy creation and the ordinary approval workflow still work", async () => {
    const a = await author();
    const { revision } = await createPolicy(a, { ref: "TEST-MAN-001", title: "Manual policy", description: "Manual", categoryCode: "GOVERNANCE", serviceTypes: [], sections: [{ key: "purpose", heading: "Purpose", body: "Text" }] });
    await submitForReview(a, revision.id);
    await decide(await approver(), revision.id, { decision: "APPROVE", comment: "ok" });
    const pub = await publishRevision(await manager(), revision.id, {});
    expect(pub.scheduled).toBe(false);
    const p = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-HS-002" } });
    const r = await createManualRevision(a, p.id, "Routine");
    await editDraftSection(a, r.id, "purpose", { body: "Updated purpose (TEST)" });
    await submitForReview(a, r.id);
    await decide(await approver(), r.id, { decision: "APPROVE", comment: "ok" });
    await publishRevision(await manager(), r.id, {}); // no generator confirmations are needed for ordinary revisions
  });
});

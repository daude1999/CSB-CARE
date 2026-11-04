import type { Policy, PolicyScopeMode, Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "../audit-log";
import { getAiProvider } from "../ai";
import { AiUnavailableError } from "../ai/provider";
import { hasOrgPermission, requireOrgPermission, visiblePolicyWhere, type Ctx } from "../auth/rbac";
import { createDraftVersion, toSectionInputs, type SectionInput } from "../policies/versions";
import { branchGaps, needsLocalArrangements, TRUST_LABEL, type GapDraft, type SourceTrust } from "./applicability";
import { allowedBranchIds, listBranchProfiles } from "./branches";
import { regionName } from "./regions";
import { sourcesForBranch } from "./reference";

/**
 * The branch-specific Policy Generator: Select Policy → Select Branches → Review Applicable Requirements → Generate
 * Draft → Review & Approve → Publish. It never publishes or approves anything: it writes a DRAFT version through the
 * existing revision workflow (separation of duties, approvals, publication and staff sign-off are unchanged), records
 * the sources it assembled and every gap it could not fill from verified material, and marks the places a manager must
 * complete with REVIEW_MARKER, which blocks publication until removed.
 */

export const REVIEW_MARKER = "[REVIEW REQUIRED";
const review = (what: string) => `${REVIEW_MARKER}: ${what}]`;

type SourceRow = Awaited<ReturnType<typeof sourcesForBranch>>[number];
export type AssembledSource = { label: string; id: string; name: string; issuer: string | null; level: string; url: string; trust: SourceTrust; areas: string; versionLabel: string | null; summary: string | null; lastChecked: string | null };
export type AssembledBranch = {
  id: string;
  name: string;
  address: string | null;
  localAuthority: string | null;
  localAuthorityCode: string | null;
  region: string | null;
  regionCode: string | null;
  profile: NonNullable<Awaited<ReturnType<typeof listBranchProfiles>>[number]["policyProfile"]> | null;
  regional: AssembledSource[];
  local: AssembledSource[];
  gaps: GapDraft[];
};
export type Assembly = {
  categoryCode: string;
  national: AssembledSource[];
  requirements: { ref: string; title: string; exactReference: string; url: string; legalStatus: string; verification: string }[];
  branches: AssembledBranch[];
  nationalGaps: GapDraft[];
};

function toAssembled(s: SourceRow, label: string, laNames: Map<string, string>): AssembledSource {
  return {
    label,
    id: s.id,
    name: s.name,
    issuer: s.issuingOrganisation,
    level: s.geoLevel,
    url: s.canonicalUrl,
    trust: s.trust,
    areas: s.geoLevel === "NATIONAL" ? "England" : s.localAuthorityCodes.length ? s.localAuthorityCodes.map((c) => laNames.get(c) ?? c).join(", ") : s.regionCodes.map((r) => regionName(r)).join(", "),
    versionLabel: s.versionLabel,
    summary: s.referenceSummary,
    lastChecked: s.review?.lastCheckedAt ? s.review.lastCheckedAt.toISOString().slice(0, 10) : null,
  };
}

/** Requirements register entries the basis policy (or the template it came from) is mapped to. */
async function requirementsFor(basis: Pick<Policy, "id" | "templateId"> | null) {
  if (!basis) return [];
  const links = await db.requirementPolicyLink.findMany({ where: { policyId: { in: [basis.id, ...(basis.templateId ? [basis.templateId] : [])] } }, include: { requirement: true } });
  const seen = new Set<string>();
  return links
    .map((l) => l.requirement)
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({ ref: r.ref, title: r.title, exactReference: r.exactReference, url: r.sourceUrl, legalStatus: r.legalStatus, verification: r.verificationStatus }));
}

/** Step 3: every verified and unverified source that applies, per level and per branch, with the gaps found. */
export async function assembleRequirements(ctx: Ctx, input: { categoryCode: string; branchIds: string[]; basisPolicyId?: string | null }): Promise<Assembly> {
  const organisationId = requireOrgPermission(ctx, "policy.author");
  const profiles = await listBranchProfiles(ctx);
  const chosen = profiles.filter((b) => input.branchIds.includes(b.id));
  if (chosen.length !== new Set(input.branchIds).size) throw new NotFoundError("Branch");
  const basis = input.basisPolicyId ? await db.policy.findFirst({ where: { AND: [{ id: input.basisPolicyId }, visiblePolicyWhere(ctx)] } }) : null;
  const laNames = new Map((await db.localAuthority.findMany({ select: { code: true, name: true } })).map((l) => [l.code, l.name]));
  const nationalRows = await sourcesForBranch(organisationId, { localAuthorityCode: null, regionCode: null }, input.categoryCode);
  const labels = new Map<string, string>();
  const label = (id: string) => labels.get(id) ?? (labels.set(id, `S${labels.size + 1}`), labels.get(id)!);
  const national = nationalRows.filter((s) => s.geoLevel === "NATIONAL").map((s) => toAssembled(s, label(s.id), laNames));
  const branches: AssembledBranch[] = [];
  for (const b of chosen) {
    const p = b.policyProfile;
    const rows = await sourcesForBranch(organisationId, { localAuthorityCode: p?.localAuthorityCode ?? null, regionCode: p?.regionCode ?? null, extraSourceIds: p?.extraSourceIds ?? [] }, input.categoryCode);
    const nonNational = rows.filter((s) => s.geoLevel !== "NATIONAL");
    branches.push({
      id: b.id,
      name: b.name,
      address: b.address,
      localAuthority: p?.localAuthority?.name ?? null,
      localAuthorityCode: p?.localAuthorityCode ?? null,
      region: p?.regionCode ? regionName(p.regionCode) : null,
      regionCode: p?.regionCode ?? null,
      profile: p,
      regional: nonNational.filter((s) => s.geoLevel === "REGIONAL").map((s) => toAssembled(s, label(s.id), laNames)),
      local: nonNational.filter((s) => s.geoLevel === "LOCAL").map((s) => toAssembled(s, label(s.id), laNames)),
      gaps: branchGaps({ branch: b, profile: p, categoryCode: input.categoryCode, sources: nonNational.map((s) => ({ id: s.id, name: s.name, geoLevel: s.geoLevel, trust: s.trust })) }),
    });
  }
  const requirements = await requirementsFor(basis);
  const nationalGaps: GapDraft[] = [];
  if (!requirements.length) nationalGaps.push({ kind: "MISSING_SOURCE", severity: "WARNING", branchId: null, sourceId: null, message: "No entries in the Requirements Register are mapped to this policy, so the legal framework section lists sources only. Map the policy's requirements in the register." });
  for (const s of national.filter((x) => x.trust === "check_failed" || x.trust === "superseded")) nationalGaps.push({ kind: s.trust === "check_failed" ? "SOURCE_CHECK_FAILED" : "OUTDATED_SOURCE", severity: "WARNING", branchId: null, sourceId: s.id, message: `"${s.name}" is ${TRUST_LABEL[s.trust].toLowerCase()}; confirm the policy still reflects it.` });
  return { categoryCode: input.categoryCode, national, requirements, branches, nationalGaps };
}

// ── Composition (no AI): the source-guided draft ──

const STANDARD_SECTIONS = [
  ["purpose", "Purpose"],
  ["scope", "Scope"],
  ["legal-framework", "Legal and regulatory framework"],
  ["roles", "Roles and responsibilities"],
  ["requirements", "Policy requirements"],
  ["procedures", "Operational procedures"],
  ["safeguarding-escalation", "Safeguarding and escalation arrangements"],
  ["local-contacts", "Local contacts"],
  ["monitoring", "Monitoring and compliance"],
  ["training", "Training requirements"],
  ["review", "Review arrangements"],
] as const;

const SAFEGUARDING_TOPICS: { label: string; match: RegExp }[] = [
  { label: "Self-neglect and hoarding", match: /self-neglect|hoarding|risk management|MARM/i },
  { label: "People in Positions of Trust", match: /positions of trust|PiPoT/i },
  { label: "Multi-agency arrangements", match: /multi-agency|multiagency|pan-london|4LSAB/i },
  { label: "Safeguarding Adults Reviews and local learning", match: /annual report|learning|adults board/i },
];

const cite = (s: AssembledSource) => `${s.name} (${s.issuer ?? "issuer not recorded"}) [${s.label}]${s.trust === "verified" ? "" : `: ${TRUST_LABEL[s.trust].toLowerCase()}, must be checked before approval`}`;

export function appendixKey(branchName: string) {
  return `appendix.${branchName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** The local arrangements for one branch, written only from recorded facts and listed sources. */
export function localArrangements(b: AssembledBranch, categoryCode: string): string {
  const p = b.profile;
  const lines: string[] = [];
  lines.push(`This section applies to people supported by the ${b.name} branch, to staff who work for or in that branch, and to care delivered in ${b.localAuthority ?? review("record the branch's local authority")}${b.region ? ` (${b.region})` : ""}.`);
  lines.push(`Where a person lives, receives care or has an incident in a different local authority area, staff tell the office straight away. A manager decides which authority's procedures apply and records the decision and the reasons; this is never assumed from the branch's location or from who funds the care.`);
  lines.push("");
  lines.push(`Local Safeguarding Adults Board: ${p?.safeguardingAdultsBoard ?? review("name the Safeguarding Adults Board from the official local source")}`);
  if (p?.safeguardingChildrenPartnership) lines.push(`Safeguarding Children Partnership (where a child is at risk): ${p.safeguardingChildrenPartnership}`);
  lines.push("");
  lines.push(`Regional procedures that apply:${b.regional.length ? "" : ` ${review(`no regional procedure is recorded for ${b.region ?? "this branch's region"}; add it to the reference library or confirm none applies`)}`}`);
  for (const s of b.regional) lines.push(`- ${cite(s)}`);
  if (p?.regionalGuidance) lines.push(`Notes recorded by the branch: ${p.regionalGuidance}`);
  lines.push(`Local procedures that apply:${b.local.length ? "" : ` ${review(`no local authority source is recorded for ${b.localAuthority ?? "this area"}; add the official local procedure to the reference library`)}`}`);
  for (const s of b.local) lines.push(`- ${cite(s)}`);
  lines.push("");
  lines.push("How to raise a concern locally:");
  lines.push(p?.localProcedures?.trim() ? p.localProcedures.trim() : review("record the local referral process from the official council or Safeguarding Adults Board source. The generator does not write local procedures from memory"));
  if (needsLocalArrangements(categoryCode) && categoryCode === "SAFEGUARDING") {
    lines.push("");
    lines.push("Local guidance on specific safeguarding matters:");
    const all = [...b.regional, ...b.local];
    for (const t of SAFEGUARDING_TOPICS) {
      const hits = all.filter((s) => t.match.test(s.name));
      lines.push(`- ${t.label}: ${hits.length ? hits.map((s) => `see ${s.name} [${s.label}]${s.trust === "verified" ? "" : " (not yet verified)"}`).join("; ") : review(`record the local guidance on ${t.label.toLowerCase()}, or confirm the national arrangements apply`)}`);
    }
  }
  if (p?.integratedCareBoard || p?.commissioningArrangements) {
    lines.push("");
    if (p.integratedCareBoard) lines.push(`NHS Integrated Care Board: ${p.integratedCareBoard}`);
    if (p.commissioningArrangements) lines.push(`Local commissioning arrangements: ${p.commissioningArrangements}`);
  }
  return lines.join("\n");
}

/** The contact block: copied word for word from the branch's recorded contacts, never written or reformatted. */
export function localContacts(b: AssembledBranch): string {
  const p = b.profile;
  const lines = [
    "If someone is in immediate danger, call 999.",
    "",
    `Local safeguarding contacts (${b.localAuthority ?? "local authority not recorded"}):`,
    p?.safeguardingContacts?.trim() ? p.safeguardingContacts.trim() : review("add the local safeguarding contact details from the official council page; none have been entered or invented"),
    "",
    "Out of hours and emergency arrangements:",
    p?.outOfHoursContacts?.trim() ? p.outOfHoursContacts.trim() : review("add the out-of-hours arrangements from the official council page"),
    "",
    `Local referral web page: ${p?.referralUrl ?? review("add the official referral web page")}`,
    p?.safeguardingContacts?.trim() ? (p.contactsVerifiedAt ? `Contacts confirmed against the official source on ${p.contactsVerifiedAt.toISOString().slice(0, 10)}.` : review("confirm these contacts against the official source before publication")) : "",
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

function referencesSection(a: Assembly): string {
  const lines = ["Sources assembled for this draft, with their status in this organisation on the date it was generated. A source that is not verified must be checked against the official page before the policy is approved.", ""];
  if (a.requirements.length) {
    lines.push("Requirements Register entries:");
    for (const r of a.requirements) lines.push(`- ${r.exactReference}: ${r.title} (${r.legalStatus.replace(/_/g, " ").toLowerCase()}, register entry ${r.ref}${r.verification === "VERIFIED" ? "" : `, ${r.verification.toLowerCase().replace(/_/g, " ")}`}) ${r.url}`);
    lines.push("");
  }
  lines.push("National sources:");
  for (const s of a.national) lines.push(`- [${s.label}] ${s.name}. ${s.issuer ?? ""} ${s.url} (${TRUST_LABEL[s.trust]})`);
  const seen = new Set<string>();
  for (const b of a.branches) {
    const extra = [...b.regional, ...b.local].filter((s) => !seen.has(s.id));
    extra.forEach((s) => seen.add(s.id));
    if (!extra.length) continue;
    lines.push("", `Regional and local sources for ${b.name}:`);
    for (const s of extra) lines.push(`- [${s.label}] ${s.name}. ${s.issuer ?? ""} ${s.url}${s.versionLabel ? ` (${s.versionLabel})` : ""} (${TRUST_LABEL[s.trust]}${s.lastChecked ? `, checked ${s.lastChecked}` : ""})`);
  }
  return lines.join("\n");
}

function frameworkSection(a: Assembly): string {
  const lines = ["This policy is based on the following national legislation, regulations and guidance for England. Regional and local procedures are set out for each branch separately and are never applied outside their own area.", ""];
  for (const r of a.requirements) lines.push(`- ${r.exactReference}: ${r.title}`);
  for (const s of a.national) lines.push(`- ${s.name} [${s.label}]`);
  if (!a.requirements.length && !a.national.length) lines.push(review("list the legislation and guidance this policy is based on"));
  return lines.join("\n");
}

function letter(i: number) {
  return String.fromCharCode(65 + (i % 26));
}

/**
 * Builds the draft sections. The basis policy's own sections are kept word for word (they are approved CSB or
 * organisation content); the generator adds the legal framework (when the basis has none), the branch arrangements
 * (as appendices, or inline for a branch policy) and the references. A new policy gets the standard headings, each
 * marked for the author to write.
 */
export function composeSections(a: Assembly, opts: { base: SectionInput[]; mode: PolicyScopeMode; branch?: AssembledBranch }): SectionInput[] {
  const out: SectionInput[] = opts.base.length
    ? opts.base.filter((s) => !s.key.startsWith("appendix.") && !s.key.startsWith("generated.") && !s.key.startsWith("branch.")).map((s) => ({ ...s }))
    : STANDARD_SECTIONS.filter(([k]) => k !== "legal-framework" && k !== "local-contacts").map(([key, heading]) => ({ key, heading, body: review(`write the ${heading.toLowerCase()} section. With AI switched on a first draft is proposed from the listed sources`) }));
  const hasFramework = out.some((s) => /legal|legislation|regulatory framework|legal framework/i.test(s.heading));
  if (!hasFramework) out.splice(Math.min(2, out.length), 0, { key: "generated.legal-framework", heading: "Legal and regulatory framework", body: frameworkSection(a) });
  if (opts.mode === "SHARED_WITH_APPENDICES") {
    out.push({
      key: "generated.local-arrangements",
      heading: "Local safeguarding and escalation arrangements",
      body: `This policy applies across the organisation. Local authority arrangements, regional procedures, local referral routes and emergency contacts are set out in a separate appendix for each branch: ${a.branches.map((b, i) => `Appendix ${letter(i)} (${b.name})`).join(", ")}. Staff read this policy and the appendices for the areas they work in.`,
    });
    a.branches.forEach((b, i) => {
      out.push({ key: appendixKey(b.name), heading: `Appendix ${letter(i)}: ${b.name}${b.localAuthority ? ` (${b.localAuthority})` : ""}`, body: `${localArrangements(b, a.categoryCode)}\n\n${localContacts(b)}`, isLocal: true });
    });
  } else if (opts.mode === "BRANCH_SPECIFIC" && opts.branch) {
    out.push({ key: "branch.arrangements", heading: `Local safeguarding and escalation arrangements: ${opts.branch.name}`, body: localArrangements(opts.branch, a.categoryCode), isLocal: true });
    out.push({ key: "branch.contacts", heading: `Local contacts: ${opts.branch.name}`, body: localContacts(opts.branch), isLocal: true });
  }
  out.push({ key: "generated.references", heading: "Relevant references", body: referencesSection(a) });
  // Keys must be unique; later duplicates (a basis that already had a generated section) are dropped.
  const keys = new Set<string>();
  return out.filter((s) => (keys.has(s.key) ? false : (keys.add(s.key), true)));
}

// ── AI pass (optional) ──

const CONTACT_LIKE = /(\+44|\b0\d{2,4})[\d\s-]{6,}\d|\b\d{3}[\s-]?\d{3,4}[\s-]?\d{3,4}\b|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\//i;

/**
 * Asks the AI provider to improve the wording of the generated, non-contact sections. Its proposal is validated: only
 * sections it was allowed to edit are taken, every citation must name a listed source, quotes must appear in the
 * source's stored text, and any section containing a telephone number, e-mail or web address is rejected (contacts come
 * only from the branch's recorded details). Anything rejected keeps the source-guided text.
 */
async function aiPass(a: Assembly, sections: SectionInput[], meta: { title: string; mode: PolicyScopeMode }) {
  const ai = getAiProvider();
  if (!ai?.draftBranchPolicy || ai.isSimulated) return { sections, method: "SOURCE_GUIDED" as const, provider: null, notes: [] as string[] };
  const editable = (s: SectionInput) => s.key.startsWith("generated.") || s.key === "branch.arrangements" || (s.key.startsWith("appendix.") ? false : s.body.startsWith(REVIEW_MARKER));
  const all = [...a.national, ...a.branches.flatMap((b) => [...b.regional, ...b.local])];
  const texts = new Map<string, string>();
  for (const s of all) {
    const docs = await db.sourceDocument.findMany({ where: { sourceId: s.id }, include: { currentVersion: { select: { normalisedText: true } } }, take: 3 });
    const t = [s.summary, ...docs.map((d) => d.currentVersion?.normalisedText ?? "")].filter(Boolean).join("\n").slice(0, 6000);
    if (t) texts.set(s.label, t);
  }
  let out;
  try {
    out = await ai.draftBranchPolicy({
      policy: { title: meta.title, category: a.categoryCode, mode: meta.mode },
      branches: a.branches.map((b) => ({ name: b.name, localAuthority: b.localAuthority, region: b.region, facts: [b.profile?.safeguardingAdultsBoard ? `Safeguarding Adults Board: ${b.profile.safeguardingAdultsBoard}` : "", b.profile?.localProcedures ? `Local procedure as recorded by the manager: ${b.profile.localProcedures}` : "Local procedure not yet recorded", b.profile?.lastVerifiedAt ? "Branch configuration verified by a manager" : "Branch configuration NOT verified"].filter(Boolean) })),
      sources: all.map((s) => ({ ref: s.label, title: s.name, issuer: s.issuer, level: s.level, status: TRUST_LABEL[s.trust], text: texts.get(s.label) ?? null })),
      sections: sections.map((s) => ({ key: s.key, heading: s.heading, body: s.body, editable: editable(s) && !s.key.startsWith("appendix.") })),
    });
  } catch (e) {
    if (e instanceof AiUnavailableError) return { sections, method: "SOURCE_GUIDED" as const, provider: null, notes: [`AI drafting was unavailable (${e.message}); the source-guided draft was used.`] };
    logger.warn({ err: (e as Error).message }, "branch policy AI draft failed");
    return { sections, method: "SOURCE_GUIDED" as const, provider: null, notes: ["AI drafting failed; the source-guided draft was used."] };
  }
  const labels = new Set(all.map((s) => s.label));
  const notes: string[] = [...out.uncertainties.map((u) => `AI noted: ${u}`)];
  const next = sections.map((s) => ({ ...s }));
  for (const prop of out.sections) {
    const target = next.find((s) => s.key === prop.key);
    if (!target || !editable(target) || target.key.startsWith("appendix.")) { notes.push(`AI proposal for "${prop.key}" ignored: not an editable section.`); continue; }
    if (CONTACT_LIKE.test(prop.body)) { notes.push(`AI proposal for "${target.heading}" rejected: it contained a telephone number, e-mail or web address.`); continue; }
    const badRef = prop.citations.find((c) => !labels.has(c.sourceRef));
    if (badRef) { notes.push(`AI proposal for "${target.heading}" rejected: it cited an unknown source ${badRef.sourceRef}.`); continue; }
    const badQuote = prop.citations.find((c) => c.quote && !(texts.get(c.sourceRef) ?? "").includes(c.quote));
    if (badQuote) { notes.push(`AI proposal for "${target.heading}" rejected: a quotation was not found in ${badQuote.sourceRef}.`); continue; }
    target.body = prop.body.trim();
    target.heading = prop.heading.trim() || target.heading;
  }
  return { sections: next, method: "AI" as const, provider: ai.name, notes };
}

// ── Generation ──

const genSchema = z.object({
  basis: z.enum(["TEMPLATE", "POLICY", "NEW"]),
  basisPolicyId: z.string().optional(),
  title: z.string().trim().max(200).optional(),
  ref: z.string().trim().max(40).optional(),
  categoryCode: z.string().optional(),
  mode: z.enum(["NATIONAL", "SHARED_WITH_APPENDICES", "BRANCH_SPECIFIC"]),
  branchIds: z.array(z.string()).default([]),
  useAi: z.boolean().default(true),
});
export type GenerateInput = z.input<typeof genSchema>;
export type GenerateResult = { runId: string; revisionId: string; policyId: string; method: string; criticalGaps: number };

async function persistRun(
  tx: Tx,
  ctx: Ctx,
  args: { organisationId: string; policy: Policy; base: { versionId: string | null; masterVersionId?: string | null }; sections: SectionInput[]; a: Assembly; mode: PolicyScopeMode; branchIds: string[]; basis: string; basisPolicyId: string | null; method: string; provider: string | null; notes: string[]; branchesForGaps: AssembledBranch[] },
) {
  const { organisationId, policy } = args;
  const draft = await createDraftVersion(tx, {
    policyId: policy.id,
    organisationId,
    sections: args.sections,
    origin: "GENERATED",
    createdById: ctx.userId,
    previousVersionId: args.base.versionId,
    basedOnMasterVersionId: args.base.masterVersionId ?? null,
    reasonForChange: `Policy Generator: ${args.mode === "NATIONAL" ? "national policy" : args.mode === "SHARED_WITH_APPENDICES" ? `shared policy with appendices for ${args.branchesForGaps.map((b) => b.name).join(", ")}` : `branch policy for ${args.branchesForGaps.map((b) => b.name).join(", ")}`}`,
    changeSummary: args.method === "AI" ? "Generated draft (AI-assisted wording, checked against the listed sources). Must be reviewed and approved." : "Generated draft (source-guided, no AI). Must be reviewed and approved.",
  });
  const gaps = [...args.a.nationalGaps, ...args.branchesForGaps.flatMap((b) => b.gaps)];
  const rev = await tx.policyRevision.create({
    data: {
      policyId: policy.id,
      organisationId,
      kind: "MANUAL",
      baseVersionId: args.base.versionId,
      draftVersionId: draft.id,
      title: `Generated ${args.mode === "NATIONAL" ? "national" : args.mode === "SHARED_WITH_APPENDICES" ? "shared policy with branch appendices" : "branch-specific"} draft of ${policy.ref}`,
      explanation: `Drafted by the Policy Generator (${args.method === "AI" ? `AI-assisted wording by ${args.provider}` : "source-guided, no AI"}). ${gaps.filter((g) => g.severity === "CRITICAL").length} critical gap(s) must be resolved and every "${REVIEW_MARKER}" marker removed before publication.${args.notes.length ? ` ${args.notes.join(" ")}` : ""}`,
      provider: args.method === "AI" ? args.provider : null,
      createdById: ctx.userId,
      authorId: ctx.userId,
      substantive: true,
    },
  });
  const run = await tx.policyGenerationRun.create({
    data: {
      organisationId,
      policyId: policy.id,
      revisionId: rev.id,
      mode: args.mode,
      branchIds: args.branchIds,
      basis: args.basis,
      basisPolicyId: args.basisPolicyId,
      method: args.method,
      provider: args.provider,
      sourceSnapshot: JSON.parse(JSON.stringify({ national: args.a.national, requirements: args.a.requirements, branches: args.branchesForGaps.map((b) => ({ id: b.id, name: b.name, localAuthority: b.localAuthority, region: b.region, regional: b.regional, local: b.local, profileVerifiedAt: b.profile?.lastVerifiedAt ?? null, contactsVerifiedAt: b.profile?.contactsVerifiedAt ?? null })), notes: args.notes })) as Prisma.InputJsonValue,
      createdById: ctx.userId,
    },
  });
  if (gaps.length) await tx.policySourceGap.createMany({ data: gaps.map((g) => ({ organisationId, runId: run.id, policyId: policy.id, branchId: g.branchId, sourceId: g.sourceId, kind: g.kind, severity: g.severity, message: g.message })) });
  for (const b of args.branchesForGaps) {
    await tx.policyBranchScope.upsert({ where: { policyId_branchId: { policyId: policy.id, branchId: b.id } }, create: { organisationId, policyId: policy.id, branchId: b.id, appendixKey: args.mode === "SHARED_WITH_APPENDICES" ? appendixKey(b.name) : null, createdById: ctx.userId }, update: { appendixKey: args.mode === "SHARED_WITH_APPENDICES" ? appendixKey(b.name) : null } });
  }
  const links = [...args.a.national.map((s) => ({ sourceId: s.id, branchKey: "" })), ...args.branchesForGaps.flatMap((b) => [...b.regional, ...b.local].map((s) => ({ sourceId: s.id, branchKey: b.id })))];
  if (links.length) await tx.policySourceLink.createMany({ data: links.map((l) => ({ organisationId, policyId: policy.id, createdById: ctx.userId, ...l })), skipDuplicates: true });
  await tx.policy.update({ where: { id: policy.id }, data: { scopeMode: args.mode } });
  await audit({ organisationId, actorId: ctx.userId, action: "policy.generated", entityType: "PolicyRevision", entityId: rev.id, data: { runId: run.id, mode: args.mode, branches: args.branchIds, method: args.method, criticalGaps: gaps.filter((g) => g.severity === "CRITICAL").length } }, tx);
  return { runId: run.id, revisionId: rev.id, policyId: policy.id, method: args.method, criticalGaps: gaps.filter((g) => g.severity === "CRITICAL").length };
}

function branchSuffix(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Generates the draft(s). Returns one result per policy drafted (one, or one per branch for branch policies). */
export async function generatePolicyDraft(ctx: Ctx, input: GenerateInput | Record<string, unknown>): Promise<GenerateResult[]> {
  const organisationId = requireOrgPermission(ctx, "policy.author");
  const p = genSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the generator choices");
  const d = p.data;
  const branchIds = [...new Set(d.branchIds)];
  if (d.mode !== "NATIONAL" && !branchIds.length) throw new ValidationError("Choose at least one branch");
  if (d.mode === "NATIONAL" && branchIds.length) throw new ValidationError("A national policy applies to every branch; choose a shared policy with appendices for branch arrangements");
  const own = await db.branch.findMany({ where: { organisationId, id: { in: branchIds } }, select: { id: true } });
  if (own.length !== branchIds.length) throw new NotFoundError("Branch");
  if (allowedBranchIds(ctx, branchIds).length !== branchIds.length) throw new ForbiddenError("You can only generate policies for your own branches");

  // Step 1: the basis.
  let basisPolicy: (Policy & { currentPublishedVersion: { id: string; sections: Parameters<typeof toSectionInputs>[0] } | null }) | null = null;
  let categoryCode = d.categoryCode ?? "";
  if (d.basis !== "NEW") {
    if (!d.basisPolicyId) throw new ValidationError("Choose the policy to generate from");
    basisPolicy = await db.policy.findFirst({ where: { AND: [{ id: d.basisPolicyId, status: "ACTIVE" }, visiblePolicyWhere(ctx)] }, include: { currentPublishedVersion: { include: { sections: true } } } });
    if (!basisPolicy) throw new NotFoundError("Policy");
    if (d.basis === "TEMPLATE" && basisPolicy.kind !== "MASTER") throw new ValidationError("Choose a CSB template");
    if (d.basis === "POLICY" && (basisPolicy.kind !== "CUSTOMER" || basisPolicy.organisationId !== organisationId)) throw new ValidationError("Choose one of your organisation's policies");
    if (!basisPolicy.currentPublishedVersion) throw new ConflictError("That policy has no approved version yet. Finish its first approval, or start a new policy.");
    categoryCode = basisPolicy.categoryCode;
  } else {
    if (!d.title || d.title.length < 5) throw new ValidationError("Give the new policy a title");
    if (!d.ref || !/^[A-Z0-9][A-Z0-9-]{2,39}$/i.test(d.ref)) throw new ValidationError("Give the new policy a reference such as CSB-LW-001");
    if (!(await db.policyCategory.findUnique({ where: { code: categoryCode } }))) throw new ValidationError("Choose the policy's category");
    if (await db.policy.findFirst({ where: { organisationId, ref: d.ref } })) throw new ConflictError(`A policy with reference ${d.ref} already exists`);
  }

  // A template the organisation already uses is generated from its own copy, so there is one company policy.
  let company: (Policy & { currentPublishedVersion: { id: string; basedOnMasterVersionId: string | null; sections: Parameters<typeof toSectionInputs>[0] } | null; revisions: { id: string }[] }) | null = null;
  if (basisPolicy?.kind === "CUSTOMER") company = await db.policy.findFirstOrThrow({ where: { id: basisPolicy.id }, include: { currentPublishedVersion: { include: { sections: true } }, revisions: { where: { closedAt: null }, select: { id: true } } } });
  if (basisPolicy?.kind === "MASTER") company = await db.policy.findFirst({ where: { organisationId, templateId: basisPolicy.id, status: "ACTIVE" }, include: { currentPublishedVersion: { include: { sections: true } }, revisions: { where: { closedAt: null }, select: { id: true } } } });

  // Step 3: assemble.
  const a = await assembleRequirements(ctx, { categoryCode, branchIds, basisPolicyId: basisPolicy?.id ?? null });
  const baseSections = company?.currentPublishedVersion ? toSectionInputs(company.currentPublishedVersion.sections) : basisPolicy?.currentPublishedVersion ? toSectionInputs(basisPolicy.currentPublishedVersion.sections) : [];
  const title = company?.title ?? basisPolicy?.title ?? d.title!;
  const results: GenerateResult[] = [];

  if (d.mode !== "BRANCH_SPECIFIC") {
    const composed = composeSections(a, { base: baseSections, mode: d.mode });
    const ai = d.useAi ? await aiPass(a, composed, { title, mode: d.mode }) : { sections: composed, method: "SOURCE_GUIDED" as const, provider: null, notes: [] };
    if (company?.revisions.length) throw new ConflictError(`${company.ref} already has a draft in progress. Finish or withdraw it before generating a new draft.`);
    const r = await db.$transaction(async (tx) => {
      const policy =
        company ??
        (await tx.policy.create({
          data: basisPolicy
            ? { kind: "CUSTOMER", organisationId, templateId: basisPolicy.id, ref: basisPolicy.ref, docType: basisPolicy.docType, title: basisPolicy.title, description: basisPolicy.description, categoryCode, serviceTypes: basisPolicy.serviceTypes, jurisdiction: basisPolicy.jurisdiction, ownerId: ctx.userId, reviewIntervalMonths: basisPolicy.reviewIntervalMonths, supportingSourceDocumentIds: basisPolicy.supportingSourceDocumentIds }
            : { kind: "CUSTOMER", organisationId, ref: d.ref!, title: d.title!, description: `${d.title} (generated draft)`, categoryCode, serviceTypes: [], ownerId: ctx.userId },
        }));
      if (!company) await audit({ organisationId, actorId: ctx.userId, action: "policy.created", entityType: "Policy", entityId: policy.id, data: { by: "policy-generator", templateId: basisPolicy?.id ?? null } }, tx);
      return persistRun(tx, ctx, { organisationId, policy, base: { versionId: company?.currentPublishedVersion?.id ?? null, masterVersionId: company?.currentPublishedVersion?.basedOnMasterVersionId ?? (basisPolicy?.kind === "MASTER" ? basisPolicy.currentPublishedVersion?.id : null) }, sections: ai.sections, a, mode: d.mode, branchIds, basis: d.basis, basisPolicyId: basisPolicy?.id ?? null, method: ai.method, provider: ai.provider, notes: ai.notes, branchesForGaps: a.branches });
    });
    results.push(r);
    return results;
  }

  // Branch-specific: one policy per branch, each linked to the company policy (when there is one).
  for (const b of a.branches) {
    const single: Assembly = { ...a, branches: [b] };
    const existing = await db.policy.findFirst({ where: { organisationId, branchId: b.id, scopeMode: "BRANCH_SPECIFIC", status: "ACTIVE", ...(company ? { parentPolicyId: company.id } : basisPolicy ? { templateId: basisPolicy.id } : { title: `${d.title} – ${b.name}` }) }, include: { currentPublishedVersion: { include: { sections: true } }, revisions: { where: { closedAt: null }, select: { id: true } } } });
    if (existing?.revisions.length) throw new ConflictError(`${existing.ref} already has a draft in progress. Finish or withdraw it before generating a new draft.`);
    const base = existing?.currentPublishedVersion ? toSectionInputs(existing.currentPublishedVersion.sections).filter((s) => !s.key.startsWith("branch.")) : baseSections;
    const composed = composeSections(single, { base, mode: "BRANCH_SPECIFIC", branch: b });
    const ai = d.useAi ? await aiPass(single, composed, { title: `${title} – ${b.name}`, mode: "BRANCH_SPECIFIC" }) : { sections: composed, method: "SOURCE_GUIDED" as const, provider: null, notes: [] };
    const baseRef = company?.ref ?? basisPolicy?.ref ?? d.ref!;
    const r = await db.$transaction(async (tx) => {
      let policy = existing;
      if (!policy) {
        let ref = `${baseRef}-${branchSuffix(b.name)}`;
        for (let n = 2; await tx.policy.findFirst({ where: { organisationId, ref } }); n++) ref = `${baseRef}-${branchSuffix(b.name)}${n}`;
        const created = await tx.policy.create({
          data: { kind: "CUSTOMER", organisationId, branchId: b.id, parentPolicyId: company?.id ?? null, templateId: basisPolicy?.kind === "MASTER" ? basisPolicy.id : null, scopeMode: "BRANCH_SPECIFIC", ref, docType: basisPolicy?.docType ?? "POLICY", title: `${title} – ${b.name}`, description: `${b.name} branch version of ${title}${company ? ` (company policy ${company.ref})` : ""}.`, categoryCode, serviceTypes: basisPolicy?.serviceTypes ?? [], ownerId: ctx.userId, reviewIntervalMonths: basisPolicy?.reviewIntervalMonths ?? 12 },
        });
        await audit({ organisationId, actorId: ctx.userId, action: "policy.created", entityType: "Policy", entityId: created.id, data: { by: "policy-generator", branchId: b.id, parentPolicyId: company?.id ?? null } }, tx);
        policy = { ...created, currentPublishedVersion: null, revisions: [] };
      }
      return persistRun(tx, ctx, { organisationId, policy, base: { versionId: existing?.currentPublishedVersion?.id ?? null }, sections: ai.sections, a: single, mode: "BRANCH_SPECIFIC", branchIds: [b.id], basis: d.basis, basisPolicyId: basisPolicy?.id ?? null, method: ai.method, provider: ai.provider, notes: ai.notes, branchesForGaps: [b] });
    });
    results.push(r);
  }
  return results;
}

// ── Gaps and publication checks ──

/** Records how a gap was resolved (or re-checks it against the branch's current configuration). */
export async function resolveGap(ctx: Ctx, gapId: string, resolution: string) {
  const organisationId = requireOrgPermission(ctx, "policy.author");
  if (resolution.trim().length < 10) throw new ValidationError("Say how the gap was resolved (which official source was checked and what was added)");
  const gap = await db.policySourceGap.findFirst({ where: { id: gapId, organisationId } });
  if (!gap) throw new NotFoundError("Gap");
  if (gap.resolvedAt) throw new ConflictError("This gap is already resolved");
  await db.$transaction(async (tx) => {
    const { count } = await tx.policySourceGap.updateMany({ where: { id: gap.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: resolution.trim() } });
    if (!count) throw new ConflictError("This gap is already resolved");
    await audit({ organisationId, actorId: ctx.userId, action: "policy.gap_resolved", entityType: "PolicySourceGap", entityId: gap.id, data: { policyId: gap.policyId, kind: gap.kind, resolution: resolution.trim() } }, tx);
  });
}

/**
 * Re-checks a run's open gaps against the branches' current configuration and sources: a gap that no longer applies
 * (for example the contacts have since been recorded and confirmed) is closed with that reason. New gaps are added.
 */
export async function recheckGaps(ctx: Ctx, runId: string) {
  const organisationId = requireOrgPermission(ctx, "policy.author");
  const run = await db.policyGenerationRun.findFirst({ where: { id: runId, organisationId }, include: { policy: true, gaps: true } });
  if (!run) throw new NotFoundError("Generation run");
  const a = await assembleRequirements(ctx, { categoryCode: run.policy.categoryCode, branchIds: run.branchIds, basisPolicyId: run.basisPolicyId });
  const now = [...a.nationalGaps, ...a.branches.flatMap((b) => b.gaps)];
  const sig = (g: { kind: string; branchId: string | null; sourceId: string | null; message: string }) => `${g.kind}|${g.branchId ?? ""}|${g.sourceId ?? ""}|${g.message}`;
  const current = new Set(now.map(sig));
  const open = run.gaps.filter((g) => !g.resolvedAt);
  const known = new Set(run.gaps.map(sig));
  let closed = 0;
  let added = 0;
  await db.$transaction(async (tx) => {
    for (const g of open) {
      if (current.has(sig(g))) continue;
      await tx.policySourceGap.update({ where: { id: g.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: "Re-checked: no longer applies to the branch's current configuration and sources." } });
      closed++;
    }
    for (const g of now.filter((x) => !known.has(sig(x)))) {
      await tx.policySourceGap.create({ data: { organisationId, runId: run.id, policyId: run.policyId, branchId: g.branchId, sourceId: g.sourceId, kind: g.kind, severity: g.severity, message: g.message } });
      added++;
    }
    await audit({ organisationId, actorId: ctx.userId, action: "policy.gaps_rechecked", entityType: "PolicyGenerationRun", entityId: run.id, data: { closed, added } }, tx);
  });
  return { closed, added };
}

export const GOVERNANCE_CHECKS = [
  ["localProcedures", "Local procedures have been checked against the official local sources"],
  ["contacts", "Contact information is correct and was taken from the official sources"],
  ["sources", "The relevant official sources are verified and current"],
  ["branches", "The policy applies to the branches selected"],
  ["criticalGaps", "Outstanding critical source gaps have been resolved"],
] as const;
export type GovernanceKey = (typeof GOVERNANCE_CHECKS)[number][0];

/**
 * Called by publication for every revision. A generated draft may only be published when every pre-publication
 * confirmation is given, no critical gap is open and no "[REVIEW REQUIRED" marker is left in the text.
 */
export async function generatedPublicationCheck(revisionId: string, draftVersionId: string, confirmations: Partial<Record<GovernanceKey, boolean>> | undefined, actorId: string) {
  const run = await db.policyGenerationRun.findUnique({ where: { revisionId }, include: { gaps: { where: { resolvedAt: null, severity: "CRITICAL" } } } });
  if (!run) return null;
  const missing = GOVERNANCE_CHECKS.filter(([k]) => !confirmations?.[k]);
  if (missing.length) throw new ValidationError(`Before publishing this generated policy, confirm: ${missing.map(([, l]) => l.toLowerCase()).join("; ")}.`);
  if (run.gaps.length) throw new ConflictError(`${run.gaps.length} critical source gap(s) are still open. Resolve them on the draft before publishing.`);
  const marked = await db.policySection.findMany({ where: { versionId: draftVersionId, body: { contains: REVIEW_MARKER } }, select: { heading: true } });
  if (marked.length) throw new ConflictError(`These sections still contain "${REVIEW_MARKER}" text: ${marked.map((m) => m.heading).join(", ")}. Complete them (a new draft round is needed) before publishing.`);
  return { runId: run.id, confirmedBy: actorId, confirmedAt: new Date().toISOString(), checks: Object.fromEntries(GOVERNANCE_CHECKS.map(([k, l]) => [k, l])) };
}

/**
 * On publication of a generated branch policy or shared policy with appendices: everyone who works in each branch it
 * applies to is asked to read it (a WORKS_IN_BRANCH rule per branch, created once, owned by the publisher). Staff who
 * work across branches are covered by each branch they work in, once. Nothing is acknowledged on anyone's behalf.
 */
export async function ensureBranchAssignmentRules(tx: Tx, revisionId: string, actorId: string) {
  const run = await tx.policyGenerationRun.findUnique({ where: { revisionId }, include: { policy: { include: { branchScopes: true } } } });
  if (!run || run.mode === "NATIONAL") return 0;
  let created = 0;
  for (const scope of run.policy.branchScopes) {
    const exists = await tx.policyAssignmentRule.findFirst({ where: { organisationId: run.organisationId, policyId: run.policyId, scope: "WORKS_IN_BRANCH", branchId: scope.branchId, withdrawnAt: null } });
    if (exists) continue;
    const rule = await tx.policyAssignmentRule.create({ data: { organisationId: run.organisationId, policyId: run.policyId, scope: "WORKS_IN_BRANCH", branchId: scope.branchId, mandatory: true, priority: run.policy.categoryCode === "SAFEGUARDING" ? 1 : 2, dueDays: 14, ownerId: actorId, createdById: actorId } });
    await audit({ organisationId: run.organisationId, actorId, action: "policy.assignment.created", entityType: "PolicyAssignmentRule", entityId: rule.id, data: { policyId: run.policyId, scope: "WORKS_IN_BRANCH", branchId: scope.branchId, by: "branch-policy-publication" } }, tx);
    created++;
  }
  return created;
}

/** The generator's record for a revision page: the run, its sources, gaps and branch scope. */
export async function generationForRevision(ctx: Ctx, revisionId: string) {
  if (!ctx.organisationId) return null;
  const run = await db.policyGenerationRun.findFirst({ where: { revisionId, organisationId: ctx.organisationId }, include: { gaps: { orderBy: [{ resolvedAt: "asc" }, { severity: "asc" }, { createdAt: "asc" }] } } });
  if (!run) return null;
  const branches = await db.branch.findMany({ where: { id: { in: run.branchIds }, organisationId: ctx.organisationId }, select: { id: true, name: true } });
  return { run, snapshot: run.sourceSnapshot as unknown as { national: AssembledSource[]; requirements: Assembly["requirements"]; branches: { id: string; name: string; localAuthority: string | null; region: string | null; regional: AssembledSource[]; local: AssembledSource[] }[]; notes: string[] }, branches };
}

export async function recentRuns(ctx: Ctx, take = 15) {
  if (!ctx.organisationId) return [];
  const runs = await db.policyGenerationRun.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { createdAt: "desc" }, take, include: { policy: { select: { id: true, ref: true, title: true } }, gaps: { select: { severity: true, resolvedAt: true } } } });
  const revs = await db.policyRevision.findMany({ where: { id: { in: runs.map((r) => r.revisionId).filter((x): x is string => !!x) } }, include: { draftVersion: { select: { status: true } } } });
  const status = new Map(revs.map((r) => [r.id, r.draftVersion.status]));
  const branches = new Map((await db.branch.findMany({ where: { organisationId: ctx.organisationId }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  return runs.map((r) => ({ ...r, status: r.revisionId ? status.get(r.revisionId) ?? null : null, branchNames: r.branchIds.map((id) => branches.get(id) ?? "?"), openCritical: r.gaps.filter((g) => !g.resolvedAt && g.severity === "CRITICAL").length }));
}

import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { Ctx } from "../auth/rbac";
import { getPolicy } from "../policies/library";
import { businessDetails } from "../business";
import { fillTags, personaliseSections } from "@/lib/business";
import { DOC_TYPES } from "../../../prisma/seed-data/library/types";

/** One paragraph-level block of a section body. */
export type Block =
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; n: string; text: string }
  | { kind: "local"; text: string };

export interface DocSection {
  number: number;
  heading: string;
  isLocal: boolean;
  blocks: Block[];
}

/** Everything a branded CSB export needs, independent of output format. */
export interface DocModel {
  ref: string;
  title: string;
  typeLabel: string;
  description: string;
  category: string;
  organisation: string | null;
  isTemplate: boolean;
  version: string;
  status: string;
  publishedAt: Date | null;
  effectiveDate: Date | null;
  approvedAt: Date | null;
  approvedBy: string;
  /** "Approved" only when the published version carries an organisation approval decision, as in the inspector. */
  approval: string;
  owner: string;
  nextReviewDate: Date | null;
  reviewIntervalMonths: number;
  appliesTo: string;
  history: { version: string; status: string; date: Date | null; summary: string }[];
  requirements: { ref: string; reference: string; title: string; type: string }[];
  sections: DocSection[];
  generatedAt: Date;
  generatedBy: string;
}

const SERVICE_LABELS: Record<string, string> = {
  RESIDENTIAL: "Residential care homes",
  NURSING: "Care homes with nursing",
  DOMICILIARY: "Domiciliary care",
  SUPPORTED_LIVING: "Supported living",
};

const LEGAL_LABELS: Record<string, string> = {
  LEGISLATION: "Legislation",
  STATUTORY_GUIDANCE: "Statutory guidance",
  REGULATOR_GUIDANCE: "Regulator guidance",
  ADVISORY_GUIDANCE: "Advisory guidance",
  BEST_PRACTICE: "Best practice",
};

/** Splits a plain-text section body into paragraphs, bullets and numbered items. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^[•\-*]\s+(.*)$/))) blocks.push({ kind: "bullet", text: m[1] });
    else if ((m = line.match(/^(\d+[.)])\s+(.*)$/))) blocks.push({ kind: "numbered", n: m[1], text: m[2] });
    else if (line.startsWith("[Complete locally]")) blocks.push({ kind: "local", text: line.replace(/^\[Complete locally\]\s*/, "") });
    else blocks.push({ kind: "para", text: line });
  }
  return blocks;
}

const humanise = (s: string) => s.charAt(0) + s.slice(1).replace(/_/g, " ").toLowerCase();

export async function buildDocModel(ctx: Ctx, policyId: string): Promise<DocModel> {
  const p = await getPolicy(ctx, policyId);
  const v = p.currentPublishedVersion;
  if (!v) throw new NotFoundError("Published version");
  const published = p.versions.find((x) => x.id === v.id)!;
  const approverIds = published.approvals.filter((a) => a.decision === "APPROVE").map((a) => a.deciderId);
  const [people, org, links] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...approverIds, ...(p.ownerId ? [p.ownerId] : [])] } }, select: { id: true, name: true } }),
    p.organisationId ? db.organisation.findUnique({ where: { id: p.organisationId } }) : null,
    p.requirementLinks.length || !p.templateId
      ? p.requirementLinks
      : db.requirementPolicyLink.findMany({ where: { policyId: p.templateId }, include: { requirement: true } }),
  ]);
  const name = new Map(people.map((u) => [u.id, u.name]));
  // Organisation copies are filled in with the business details from Settings; CSB templates stay generic.
  const details = p.organisationId ? await businessDetails(p.organisationId) : null;
  const sections = details ? personaliseSections(v.sections, p.docType).map((s) => ({ ...s, body: fillTags(s.body, details) })) : v.sections;
  const seen = new Set<string>();
  const requirements = links
    .map((l) => l.requirement)
    .filter((r) => !r.isSimulated && !seen.has(r.ref) && seen.add(r.ref))
    .sort((a, b) => a.ref.localeCompare(b.ref))
    .map((r) => ({ ref: r.ref, reference: r.exactReference, title: r.title, type: r.ref.startsWith("CQC-QS-") ? "CQC quality statement" : (LEGAL_LABELS[r.legalStatus] ?? humanise(r.legalStatus)) }));
  return {
    ref: p.ref,
    title: p.title,
    typeLabel: new Map<string, string>(DOC_TYPES).get(p.docType) ?? humanise(p.docType),
    description: p.description,
    category: p.category.name,
    organisation: details?.company_name || (org?.name ?? null),
    isTemplate: p.kind === "MASTER",
    version: v.label.replace(/^v/i, ""),
    status: humanise(v.status),
    publishedAt: v.publishedAt,
    effectiveDate: v.effectiveDate,
    approvedAt: v.approvedAt,
    approval: approverIds.length ? "Approved" : v.origin === "SEED" ? "Not yet approved (starter content)" : "Not yet approved",
    approvedBy: approverIds.map((id) => name.get(id)).filter(Boolean).join(", ") || "—",
    owner: (p.ownerId && name.get(p.ownerId)) || (p.kind === "MASTER" ? "CSB Content Team" : "Registered Manager"),
    nextReviewDate: p.nextReviewDate,
    reviewIntervalMonths: p.reviewIntervalMonths,
    appliesTo: p.serviceTypes.map((s) => SERVICE_LABELS[s] ?? humanise(s)).join(", ") || "All services",
    history: p.versions
      .filter((x) => ["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(x.status))
      .map((x) => ({ version: x.label.replace(/^v/i, ""), status: humanise(x.status), date: x.publishedAt, summary: x.changeSummary ?? x.reasonForChange ?? "" })),
    requirements,
    sections: sections.map((s, i) => ({ number: i + 1, heading: s.heading, isLocal: s.isLocal, blocks: parseBody(s.body) })),
    generatedAt: new Date(),
    generatedBy: ctx.userName,
  };
}

export function fmtDocDate(d: Date | null | undefined) {
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "—";
}

export function fileName(m: DocModel, ext: string) {
  return `${m.ref} ${m.title} v${m.version}`.replace(/[^\w .()-]+/g, "").replace(/\s+/g, " ").trim() + `.${ext}`;
}

import type { PolicySection, PolicyVersion, Prisma, VersionOrigin } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { sha256, stableStringify } from "@/lib/text";
import { wordDiff, type WordDiffPart } from "../changes/diff";

export interface SectionInput {
  key: string;
  heading: string;
  body: string;
  isLocal?: boolean;
  masterKey?: string | null;
}

export function sectionsHash(sections: SectionInput[]): string {
  return sha256(stableStringify(sections.map((s) => ({ k: s.key, h: s.heading, b: s.body, l: Boolean(s.isLocal) }))));
}

/** Creates a new DRAFT version. History is append-only: existing versions are never modified. */
export async function createDraftVersion(
  tx: Tx,
  args: {
    policyId: string;
    organisationId: string | null;
    sections: SectionInput[];
    origin: VersionOrigin;
    createdById?: string | null;
    previousVersionId?: string | null;
    basedOnMasterVersionId?: string | null;
    changeSummary?: string;
    reasonForChange?: string;
    isSimulated?: boolean;
  },
): Promise<PolicyVersion> {
  const max = await tx.policyVersion.aggregate({ where: { policyId: args.policyId }, _max: { versionNumber: true } });
  const versionNumber = (max._max.versionNumber ?? 0) + 1;
  return tx.policyVersion.create({
    data: {
      policyId: args.policyId,
      organisationId: args.organisationId,
      versionNumber,
      label: `v${versionNumber}`,
      origin: args.origin,
      status: "DRAFT",
      createdById: args.createdById ?? null,
      previousVersionId: args.previousVersionId ?? null,
      basedOnMasterVersionId: args.basedOnMasterVersionId ?? null,
      changeSummary: args.changeSummary,
      reasonForChange: args.reasonForChange,
      contentHash: sectionsHash(args.sections),
      isSimulated: args.isSimulated ?? false,
      sections: {
        create: args.sections.map((s, i) => ({ key: s.key, heading: s.heading, body: s.body, position: i, isLocal: Boolean(s.isLocal), masterKey: s.masterKey ?? null })),
      },
    },
  });
}

export function toSectionInputs(sections: PolicySection[]): SectionInput[] {
  return [...sections].sort((a, b) => a.position - b.position).map((s) => ({ key: s.key, heading: s.heading, body: s.body, isLocal: s.isLocal, masterKey: s.masterKey }));
}

export interface SectionDiff {
  key: string;
  heading: string;
  previousHeading?: string;
  status: "unchanged" | "modified" | "added" | "removed";
  isLocal: boolean;
  parts: WordDiffPart[];
  before: string;
  after: string;
}

export function diffPolicySections(base: SectionInput[], draft: SectionInput[]): SectionDiff[] {
  const baseMap = new Map(base.map((s) => [s.key, s]));
  const draftKeys = new Set(draft.map((s) => s.key));
  const out: SectionDiff[] = [];
  for (const s of draft) {
    const b = baseMap.get(s.key);
    if (!b) out.push({ key: s.key, heading: s.heading, status: "added", isLocal: Boolean(s.isLocal), parts: [{ value: s.body, added: true }], before: "", after: s.body });
    else if (b.body === s.body && b.heading === s.heading) out.push({ key: s.key, heading: s.heading, status: "unchanged", isLocal: Boolean(s.isLocal), parts: [{ value: s.body }], before: b.body, after: s.body });
    else
      out.push({
        key: s.key,
        heading: s.heading,
        previousHeading: b.heading !== s.heading ? b.heading : undefined,
        status: "modified",
        isLocal: Boolean(s.isLocal),
        parts: wordDiff(b.body, s.body),
        before: b.body,
        after: s.body,
      });
  }
  for (const b of base) if (!draftKeys.has(b.key)) out.push({ key: b.key, heading: b.heading, status: "removed", isLocal: Boolean(b.isLocal), parts: [{ value: b.body, removed: true }], before: b.body, after: "" });
  return out;
}

export async function loadVersionSections(versionId: string): Promise<SectionInput[]> {
  const v = await db.policyVersion.findUniqueOrThrow({ where: { id: versionId }, include: { sections: true } });
  return toSectionInputs(v.sections);
}

export async function versionDiff(baseVersionId: string | null, draftVersionId: string) {
  const draft = await loadVersionSections(draftVersionId);
  const base = baseVersionId ? await loadVersionSections(baseVersionId) : [];
  return diffPolicySections(base, draft);
}

export type JsonValue = Prisma.InputJsonValue;

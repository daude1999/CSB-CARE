import type { ChangeStatus, Prisma, RegulatorySource, SourceDocument, SourceVersion } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { Section } from "../sources/extract";
import { classifyChanges, suggestCategories, suggestServiceTypes } from "./classify";
import { diffSections, type SectionChange } from "./diff";

export function summariseChanges(changes: SectionChange[]): string {
  if (!changes.length) return "No content changes.";
  const parts = changes.slice(0, 6).map((c) => {
    if (c.kind === "added") return `section "${c.heading}" added`;
    if (c.kind === "removed") return `section "${c.heading}" removed`;
    return `"${c.heading}" modified (+${c.addedSentences.length}/−${c.removedSentences.length} sentences${c.editorialOnly ? ", formatting only" : ""})`;
  });
  const more = changes.length > 6 ? `, and ${changes.length - 6} more` : "";
  return `${changes.length} section change(s): ${parts.join("; ")}${more}.`;
}

const STATUS_FOR: Record<string, ChangeStatus> = {
  POTENTIALLY_SUBSTANTIVE: "POTENTIALLY_SUBSTANTIVE",
  EDITORIAL: "EDITORIAL_OR_IMMATERIAL",
  UNCERTAIN: "AWAITING_CLASSIFICATION",
  NEW_DOCUMENT: "AWAITING_CLASSIFICATION",
};

/**
 * Records a detected change between two immutable source versions.
 * Idempotent: a change is unique per new source version.
 */
export async function recordChange(
  tx: Tx,
  args: { source: RegulatorySource; document: SourceDocument; previous: SourceVersion | null; next: SourceVersion },
) {
  const existing = await tx.regulatoryChange.findUnique({ where: { newVersionId: args.next.id } });
  if (existing) return existing;
  const prevSections = (args.previous?.sections ?? []) as unknown as Section[];
  const nextSections = args.next.sections as unknown as Section[];
  const changes = diffSections(prevSections, nextSections);
  const meta = args.next.metadata as { latestChangeNote?: { note: string; public_timestamp: string } | null };
  const prevMeta = (args.previous?.metadata ?? {}) as typeof meta;
  const newNote = meta.latestChangeNote && meta.latestChangeNote.public_timestamp !== prevMeta.latestChangeNote?.public_timestamp ? meta.latestChangeNote.note : null;
  const c = classifyChanges(changes, { isNewDocument: !args.previous, publisherChangeNote: newNote });
  const changedText = changes.flatMap((x) => [...x.addedSentences, ...x.removedSentences, x.heading]).join(" ");
  const status = STATUS_FOR[c.classification]!;
  const change = await tx.regulatoryChange.create({
    data: {
      sourceId: args.source.id,
      documentId: args.document.id,
      previousVersionId: args.previous?.id ?? null,
      newVersionId: args.next.id,
      canonicalUrl: args.document.url,
      title: args.document.title,
      retrievedAt: args.next.retrievedAt,
      officialDate: args.next.modifiedAt ?? args.next.publishedAt,
      classification: c.classification,
      classificationBasis: "rules",
      status,
      changedSections: changes as unknown as Prisma.InputJsonValue,
      summary: summariseChanges(changes),
      suggestedUrgency: c.urgency,
      affectedCategories: suggestCategories(changedText),
      affectedServiceTypes: suggestServiceTypes(changedText, args.source.serviceTypes),
      uncertainty: c.reasons.join(" "),
      isSimulated: args.source.isSimulated || args.next.isSimulated,
      events: {
        create: [
          { to: "NEWLY_DETECTED", reason: "Content hash differs from the previous stored version" },
          { from: "NEWLY_DETECTED", to: status, reason: `Rule-based classification: ${c.classification}. ${c.reasons.join(" ")}` },
        ],
      },
    },
  });
  return change;
}

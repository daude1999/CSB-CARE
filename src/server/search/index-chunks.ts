import type { LegalStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Section } from "../sources/extract";

const MAX_CHUNK = 1800;

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let buf = "";
  for (const para of text.split(/\n+/)) {
    if ((buf + para).length > MAX_CHUNK && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += `${para}\n`;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Indexes a source version for retrieval; older versions of the document stay stored but are marked non-current. */
export async function indexSourceVersion(sourceVersionId: string) {
  const v = await db.sourceVersion.findUniqueOrThrow({ where: { id: sourceVersionId }, include: { document: true } });
  const sections = v.sections as unknown as Section[];
  await db.$transaction([
    db.documentChunk.updateMany({ where: { kind: "SOURCE", sourceVersion: { documentId: v.documentId }, isCurrent: true }, data: { isCurrent: false } }),
    db.documentChunk.deleteMany({ where: { sourceVersionId } }),
    db.documentChunk.createMany({
      data: sections.flatMap((s) =>
        splitLong(s.text).map((text, i) => ({
          organisationId: null,
          kind: "SOURCE",
          sourceVersionId,
          sectionRef: i ? `${s.ref}#${i + 1}` : s.ref,
          heading: `${v.document.title} — ${s.heading}`,
          text,
          legalStatus: v.document.legalStatus as LegalStatus,
          isCurrent: true,
        })),
      ),
    }),
  ]);
}

/** Indexes a published policy version. Customer policy chunks carry their organisationId for tenant isolation. */
export async function indexPolicyVersion(policyVersionId: string) {
  const v = await db.policyVersion.findUniqueOrThrow({ where: { id: policyVersionId }, include: { sections: { orderBy: { position: "asc" } }, policy: true } });
  await db.$transaction([
    db.documentChunk.updateMany({ where: { kind: "POLICY", policyId: v.policyId, isCurrent: true }, data: { isCurrent: false } }),
    db.documentChunk.deleteMany({ where: { policyVersionId } }),
    db.documentChunk.createMany({
      data: v.sections.flatMap((s) =>
        splitLong(s.body).map((text, i) => ({
          organisationId: v.policy.organisationId,
          kind: "POLICY",
          policyVersionId,
          policyId: v.policyId,
          sectionRef: i ? `${s.key}#${i + 1}` : s.key,
          heading: `${v.policy.ref} ${v.policy.title} — ${s.heading}`,
          text,
          legalStatus: "INTERNAL_POLICY" as LegalStatus,
          isCurrent: true,
        })),
      ),
    }),
  ]);
}

export interface ChunkHit {
  id: string;
  kind: string;
  organisationId: string | null;
  sourceVersionId: string | null;
  policyVersionId: string | null;
  policyId: string | null;
  sectionRef: string;
  heading: string;
  text: string;
  legalStatus: LegalStatus;
  rank: number;
}

/**
 * Tenant-safe full-text search: only shared content (organisationId IS NULL) and
 * the caller's own organisation are ever returned.
 */
export async function searchChunks(query: string, opts: { organisationId: string | null; kind?: "SOURCE" | "POLICY"; limit?: number; currentOnly?: boolean }): Promise<ChunkHit[]> {
  const q = query.trim().slice(0, 500);
  if (!q) return [];
  const limit = Math.min(opts.limit ?? 8, 50);
  const kind = opts.kind ?? null;
  const currentOnly = opts.currentOnly ?? true;
  return db.$queryRaw<ChunkHit[]>`
    SELECT id, kind, "organisationId", "sourceVersionId", "policyVersionId", "policyId", "sectionRef", heading, text, "legalStatus",
           ts_rank_cd(search_vector, query) AS rank
    FROM "DocumentChunk", websearch_to_tsquery('english', ${q}) query
    WHERE search_vector @@ query
      AND ("organisationId" IS NULL OR "organisationId" = ${opts.organisationId})
      AND (${kind}::text IS NULL OR kind = ${kind})
      AND (${currentOnly} = false OR "isCurrent" = true)
    ORDER BY rank DESC
    LIMIT ${limit}`;
}

/** OR-query builder from free text: keeps distinctive words so changed sentences can find related policy text. */
export function keywordQuery(text: string, max = 12): string {
  const STOP = new Set("the and for that with this from have will must should shall into been were their there which when what your about other also more than such only them they these those then within under over each any all may can not are was its has had our you who how where".split(" "));
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
    .join(" OR ");
}

import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { MAX_UPLOAD_BYTES, storeEvidenceFile } from "../compliance/evidence";
import { sniffContentType } from "../sources/extract";
import { createDraftVersion, type SectionInput } from "./versions";

/**
 * Upload policy (owner's brief of 3 Nov 2026): an organisation's existing Word or PDF policies come into the library as
 * drafts. Each upload becomes a new policy at Draft v1 with an open revision, so it goes through the same review,
 * approval and publication as any other change; nothing is approved or published automatically. The original file is
 * kept as private evidence linked to the policy and is only ever served after a permission check. Text is taken from
 * Word files when asked, for the author to check and correct in the draft before anyone reviews it.
 */

export const IMPORT_MAX_FILES = 10;
export const IMPORT_MAX_BYTES = MAX_UPLOAD_BYTES;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const Options = z.object({
  categoryCode: z.string().regex(/^[A-Z_]{2,40}$/, "Choose a category"),
  ownerId: z.string().regex(/^[a-z0-9]{8,40}$/i, "Choose a policy owner"),
  duplicateCheck: z.boolean(),
  extractText: z.boolean(),
});
export type ImportOptions = z.infer<typeof Options>;
export interface ImportFile { name: string; type: string; bytes: Buffer }
export interface ImportResult {
  created: { id: string; ref: string; title: string; revisionId: string; extracted: boolean }[];
  skipped: { name: string; reason: string }[];
}

/** "Medication_policy v3.docx" → "Medication policy v3". */
export function titleFromFilename(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Imported policy").slice(0, 160);
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const plain = (html: string) => decode(html.replace(/<\/(p|li|tr|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
const keyOf = (heading: string, i: number) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `section-${i + 1}`;

/**
 * Splits a Word document into sections at its headings (Heading 1 and 2 styles). A document without heading styles
 * becomes one section. Sections whose heading mentions local arrangements or contacts are marked as the provider's own.
 */
export function sectionsFromHtml(html: string): SectionInput[] {
  const out: { heading: string; body: string }[] = [];
  for (const part of html.split(/(?=<h[12][^>]*>)/i)) {
    const m = /^<h[12][^>]*>([\s\S]*?)<\/h[12]>([\s\S]*)$/i.exec(part);
    if (m) {
      const heading = plain(m[1]!).slice(0, 200);
      const body = plain(m[2]!);
      if (heading || body) out.push({ heading: heading || "Untitled section", body: body || "(no text under this heading)" });
    } else {
      const body = plain(part);
      if (body) out.push({ heading: "Imported text", body });
    }
  }
  const seen = new Map<string, number>();
  return out.map((s, i) => {
    const k = keyOf(s.heading, i);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { key: n > 1 ? `${k}-${n}` : k, heading: s.heading, body: s.body, isLocal: /local|contact/i.test(s.heading) };
  });
}

function placeholder(name: string, kind: "pdf" | "docx"): SectionInput[] {
  return [{
    key: "imported-document",
    heading: "Imported document",
    body: `The original ${kind === "pdf" ? "PDF" : "Word"} file "${name}" is kept with this policy as evidence. ${kind === "pdf" ? "Text is not taken from PDF files." : "Text was not extracted, as chosen at upload."} Write or paste the policy text here and check it before sending the draft for review.`,
  }];
}

/** The next free IMP-nnn reference in the organisation. */
async function nextRefs(orgId: string, n: number) {
  const used = await db.policy.findMany({ where: { organisationId: orgId, ref: { startsWith: "IMP-" } }, select: { ref: true } });
  let max = used.reduce((m, p) => Math.max(m, Number(/^IMP-(\d+)$/.exec(p.ref)?.[1] ?? 0)), 0);
  return Array.from({ length: n }, () => `IMP-${String(++max).padStart(3, "0")}`);
}

export async function importPolicies(ctx: Ctx, files: ImportFile[], input: ImportOptions, now = new Date()): Promise<ImportResult> {
  const orgId = requireOrgPermission(ctx, "policy.author");
  const opts = Options.parse(input);
  if (!files.length) throw new ValidationError("Choose at least one .docx or .pdf file");
  if (files.length > IMPORT_MAX_FILES) throw new ValidationError(`Upload up to ${IMPORT_MAX_FILES} files at a time`);
  const [category, owner] = await Promise.all([
    db.policyCategory.findUnique({ where: { code: opts.categoryCode } }),
    // The owner must be a member of the caller's own organisation.
    db.membership.findFirst({ where: { organisationId: orgId, userId: opts.ownerId }, select: { userId: true } }),
  ]);
  if (!category) throw new ValidationError("Choose a category");
  if (!owner) throw new ValidationError("Choose a policy owner from your organisation");

  const existing = opts.duplicateCheck ? new Set((await db.policy.findMany({ where: { organisationId: orgId }, select: { title: true } })).map((p) => p.title.trim().toLowerCase())) : new Set<string>();
  const result: ImportResult = { created: [], skipped: [] };
  const accepted: { file: ImportFile; kind: "pdf" | "docx"; title: string }[] = [];
  for (const file of files) {
    const kind = sniffContentType(file.bytes, file.type);
    const title = titleFromFilename(file.name);
    if (!file.bytes.length) result.skipped.push({ name: file.name, reason: "the file is empty" });
    else if (file.bytes.length > IMPORT_MAX_BYTES) result.skipped.push({ name: file.name, reason: `it is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB` });
    else if (!(kind === "pdf" && file.type === "application/pdf") && !(kind === "docx" && file.type === DOCX)) result.skipped.push({ name: file.name, reason: "only .docx and .pdf files can be uploaded" });
    else if (existing.has(title.toLowerCase())) result.skipped.push({ name: file.name, reason: `a policy called "${title}" is already in your library` });
    else {
      existing.add(title.toLowerCase());
      accepted.push({ file, kind, title });
    }
  }
  const refs = await nextRefs(orgId, accepted.length);

  for (const [i, a] of accepted.entries()) {
    let sections = placeholder(a.file.name, a.kind);
    let extracted = false;
    if (a.kind === "docx" && opts.extractText) {
      try {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.convertToHtml({ buffer: a.file.bytes });
        const found = sectionsFromHtml(value);
        if (found.length) {
          sections = found;
          extracted = true;
        }
      } catch {
        // An unreadable Word file still comes in, with the placeholder section, so its original is kept.
      }
    }
    // The original is stored first (checked, virus-scanned where configured), so a policy never points at a missing file.
    const doc = await storeEvidenceFile(orgId, ctx.userId, a.file, { description: `Original uploaded file for ${refs[i]} ${a.title}` }).catch((e: unknown) => {
      result.skipped.push({ name: a.file.name, reason: e instanceof ValidationError ? e.message.replace(/\.$/, "") : "the file could not be stored" });
      return null;
    });
    if (!doc) continue;
    const ref = refs[i]!;
    const created = await db.$transaction(async (tx) => {
      if (await tx.policy.findFirst({ where: { organisationId: orgId, ref }, select: { id: true } })) throw new ConflictError("Another upload took the same reference. Try again.");
      const policy = await tx.policy.create({
        data: { kind: "CUSTOMER", organisationId: orgId, ref, title: a.title, description: `Uploaded from ${a.file.name.slice(0, 120)} on ${now.toISOString().slice(0, 10)}. Check the text before review.`, categoryCode: category.code, serviceTypes: [], ownerId: owner.userId, reviewIntervalMonths: 12 },
      });
      const draft = await createDraftVersion(tx, { policyId: policy.id, organisationId: orgId, sections, origin: "MANUAL", createdById: ctx.userId, reasonForChange: `Uploaded from ${a.file.name.slice(0, 120)}`, changeSummary: extracted ? "First version, text taken from the uploaded Word file" : "First version, uploaded file kept as the original" });
      const rev = await tx.policyRevision.create({ data: { policyId: policy.id, organisationId: orgId, kind: "MANUAL", draftVersionId: draft.id, title: `Uploaded policy ${ref}`, createdById: ctx.userId, authorId: ctx.userId } });
      await tx.evidenceDocument.update({ where: { id: doc.id }, data: { linkedType: "POLICY", linkedId: policy.id } });
      await audit({ organisationId: orgId, actorId: ctx.userId, action: "policy.uploaded", entityType: "Policy", entityId: policy.id, data: { filename: doc.filename, evidenceId: doc.id, textExtracted: extracted, sections: sections.length } }, tx);
      return { id: policy.id, ref, title: a.title, revisionId: rev.id, extracted };
    });
    result.created.push(created);
  }
  return result;
}

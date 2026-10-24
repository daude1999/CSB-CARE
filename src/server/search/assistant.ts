import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { textContains } from "@/lib/text";
import { getAiProvider } from "../ai";
import { requireOrgPermission, type Ctx } from "../auth/rbac";
import { searchChunks, type ChunkHit } from "./index-chunks";

export interface AssistantResult {
  answer: string;
  provider: string;
  simulated: boolean;
  citations: { chunkId: string; quote: string; verified: boolean; heading: string; legalStatus: string; kind: string; link: string; versionLabel: string }[];
  evidenceGaps: string[];
  facts: string[];
  aiUnavailable: boolean;
}

/** Structured facts from the database for common questions (respecting tenant scope). */
async function factsFor(ctx: Ctx, question: string): Promise<string[]> {
  const orgId = ctx.organisationId!;
  const q = question.toLowerCase();
  const facts: string[] = [];
  if (/overdue|review(s)? (due|overdue)/.test(q)) {
    const overdue = await db.policy.findMany({ where: { organisationId: orgId, status: "ACTIVE", nextReviewDate: { lt: new Date() } }, select: { ref: true, title: true, nextReviewDate: true } });
    facts.push(overdue.length ? `Overdue policy reviews: ${overdue.map((p) => `${p.ref} ${p.title} (due ${p.nextReviewDate?.toDateString()})`).join("; ")}` : "No policy reviews are overdue.");
  }
  if (/need(s)? updat|flagged|affected|which of our policies/.test(q)) {
    const flagged = await db.changePolicyCandidate.findMany({ where: { organisationId: orgId, change: { status: { notIn: ["CLOSED", "CONFIRMED_NOT_APPLICABLE", "EDITORIAL_OR_IMMATERIAL", "NO_POLICY_REVISION_REQUIRED"] } } }, include: { policy: true, change: true }, distinct: ["policyId", "changeId"] });
    facts.push(flagged.length ? `Policies flagged by open regulatory changes: ${flagged.map((f) => `${f.policy.ref} (change: "${f.change.title}"${f.change.isSimulated ? ", SIMULATED" : ""}; reason: ${f.reason})`).join("; ")}` : "No policies are currently flagged by open regulatory changes.");
    const open = await db.policyRevision.findMany({ where: { organisationId: orgId, closedAt: null }, include: { policy: true, draftVersion: true } });
    if (open.length) facts.push(`Open revisions: ${open.map((r) => `${r.policy.ref} (${r.draftVersion.status})`).join("; ")}`);
  }
  if (/latest|what changed|recent/.test(q)) {
    const recent = await db.regulatoryChange.findMany({ orderBy: { detectedAt: "desc" }, take: 5 });
    facts.push(...recent.map((c) => `Change detected ${c.detectedAt.toDateString()}${c.isSimulated ? " [SIMULATED]" : ""}: "${c.title}" — ${c.summary} Status: ${c.status}.`));
  }
  if (/before .*approv|approval|actions needed/.test(q)) {
    const pending = await db.policyRevision.findMany({ where: { organisationId: orgId, closedAt: null }, include: { policy: true, draftVersion: true, assignments: true } });
    facts.push(...pending.map((r) => `${r.policy.ref}: draft is ${r.draftVersion.status}; ${r.assignments.filter((a) => a.status === "PENDING").length} pending reviewer/approver assignment(s).`));
  }
  return facts;
}

export async function askAssistant(ctx: Ctx, question: string): Promise<AssistantResult> {
  const orgId = requireOrgPermission(ctx, "assistant.use");
  const trimmed = question.trim().slice(0, 1000);
  const facts = await factsFor(ctx, trimmed);
  const hits: ChunkHit[] = await searchChunks(trimmed, { organisationId: orgId, limit: 8 });
  const versionLabels = new Map<string, string>();
  for (const h of hits) {
    if (h.policyVersionId) versionLabels.set(h.id, (await db.policyVersion.findUnique({ where: { id: h.policyVersionId }, select: { label: true } }))?.label ?? "");
    if (h.sourceVersionId) versionLabels.set(h.id, `source v${(await db.sourceVersion.findUnique({ where: { id: h.sourceVersionId }, select: { versionNumber: true } }))?.versionNumber ?? "?"}`);
  }
  const ai = getAiProvider();
  const linkFor = (h: ChunkHit) => (h.kind === "POLICY" ? `/policies/${h.policyId}` : `/sources/versions/${h.sourceVersionId}#${encodeURIComponent(h.sectionRef)}`);
  if (!ai) {
    return {
      answer: "The AI assistant is currently unavailable. Here is the matching material from your policies and monitored sources.",
      provider: "none",
      simulated: false,
      aiUnavailable: true,
      facts,
      evidenceGaps: [],
      citations: hits.map((h) => ({ chunkId: h.id, quote: h.text.slice(0, 240), verified: true, heading: h.heading, legalStatus: h.legalStatus, kind: h.kind, link: linkFor(h), versionLabel: versionLabels.get(h.id) ?? "" })),
    };
  }
  const out = await ai.answer({ question: trimmed, facts, chunks: hits.map((h) => ({ id: h.id, heading: h.heading, text: h.text, legalStatus: h.legalStatus, kind: h.kind })) });
  const byId = new Map(hits.map((h) => [h.id, h]));
  const citations = out.citations.map((c) => {
    const h = byId.get(c.chunkId);
    // Citations must reference a retrieved chunk the user may see and quote it verbatim.
    const verified = Boolean(h && textContains(h.text, c.quote));
    return { chunkId: c.chunkId, quote: c.quote, verified, heading: h?.heading ?? "Unknown (citation not in retrieved material)", legalStatus: h?.legalStatus ?? "UNKNOWN", kind: h?.kind ?? "UNKNOWN", link: h ? linkFor(h) : "#", versionLabel: versionLabels.get(c.chunkId) ?? "" };
  });
  const gaps = [...out.evidenceGaps];
  if (citations.some((c) => !c.verified)) gaps.push("Some citations could not be verified against the retrieved text and should be disregarded.");
  await db.assistantQuery.create({ data: { organisationId: orgId, userId: ctx.userId, question: trimmed, answer: { answer: out.answer, citations, gaps } as unknown as Prisma.InputJsonValue, provider: ai.name } });
  return { answer: out.answer, provider: ai.name, simulated: ai.isSimulated, aiUnavailable: false, citations, evidenceGaps: gaps, facts };
}

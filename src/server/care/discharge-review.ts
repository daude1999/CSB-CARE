import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { fromDbDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";

/**
 * Post-hospital discharge review (AI CSB Coordinator brief, 6 Nov 2026, phase 7).
 *
 * When the Care Coordinator files a hospital discharge letter for a person, a review is opened, linked to the
 * letter. It is a checklist for the office: what the letter says about mobility, personal care, medicines, skin,
 * equipment, follow-up appointments, risks and visits, each closed with "no change", "record updated" or "action
 * needed". It never replaces the council support plan (that changes only through a revised plan and its own
 * approval) and never authorises medication: medicines at discharge are reconciled with the GP or pharmacy first.
 * Words that suggest an urgent issue mark the review urgent and alert managers in-app; nothing is sent outside.
 */

export const DISCHARGE_CATEGORIES = new Set(["HOSPITAL_DISCHARGE", "DISCHARGE_INFORMATION"]);

export const CHECKS = [
  { key: "mobility", label: "Mobility and transfers", sections: ["CARE_PLAN", "RISKS"], words: /mobil|transfer|hoist|walk|frame|stick|bed-?bound|falls?\b/i },
  { key: "personal_care", label: "Personal care and continence", sections: ["CARE_PLAN"], words: /wash|shower|dress|continen|catheter|stoma|toilet/i },
  { key: "medication", label: "Medicines at discharge (reconcile; nothing is authorised from the letter)", sections: ["MEDICATION"], words: /medic|tablet|dose|insulin|anticoag|warfarin|inhaler|stopped|started/i },
  { key: "skin", label: "Skin and pressure areas", sections: ["BODY_MAP"], words: /pressure|ulcer|wound|dressing|skin|sore/i },
  { key: "equipment", label: "Equipment and home adaptations", sections: [], words: /equipment|hoist|commode|bed|rail|wheelchair|frame|oxygen/i },
  { key: "appointments", label: "Follow-up appointments and community services", sections: [], words: /follow[- ]?up|appointment|clinic|district nurse|community nurs|physio|occupational therap/i },
  { key: "risks", label: "Risks to review", sections: ["RISKS", "INCIDENTS"], words: /risk|fall|choking|aspiration|confus|delirium/i },
  { key: "visits", label: "Visit times, length and carers (council package unchanged until the council confirms)", sections: ["VISITS", "PACKAGE"], words: /visit|call|double[- ]up|two carers|package|hours/i },
] as const;
export type CheckKey = (typeof CHECKS)[number]["key"];
export const CHECK_OUTCOMES = { NO_CHANGE: "No change needed", UPDATED: "Record updated", ACTION: "Action needed" } as const;
type CheckOutcome = keyof typeof CHECK_OUTCOMES;
type Check = { key: string; label: string; finding: string | null; outcome: CheckOutcome | null; note: string | null; by: string | null; at: string | null };

/** Words that make a discharge urgent: the review is marked urgent and managers are alerted in-app. */
const URGENT: [RegExp, string][] = [
  [/\b(?:grade|category)\s*[234]\b|pressure (?:ulcer|sore)/i, "Pressure damage mentioned"],
  [/\bDNACPR\b|do not attempt (?:cardiopulmonary )?resuscitation|end of life|palliative/i, "End of life or resuscitation decision mentioned"],
  [/\binsulin\b|anticoagula|warfarin|apixaban|rivaroxaban|controlled drug/i, "High-risk medicine mentioned"],
  [/\boxygen\b/i, "Oxygen mentioned"],
  [/safeguarding|self[- ]neglect|abuse/i, "Safeguarding concern mentioned"],
  [/same day|within 24 hours|urgent|immediately/i, "The letter asks for action urgently"],
];

/** What the letter says, sorted into the checklist, plus urgent reasons. Pure, so it can be tested on its own. */
export function assessDischarge(pages: string[], facts: { section: string; label: string; text: string }[]) {
  const text = pages.join("\n");
  const urgentReasons = URGENT.filter(([re]) => re.test(text) || facts.some((f) => re.test(f.text))).map(([, why]) => why);
  const checks: Check[] = CHECKS.map((c) => {
    const found = facts.filter((f) => (c.sections as readonly string[]).includes(f.section) || c.words.test(f.text)).map((f) => f.label);
    const mentioned = !found.length && c.words.test(text);
    return { key: c.key, label: c.label, finding: found.length ? `Read from the letter: ${[...new Set(found)].slice(0, 6).join("; ")}` : mentioned ? "Mentioned in the letter. Read the original." : null, outcome: null, note: null, by: null, at: null };
  });
  return { urgent: urgentReasons.length > 0, urgentReasons, checks };
}

/** Opens the review for a filed discharge letter (inside the filing transaction). One per intake document. */
export async function openDischargeReview(tx: Prisma.TransactionClient, input: { organisationId: string; serviceUserId: string; serviceUserName: string; intakeId: string; intakeDocumentId: string; documentId: string | null; actorId: string }) {
  const existing = await tx.dischargeReview.findUnique({ where: { intakeDocumentId: input.intakeDocumentId } });
  if (existing) return existing;
  const doc = await tx.careIntakeDocument.findUniqueOrThrow({ where: { id: input.intakeDocumentId }, select: { name: true, documentDate: true, pageText: true } });
  const facts = await tx.careIntakeFact.findMany({ where: { intakeId: input.intakeId, sourceDocumentId: input.intakeDocumentId }, select: { section: true, label: true, value: true, quote: true } });
  const pages = Array.isArray(doc.pageText) ? (doc.pageText as unknown[]).map((p) => (typeof p === "string" ? p : "")) : [];
  const a = assessDischarge(pages, facts.map((f) => ({ section: f.section, label: f.label, text: `${f.label} ${f.quote ?? ""} ${JSON.stringify(f.value)}` })));
  const review = await tx.dischargeReview.create({ data: { organisationId: input.organisationId, serviceUserId: input.serviceUserId, intakeId: input.intakeId, intakeDocumentId: input.intakeDocumentId, documentId: input.documentId, documentName: doc.name.slice(0, 200), dischargeDate: doc.documentDate, urgent: a.urgent, urgentReasons: a.urgentReasons, checks: a.checks as unknown as Prisma.InputJsonValue, createdById: input.actorId } });
  await audit({ organisationId: input.organisationId, actorId: input.actorId, action: "discharge.review.opened", entityType: "ServiceUser", entityId: input.serviceUserId, data: { reviewId: review.id, urgent: a.urgent, intakeId: input.intakeId } }, tx);
  const ms = await tx.membership.findMany({ where: { organisationId: input.organisationId, deactivatedAt: null, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER"] } }, select: { userId: true } });
  const users = [...new Set(ms.map((m) => m.userId))];
  if (users.length) {
    await tx.notification.createMany({
      data: users.map((userId) => ({
        organisationId: input.organisationId, userId,
        type: a.urgent ? "care.discharge.urgent" : "care.discharge.review",
        title: a.urgent ? `Urgent: hospital discharge for ${input.serviceUserName}` : `Hospital discharge review for ${input.serviceUserName}`,
        body: a.urgent ? `${a.urgentReasons.join(". ")}. Review the discharge letter before the next visit. Nothing was changed or authorised automatically.` : "A hospital discharge letter was filed. Work through the discharge review. Nothing was changed or authorised automatically.",
        reason: "You manage care for this organisation.",
        actionUrl: `/rota/service-users/${input.serviceUserId}?tab=overview#discharge`,
        dedupeKey: `discharge:${review.id}:${userId}`,
      })),
      skipDuplicates: true,
    });
  }
  return review;
}

async function inScope(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const r = await db.dischargeReview.findFirst({ where: { id, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
  if (!r) throw new NotFoundError("Discharge review");
  return r;
}

/** A person's discharge reviews, newest first. Discharge letters are restricted, so only managers see them. */
export async function listDischargeReviews(ctx: Ctx, serviceUserId: string) {
  if (!hasOrgPermission(ctx, "serviceUser.sensitive")) return null;
  const scope = await rotaScope(ctx, "serviceUser.view");
  const rows = await db.dischargeReview.findMany({ where: { organisationId: scope.organisationId, serviceUserId, serviceUser: serviceUserWhere(scope) }, orderBy: { createdAt: "desc" }, take: 20 });
  const docs = await db.serviceUserDocument.findMany({ where: { id: { in: rows.flatMap((r) => (r.documentId ? [r.documentId] : [])) }, organisationId: scope.organisationId }, select: { id: true, section: true } });
  return rows.map((r) => ({ ...r, dischargeDate: r.dischargeDate ? fromDbDate(r.dischargeDate) : null, checks: r.checks as unknown as Check[], documentSection: docs.find((d) => d.id === r.documentId)?.section === "OTHER" ? "other" : "council" }));
}

const checkSchema = z.object({ key: z.string().min(1), outcome: z.enum(["NO_CHANGE", "UPDATED", "ACTION"]), note: z.string().trim().max(1000).optional() });

/** Records one check. "Action needed" and every medicines check need a note saying what was done or is needed. */
export async function recordDischargeCheck(ctx: Ctx, id: string, lockVersion: number, input: z.input<typeof checkSchema>) {
  requireOrgPermission(ctx, "serviceUser.sensitive");
  const p = checkSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the answer");
  const r = await inScope(ctx, id);
  if (r.status !== "OPEN") throw new ConflictError("This review is completed");
  if ((p.data.outcome === "ACTION" || p.data.key === "medication") && !p.data.note) throw new ValidationError(p.data.key === "medication" ? "Say how the medicines were reconciled (for example checked with the GP or pharmacy)" : "Say what action is needed");
  const checks = r.checks as unknown as Check[];
  const c = checks.find((x) => x.key === p.data.key);
  if (!c) throw new NotFoundError("Check");
  Object.assign(c, { outcome: p.data.outcome, note: p.data.note ?? null, by: ctx.userId, at: new Date().toISOString() });
  return db.$transaction(async (tx) => {
    const n = await tx.dischargeReview.updateMany({ where: { id: r.id, lockVersion }, data: { checks: checks as unknown as Prisma.InputJsonValue, lockVersion: { increment: 1 } } });
    if (n.count !== 1) throw new ConflictError("Someone else changed this review. Reload the page and try again.");
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "discharge.review.checked", entityType: "ServiceUser", entityId: r.serviceUserId, data: { reviewId: r.id, check: c.key, outcome: c.outcome } }, tx);
  });
}

/** Completes the review once every check has an answer. */
export async function completeDischargeReview(ctx: Ctx, id: string, lockVersion: number, outcome: string) {
  requireOrgPermission(ctx, "serviceUser.sensitive");
  const r = await inScope(ctx, id);
  if (r.status !== "OPEN") throw new ConflictError("This review is already completed");
  const open = (r.checks as unknown as Check[]).filter((c) => !c.outcome);
  if (open.length) throw new ValidationError(`Answer every check first: ${open.map((c) => c.label.split(" (")[0]).join(", ")}`);
  if (outcome.trim().length < 3) throw new ValidationError("Write a short summary of the review");
  if (!hasOrgPermission(ctx, "serviceUser.edit")) throw new ForbiddenError("You cannot complete this review");
  return db.$transaction(async (tx) => {
    const n = await tx.dischargeReview.updateMany({ where: { id: r.id, lockVersion, status: "OPEN" }, data: { status: "COMPLETED", completedById: ctx.userId, completedAt: new Date(), outcome: outcome.trim().slice(0, 2000), lockVersion: { increment: 1 } } });
    if (n.count !== 1) throw new ConflictError("Someone else changed this review. Reload the page and try again.");
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "discharge.review.completed", entityType: "ServiceUser", entityId: r.serviceUserId, data: { reviewId: r.id } }, tx);
  });
}

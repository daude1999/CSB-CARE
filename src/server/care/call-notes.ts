import type { CallNote, Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, parseHhmm } from "@/lib/london";
import {
  DESTINATIONS, DESTINATION_KEYS, KIND_KEYS, METHOD_KEYS, METHOD_TITLE, PRIORITIES, URGENT_KINDS, basicOrganise, findDuplicate, formatReference, isDestination, quoteInText,
  suggestedDecision, urgentOf, verifyProposal, type Candidate, type Destination, type ItemDecision, type Kind, type Method, type Organised, type UrgentKind,
} from "@/lib/call-note-rules";
import { displayValue } from "@/lib/care-coordinator-rules";
import { audit } from "@/server/audit-log";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError } from "@/server/ai/provider";
import { CallNoteOrganisationSchema } from "@/server/ai/schemas";
import { ORG_PERMISSIONS, hasOrgPermission, requireOrgPermission, type Ctx, type OrgPermission } from "@/server/auth/rbac";
import { notify } from "@/server/notifications/notify";
import { memberNames } from "@/server/rota/queries";
import { rotaScope, serviceUserWhere, visitWhere } from "@/server/rota/scope";
import { rotaSettings } from "@/server/rota/settings";
import { visibleWhere as incidentVisibleWhere } from "./incidents";
import { medicationEnabled } from "./medication";

/**
 * Service user Call Notes (4 Nov 2026): RECEIVE → EXTRACT → CLASSIFY → COMPARE → REVIEW → APPROVE → SAVE → LINK.
 *
 *  - A note belongs to one person and is opened only through that person, in the caller's organisation, branches and
 *    areas. Restricted notes (safeguarding, or marked so) open only for their author and people with
 *    serviceUser.sensitive; everyone else is told how many are hidden, never what they say.
 *  - The original text is kept exactly as typed and cannot change once the note is saved (database trigger). Organising
 *    (AI, or the basic organiser on our own server when AI is off) only proposes: every bullet must quote the original,
 *    and the coordinator checks every bullet, its kind and where it belongs before saving.
 *  - Information that belongs in a structured record is never written into that record from here. On approval it becomes
 *    an item in the Care Coordinator review queue for that destination (care plan, risks, medication reconciliation,
 *    rota, contacts …), to be done through that record's own workflow and approvals; the note links to it.
 *  - AI-assisted notes, and notes by people who cannot review, wait for a manager who did not write them. A manager's
 *    own typed note (no AI) is recorded as approved. Corrections keep the previous version; nothing is deleted.
 *  - Urgent safeguarding, medication or safety concerns are flagged on the note and in-app to managers at once.
 */

const PAGE_SIZE = 20;
const NOTE_TEXT_MAX = 8000;

export function callNoteAccess(ctx: Ctx) {
  requireOrgPermission(ctx, "callNote.view");
  return {
    record: hasOrgPermission(ctx, "callNote.record"),
    review: hasOrgPermission(ctx, "callNote.review"),
    sensitive: hasOrgPermission(ctx, "serviceUser.sensitive"),
    medication: hasOrgPermission(ctx, "medication.view"),
    incidents: hasOrgPermission(ctx, "incident.report"),
    rota: hasOrgPermission(ctx, "rota.view"),
  };
}
export type CallNoteAccess = ReturnType<typeof callNoteAccess>;

/** The person, only if the caller may see them (organisation, branch and area scope). */
async function personFor(ctx: Ctx, serviceUserId: string, perm: OrgPermission = "callNote.view", tx: Tx | typeof db = db) {
  requireOrgPermission(ctx, perm);
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: serviceUserId }, select: { id: true, organisationId: true, firstName: true, lastName: true, preferredName: true, phone: true, altPhone: true, email: true, addressLine1: true, addressLine2: true, town: true, postcode: true } });
  if (!su) throw new NotFoundError("Service user");
  return su;
}

/** A note the caller may open: same organisation, a person in scope, and restricted only to its author or sensitive. */
async function noteFor(ctx: Ctx, noteId: string, perm: OrgPermission = "callNote.view", tx: Tx | typeof db = db) {
  const access = callNoteAccess(ctx);
  requireOrgPermission(ctx, perm);
  const note = await tx.callNote.findFirst({ where: { id: noteId, organisationId: ctx.organisationId! } });
  if (!note) throw new NotFoundError("Call Note");
  await personFor(ctx, note.serviceUserId, "callNote.view", tx);
  if (note.restricted && !access.sensitive && note.createdById !== ctx.userId) throw new NotFoundError("Call Note");
  return { note, access };
}

async function lockNote(tx: Tx, noteId: string, organisationId: string) {
  await tx.$queryRaw`SELECT id FROM "CallNote" WHERE id = ${noteId} AND "organisationId" = ${organisationId} FOR UPDATE`;
}

/** Never reused: one counter row per organisation and year, incremented in the same transaction as the note. */
export async function nextCallNoteReference(tx: Tx, organisationId: string, year: number) {
  const c = await tx.callNoteReferenceCounter.upsert({ where: { organisationId_year: { organisationId, year } }, create: { organisationId, year, nextNumber: 2 }, update: { nextNumber: { increment: 1 } } });
  return formatReference(year, c.nextNumber - 1);
}

// ── Organising text ────────────────────────────────────────────────────────

export interface OrganiseOutcome { organised: Organised; reader: string; usedAi: boolean }

/**
 * Turns free text into proposed bullet points. AI is used only when the organisation's Care Coordinator AI switch is on
 * and a real provider is configured; otherwise (or if the AI fails) the basic organiser runs on our own server, so the
 * workflow never breaks. Names are never sent: only the text, the method and the relationship.
 */
export async function organiseText(organisationId: string, input: { text: string; method: Method; contactName: string; contactRole: string | null }): Promise<OrganiseOutcome> {
  const settings = await rotaSettings(db, organisationId);
  const provider = getAiProvider();
  const aiAllowed = !!settings.careCoordinatorAiEnabledAt && !!provider?.organiseCallNote && !provider.isSimulated;
  const basic = () => ({ organised: basicOrganise(input), reader: "basic-organiser", usedAi: false });
  if (!aiAllowed) return basic();
  let raw: unknown;
  try {
    raw = await provider!.organiseCallNote!({ text: input.text, method: METHOD_TITLE[input.method], contactRole: input.contactRole });
  } catch (e) {
    if (!(e instanceof AiUnavailableError) && !(e instanceof Error)) throw e;
    return { ...basic(), reader: "basic-organiser (AI unavailable)" };
  }
  const parsed = CallNoteOrganisationSchema.safeParse(raw);
  if (!parsed.success) return { ...basic(), reader: "basic-organiser (AI output not usable)" };
  return { organised: parsed.data as Organised, reader: provider!.name, usedAi: true };
}

// ── Duplicate detection ────────────────────────────────────────────────────

const INTAKE_SECTION_DEST: Record<string, Destination> = { PERSONAL: "PERSONAL", CONTACTS: "CONTACTS", CARER_PREFERENCES: "CARE_PLAN", CARE_PLAN: "CARE_PLAN", RISKS: "RISK", PACKAGE: "ROTA", VISITS: "ROTA", MEDICATION: "MEDICATION", INCIDENTS: "INCIDENT", BODY_MAP: "INCIDENT", CALL_NOTES: "CALL_NOTE" };

/**
 * Existing records about this person the caller may see, for the duplicate check. Each source is read with the
 * caller's own permissions: medication only with medication access, incidents through incident visibility, restricted
 * notes, documents and intake facts only with sensitive access.
 */
export async function duplicateCandidates(ctx: Ctx, serviceUserId: string, excludeNoteId?: string): Promise<Candidate[]> {
  const access = callNoteAccess(ctx);
  const su = await personFor(ctx, serviceUserId);
  const org = su.organisationId;
  const out: Candidate[] = [];
  const [notes, plans, risks, contacts, facts, docs] = await Promise.all([
    db.callNote.findMany({ where: { organisationId: org, serviceUserId, id: excludeNoteId ? { not: excludeNoteId } : undefined, status: { notIn: ["WITHDRAWN", "REJECTED"] }, ...(access.sensitive ? {} : { OR: [{ restricted: false }, { createdById: ctx.userId }] }) }, select: { id: true, reference: true, summary: true, items: { where: { decision: { not: "LEAVE_OUT" } }, select: { text: true } } }, orderBy: { communicationAt: "desc" }, take: 200 }),
    db.carePlan.findMany({ where: { organisationId: org, serviceUserId }, select: { id: true, version: true, status: true, sections: { select: { title: true, body: true } } }, orderBy: { version: "desc" }, take: 10 }),
    db.riskAssessment.findMany({ where: { organisationId: org, serviceUserId, status: { not: "ARCHIVED" } }, select: { id: true, title: true, hazards: true } }),
    db.serviceUserContact.findMany({ where: { organisationId: org, serviceUserId }, select: { id: true, name: true, relationship: true, phone: true, email: true } }),
    db.careIntakeFact.findMany({ where: { organisationId: org, intake: { serviceUserId }, decision: { in: ["APPROVED", "EDITED", "PENDING"] }, ...(access.sensitive ? {} : { section: { notIn: ["MEDICATION", "INCIDENTS", "BODY_MAP"] } }) }, select: { id: true, intakeId: true, section: true, destination: true, label: true, value: true }, take: 300 }),
    db.serviceUserDocument.findMany({ where: { organisationId: org, serviceUserId, archivedAt: null, ...(access.sensitive ? {} : { sensitive: false }) }, select: { id: true, name: true, section: true, notes: true } }),
  ]);
  for (const n of notes) {
    out.push({ ref: `CallNote:${n.id}`, label: `Call Note ${n.reference}`, text: n.summary, destination: "ANY" });
    for (const i of n.items) out.push({ ref: `CallNote:${n.id}`, label: `Call Note ${n.reference}`, text: i.text, destination: "ANY" });
  }
  for (const p of plans) for (const s of p.sections) out.push({ ref: `CarePlan:${p.id}`, label: `Care plan v${p.version} (${p.status.toLowerCase()}): ${s.title}`, text: `${s.title}. ${s.body}`, destination: "CARE_PLAN" });
  for (const r of risks) out.push({ ref: `RiskAssessment:${r.id}`, label: `Risk assessment: ${r.title}`, text: `${r.title}. ${r.hazards}`, destination: "RISK" });
  for (const c of contacts) out.push({ ref: `Contact:${c.id}`, label: `Contact: ${c.name}${c.relationship ? ` (${c.relationship})` : ""}`, text: [c.name, c.relationship, c.phone, c.email].filter(Boolean).join(" "), destination: "CONTACTS" });
  const personal = [su.phone, su.altPhone, su.email, [su.addressLine1, su.addressLine2, su.town, su.postcode].filter(Boolean).join(", ")].filter((x): x is string => !!x);
  for (const p of personal) out.push({ ref: `Person:${su.id}`, label: "Personal details", text: p, destination: "PERSONAL" });
  for (const f of facts) out.push({ ref: `IntakeFact:${f.intakeId}`, label: `Care Coordinator intake: ${f.label}`, text: `${f.label}. ${displayValue(f.destination, f.value)}`, destination: INTAKE_SECTION_DEST[f.section] ?? "ANY" });
  for (const d of docs) out.push({ ref: `Document:${d.id}`, label: `Document: ${d.name}`, text: [d.name, d.notes].filter(Boolean).join(". "), destination: "DOCUMENTS" });
  if (access.rota) {
    const vn = await db.visitNote.findMany({ where: { organisationId: org, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) }, visit: { ...visitWhere(await rotaScope(ctx, "rota.view")), serviceUserId } }, select: { id: true, text: true, visitId: true }, orderBy: { createdAt: "desc" }, take: 200 });
    for (const n of vn) out.push({ ref: `Visit:${n.visitId}`, label: "Visit note", text: n.text, destination: "VISIT" });
  }
  if (access.medication && (await medicationEnabled(org))) {
    const meds = await db.medication.findMany({ where: { organisationId: org, serviceUserId }, select: { id: true, name: true, dose: true, status: true } });
    for (const m of meds) out.push({ ref: `Medication:${m.id}`, label: `Medication: ${m.name}`, text: `${m.name} ${m.dose}`, destination: "MEDICATION" });
  }
  if (access.incidents) {
    const inc = await db.incident.findMany({ where: { ...incidentVisibleWhere(ctx, org), serviceUserId }, select: { id: true, reference: true, category: true, description: true }, orderBy: { occurredAt: "desc" }, take: 100 });
    for (const i of inc) out.push({ ref: `Incident:${i.id}`, label: `Incident ${i.reference}`, text: `${i.category}. ${i.description}`, destination: "INCIDENT" });
  }
  return out;
}

// ── Creating a note ────────────────────────────────────────────────────────

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const createSchema = z.object({
  submissionKey: z.string().trim().min(8, "This form is out of date. Reload the page and try again.").max(80),
  date: z.string().refine(isIsoDate, "Enter the date of the communication"),
  time: z.string().refine((v) => parseHhmm(v) !== null, "Enter the time as HH:MM"),
  method: z.enum(METHOD_KEYS, { errorMap: () => ({ message: "Choose how the communication happened" }) }),
  contactName: z.string().trim().min(1, "Say who you spoke with").max(200),
  contactRole: optText(200),
  contactId: optText(40),
  summary: optText(2000),
  details: z.string().trim().max(NOTE_TEXT_MAX, `Keep the notes under ${NOTE_TEXT_MAX} characters`).optional().transform((v) => v ?? ""),
  clarification: optText(2000),
  followUpRequired: z.boolean().default(false),
  followUpText: optText(500),
  followUpOwnerId: optText(40),
  followUpDueOn: optText(10),
  sourceDocumentId: optText(40),
  restricted: z.boolean().default(false),
  organise: z.boolean().default(false),
});
export type CallNoteInput = z.input<typeof createSchema>;

function communicationAt(date: string, time: string) {
  // London wall-clock time to an instant. The offset is read for that date, so British Summer Time is respected.
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const [th, tm] = time.split(":").map(Number) as [number, number];
  const diff = (h * 60 + m - (th * 60 + tm) + 1440) % 1440;
  return new Date(guess.getTime() - (diff > 720 ? diff - 1440 : diff) * 60_000);
}

function urgentKindsIn(...texts: (string | null | undefined)[]) {
  const kinds = new Set<UrgentKind>();
  for (const t of texts) for (const line of (t ?? "").split(/(?<=[.!?;])\s+|\n+/)) { const u = urgentOf(line); if (u) kinds.add(u); }
  return [...kinds];
}

/** Members who may be given a follow-up task (people who record Call Notes), by role from the permission list. */
export async function assignablePeople(ctx: Ctx) {
  const organisationId = requireOrgPermission(ctx, "callNote.view");
  const roles = ORG_PERMISSIONS["callNote.record"] as readonly string[];
  const ms = await db.membership.findMany({ where: { organisationId, roles: { hasSome: [...roles] as never } }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  const seen = new Set<string>();
  return ms.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true))).map((m) => ({ id: m.userId, name: m.user.name }));
}

async function checkSourceDocument(tx: Tx, org: string, serviceUserId: string, id: string | null, sensitive: boolean) {
  if (!id) return null;
  const d = await tx.serviceUserDocument.findFirst({ where: { id, organisationId: org, serviceUserId }, select: { id: true, name: true, sensitive: true } });
  if (!d || (d.sensitive && !sensitive)) throw new ValidationError("Choose one of this person's documents");
  return d;
}

async function checkContact(tx: Tx, org: string, serviceUserId: string, id: string | null) {
  if (!id) return null;
  const c = await tx.serviceUserContact.findFirst({ where: { id, organisationId: org, serviceUserId }, select: { id: true, name: true } });
  if (!c) throw new ValidationError("Choose one of this person's contacts");
  return c;
}

/**
 * Records a note. With `organise`, the note is kept as a DRAFT with the organiser's proposal for the coordinator to
 * check (nothing is final until they save it). Without, it is saved as typed: approved straight away when the author is
 * a manager (no AI involved), otherwise sent for a manager's review. A repeated submission returns the first note.
 */
export async function createCallNote(ctx: Ctx, serviceUserId: string, input: CallNoteInput) {
  const access = callNoteAccess(ctx);
  requireOrgPermission(ctx, "callNote.record");
  const p = createSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the note");
  const d = p.data;
  const su = await personFor(ctx, serviceUserId, "callNote.record");
  const org = su.organisationId;
  const existing = await db.callNote.findUnique({ where: { organisationId_submissionKey: { organisationId: org, submissionKey: d.submissionKey } } });
  if (existing) {
    if (existing.serviceUserId !== su.id || existing.createdById !== ctx.userId) throw new ConflictError("This form was already used. Reload the page and try again.");
    return { note: existing, repeated: true };
  }
  if (d.organise && d.details.length < 10) throw new ValidationError("Write the conversation notes first, then organise them");
  if (!d.organise && !d.summary && !d.details) throw new ValidationError("Write a summary or the conversation notes");
  const at = communicationAt(d.date, d.time);
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("The communication cannot be in the future");
  if (d.followUpRequired && !d.organise) {
    if (!d.followUpText) throw new ValidationError("Say what the follow-up is");
    if (!d.followUpOwnerId) throw new ValidationError("Choose who the follow-up is for");
    if (!d.followUpDueOn || !isIsoDate(d.followUpDueOn)) throw new ValidationError("Choose a due date for the follow-up");
    if (d.followUpDueOn < londonDate()) throw new ValidationError("The follow-up due date cannot be in the past");
    if (!(await assignablePeople(ctx)).some((x) => x.id === d.followUpOwnerId)) throw new ValidationError("Choose someone who records Call Notes for the follow-up");
  }
  const outcome = d.organise ? await organiseText(org, { text: d.details, method: d.method, contactName: d.contactName, contactRole: d.contactRole }) : null;
  const candidates = outcome ? await duplicateCandidates(ctx, su.id) : [];
  const originalText = d.details || d.summary!;
  const verified = outcome ? verifyProposal(originalText, outcome.organised) : null;
  const urgentKinds = [...new Set([...urgentKindsIn(originalText, d.summary), ...(verified?.urgent.map((u) => u.kind) ?? [])])];
  const restricted = d.restricted || urgentKinds.includes("SAFEGUARDING");
  const managerTyped = !d.organise && access.review;
  const status = d.organise ? "DRAFT" : managerTyped ? "APPROVED" : "AWAITING_REVIEW";

  const note = await db.$transaction(async (tx) => {
    await checkSourceDocument(tx, org, su.id, d.sourceDocumentId, access.sensitive);
    await checkContact(tx, org, su.id, d.contactId);
    const reference = await nextCallNoteReference(tx, org, Number(londonDate().slice(0, 4)));
    let n: CallNote;
    try {
      n = await tx.callNote.create({
        data: {
          organisationId: org, serviceUserId: su.id, reference, submissionKey: d.submissionKey, communicationAt: at, method: d.method, contactName: d.contactName, contactRole: d.contactRole, contactId: d.contactId,
          summary: d.summary ?? outcome?.organised.summary ?? d.details.slice(0, 200), details: d.organise ? null : d.details || null, originalText, clarification: d.clarification, sourceDocumentId: d.sourceDocumentId,
          restricted, origin: outcome ? (outcome.usedAi ? "AI_ASSISTED" : "BASIC_ORGANISER") : "MANUAL", reader: outcome?.reader ?? null, proposal: outcome ? (outcome.organised as unknown as Prisma.InputJsonValue) : undefined,
          status, urgentKinds, createdById: ctx.userId, submittedAt: status === "DRAFT" ? null : new Date(), ...(managerTyped ? { reviewNote: "Typed by a manager without AI; no separate review needed." } : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictError("This form was already used. Reload the page and try again.");
      throw e;
    }
    if (outcome && verified) {
      const rows = verified.items.map((item, position) => {
        const destination = isDestination(item.destination) ? item.destination : "CALL_NOTE";
        const dup = findDuplicate(item.text, destination, candidates);
        return {
          organisationId: org, callNoteId: n.id, position, text: item.text.slice(0, 1000), kind: item.kind, destination, quote: item.quote?.slice(0, 1000) ?? null, quoteFound: item.quoteFound, urgent: !!item.urgent,
          origin: outcome.usedAi ? "AI" : "BASIC", aiKind: item.kind, aiDestination: destination, duplicate: dup.kind, duplicateRef: dup.ref, duplicateLabel: dup.label?.slice(0, 300) ?? null,
          decision: suggestedDecision(destination, dup.kind, item.quoteFound),
        };
      });
      if (rows.length) await tx.callNoteItem.createMany({ data: rows });
    }
    if (d.sourceDocumentId) await tx.callNoteLink.create({ data: { organisationId: org, callNoteId: n.id, targetType: "DOCUMENT", targetId: d.sourceDocumentId, label: "Source document", createdById: ctx.userId } });
    if (d.contactId) await tx.callNoteLink.create({ data: { organisationId: org, callNoteId: n.id, targetType: "CONTACT", targetId: d.contactId, label: `Contact: ${d.contactName}`, createdById: ctx.userId } });
    if (d.followUpRequired && !d.organise) await createTaskInTx(tx, ctx, n, { description: d.followUpText!, assigneeId: d.followUpOwnerId!, dueOn: d.followUpDueOn!, priority: "MEDIUM", evidenceRequired: false });
    await audit({ organisationId: org, actorId: ctx.userId, action: d.organise ? "callNote.organised" : "callNote.created", entityType: "CallNote", entityId: n.id, data: { reference, serviceUserId: su.id, origin: n.origin, reader: n.reader, status, method: d.method, communicationAt: at.toISOString(), items: verified?.items.length ?? 0, unquoted: verified?.items.filter((i) => !i.quoteFound).length ?? 0, urgentKinds, restricted } }, tx);
    return n;
  });
  if (status !== "DRAFT" && urgentKinds.length) await escalate(ctx, note);
  if (status === "AWAITING_REVIEW") await notifyReviewers(ctx, note);
  return { note, repeated: false };
}

/** The draft's organised items, as the coordinator decides them on the review screen. */
const itemDecisionSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(3, "A bullet point cannot be empty").max(1000),
  kind: z.enum(KIND_KEYS),
  destination: z.enum(DESTINATION_KEYS),
  decision: z.enum(["KEEP", "ROUTE", "LINK", "LEAVE_OUT"]),
});
const followUpSchema = z.object({ description: z.string().trim().min(3).max(500), assigneeId: z.string().min(1, "Choose who the follow-up is for"), dueOn: z.string().refine(isIsoDate, "Choose a due date"), priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM") });
const submitSchema = z.object({
  summary: z.string().trim().min(3, "Write a short summary").max(2000),
  clarification: optText(2000),
  restricted: z.boolean().default(false),
  items: z.array(itemDecisionSchema).max(100),
  followUps: z.array(followUpSchema).max(20).default([]),
});
export type SubmitInput = z.input<typeof submitSchema>;

/**
 * Saves the coordinator's checked version of an organised draft and sends it for a manager's review. Human edits are
 * recorded against what the organiser proposed. Exact duplicates are linked, never copied again.
 */
export async function submitOrganised(ctx: Ctx, noteId: string, lockVersion: number, input: SubmitInput) {
  const { note } = await noteFor(ctx, noteId, "callNote.record");
  const p = submitSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the note");
  const d = p.data;
  if (note.createdById !== ctx.userId) throw new ForbiddenError("Only the person who wrote this draft can save it");
  const people = d.followUps.length ? await assignablePeople(ctx) : [];
  for (const f of d.followUps) {
    if (!people.some((x) => x.id === f.assigneeId)) throw new ValidationError("Choose someone who records Call Notes for each follow-up");
    if (f.dueOn < londonDate()) throw new ValidationError("A follow-up due date cannot be in the past");
  }
  const saved = await db.$transaction(async (tx) => {
    await lockNote(tx, note.id, note.organisationId);
    const fresh = await tx.callNote.findUniqueOrThrow({ where: { id: note.id } });
    if (fresh.status !== "DRAFT") throw new ConflictError("This note has already been saved. Reload the page to see it.");
    if (fresh.lockVersion !== lockVersion) throw new ConflictError("This draft was changed in another window. Reload the page and try again.");
    const items = await tx.callNoteItem.findMany({ where: { callNoteId: note.id } });
    const byId = new Map(items.map((i) => [i.id, i]));
    let edits = 0;
    for (const it of d.items) {
      const cur = byId.get(it.id);
      if (!cur) throw new ValidationError("This draft is out of date. Reload the page and try again.");
      if (it.decision === "LINK" && !cur.duplicateRef) throw new ValidationError(`"${cur.text.slice(0, 60)}" has no existing record to link to`);
      if (it.decision === "ROUTE" && it.destination === "CALL_NOTE") throw new ValidationError(`Choose where "${it.text.slice(0, 60)}" belongs, or keep it in this note`);
      if (it.text !== cur.text || it.kind !== cur.kind || it.destination !== cur.destination || it.decision !== cur.decision) edits++;
      await tx.callNoteItem.update({ where: { id: cur.id }, data: { text: it.text, kind: it.kind, destination: it.destination, decision: it.decision, urgent: cur.urgent || it.destination === "SAFEGUARDING" } });
    }
    const kept = d.items.filter((i) => i.decision !== "LEAVE_OUT");
    const urgentKinds = [...new Set<string>([...fresh.urgentKinds, ...(kept.some((i) => i.destination === "SAFEGUARDING") ? ["SAFEGUARDING"] : [])])];
    const restricted = d.restricted || fresh.restricted || urgentKinds.includes("SAFEGUARDING");
    const n = await tx.callNote.update({ where: { id: note.id }, data: { summary: d.summary, clarification: d.clarification, restricted, urgentKinds, status: "AWAITING_REVIEW", submittedAt: new Date(), lockVersion: { increment: 1 } } });
    for (const f of d.followUps) await createTaskInTx(tx, ctx, n, { ...f, evidenceRequired: false });
    for (const it of kept.filter((i) => i.decision === "LINK")) {
      const cur = byId.get(it.id)!;
      await addLinkInTx(tx, ctx, n, cur.duplicateRef!, cur.duplicateLabel ?? "Existing record");
    }
    const proposal = fresh.proposal as { summary?: string } | null;
    await audit({ organisationId: n.organisationId, actorId: ctx.userId, action: "callNote.submitted", entityType: "CallNote", entityId: n.id, data: { reference: n.reference, items: d.items.length, kept: kept.length, routed: kept.filter((i) => i.decision === "ROUTE").length, linked: kept.filter((i) => i.decision === "LINK").length, humanEdits: edits, summaryEdited: proposal?.summary !== d.summary, followUps: d.followUps.length, urgentKinds } }, tx);
    return n;
  });
  if (saved.urgentKinds.length) await escalate(ctx, saved);
  await notifyReviewers(ctx, saved);
  return saved;
}

/** The author withdraws a draft they no longer need. It stays in the history as Withdrawn. */
export async function withdrawDraft(ctx: Ctx, noteId: string) {
  const { note } = await noteFor(ctx, noteId, "callNote.record");
  if (note.createdById !== ctx.userId) throw new ForbiddenError("Only the person who wrote this draft can withdraw it");
  await db.$transaction(async (tx) => {
    const r = await tx.callNote.updateMany({ where: { id: note.id, status: "DRAFT" }, data: { status: "WITHDRAWN", lockVersion: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("Only a draft can be withdrawn");
    await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.withdrawn", entityType: "CallNote", entityId: note.id, data: { reference: note.reference } }, tx);
  });
}

// ── From the AI Care Coordinator ───────────────────────────────────────────

/**
 * Saves one approved Call Notes fact from a Care Coordinator intake. The manager has already approved the section (and
 * the intake's separation of duties applies), so the note is saved as approved, linked to the intake and its source.
 * The date is the one written in the document; when there is none, the document's own date (or the date it was read)
 * is used and the note says so. Idempotent: one note per fact.
 */
export async function createIntakeCallNote(tx: Tx, ctx: Ctx, input: {
  organisationId: string; serviceUserId: string; intake: { id: string; reference: string; createdAt: Date }; fact: { id: string; quote: string | null; label: string };
  documentName: string | null; documentDate: Date | null; approvedById: string | null; value: { summary: string; contactName: string | null; method: string; date: string | null }; sourceLabel: string;
}) {
  const existing = await tx.callNote.findUnique({ where: { intakeFactId: input.fact.id } });
  if (existing) return existing;
  const v = input.value;
  const when = v.date ? new Date(`${v.date}T12:00:00Z`) : input.documentDate ?? input.intake.createdAt;
  const urgentKinds = urgentKindsIn(v.summary, input.fact.quote);
  const reference = await nextCallNoteReference(tx, input.organisationId, Number(londonDate().slice(0, 4)));
  const note = await tx.callNote.create({
    data: {
      organisationId: input.organisationId, serviceUserId: input.serviceUserId, reference, submissionKey: `intake-fact:${input.fact.id}`, communicationAt: when, method: (METHOD_KEYS as readonly string[]).includes(v.method) ? v.method : "OTHER",
      contactName: v.contactName ?? "Not stated in the document", summary: v.summary, originalText: input.fact.quote ?? v.summary, sourceLabel: input.sourceLabel.slice(0, 300), intakeId: input.intake.id, intakeFactId: input.fact.id,
      clarification: v.date ? null : "The document does not give the date of this communication; the date shown is the document's date or when it was read.",
      origin: "INTAKE", status: "APPROVED", urgentKinds, restricted: urgentKinds.includes("SAFEGUARDING"), createdById: ctx.userId, submittedAt: new Date(), reviewedById: input.approvedById, reviewedAt: new Date(), reviewNote: `Approved as part of Care Coordinator intake ${input.intake.reference}.`,
    },
  });
  await tx.callNoteLink.create({ data: { organisationId: input.organisationId, callNoteId: note.id, targetType: "INTAKE", targetId: input.intake.id, label: `Care Coordinator intake ${input.intake.reference}`, createdById: ctx.userId } });
  await audit({ organisationId: input.organisationId, actorId: ctx.userId, action: "callNote.createdFromIntake", entityType: "CallNote", entityId: note.id, data: { reference, intakeId: input.intake.id, intakeReference: input.intake.reference, factId: input.fact.id, source: input.sourceLabel.slice(0, 300), urgentKinds } }, tx);
  return note;
}

// ── Review and approval ────────────────────────────────────────────────────

const reviewSchema = z.object({ decision: z.enum(["APPROVE", "CLARIFY", "REJECT"]), note: optText(2000) });

/**
 * A manager who did not write the note approves it, asks for clarification or rejects it. Approval sends every routed
 * item to its destination's review queue and links it; nothing in a structured record changes here.
 */
export async function reviewCallNote(ctx: Ctx, noteId: string, lockVersion: number, input: z.input<typeof reviewSchema>) {
  const { note, access } = await noteFor(ctx, noteId, "callNote.review");
  const p = reviewSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the decision");
  const d = p.data;
  if (note.createdById === ctx.userId) throw new ForbiddenError("You wrote this note, so another manager must review it");
  if (d.decision !== "APPROVE" && !d.note) throw new ValidationError(d.decision === "CLARIFY" ? "Say what needs clarifying" : "Say why the note is rejected");
  const updated = await db.$transaction(async (tx) => {
    await lockNote(tx, note.id, note.organisationId);
    const fresh = await tx.callNote.findUniqueOrThrow({ where: { id: note.id } });
    if (fresh.status !== "AWAITING_REVIEW") throw new ConflictError("This note is not waiting for review");
    if (fresh.lockVersion !== lockVersion) throw new ConflictError("This note was changed after you opened it. Reload the page and try again.");
    const status = d.decision === "APPROVE" ? "APPROVED" : d.decision === "CLARIFY" ? "CLARIFICATION_REQUESTED" : "REJECTED";
    const n = await tx.callNote.update({ where: { id: note.id }, data: { status, reviewedById: ctx.userId, reviewedAt: new Date(), reviewNote: d.note, lockVersion: { increment: 1 } } });
    let routed = 0;
    if (status === "APPROVED") {
      const items = await tx.callNoteItem.findMany({ where: { callNoteId: note.id, decision: "ROUTE", reviewItemId: null }, orderBy: { position: "asc" } });
      for (const it of items) {
        const dest = isDestination(it.destination) ? DESTINATIONS[it.destination] : null;
        if (!dest?.category) continue;
        const ri = await tx.careIntakeReviewItem.create({
          data: { organisationId: note.organisationId, serviceUserId: note.serviceUserId, category: dest.category, description: `${it.text} (from ${note.reference}; ${it.kind === "AUTHORISED_INSTRUCTION" ? "stated as an authorised instruction, still to be verified" : "not verified"})`.slice(0, 2000), sourceRef: note.reference, restricted: dest.restricted || note.restricted, createdById: ctx.userId },
        });
        await tx.callNoteItem.update({ where: { id: it.id }, data: { reviewItemId: ri.id } });
        await tx.callNoteLink.create({ data: { organisationId: note.organisationId, callNoteId: note.id, targetType: "REVIEW_ITEM", targetId: ri.id, label: `${dest.short}: ${it.text.slice(0, 120)}`, createdById: ctx.userId } });
        routed++;
      }
    }
    await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: `callNote.${status === "APPROVED" ? "approved" : status === "REJECTED" ? "rejected" : "clarificationRequested"}`, entityType: "CallNote", entityId: note.id, data: { reference: note.reference, note: d.note, routed } }, tx);
    return n;
  });
  if (updated.status !== "APPROVED") {
    await notify({ organisationId: note.organisationId, userIds: [note.createdById], type: "callNote.returned", title: `${note.reference} ${updated.status === "REJECTED" ? "was rejected" : "needs clarification"}`, body: d.note ?? "", reason: "You wrote this Call Note.", actionUrl: noteUrl(note), dedupeKey: `call-note-review:${note.id}:${updated.lockVersion}`, email: false });
  }
  void access;
  return updated;
}

const correctionSchema = z.object({
  summary: z.string().trim().min(3, "Write a short summary").max(2000),
  details: optText(NOTE_TEXT_MAX),
  clarification: optText(2000),
  reason: z.string().trim().min(5, "Say why the note is being corrected").max(500),
});

/**
 * Corrects a note. The previous summary, notes and clarification are kept as a revision (never edited or deleted); the
 * original text cannot change. A corrected note that was approved, or returned for clarification, goes back for review.
 */
export async function correctCallNote(ctx: Ctx, noteId: string, lockVersion: number, input: z.input<typeof correctionSchema>) {
  const { note, access } = await noteFor(ctx, noteId, "callNote.record");
  const p = correctionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the correction");
  const d = p.data;
  if (note.createdById !== ctx.userId && !access.review) throw new ForbiddenError("Only the author or a manager can correct a note");
  return db.$transaction(async (tx) => {
    await lockNote(tx, note.id, note.organisationId);
    const fresh = await tx.callNote.findUniqueOrThrow({ where: { id: note.id } });
    if (!["AWAITING_REVIEW", "APPROVED", "CLARIFICATION_REQUESTED"].includes(fresh.status)) throw new ConflictError("This note can no longer be corrected");
    if (fresh.lockVersion !== lockVersion) throw new ConflictError("This note was changed after you opened it. Reload the page and try again.");
    await tx.callNoteRevision.create({ data: { callNoteId: fresh.id, version: fresh.version, snapshot: { summary: fresh.summary, details: fresh.details, clarification: fresh.clarification, status: fresh.status, reviewedById: fresh.reviewedById, reviewedAt: fresh.reviewedAt?.toISOString() ?? null } as Prisma.InputJsonValue, reason: d.reason, createdById: ctx.userId } });
    const n = await tx.callNote.update({ where: { id: fresh.id }, data: { summary: d.summary, details: d.details, clarification: d.clarification, version: { increment: 1 }, status: "AWAITING_REVIEW", submittedAt: new Date(), reviewedById: null, reviewedAt: null, reviewNote: null, lockVersion: { increment: 1 } } });
    await audit({ organisationId: fresh.organisationId, actorId: ctx.userId, action: "callNote.corrected", entityType: "CallNote", entityId: fresh.id, data: { reference: fresh.reference, fromVersion: fresh.version, toVersion: n.version, reason: d.reason, previousStatus: fresh.status } }, tx);
    return n;
  });
}

/** A manager records that a later note replaces this one. Both stay in the history, linked. */
export async function supersedeCallNote(ctx: Ctx, noteId: string, input: { byReference: string; reason: string }) {
  const { note } = await noteFor(ctx, noteId, "callNote.review");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError("Say why the note is superseded");
  const ref = input.byReference.trim().toUpperCase();
  await db.$transaction(async (tx) => {
    await lockNote(tx, note.id, note.organisationId);
    const by = await tx.callNote.findFirst({ where: { organisationId: note.organisationId, serviceUserId: note.serviceUserId, reference: ref } });
    if (!by || by.id === note.id) throw new ValidationError("Enter the reference of a different Call Note for this person");
    const r = await tx.callNote.updateMany({ where: { id: note.id, status: { in: ["APPROVED", "AWAITING_REVIEW", "CLARIFICATION_REQUESTED"] } }, data: { status: "SUPERSEDED", supersededById: by.id, lockVersion: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("This note cannot be superseded in its current status");
    await tx.callNoteLink.upsert({ where: { callNoteId_targetType_targetId: { callNoteId: note.id, targetType: "CALL_NOTE", targetId: by.id } }, create: { organisationId: note.organisationId, callNoteId: note.id, targetType: "CALL_NOTE", targetId: by.id, label: `Superseded by ${by.reference}`, createdById: ctx.userId }, update: {} });
    await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.superseded", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, by: by.reference, reason } }, tx);
  });
}

// ── Urgent concerns ────────────────────────────────────────────────────────

const noteUrl = (n: { serviceUserId: string; id: string }) => `/rota/service-users/${n.serviceUserId}?tab=call-notes&note=${n.id}`;

async function escalate(ctx: Ctx, note: CallNote) {
  const roles = ["ORG_ADMIN", "CARE_MANAGER"];
  const managers = await db.membership.findMany({ where: { organisationId: note.organisationId, roles: { hasSome: roles as never } }, select: { userId: true } });
  const ids = managers.map((m) => m.userId).filter((id) => id !== ctx.userId);
  const what = note.urgentKinds.map((k) => URGENT_KINDS[k as UrgentKind] ?? k).join(", ");
  // Only the reference and the kind of concern: the person's details stay in the note, behind its permissions.
  await notify({ organisationId: note.organisationId, userIds: ids, type: "callNote.urgent", title: `Urgent: ${what} in ${note.reference}`, body: `A Call Note raised a possible ${what.toLowerCase()}. It is reported, not verified. Open the note and use the incident and safeguarding workflow if needed.`, reason: "You manage care for your organisation.", actionUrl: noteUrl(note), links: [{ label: "Open the Call Note", url: noteUrl(note) }], dedupeKey: `call-note-urgent:${note.id}`, email: false });
  await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.escalated", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, urgentKinds: note.urgentKinds, notified: ids.length } });
}

async function notifyReviewers(ctx: Ctx, note: CallNote) {
  const roles = ORG_PERMISSIONS["callNote.review"] as readonly string[];
  const ms = await db.membership.findMany({ where: { organisationId: note.organisationId, roles: { hasSome: [...roles] as never } }, select: { userId: true } });
  const ids = ms.map((m) => m.userId).filter((id) => id !== note.createdById);
  await notify({ organisationId: note.organisationId, userIds: ids, type: "callNote.review", title: `${note.reference} is waiting for review`, body: "A Call Note is waiting for a manager's review.", reason: "You review Call Notes for your organisation.", actionUrl: noteUrl(note), dedupeKey: `call-note-submitted:${note.id}:${note.version}`, email: false });
}

/** A manager records what was done about an urgent concern, optionally linking the incident that was reported. */
export async function recordEscalation(ctx: Ctx, noteId: string, input: { action: string; incidentId?: string | null }) {
  const { note } = await noteFor(ctx, noteId, "callNote.review");
  const action = input.action.trim();
  if (action.length < 5) throw new ValidationError("Say what action was taken");
  if (!note.urgentKinds.length) throw new ValidationError("This note has no urgent concern to record an action for");
  await db.$transaction(async (tx) => {
    if (input.incidentId) {
      const inc = await tx.incident.findFirst({ where: { ...incidentVisibleWhere(ctx, note.organisationId), id: input.incidentId, serviceUserId: note.serviceUserId }, select: { id: true, reference: true } });
      if (!inc) throw new ValidationError("Choose one of this person's incidents");
      await tx.callNoteLink.upsert({ where: { callNoteId_targetType_targetId: { callNoteId: note.id, targetType: "INCIDENT", targetId: inc.id } }, create: { organisationId: note.organisationId, callNoteId: note.id, targetType: "INCIDENT", targetId: inc.id, label: `Incident ${inc.reference}`, createdById: ctx.userId }, update: {} });
    }
    await tx.callNote.update({ where: { id: note.id }, data: { escalatedAt: new Date(), escalationNote: action.slice(0, 2000), escalationById: ctx.userId, lockVersion: { increment: 1 } } });
    await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.escalationRecorded", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, action: action.slice(0, 500), incidentId: input.incidentId ?? null } }, tx);
  });
}

// ── Links ──────────────────────────────────────────────────────────────────

type LinkType = "CARE_PLAN" | "RISK" | "VISIT" | "INCIDENT" | "CONTACT" | "DOCUMENT" | "INTAKE" | "MEDICATION" | "CALL_NOTE" | "REVIEW_ITEM";
const REF_TYPE: Record<string, LinkType> = { CarePlan: "CARE_PLAN", RiskAssessment: "RISK", Visit: "VISIT", Incident: "INCIDENT", Contact: "CONTACT", Document: "DOCUMENT", IntakeFact: "INTAKE", Medication: "MEDICATION", CallNote: "CALL_NOTE" };

/** Checks the record belongs to this person and organisation before linking it. Person: refs are not linked. */
async function addLinkInTx(tx: Tx, ctx: Ctx, note: CallNote, ref: string, label: string) {
  const [prefix, id] = ref.split(":", 2) as [string, string | undefined];
  const type = REF_TYPE[prefix];
  if (!type || !id) return;
  const org = note.organisationId;
  const su = note.serviceUserId;
  const ok =
    type === "CARE_PLAN" ? !!(await tx.carePlan.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "RISK" ? !!(await tx.riskAssessment.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "VISIT" ? !!(await tx.visit.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "INCIDENT" ? !!(await tx.incident.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "CONTACT" ? !!(await tx.serviceUserContact.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "DOCUMENT" ? !!(await tx.serviceUserDocument.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "INTAKE" ? !!(await tx.careIntake.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "MEDICATION" ? !!(await tx.medication.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : type === "CALL_NOTE" ? !!(await tx.callNote.findFirst({ where: { id, organisationId: org, serviceUserId: su }, select: { id: true } }))
    : false;
  if (!ok) throw new ValidationError("That record is not one of this person's records");
  await tx.callNoteLink.upsert({ where: { callNoteId_targetType_targetId: { callNoteId: note.id, targetType: type, targetId: id } }, create: { organisationId: org, callNoteId: note.id, targetType: type, targetId: id, label: label.slice(0, 300), createdById: ctx.userId }, update: {} });
}

/** Links a note to one of the person's existing records (care plan, risk, visit, incident, contact, document …). */
export async function linkRecord(ctx: Ctx, noteId: string, ref: string, label: string) {
  const { note } = await noteFor(ctx, noteId, "callNote.record");
  await db.$transaction(async (tx) => {
    await addLinkInTx(tx, ctx, note, ref, label || "Linked record");
    await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.linked", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, ref } }, tx);
  });
}

/** Where a link opens, or null when the viewer may not open that record (then the link is not shown). */
export function linkHref(access: CallNoteAccess, ctx: Ctx, serviceUserId: string, type: string, id: string): string | null {
  const base = `/rota/service-users/${serviceUserId}`;
  switch (type) {
    case "CARE_PLAN": return hasOrgPermission(ctx, "serviceUser.view") ? `/rota/care-plans/${serviceUserId}` : null;
    case "RISK": return `/rota/risks/${id}`;
    case "VISIT": return access.rota ? `/rota/visits/${id}` : null;
    case "INCIDENT": return access.incidents ? `/rota/incidents/${id}` : null;
    case "CONTACT": return `${base}?tab=people`;
    case "DOCUMENT": return `${base}?tab=documents&doc=${id}`;
    case "INTAKE": return hasOrgPermission(ctx, "serviceUser.edit") && hasOrgPermission(ctx, "rota.edit") ? `/rota/coordinator/${id}` : null;
    case "MEDICATION": return access.medication ? `${base}?tab=medication` : null;
    case "CALL_NOTE": return `${base}?tab=call-notes&note=${id}`;
    case "REVIEW_ITEM": return `${base}?tab=call-notes&item=${id}`;
    case "Person": return `${base}?tab=details`;
    default: return null;
  }
}

/** The duplicate check's matched record, as a link the viewer may open. */
export function refHref(access: CallNoteAccess, ctx: Ctx, serviceUserId: string, ref: string | null) {
  if (!ref) return null;
  const [prefix, id] = ref.split(":", 2) as [string, string];
  return linkHref(access, ctx, serviceUserId, REF_TYPE[prefix] ?? prefix, id);
}

// ── Routed items (Care Coordinator review queue) ───────────────────────────

const ROUTE_PERM: Record<string, OrgPermission> = { CARE_PLAN: "care.plan.edit", RISK: "care.plan.edit", MEDICATION: "medication.manage", ROTA: "rota.edit", VISIT: "rota.edit", INCIDENT: "incident.manage", SAFEGUARDING: "incident.manage", CONTACTS: "serviceUser.edit", PERSONAL: "serviceUser.edit", DOCUMENTS: "serviceUser.documents" };

/**
 * Closes a routed item once the change was made (or decided against) through the destination's own workflow. The
 * review item is never closed automatically, and only by someone who may act in that destination.
 */
export async function resolveRoutedItem(ctx: Ctx, reviewItemId: string, resolution: string) {
  const access = callNoteAccess(ctx);
  const text = resolution.trim();
  if (text.length < 5) throw new ValidationError("Say what was done, so the next person can see it");
  const scope = await rotaScope(ctx, "serviceUser.view");
  await db.$transaction(async (tx) => {
    const item = await tx.careIntakeReviewItem.findFirst({ where: { id: reviewItemId, organisationId: scope.organisationId, serviceUser: serviceUserWhere(scope) } });
    const link = item ? await tx.callNoteItem.findFirst({ where: { reviewItemId: item.id, organisationId: scope.organisationId }, include: { callNote: true } }) : null;
    if (!item || !link) throw new NotFoundError("Routed item");
    if (item.restricted && !access.sensitive) throw new NotFoundError("Routed item");
    const perm = ROUTE_PERM[link.destination];
    if (!perm || !hasOrgPermission(ctx, perm)) throw new ForbiddenError(`Someone who can work on ${DESTINATIONS[link.destination as Destination]?.label ?? "that record"} closes this item`);
    const done = await tx.careIntakeReviewItem.updateMany({ where: { id: item.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedById: ctx.userId, resolvedAt: new Date(), resolution: text.slice(0, 2000) } });
    if (!done.count) throw new ConflictError("This item is already closed");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "callNote.routedResolved", entityType: "CallNote", entityId: link.callNoteId, data: { reference: link.callNote.reference, reviewItemId: item.id, destination: link.destination } }, tx);
  });
}

// ── Follow-up tasks ────────────────────────────────────────────────────────

const taskSchema = z.object({
  description: z.string().trim().min(3, "Describe the follow-up").max(500),
  assigneeId: z.string().trim().min(1, "Choose who the follow-up is for"),
  dueOn: z.string().refine(isIsoDate, "Choose a due date"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  evidenceRequired: z.boolean().default(false),
});

async function createTaskInTx(tx: Tx, ctx: Ctx, note: CallNote, input: z.input<typeof taskSchema>) {
  const d = taskSchema.parse(input);
  const task = await tx.callNoteTask.create({ data: { organisationId: note.organisationId, serviceUserId: note.serviceUserId, callNoteId: note.id, description: d.description, assigneeId: d.assigneeId, priority: d.priority, dueOn: dbDate(d.dueOn), evidenceRequired: d.evidenceRequired, createdById: ctx.userId } });
  if (d.assigneeId !== ctx.userId) {
    await tx.notification.create({ data: { organisationId: note.organisationId, userId: d.assigneeId, type: "callNote.task", title: `Follow-up from ${note.reference}`, body: `${d.description}. Due ${d.dueOn}.`, reason: "A follow-up from a Call Note was assigned to you.", actionUrl: noteUrl(note), dueAt: dbDate(d.dueOn), dedupeKey: `call-note-task:${task.id}` } });
  }
  await audit({ organisationId: note.organisationId, actorId: ctx.userId, action: "callNote.taskCreated", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, taskId: task.id, assigneeId: d.assigneeId, dueOn: d.dueOn, priority: d.priority } }, tx);
  return task;
}

/** Creates a follow-up task linked to the note, for one person who records Call Notes. */
export async function createFollowUp(ctx: Ctx, noteId: string, input: z.input<typeof taskSchema>) {
  const { note } = await noteFor(ctx, noteId, "callNote.record");
  const p = taskSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the follow-up");
  if (p.data.dueOn < londonDate()) throw new ValidationError("The due date cannot be in the past");
  if (!(await assignablePeople(ctx)).some((x) => x.id === p.data.assigneeId)) throw new ValidationError("Choose someone who records Call Notes");
  if (["WITHDRAWN", "REJECTED"].includes(note.status)) throw new ConflictError("Follow-ups cannot be added to a withdrawn or rejected note");
  return db.$transaction((tx) => createTaskInTx(tx, ctx, note, p.data));
}

const closeSchema = z.object({ done: z.boolean(), note: z.string().trim().min(3, "Record what was done").max(2000), evidenceDocumentId: optText(40) });

/** The assignee or a manager closes a task with a completion note (and evidence when required). Never automatic. */
export async function closeFollowUp(ctx: Ctx, taskId: string, version: number, input: z.input<typeof closeSchema>) {
  const access = callNoteAccess(ctx);
  const p = closeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the outcome");
  const t = await db.callNoteTask.findFirst({ where: { id: taskId, organisationId: ctx.organisationId! } });
  if (!t) throw new NotFoundError("Follow-up");
  const { note } = await noteFor(ctx, t.callNoteId);
  if (t.assigneeId !== ctx.userId && !access.review) throw new ForbiddenError("Only the person the follow-up is for, or a manager, can close it");
  if (!p.data.done && !access.review) throw new ForbiddenError("Only a manager can cancel a follow-up");
  await db.$transaction(async (tx) => {
    if (p.data.done && t.evidenceRequired) {
      if (!p.data.evidenceDocumentId) throw new ValidationError("This follow-up needs evidence: choose the document that shows it was done");
      await checkSourceDocument(tx, t.organisationId, t.serviceUserId, p.data.evidenceDocumentId, access.sensitive);
    }
    const r = await tx.callNoteTask.updateMany({ where: { id: t.id, version, status: "OPEN" }, data: { status: p.data.done ? "DONE" : "CANCELLED", completionNote: p.data.note, evidenceDocumentId: p.data.evidenceDocumentId, closedById: ctx.userId, closedAt: new Date(), version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("This follow-up has already been closed or changed. Reload the page and try again.");
    await audit({ organisationId: t.organisationId, actorId: ctx.userId, action: p.data.done ? "callNote.taskDone" : "callNote.taskCancelled", entityType: "CallNote", entityId: note.id, data: { reference: note.reference, taskId: t.id, note: p.data.note.slice(0, 500), evidenceDocumentId: p.data.evidenceDocumentId } }, tx);
  });
}

/** Open follow-ups due within the window, for Active Reminders, in the caller's scope. */
export async function callNoteReminders(ctx: Ctx, horizon: Date, suScope: Prisma.ServiceUserWhereInput) {
  if (!hasOrgPermission(ctx, "callNote.view")) return [];
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const rows = await db.callNoteTask.findMany({
    where: { organisationId: ctx.organisationId!, status: "OPEN", dueOn: { lte: horizon }, callNote: { serviceUser: suScope, ...(sensitive ? {} : { OR: [{ restricted: false }, { createdById: ctx.userId }] }) } },
    select: { id: true, description: true, dueOn: true, callNote: { select: { id: true, reference: true, serviceUserId: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } } } },
    orderBy: { dueOn: "asc" },
    take: 200,
  });
  return rows.map((r) => ({ text: `Call note follow-up (${r.callNote.reference}): ${r.description}`, due: fromDbDate(r.dueOn), person: r.callNote.serviceUser, href: noteUrl({ serviceUserId: r.callNote.serviceUserId, id: r.callNote.id }) }));
}

/** Daily, from the maintenance tick: an in-app reminder to the assignee for each overdue follow-up, once per due date. */
export async function sendCallNoteReminders(now = new Date()) {
  const today = dbDate(londonDate(now));
  const overdue = await db.callNoteTask.findMany({ where: { status: "OPEN", dueOn: { lt: today } }, select: { id: true, organisationId: true, description: true, assigneeId: true, dueOn: true, callNote: { select: { id: true, reference: true, serviceUserId: true } } } });
  let sent = 0;
  for (const t of overdue) {
    const due = fromDbDate(t.dueOn);
    const url = noteUrl({ serviceUserId: t.callNote.serviceUserId, id: t.callNote.id });
    sent += await notify({ organisationId: t.organisationId, userIds: [t.assigneeId], type: "callNote.taskOverdue", title: `Overdue follow-up from ${t.callNote.reference}`, body: `${t.description.slice(0, 200)}. Action required: complete it with a note, or ask a manager to change it. Due: ${due}.`, reason: "This follow-up is assigned to you.", actionUrl: url, links: [{ label: "Open the Call Note", url }], dueAt: t.dueOn, dedupeKey: `call-note-task-overdue:${t.id}:${due}`, email: false });
  }
  return sent;
}

// ── Reading ────────────────────────────────────────────────────────────────

const filterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().optional().refine((v) => !v || isIsoDate(v)),
  to: z.string().optional().refine((v) => !v || isIsoDate(v)),
  method: z.enum(METHOD_KEYS).optional(),
  contact: z.string().trim().max(100).optional(),
  by: z.string().trim().max(40).optional(),
  followUp: z.enum(["yes", "no"]).optional(),
  status: z.enum(["DRAFT", "AWAITING_REVIEW", "APPROVED", "CLARIFICATION_REQUESTED", "REJECTED", "SUPERSEDED", "WITHDRAWN", "FOLLOW_UP", "COMPLETED"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type CallNoteFilters = z.input<typeof filterSchema>;

/** Reads filters from the query string; anything invalid is ignored rather than failing the page. */
export function parseFilters(sp: Record<string, string | undefined>): z.infer<typeof filterSchema> {
  const clean = Object.fromEntries(Object.entries({ q: sp.q, from: sp.from, to: sp.to, method: sp.method, contact: sp.contact, by: sp.by, followUp: sp.followUp, status: sp.status, page: sp.page }).filter(([, v]) => v !== undefined && v !== ""));
  const r = filterSchema.safeParse(clean);
  if (r.success) return r.data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) {
    const one = filterSchema.safeParse({ [k]: v });
    if (one.success) out[k] = (one.data as Record<string, unknown>)[k];
  }
  return filterSchema.parse(out);
}

/** One person's Call Notes, newest communication first, 20 to a page, with search and filters. */
export async function listCallNotes(ctx: Ctx, serviceUserId: string, raw: CallNoteFilters = {}) {
  const access = callNoteAccess(ctx);
  const su = await personFor(ctx, serviceUserId);
  const f = filterSchema.parse(raw);
  const org = su.organisationId;
  const visible: Prisma.CallNoteWhereInput = access.sensitive ? {} : { OR: [{ restricted: false }, { createdById: ctx.userId }] };
  const statusWhere: Prisma.CallNoteWhereInput =
    f.status === "FOLLOW_UP" ? { status: "APPROVED", tasks: { some: { status: "OPEN" } } }
    : f.status === "COMPLETED" ? { status: "APPROVED", tasks: { some: {}, none: { status: "OPEN" } } }
    : f.status ? { status: f.status }
    // Other people's drafts are private working copies; withdrawn drafts show only when asked for.
    : { OR: [{ status: { notIn: ["DRAFT", "WITHDRAWN"] } }, { status: "DRAFT", createdById: ctx.userId }] };
  const where: Prisma.CallNoteWhereInput = {
    AND: [
      { organisationId: org, serviceUserId: su.id },
      visible,
      statusWhere,
      f.status === "DRAFT" ? { createdById: ctx.userId } : {},
      f.from ? { communicationAt: { gte: new Date(`${f.from}T00:00:00Z`) } } : {},
      f.to ? { communicationAt: { lt: new Date(`${addDays(f.to, 1)}T00:00:00Z`) } } : {},
      f.method ? { method: f.method } : {},
      f.contact ? { OR: [{ contactName: { contains: f.contact, mode: "insensitive" } }, { contactRole: { contains: f.contact, mode: "insensitive" } }] } : {},
      f.by ? { createdById: f.by } : {},
      f.followUp === "yes" ? { tasks: { some: { status: "OPEN" } } } : f.followUp === "no" ? { tasks: { none: { status: "OPEN" } } } : {},
      f.q
        ? { OR: [
            { reference: { contains: f.q, mode: "insensitive" } }, { summary: { contains: f.q, mode: "insensitive" } }, { details: { contains: f.q, mode: "insensitive" } },
            { originalText: { contains: f.q, mode: "insensitive" } }, { contactName: { contains: f.q, mode: "insensitive" } }, { contactRole: { contains: f.q, mode: "insensitive" } },
            { items: { some: { text: { contains: f.q, mode: "insensitive" } } } },
          ] }
        : {},
    ],
  };
  const [total, rows, hidden] = await Promise.all([
    db.callNote.count({ where }),
    db.callNote.findMany({
      where,
      orderBy: [{ communicationAt: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { items: { orderBy: { position: "asc" } }, tasks: { orderBy: { dueOn: "asc" } }, links: { orderBy: { createdAt: "asc" } }, revisions: { orderBy: { version: "desc" } } },
    }),
    access.sensitive ? Promise.resolve(0) : db.callNote.count({ where: { organisationId: org, serviceUserId: su.id, restricted: true, createdById: { not: ctx.userId }, status: { notIn: ["DRAFT", "WITHDRAWN"] } } }),
  ]);
  const ids = rows.map((r) => r.id);
  const reviewItemIds = rows.flatMap((r) => r.items.flatMap((i) => (i.reviewItemId ? [i.reviewItemId] : [])));
  const [history, reviewItems, recorders] = await Promise.all([
    ids.length ? db.auditLog.findMany({ where: { organisationId: org, entityType: "CallNote", entityId: { in: ids } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    reviewItemIds.length ? db.careIntakeReviewItem.findMany({ where: { id: { in: reviewItemIds }, organisationId: org } }) : Promise.resolve([]),
    db.callNote.findMany({ where: { organisationId: org, serviceUserId: su.id }, select: { createdById: true }, distinct: ["createdById"] }),
  ]);
  const names = await memberNames(ctx, [...rows.flatMap((r) => [r.createdById, r.reviewedById, r.escalationById, ...r.tasks.flatMap((t) => [t.assigneeId, t.closedById]), ...r.revisions.map((v) => v.createdById)]), ...history.map((h) => h.actorId), ...recorders.map((r) => r.createdById), ...reviewItems.map((r) => r.resolvedById)]);
  const riById = new Map(reviewItems.map((r) => [r.id, r]));
  const superseding = rows.flatMap((r) => (r.supersededById ? [r.supersededById] : []));
  const supRefs = superseding.length ? new Map((await db.callNote.findMany({ where: { id: { in: superseding }, organisationId: org }, select: { id: true, reference: true } })).map((x) => [x.id, x.reference])) : new Map<string, string>();
  const notes = rows.map((r) => {
    const items = r.items
      .filter((i) => i.destination !== "MEDICATION" || access.medication || r.createdById === ctx.userId)
      .map((i) => {
        const ri = i.reviewItemId ? riById.get(i.reviewItemId) : null;
        const hideRi = ri?.restricted && !access.sensitive;
        return { ...i, dupHref: refHref(access, ctx, su.id, i.duplicateRef), review: ri && !hideRi ? { id: ri.id, status: ri.status, resolution: ri.resolution, resolvedBy: ri.resolvedById ? names.get(ri.resolvedById) ?? "Former member" : null, resolvedAt: ri.resolvedAt, canResolve: ri.status === "OPEN" && hasOrgPermission(ctx, ROUTE_PERM[i.destination] ?? "org.manage") } : null };
      });
    return {
      ...r,
      items,
      recordedBy: names.get(r.createdById) ?? "Former member",
      reviewedBy: r.reviewedById ? names.get(r.reviewedById) ?? "Former member" : null,
      escalatedBy: r.escalationById ? names.get(r.escalationById) ?? "Former member" : null,
      supersededByRef: r.supersededById ? supRefs.get(r.supersededById) ?? null : null,
      tasks: r.tasks.map((t) => ({ ...t, assignee: names.get(t.assigneeId) ?? "Former member", closedBy: t.closedById ? names.get(t.closedById) ?? "Former member" : null, overdue: t.status === "OPEN" && fromDbDate(t.dueOn) < londonDate(), canClose: t.status === "OPEN" && (t.assigneeId === ctx.userId || access.review) })),
      links: r.links.map((l) => ({ ...l, href: linkHref(access, ctx, su.id, l.targetType, l.targetId) })).filter((l) => l.href),
      revisions: r.revisions.map((v) => ({ ...v, by: names.get(v.createdById) ?? "Former member" })),
      history: history.filter((h) => h.entityId === r.id).map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actorId ? names.get(h.actorId) ?? "Former member" : "System" })),
      can: {
        review: access.review && r.status === "AWAITING_REVIEW" && r.createdById !== ctx.userId,
        correct: (r.createdById === ctx.userId || access.review) && access.record && ["AWAITING_REVIEW", "APPROVED", "CLARIFICATION_REQUESTED"].includes(r.status),
        continueDraft: r.status === "DRAFT" && r.createdById === ctx.userId,
        supersede: access.review && ["APPROVED", "AWAITING_REVIEW", "CLARIFICATION_REQUESTED"].includes(r.status),
        followUp: access.record && !["WITHDRAWN", "REJECTED", "DRAFT"].includes(r.status),
        escalate: access.review && r.urgentKinds.length > 0,
      },
    };
  });
  return { notes, total, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), hidden, filters: f, recorders: recorders.map((r) => ({ id: r.createdById, name: names.get(r.createdById) ?? "Former member" })), access };
}
export type CallNoteList = Awaited<ReturnType<typeof listCallNotes>>;
export type CallNoteView = CallNoteList["notes"][number];

/** Options for the Add Call Note form: the person's contacts and documents, and who can take a follow-up. */
export async function callNoteFormOptions(ctx: Ctx, serviceUserId: string) {
  const access = callNoteAccess(ctx);
  const su = await personFor(ctx, serviceUserId);
  const [contacts, documents, people, settings] = await Promise.all([
    db.serviceUserContact.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id }, select: { id: true, name: true, relationship: true, kind: true }, orderBy: { name: "asc" } }),
    db.serviceUserDocument.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id, archivedAt: null, ...(access.sensitive ? {} : { sensitive: false }) }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    assignablePeople(ctx),
    rotaSettings(db, su.organisationId),
  ]);
  const provider = getAiProvider();
  const ai = !!settings.careCoordinatorAiEnabledAt && !!provider?.organiseCallNote && !provider.isSimulated;
  return { contacts, documents, people, ai };
}

/** Records of this person the caller may link a note to, as "Type:id" refs with a label. */
export async function linkOptions(ctx: Ctx, serviceUserId: string) {
  const access = callNoteAccess(ctx);
  const su = await personFor(ctx, serviceUserId);
  const org = su.organisationId;
  const [plans, risks, contacts, docs, visits, incidents] = await Promise.all([
    db.carePlan.findMany({ where: { organisationId: org, serviceUserId: su.id }, select: { id: true, version: true, status: true }, orderBy: { version: "desc" }, take: 5 }),
    db.riskAssessment.findMany({ where: { organisationId: org, serviceUserId: su.id, status: { not: "ARCHIVED" } }, select: { id: true, title: true } }),
    db.serviceUserContact.findMany({ where: { organisationId: org, serviceUserId: su.id }, select: { id: true, name: true } }),
    db.serviceUserDocument.findMany({ where: { organisationId: org, serviceUserId: su.id, archivedAt: null, ...(access.sensitive ? {} : { sensitive: false }) }, select: { id: true, name: true }, take: 50 }),
    access.rota ? db.visit.findMany({ where: { organisationId: org, serviceUserId: su.id, date: { gte: dbDate(addDays(londonDate(), -14)), lte: dbDate(addDays(londonDate(), 14)) } }, select: { id: true, reference: true, date: true }, orderBy: { scheduledStart: "desc" }, take: 40 }) : Promise.resolve([]),
    access.incidents ? db.incident.findMany({ where: { ...incidentVisibleWhere(ctx, org), serviceUserId: su.id }, select: { id: true, reference: true, category: true }, orderBy: { occurredAt: "desc" }, take: 30 }) : Promise.resolve([]),
  ]);
  return [
    ...plans.map((p) => ({ ref: `CarePlan:${p.id}`, label: `Care plan v${p.version} (${p.status.toLowerCase()})` })),
    ...risks.map((r) => ({ ref: `RiskAssessment:${r.id}`, label: `Risk assessment: ${r.title}` })),
    ...incidents.map((i) => ({ ref: `Incident:${i.id}`, label: `Incident ${i.reference}: ${i.category}` })),
    ...visits.map((v) => ({ ref: `Visit:${v.id}`, label: `Visit ${v.reference ?? ""} on ${fromDbDate(v.date)}`.replace("  ", " ") })),
    ...contacts.map((c) => ({ ref: `Contact:${c.id}`, label: `Contact: ${c.name}` })),
    ...docs.map((d) => ({ ref: `Document:${d.id}`, label: `Document: ${d.name}` })),
  ];
}

/** The open draft being checked, with the organiser's items and duplicate findings, for its author only. */
export async function draftForReview(ctx: Ctx, noteId: string) {
  const { note, access } = await noteFor(ctx, noteId, "callNote.record");
  if (note.status !== "DRAFT" || note.createdById !== ctx.userId) return null;
  const items = await db.callNoteItem.findMany({ where: { callNoteId: note.id }, orderBy: { position: "asc" } });
  const proposal = note.proposal as unknown as Organised | null;
  return {
    note,
    items: items.map((i) => ({ ...i, dupHref: refHref(access, ctx, note.serviceUserId, i.duplicateRef), quoteFound: i.quoteFound && quoteInText(note.originalText, i.quote) })),
    followUps: proposal?.followUps ?? [],
    clarifications: proposal?.clarifications ?? [],
    urgent: proposal ? verifyProposal(note.originalText, proposal).urgent : [],
    people: await assignablePeople(ctx),
    defaultDue: addDays(londonDate(), 1),
  };
}

/** Kinds of statement for the form selects. */
export { KIND_KEYS, DESTINATION_KEYS, PRIORITIES };
export type { Kind, ItemDecision };

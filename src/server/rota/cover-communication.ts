import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fmtLondonDate, isIsoDate, londonDate, londonTime, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, visitWhere, type Scope } from "./scope";

/**
 * Contact & Communication inside Find Replacement Cover. The office reads the service user's current contact details,
 * phones or messages someone outside the platform, and records each attempt here. Nothing is sent from the platform:
 * recording an SMS or e-mail only records that staff sent one. Attempts are append-only (a database trigger refuses
 * edits); a correction is a new entry pointing at the original. Each attempt keeps a copy of the recipient's name and
 * the number or address used, and of the arrangements discussed, so later profile or rota changes never rewrite it.
 * Communication never blocks a booking; it is tracked as its own state per visit.
 */

type Tx = Prisma.TransactionClient;

export const METHOD_LABEL = { PHONE: "Telephone", SMS: "Text message (SMS)", EMAIL: "Email", OTHER: "Other" } as const;
export type Method = keyof typeof METHOD_LABEL;
export const OUTCOME_LABEL = { INFORMED: "Successfully informed", NO_ANSWER: "No answer", MESSAGE_LEFT: "Message left", UNSUCCESSFUL: "Contact unsuccessful", NOT_APPLICABLE: "Not applicable" } as const;
export type Outcome = keyof typeof OUTCOME_LABEL;
export const AUTHORITY_LABEL = { LPA_HEALTH: "Lasting power of attorney (health and welfare)", LPA_FINANCE: "Lasting power of attorney (property and financial affairs)", DEPUTY: "Court-appointed deputy", OTHER: "Other recorded authority" } as const;
export const PREFERRED_LABEL: Record<string, string> = { PHONE: "Telephone", SMS: "Text message", EMAIL: "Email", OTHER: "Other (see notes)" };

export type CommsKind = "NOT_CONTACTED" | "ATTEMPTED" | "INFORMED" | "NOT_APPLICABLE" | "UPDATE_NEEDED";
export const COMMS_LABEL: Record<CommsKind, string> = {
  NOT_CONTACTED: "Not yet contacted",
  ATTEMPTED: "Attempted — awaiting confirmation",
  INFORMED: "Informed",
  NOT_APPLICABLE: "Not applicable",
  UPDATE_NEEDED: "Updated arrangements need communicating",
};

// ── Telephone numbers ───────────────────────────────────────────────────

/** A tel: link for a recorded number, or null when the text is not a dialable number. Never guesses digits. */
export function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d{6,15}$/.test(s)) return null;
  return `tel:${s}`;
}

// ── Arrangements ────────────────────────────────────────────────────────

export interface Arrangement {
  visitId: string;
  reference: string;
  start: string;
  end: string;
  cancelled: boolean;
  carers: { slot: string; staffId: string; name: string }[];
}

type ArrangementVisit = { id: string; reference: string; status: string; scheduledStart: Date; scheduledEnd: Date; assignments: { slot: string; staffId: string; removedAt: Date | null; staff: { displayName: string } }[] };

/** The arrangements a service user would be told about: which visit, when, and who is coming (shadows left out). */
export function arrangementOf(v: ArrangementVisit): Arrangement {
  const carers = v.assignments
    .filter((a) => !a.removedAt && a.slot !== "SHADOW")
    .map((a) => ({ slot: a.slot, staffId: a.staffId, name: a.staff.displayName }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
  return { visitId: v.id, reference: v.reference, start: v.scheduledStart.toISOString(), end: v.scheduledEnd.toISOString(), cancelled: v.status === "CANCELLED", carers };
}

/** A stable key for comparing arrangements. Status changes such as clock-in do not count; carer, time or cancellation do. */
export function arrangementKey(a: Arrangement) {
  return [a.visitId, a.start, a.end, a.cancelled ? "cancelled" : "", ...a.carers.map((c) => `${c.slot}:${c.staffId}`)].join("|");
}

export function describeArrangement(a: Arrangement) {
  const start = new Date(a.start);
  const end = new Date(a.end);
  const when = `${fmtLondonDate(londonDate(start), { weekday: "short", day: "numeric", month: "short" })} ${londonTime(start)}–${londonTime(end)}`;
  if (a.cancelled) return `${a.reference} cancelled (was ${when})`;
  return `${a.reference}, ${when}, ${a.carers.length ? a.carers.map((c) => c.name).join(" and ") : "no carer booked yet"}`;
}

// ── State ───────────────────────────────────────────────────────────────

export interface AttemptLike {
  id: string;
  outcome: string;
  arrangementKey: string;
  contactedAt: Date;
  createdAt: Date;
  correctsId: string | null;
  notApplicableReason: string | null;
  followUpRequired: boolean;
  followUpOwnerId: string | null;
  followUpDueAt: Date | null;
  followUpDoneAt: Date | null;
}

export interface CommsState {
  kind: CommsKind;
  label: string;
  /** The latest attempt still in force (not corrected). */
  last: AttemptLike | null;
  /** Attempts still in force, oldest first. */
  effective: AttemptLike[];
  reason: string | null;
  followUp: { attemptId: string; ownerId: string | null; dueAt: Date | null; overdue: boolean } | null;
}

const byTime = (a: AttemptLike, b: AttemptLike) => a.contactedAt.getTime() - b.contactedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime();

/**
 * The overall communication state for one visit's arrangements. Pure, so it is tested directly.
 * - Not yet contacted: no attempt in force. This is a state, never a fabricated attempt.
 * - A message left, no answer or an unsuccessful contact is "attempted — awaiting confirmation", never "informed".
 * - Informed only when someone was successfully told about the arrangements as they stand now; if the carer, time or
 *   visit changed since, the earlier record stays and the state becomes "updated arrangements need communicating".
 * - A corrected entry is replaced by its correction.
 */
export function communicationState(attempts: AttemptLike[], currentKey: string, now = new Date()): CommsState {
  const corrected = new Set(attempts.map((a) => a.correctsId).filter((x): x is string => !!x));
  const effective = attempts.filter((a) => !corrected.has(a.id)).sort(byTime);
  const last = effective.at(-1) ?? null;
  const open = [...effective].reverse().find((a) => a.followUpRequired && !a.followUpDoneAt) ?? null;
  const followUp = open ? { attemptId: open.id, ownerId: open.followUpOwnerId, dueAt: open.followUpDueAt, overdue: !!open.followUpDueAt && open.followUpDueAt < now } : null;
  const out = (kind: CommsKind, reason: string | null = null): CommsState => ({ kind, label: COMMS_LABEL[kind], last, effective, reason, followUp });
  if (!effective.length) return out("NOT_CONTACTED");
  const decisive = [...effective].reverse().find((a) => a.outcome === "INFORMED" || a.outcome === "NOT_APPLICABLE");
  if (decisive?.outcome === "NOT_APPLICABLE") return out("NOT_APPLICABLE", decisive.notApplicableReason);
  if (decisive?.outcome === "INFORMED") {
    if (effective.some((a) => a.outcome === "INFORMED" && a.arrangementKey === currentKey && a.contactedAt >= decisive.contactedAt)) return out("INFORMED");
    return out("UPDATE_NEEDED");
  }
  return out("ATTEMPTED");
}

/** Whether a state still needs the office to act. */
export const commsOutstanding = (k: CommsKind) => k === "NOT_CONTACTED" || k === "ATTEMPTED" || k === "UPDATE_NEEDED";

// ── Reading ─────────────────────────────────────────────────────────────

const arrangementVisitSelect = {
  id: true, reference: true, status: true, scheduledStart: true, scheduledEnd: true, serviceUserId: true, organisationId: true, areaId: true, recoveryOfId: true,
  serviceUser: { select: { areaId: true, branchId: true } },
  assignments: { select: { slot: true, staffId: true, removedAt: true, staff: { select: { displayName: true } } } },
} satisfies Prisma.VisitSelect;

/** The visit and (for a recovery visit or a missed visit with a case) the case its communication belongs to. */
async function loadTarget(tx: Tx | typeof db, scope: Scope, visitId: string, caseId?: string | null) {
  const v = await tx.visit.findFirst({ where: { AND: [visitWhere(scope), { id: visitId }] }, select: arrangementVisitSelect });
  if (!v) throw new NotFoundError("Visit");
  let c: { id: string; visitId: string; serviceUserId: string } | null = null;
  if (caseId) {
    c = await tx.missedCallCase.findFirst({ where: { id: caseId, organisationId: scope.organisationId }, select: { id: true, visitId: true, serviceUserId: true } });
    // The case must be this visit's own case, or the case of the missed visit this visit recovers.
    if (!c || c.serviceUserId !== v.serviceUserId || (c.visitId !== v.id && c.visitId !== v.recoveryOfId)) throw new NotFoundError("Missed call");
  }
  return { visit: v, case: c };
}

/** The service user's own details and their contacts, from the current profile. Needs serviceUser.view. */
export async function coverContacts(ctx: Ctx, serviceUserId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (!hasOrgPermission(ctx, "serviceUser.view")) return null;
  const su = await db.serviceUser.findFirst({
    where: { id: serviceUserId, organisationId: scope.organisationId },
    select: {
      id: true, firstName: true, lastName: true, preferredName: true, phone: true, altPhone: true, email: true, preferredContactMethod: true, communicationNeeds: true, firstLanguage: true, areaId: true, branchId: true,
      contacts: { orderBy: [{ isPrimary: "desc" }, { isEmergency: "desc" }, { name: "asc" }] },
    },
  });
  if (!su) throw new NotFoundError("Service user");
  if (scope.areaIds && su.areaId && !scope.areaIds.includes(su.areaId)) throw new NotFoundError("Service user");
  if (scope.branchIds && su.branchId && !scope.branchIds.includes(su.branchId)) throw new NotFoundError("Service user");
  const contacts = su.contacts.map((c) => ({
    id: c.id, kind: c.kind, name: c.name, relationship: c.relationship, phone: c.phone, altPhone: c.altPhone, email: c.email, preferredContactMethod: c.preferredContactMethod,
    isPrimary: c.isPrimary, isEmergency: c.isEmergency, canReceiveUpdates: c.canReceiveUpdates,
    authority: authorityOf(c),
  }));
  return {
    serviceUser: { id: su.id, name: `${su.preferredName || su.firstName} ${su.lastName}`, fullName: `${su.firstName} ${su.lastName}`, phone: su.phone, altPhone: su.altPhone, email: su.email, preferredContactMethod: su.preferredContactMethod, communicationNeeds: su.communicationNeeds, firstLanguage: su.firstLanguage },
    contacts,
    canEdit: hasOrgPermission(ctx, "serviceUser.edit"),
  };
}
export type CoverContacts = NonNullable<Awaited<ReturnType<typeof coverContacts>>>;
export type CoverContact = CoverContacts["contacts"][number];

/** Recorded authority only: a lasting power of attorney recorded as the contact's type, or the authority fields. Never inferred from next of kin. */
export function authorityOf(c: { kind: string; authorityType: string | null; authorityScope: string | null }) {
  const type = c.authorityType ?? (c.kind === "LPA_HEALTH" || c.kind === "LPA_FINANCE" ? c.kind : null);
  if (!type) return null;
  return { type, label: AUTHORITY_LABEL[type as keyof typeof AUTHORITY_LABEL] ?? "Recorded authority", scope: c.authorityScope };
}

const attemptSelect = {
  id: true, visitId: true, missedCallCaseId: true, missedCallCoverId: true, recipientKind: true, contactId: true, recipientName: true, recipientRelationship: true, recipientAddress: true, recipientAuthority: true,
  method: true, outcome: true, notApplicableReason: true, notes: true, arrangement: true, arrangementKey: true, contactedAt: true, createdAt: true, createdById: true,
  followUpRequired: true, followUpOwnerId: true, followUpDueAt: true, followUpDoneAt: true, followUpDoneById: true, followUpDoneNote: true, correctsId: true, correctionReason: true,
} satisfies Prisma.CoverContactAttemptSelect;
export type AttemptRow = Prisma.CoverContactAttemptGetPayload<{ select: typeof attemptSelect }>;

/** Attempts that belong to a visit's arrangements: on the visit itself, and for a recovery visit those on its case. */
function attemptsWhere(organisationId: string, visitId: string, caseId: string | null): Prisma.CoverContactAttemptWhereInput {
  return { organisationId, OR: [{ visitId }, ...(caseId ? [{ missedCallCaseId: caseId }] : [])] };
}

/**
 * Everything the Contact & Communication section shows for one visit: the current contacts, the history (oldest first,
 * corrections next to what they correct), the overall state against the arrangements as they stand now, the open
 * follow-up and the people a follow-up can be given to.
 */
export async function communicationView(ctx: Ctx, target: { visitId: string; caseId?: string | null }, now = new Date()) {
  const scope = await rotaScope(ctx, "rota.edit");
  const { visit, case: c } = await loadTarget(db, scope, target.visitId, target.caseId);
  const arrangement = arrangementOf(visit);
  const key = arrangementKey(arrangement);
  const attempts = await db.coverContactAttempt.findMany({ where: attemptsWhere(scope.organisationId, visit.id, c?.id ?? null), select: attemptSelect, orderBy: [{ contactedAt: "asc" }, { createdAt: "asc" }], take: 200 });
  const state = communicationState(attempts, key, now);
  const contacts = await coverContacts(ctx, visit.serviceUserId);
  const owners = await db.membership.findMany({ where: { organisationId: scope.organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] }, deactivatedAt: null }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
  const names = new Map(owners.map((o) => [o.userId, o.user.name]));
  const missing = [...new Set(attempts.flatMap((a) => [a.createdById, a.followUpOwnerId, a.followUpDoneById]).filter((x): x is string => !!x && !names.has(x)))];
  if (missing.length) for (const m of await db.membership.findMany({ where: { organisationId: scope.organisationId, userId: { in: missing } }, select: { userId: true, user: { select: { name: true } } } })) names.set(m.userId, m.user.name);
  const correctedBy = new Map(attempts.filter((a) => a.correctsId).map((a) => [a.correctsId!, a.id]));
  return {
    visit: { id: visit.id, reference: visit.reference, serviceUserId: visit.serviceUserId }, caseId: c?.id ?? null,
    arrangement, arrangementText: describeArrangement(arrangement), key,
    attempts, state, contacts, correctedBy,
    owners: owners.map((o) => ({ id: o.userId, name: o.user.name })),
    names, me: ctx.userId,
  };
}
export type CommunicationView = Awaited<ReturnType<typeof communicationView>>;

// ── Recording ───────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max).optional().transform((s) => s || undefined);
const attemptSchema = z.object({
  visitId: z.string().min(1).max(40),
  caseId: z.string().max(40).optional().transform((s) => s || undefined),
  /** "su" (the service user), a contact id, or "other". */
  recipient: z.string().min(1, "Choose who you contacted").max(40),
  /** Which recorded number or address was used: phone | altPhone | email | other. */
  via: z.enum(["phone", "altPhone", "email", "other"], { message: "Choose the number or address you used" }),
  otherName: text(200),
  otherRelationship: text(100),
  otherAddress: text(200),
  method: z.enum(["PHONE", "SMS", "EMAIL", "OTHER"], { message: "Choose how you made contact" }),
  outcome: z.enum(["INFORMED", "NO_ANSWER", "MESSAGE_LEFT", "UNSUCCESSFUL", "NOT_APPLICABLE"], { message: "Choose the outcome" }),
  notApplicableReason: text(500),
  notes: text(2000),
  /** Only when the contact happened earlier than now (London date and time). */
  contactedDate: text(10),
  contactedTime: text(5),
  followUp: z.boolean().default(false),
  followUpOwnerId: text(40),
  followUpDate: text(10),
  followUpTime: text(5),
  clientToken: z.string().min(8, "Reload the page and try again").max(64),
});
/** Form fields arrive as plain strings; the schema decides what is allowed. */
type Loose<T> = { [K in keyof T]: T[K] extends string | undefined ? string | undefined : T[K] };
export type AttemptInput = Loose<z.input<typeof attemptSchema>>;

/** The London date and time given, or null when both are empty. */
function londonAt(date: string | undefined, time: string | undefined, what: string) {
  if (!date && !time) return null;
  if (!date || !isIsoDate(date)) throw new ValidationError(`Enter the ${what} date`);
  const m = parseHhmm(time ?? "");
  if (m === null) throw new ValidationError(`Enter the ${what} time, such as 14:05`);
  return londonToUtc(date, m);
}

async function resolveRecipient(tx: Tx, scope: Scope, serviceUserId: string, d: z.output<typeof attemptSchema>) {
  const pick = (vals: { phone?: string | null; altPhone?: string | null; email?: string | null }) => {
    if (d.via === "other") {
      if (!d.otherAddress) throw new ValidationError("Enter the number or address you used");
      return d.otherAddress;
    }
    const v = vals[d.via];
    if (!v) throw new ValidationError(d.via === "email" ? "There is no email address recorded for them. Choose another way, or enter the address you used." : "That number is not recorded for them. Choose another number, or enter the one you used.");
    return v;
  };
  if (d.recipient === "su") {
    const su = await tx.serviceUser.findFirstOrThrow({ where: { id: serviceUserId, organisationId: scope.organisationId }, select: { firstName: true, lastName: true, phone: true, altPhone: true, email: true } });
    return { recipientKind: "SERVICE_USER", contactId: null, recipientName: `${su.firstName} ${su.lastName}`, recipientRelationship: "Service user", recipientAuthority: null, recipientAddress: pick(su) };
  }
  if (d.recipient === "other") {
    if (!d.otherName || d.otherName.length < 2) throw new ValidationError("Enter the name of the person you contacted");
    if (d.via !== "other") throw new ValidationError("Enter the number or address you used");
    return { recipientKind: "OTHER", contactId: null, recipientName: d.otherName, recipientRelationship: d.otherRelationship ?? null, recipientAuthority: null, recipientAddress: pick({}) };
  }
  // A contact must be one of this service user's own contacts in this organisation.
  const c = await tx.serviceUserContact.findFirst({ where: { id: d.recipient, serviceUserId, organisationId: scope.organisationId } });
  if (!c) throw new NotFoundError("Contact");
  const auth = authorityOf(c);
  return { recipientKind: "CONTACT", contactId: c.id, recipientName: c.name, recipientRelationship: c.relationship ?? null, recipientAuthority: auth ? `${auth.label}${auth.scope ? `: ${auth.scope}` : ""}` : null, recipientAddress: pick(c) };
}

async function checkOwner(tx: Tx, organisationId: string, userId: string) {
  const m = await tx.membership.findFirst({ where: { organisationId, userId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER", "CARE_COORDINATOR"] }, deactivatedAt: null }, select: { userId: true } });
  if (!m) throw new ValidationError("Choose a coordinator or manager in your organisation for the follow-up");
}

const CASE_INFORMED: Record<Outcome, string | null> = { INFORMED: "INFORMED", NO_ANSWER: "COULD_NOT_REACH", MESSAGE_LEFT: "COULD_NOT_REACH", UNSUCCESSFUL: "COULD_NOT_REACH", NOT_APPLICABLE: null };

async function writeAttempt(tx: Tx, ctx: Ctx, scope: Scope, d: z.output<typeof attemptSchema>, now: Date, correction?: { of: AttemptRow; reason: string }) {
  const { visit, case: c } = await loadTarget(tx, scope, d.visitId, d.caseId);
  if (d.outcome === "NOT_APPLICABLE" && (d.notApplicableReason ?? "").length < 5) throw new ValidationError("Say why contact is not applicable (at least 5 characters)");
  const at = londonAt(d.contactedDate, d.contactedTime, "contact");
  if (at && at.getTime() > now.getTime() + 2 * 60_000) throw new ValidationError("The contact time cannot be in the future");
  if (at && at.getTime() < now.getTime() - 14 * 86400_000) throw new ValidationError("Record contact from the last 14 days only");
  let followUp: { ownerId: string; dueAt: Date } | null = null;
  if (d.followUp) {
    const ownerId = d.followUpOwnerId ?? ctx.userId;
    await checkOwner(tx, scope.organisationId, ownerId);
    const dueAt = londonAt(d.followUpDate, d.followUpTime, "follow-up");
    if (!dueAt) throw new ValidationError("Choose when the follow-up is due");
    if (dueAt.getTime() > now.getTime() + 30 * 86400_000) throw new ValidationError("Set a follow-up within the next 30 days");
    followUp = { ownerId, dueAt };
  }
  const who = await resolveRecipient(tx, scope, visit.serviceUserId, d);
  const arrangement = arrangementOf(visit);
  const cover = c ? await tx.missedCallCover.findFirst({ where: { caseId: c.id, recoveryVisitId: visit.id }, orderBy: { confirmedAt: "desc" }, select: { id: true } }) : null;
  const row = await tx.coverContactAttempt.create({
    data: {
      organisationId: scope.organisationId, serviceUserId: visit.serviceUserId, visitId: visit.id, missedCallCaseId: c?.id ?? null, missedCallCoverId: cover?.id ?? null,
      ...who, method: d.method, outcome: d.outcome, notApplicableReason: d.outcome === "NOT_APPLICABLE" ? d.notApplicableReason ?? null : null, notes: d.notes ?? null,
      arrangement: arrangement as unknown as Prisma.InputJsonValue, arrangementKey: arrangementKey(arrangement),
      contactedAt: at ?? now, createdById: ctx.userId,
      followUpRequired: !!followUp, followUpOwnerId: followUp?.ownerId ?? null, followUpDueAt: followUp?.dueAt ?? null,
      correctsId: correction?.of.id ?? null, correctionReason: correction?.reason ?? null,
      clientToken: d.clientToken,
    },
    select: { id: true },
  });
  // A new attempt is the follow-up of earlier ones: their open follow-ups close, with this entry as the reason.
  if (!correction) {
    await tx.coverContactAttempt.updateMany({ where: { ...attemptsWhere(scope.organisationId, visit.id, c?.id ?? null), id: { not: row.id }, followUpRequired: true, followUpDoneAt: null }, data: { followUpDoneAt: now, followUpDoneById: ctx.userId, followUpDoneNote: "Followed up by a later attempt" } });
  }
  if (c) {
    const status = CASE_INFORMED[d.outcome];
    const summary = `${correction ? "Correction: " : ""}${OUTCOME_LABEL[d.outcome]} — ${who.recipientName}${who.recipientRelationship ? ` (${who.recipientRelationship})` : ""} by ${METHOD_LABEL[d.method].toLowerCase()}`;
    if (status) await tx.missedCallCase.update({ where: { id: c.id }, data: { suInformedStatus: status === "INFORMED" && who.recipientKind !== "SERVICE_USER" ? "REPRESENTATIVE_INFORMED" : status, suInformedNote: summary.slice(0, 300), suInformedById: ctx.userId, suInformedAt: at ?? now, clientInformed: summary.slice(0, 300), lockVersion: { increment: 1 } } });
    await tx.missedCallComment.create({ data: { organisationId: scope.organisationId, caseId: c.id, authorId: ctx.userId, kind: "SYSTEM", body: `Communication recorded: ${summary}.` } });
  }
  await tx.visitEvent.create({ data: { organisationId: scope.organisationId, visitId: visit.id, type: correction ? "CONTACT_CORRECTED" : "CONTACT_RECORDED", actorId: ctx.userId, data: { attemptId: row.id, outcome: d.outcome, method: d.method, recipientKind: who.recipientKind, caseId: c?.id ?? null } } });
  // The audit entry holds ids and outcomes only: no numbers, names or notes.
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: correction ? "rota.cover.contact.corrected" : "rota.cover.contact.recorded", entityType: "Visit", entityId: visit.id, data: { attemptId: row.id, outcome: d.outcome, method: d.method, recipientKind: who.recipientKind, caseId: c?.id ?? null, ...(correction ? { corrects: correction.of.id } : {}), followUp: !!followUp } }, tx);
  return row;
}

function isTokenClash(e: unknown) {
  // The only unique key a new attempt can clash on is its form token.
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Saves one communication attempt. Independent of booking: it can be recorded before or after cover is booked, and
 * as many times as needed. A repeated submission of the same form (same token) returns the entry already saved.
 */
export async function recordContactAttempt(ctx: Ctx, raw: AttemptInput, now = new Date()) {
  const p = attemptSchema.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the communication details");
  const scope = await rotaScope(ctx, "rota.edit");
  const existing = await db.coverContactAttempt.findUnique({ where: { organisationId_clientToken: { organisationId: scope.organisationId, clientToken: p.data.clientToken } }, select: { id: true } });
  if (existing) return { id: existing.id, duplicate: true };
  try {
    const row = await db.$transaction((tx) => writeAttempt(tx, ctx, scope, p.data, now));
    return { id: row.id, duplicate: false };
  } catch (e) {
    if (isTokenClash(e)) {
      const again = await db.coverContactAttempt.findUnique({ where: { organisationId_clientToken: { organisationId: scope.organisationId, clientToken: p.data.clientToken } }, select: { id: true } });
      if (again) return { id: again.id, duplicate: true };
    }
    throw e;
  }
}

/**
 * Corrects an entry by recording a new one that points at it, with the reason. The original stays, unchanged, and is
 * shown as corrected. Only the latest version of an entry can be corrected, so two people cannot fork it.
 */
export async function correctContactAttempt(ctx: Ctx, attemptId: string, raw: AttemptInput & { reason?: string }, now = new Date()) {
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 5) throw new ValidationError("Give the reason for the correction (at least 5 characters)");
  const scope = await rotaScope(ctx, "rota.edit");
  const of = await db.coverContactAttempt.findFirst({ where: { id: attemptId, organisationId: scope.organisationId }, select: attemptSelect });
  if (!of) throw new NotFoundError("Communication entry");
  const p = attemptSchema.safeParse({ ...raw, visitId: of.visitId, caseId: of.missedCallCaseId ?? undefined });
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the correction");
  const existing = await db.coverContactAttempt.findUnique({ where: { organisationId_clientToken: { organisationId: scope.organisationId, clientToken: p.data.clientToken } }, select: { id: true } });
  if (existing) return { id: existing.id, duplicate: true };
  try {
    const row = await db.$transaction(async (tx) => {
      // Serialise corrections of the same entry.
      await tx.$queryRaw`SELECT id FROM "CoverContactAttempt" WHERE id = ${of.id} FOR UPDATE`;
      if (await tx.coverContactAttempt.findFirst({ where: { correctsId: of.id }, select: { id: true } })) throw new ConflictError("This entry has already been corrected. Reload and correct the latest version.");
      if (!p.data.contactedDate && !p.data.contactedTime) {
        // Keep the original time of contact unless the correction gives another.
        p.data.contactedDate = londonDate(of.contactedAt);
        p.data.contactedTime = londonTime(of.contactedAt);
      }
      return writeAttempt(tx, ctx, scope, p.data, now, { of, reason: reason.slice(0, 1000) });
    });
    return { id: row.id, duplicate: false };
  } catch (e) {
    if (isTokenClash(e)) return { id: "", duplicate: true };
    throw e;
  }
}

/** Closes an open follow-up without a new attempt (for example, the family phoned back), with a note. */
export async function closeContactFollowUp(ctx: Ctx, attemptId: string, note: string) {
  const n = note.trim();
  if (n.length < 3) throw new ValidationError("Say how the follow-up was dealt with");
  const scope = await rotaScope(ctx, "rota.edit");
  await db.$transaction(async (tx) => {
    const a = await tx.coverContactAttempt.findFirst({ where: { id: attemptId, organisationId: scope.organisationId }, select: { id: true, visitId: true, followUpRequired: true, followUpDoneAt: true } });
    if (!a) throw new NotFoundError("Communication entry");
    await loadTarget(tx, scope, a.visitId);
    if (!a.followUpRequired) throw new ValidationError("This entry has no follow-up");
    const done = await tx.coverContactAttempt.updateMany({ where: { id: a.id, followUpDoneAt: null }, data: { followUpDoneAt: new Date(), followUpDoneById: ctx.userId, followUpDoneNote: n.slice(0, 500) } });
    if (!done.count) throw new ConflictError("This follow-up has already been closed");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.cover.contact.followup-closed", entityType: "Visit", entityId: a.visitId, data: { attemptId: a.id } }, tx);
  });
}

// ── Outstanding communication (Visits Needing Attention) ────────────────

/** Booking sources that mean the office arranged cover and should tell the service user. */
export const COVER_SOURCES = ["find-cover", "replace-cover", "missed-cover"];

export interface OutstandingItem {
  visitId: string;
  reference: string;
  serviceUserId: string;
  serviceUser: string;
  start: Date;
  end: Date;
  caseId: string | null;
  state: CommsState;
  ownerId: string | null;
  owner: string;
  dueAt: Date;
  overdue: boolean;
}

/**
 * Visits whose cover was arranged through Find Cover (or that already have communication recorded) and where the
 * service user's side is still outstanding: not yet contacted, attempted without confirmation, or arrangements changed
 * since they were told. The coordinator responsible is the open follow-up's owner, else whoever booked the cover; it is
 * due at the follow-up time, else when the visit starts. Bounded to visits from 24 hours ago to 14 days ahead.
 */
export async function outstandingCommunication(ctx: Ctx, now = new Date(), take = 50): Promise<{ items: OutstandingItem[]; total: number }> {
  const scope = await rotaScope(ctx, "rota.edit");
  const from = new Date(now.getTime() - 24 * 3600_000);
  const to = new Date(now.getTime() + 14 * 86400_000);
  const inWindow: Prisma.VisitWhereInput = { AND: [visitWhere(scope), { scheduledEnd: { gte: from }, scheduledStart: { lte: to }, status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "MISSED", "CANCELLED"] } }] };
  const booked = await db.visitEvent.findMany({
    where: { organisationId: scope.organisationId, type: { in: ["ASSIGNED", "REASSIGNED"] }, OR: COVER_SOURCES.map((s) => ({ data: { path: ["source"], equals: s } })), visit: inWindow },
    select: { visitId: true, actorId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  const withAttempts = await db.coverContactAttempt.findMany({ where: { organisationId: scope.organisationId, visit: inWindow }, select: { visitId: true }, distinct: ["visitId"], take: 2000 });
  const bookedBy = new Map<string, string | null>();
  for (const b of booked) bookedBy.set(b.visitId, b.actorId);
  const ids = [...new Set([...bookedBy.keys(), ...withAttempts.map((a) => a.visitId)])];
  if (!ids.length) return { items: [], total: 0 };
  const visits = await db.visit.findMany({
    where: { id: { in: ids } },
    select: { ...arrangementVisitSelect, serviceUser: { select: { areaId: true, branchId: true, firstName: true, lastName: true, preferredName: true } }, recoveryOf: { select: { missedCallCase: { select: { id: true } } } }, missedCallCase: { select: { id: true } } },
  });
  const caseIds = visits.map((v) => v.recoveryOf?.missedCallCase?.id ?? v.missedCallCase?.id).filter((x): x is string => !!x);
  const attempts = await db.coverContactAttempt.findMany({ where: { organisationId: scope.organisationId, OR: [{ visitId: { in: ids } }, { missedCallCaseId: { in: caseIds } }] }, select: attemptSelect });
  const items: OutstandingItem[] = [];
  for (const v of visits) {
    // A cancelled visit needs no "who is coming" message unless the person was already told something.
    const caseId = v.recoveryOf?.missedCallCase?.id ?? v.missedCallCase?.id ?? null;
    const mine = attempts.filter((a) => a.visitId === v.id || (!!v.recoveryOfId && !!caseId && a.missedCallCaseId === caseId));
    if (v.status === "CANCELLED" && !mine.length) continue;
    // A missed visit that has a recovery visit is tracked on the recovery visit.
    if (v.status === "MISSED" && visits.some((x) => x.recoveryOfId === v.id)) continue;
    const state = communicationState(mine, arrangementKey(arrangementOf(v)), now);
    if (!commsOutstanding(state.kind) && !state.followUp) continue;
    const ownerId = state.followUp?.ownerId ?? bookedBy.get(v.id) ?? mine.at(-1)?.createdById ?? null;
    const dueAt = state.followUp?.dueAt ?? v.scheduledStart;
    items.push({ visitId: v.id, reference: v.reference, serviceUserId: v.serviceUserId, serviceUser: `${v.serviceUser.preferredName || v.serviceUser.firstName} ${v.serviceUser.lastName}`, start: v.scheduledStart, end: v.scheduledEnd, caseId, state, ownerId, owner: "", dueAt, overdue: dueAt < now });
  }
  const names = new Map((await db.membership.findMany({ where: { organisationId: scope.organisationId, userId: { in: items.map((i) => i.ownerId).filter((x): x is string => !!x) } }, select: { userId: true, user: { select: { name: true } } } })).map((m) => [m.userId, m.user.name]));
  for (const i of items) i.owner = i.ownerId ? names.get(i.ownerId) ?? "Former member" : "Not assigned";
  items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return { items: items.slice(0, take), total: items.length };
}

/** The communication state of a set of visits, for lists (one query). */
export async function communicationStates(ctx: Ctx, visitIds: string[], now = new Date()) {
  const scope = await rotaScope(ctx, "rota.view");
  const out = new Map<string, CommsState>();
  if (!visitIds.length) return out;
  const visits = await db.visit.findMany({ where: { AND: [visitWhere(scope), { id: { in: visitIds } }] }, select: { ...arrangementVisitSelect, recoveryOf: { select: { missedCallCase: { select: { id: true } } } } } });
  const caseIds = visits.map((v) => v.recoveryOf?.missedCallCase?.id).filter((x): x is string => !!x);
  const attempts = await db.coverContactAttempt.findMany({ where: { organisationId: scope.organisationId, OR: [{ visitId: { in: visitIds } }, { missedCallCaseId: { in: caseIds } }] }, select: attemptSelect });
  for (const v of visits) {
    const caseId = v.recoveryOf?.missedCallCase?.id ?? null;
    out.set(v.id, communicationState(attempts.filter((a) => a.visitId === v.id || (caseId && a.missedCallCaseId === caseId)), arrangementKey(arrangementOf(v)), now));
  }
  return out;
}

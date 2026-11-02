import type { Prisma, ServiceUserStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate, londonToUtc } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";
import { cancelVisitInTx } from "@/server/rota/visits";
import { reviewStaffImpact } from "@/server/workforce/impact";
import { decryptKeySafe, encryptKeySafe } from "./keysafe";

/**
 * Service users: the people the organisation supports. Every read and write is scoped to the caller's organisation
 * and (for area-limited coordinators) their areas. Date of birth and NHS number need serviceUser.sensitive; the
 * key safe code is stored encrypted and each reveal is audited.
 */

type Tx = Prisma.TransactionClient;

export interface ServiceUserFilters {
  q?: string;
  status?: ServiceUserStatus | "CURRENT";
  areaId?: string;
}

export async function listServiceUsers(ctx: Ctx, f: ServiceUserFilters) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const where: Prisma.ServiceUserWhereInput = {
    ...serviceUserWhere(scope),
    ...(f.status === "CURRENT" || !f.status ? { status: { in: ["ENQUIRY", "ASSESSMENT", "ACTIVE", "PAUSED"] } } : { status: f.status }),
    ...(f.areaId ? { areaId: f.areaId } : {}),
    ...(f.q ? { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }, { preferredName: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } }, { postcode: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  return db.serviceUser.findMany({
    where,
    select: { id: true, reference: true, firstName: true, lastName: true, preferredName: true, status: true, postcode: true, town: true, riskLevel: true, carerGenderPreference: true, branchId: true, area: { select: { name: true, colour: true } }, packages: { where: { status: "ACTIVE" }, select: { commissionedMinutesPerWeek: true } }, _count: { select: { templates: { where: { enabled: true } } } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });
}

async function loadSu(tx: Tx | typeof db, scope: Scope, id: string) {
  const su = await tx.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id } });
  if (!su) throw new NotFoundError("Service user");
  return su;
}

export async function getServiceUser(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await db.serviceUser.findFirst({
    where: { ...serviceUserWhere(scope), id },
    include: {
      area: true,
      branch: { select: { name: true } },
      // Only a demonstration organisation's people are labelled as fictional; real records never are.
      organisation: { select: { isDemo: true } },
      contacts: { orderBy: [{ isEmergency: "desc" }, { name: "asc" }] },
      packages: { orderBy: { startDate: "desc" }, include: { funder: { select: { name: true } } } },
      absences: { where: { cancelledAt: null, OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }, orderBy: { startsAt: "asc" } },
      carerPreferences: { include: { staff: { select: { id: true, displayName: true } } }, orderBy: { updatedAt: "desc" } },
      templates: { where: { enabled: true }, include: { callType: { select: { name: true } } }, orderBy: { startMinute: "asc" } },
    },
  });
  if (!su) throw new NotFoundError("Service user");
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const { keySafeCipher, dateOfBirth, nhsNumber, ...rest } = su;
  return { ...rest, hasKeySafe: !!keySafeCipher, dateOfBirth: sensitive ? dateOfBirth : null, nhsNumber: sensitive ? nhsNumber : null, sensitiveHidden: !sensitive };
}

const opt = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s || null)
  .nullable()
  .optional();
const detailsSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(100),
  lastName: z.string().trim().min(1, "Enter a last name").max(100),
  preferredName: opt,
  dateOfBirth: z.string().refine((d) => !d || isIsoDate(d), "Enter a valid date of birth").optional(),
  nhsNumber: z.string().trim().refine((s) => !s || /^\d{3} ?\d{3} ?\d{4}$/.test(s), "An NHS number has 10 digits").optional(),
  gender: opt,
  areaId: opt,
  addressLine1: opt,
  addressLine2: opt,
  town: opt,
  postcode: z.string().trim().max(10).optional(),
  phone: opt,
  altPhone: opt,
  preferredContactMethod: z.enum(["PHONE", "SMS", "EMAIL", "OTHER"]).or(z.literal("")).optional(),
  accessNotes: z.string().trim().max(2000).optional(),
  carerGenderPreference: z.enum(["ANY", "FEMALE", "MALE"]),
  firstLanguage: opt,
  communicationNeeds: z.string().trim().max(2000).optional(),
  carePreferences: z.string().trim().max(2000).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
  riskSummary: z.string().trim().max(2000).optional(),
});
export type ServiceUserInput = z.input<typeof detailsSchema>;

async function checkArea(tx: Tx, scope: Scope, areaId: string | null | undefined) {
  if (!areaId) {
    if (scope.areaIds) throw new ValidationError("Choose one of your areas");
    return null;
  }
  const a = await tx.area.findFirst({ where: { id: areaId, organisationId: scope.organisationId } });
  if (!a || (scope.areaIds && !scope.areaIds.includes(a.id))) throw new NotFoundError("Area");
  return a;
}

function detailData(ctx: Ctx, d: z.output<typeof detailsSchema>) {
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  return {
    firstName: d.firstName,
    lastName: d.lastName,
    preferredName: d.preferredName ?? null,
    gender: d.gender ?? null,
    addressLine1: d.addressLine1 ?? null,
    addressLine2: d.addressLine2 ?? null,
    town: d.town ?? null,
    postcode: d.postcode?.toUpperCase() || null,
    phone: d.phone ?? null,
    // Optional contact fields: left as they are when a form does not send them, never invented.
    ...(d.altPhone !== undefined ? { altPhone: d.altPhone ?? null } : {}),
    ...(d.preferredContactMethod !== undefined ? { preferredContactMethod: d.preferredContactMethod || null } : {}),
    accessNotes: d.accessNotes || null,
    carerGenderPreference: d.carerGenderPreference,
    firstLanguage: d.firstLanguage ?? null,
    communicationNeeds: d.communicationNeeds || null,
    carePreferences: d.carePreferences || null,
    riskLevel: d.riskLevel ?? null,
    riskSummary: d.riskSummary || null,
    // Sensitive identifiers are only written by people allowed to see them; otherwise they are left untouched.
    ...(sensitive ? { dateOfBirth: d.dateOfBirth ? dbDate(d.dateOfBirth) : null, nhsNumber: d.nhsNumber?.replace(/\s/g, "") || null } : {}),
  };
}

export async function createServiceUser(ctx: Ctx, input: ServiceUserInput | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const r = detailsSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the details");
  return db.$transaction(async (tx) => {
    const area = await checkArea(tx, scope, r.data.areaId);
    const count = await tx.serviceUser.count({ where: { organisationId: scope.organisationId } });
    let reference = `SU-${String(101 + count)}`;
    for (let n = 1; await tx.serviceUser.findFirst({ where: { organisationId: scope.organisationId, reference } }); n++) reference = `SU-${String(101 + count + n)}`;
    const su = await tx.serviceUser.create({ data: { organisationId: scope.organisationId, reference, status: "ASSESSMENT", areaId: area?.id ?? null, branchId: area?.branchId ?? null, createdById: ctx.userId, ...detailData(ctx, r.data) } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.created", entityType: "ServiceUser", entityId: su.id }, tx);
    return su;
  });
}

export async function updateServiceUser(ctx: Ctx, id: string, version: number, input: ServiceUserInput | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const r = detailsSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the details");
  return db.$transaction(async (tx) => {
    const before = await loadSu(tx, scope, id);
    if (before.version !== version) throw new ConflictError("Someone else changed this record since you opened it. Reload and try again.");
    const area = await checkArea(tx, scope, r.data.areaId);
    const data = { ...detailData(ctx, r.data), areaId: area?.id ?? null, branchId: area?.branchId ?? before.branchId };
    const updated = await tx.serviceUser.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(updated[k]));
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.updated", entityType: "ServiceUser", entityId: id, data: { changed } }, tx);
    // A changed gender preference changes who may visit: re-check future allocations (flags only).
    if (changed.includes("carerGenderPreference")) {
      const staff = await tx.visitAssignment.findMany({ where: { removedAt: null, visit: { serviceUserId: id, status: "SCHEDULED", scheduledStart: { gt: new Date() } } }, select: { staffId: true }, distinct: ["staffId"] });
      await reviewStaffImpact(tx, scope.organisationId, staff.map((s) => s.staffId), { source: "service-user" });
    }
    return updated;
  });
}

const STATUS_FLOW: Record<ServiceUserStatus, ServiceUserStatus[]> = { ENQUIRY: ["ASSESSMENT", "ENDED"], ASSESSMENT: ["ACTIVE", "ENDED"], ACTIVE: ["PAUSED", "ENDED"], PAUSED: ["ACTIVE", "ENDED"], ENDED: ["ASSESSMENT"] };
export const nextStatuses = (s: ServiceUserStatus) => STATUS_FLOW[s];

/**
 * Moves a person through enquiry → assessment → active ⇄ paused → ended. Ending care switches off their templates and
 * cancels future visits that have not started, in the same transaction, each with the reason given.
 */
export async function setServiceUserStatus(ctx: Ctx, id: string, to: ServiceUserStatus, reason: string, endDate?: string) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason");
  return db.$transaction(async (tx) => {
    const su = await loadSu(tx, scope, id);
    if (!STATUS_FLOW[su.status].includes(to)) throw new ValidationError(`Cannot move from ${su.status.toLowerCase()} to ${to.toLowerCase()}`);
    let cancelled = 0;
    if (to === "ENDED") {
      const end = endDate && isIsoDate(endDate) ? endDate : londonDate();
      const from = londonToUtc(end, 1440);
      await tx.visitTemplate.updateMany({ where: { serviceUserId: id, enabled: true }, data: { enabled: false, version: { increment: 1 } } });
      const future = await tx.visit.findMany({ where: { serviceUserId: id, status: "SCHEDULED", scheduledStart: { gte: new Date(Math.max(from.getTime(), Date.now())) } }, select: { id: true } });
      for (const v of future) await cancelVisitInTx(tx, scope, ctx.userId, v.id, `Care ended: ${reason.trim()}`);
      cancelled = future.length;
      await tx.serviceUser.update({ where: { id }, data: { status: to, endDate: dbDate(end), endReason: reason.trim(), version: { increment: 1 } } });
    } else {
      await tx.serviceUser.update({ where: { id }, data: { status: to, ...(to === "ACTIVE" && !su.startDate ? { startDate: dbDate(londonDate()) } : {}), ...(su.status === "ENDED" ? { endDate: null, endReason: null } : {}), version: { increment: 1 } } });
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.status", entityType: "ServiceUser", entityId: id, data: { from: su.status, to, reason: reason.trim(), visitsCancelled: cancelled } }, tx);
    return { cancelled };
  });
}

const contactSchema = z.object({
  kind: z.enum(["NEXT_OF_KIN", "FAMILY", "LPA_HEALTH", "LPA_FINANCE", "GP", "PHARMACY", "SOCIAL_WORKER", "DISTRICT_NURSE", "OTHER"]),
  name: z.string().trim().min(2, "Enter the contact's name").max(200),
  relationship: opt,
  phone: opt,
  email: z.string().trim().email("Enter a valid e-mail address").or(z.literal("")).optional(),
  isEmergency: z.boolean(),
  canReceiveUpdates: z.boolean(),
  altPhone: opt,
  preferredContactMethod: z.enum(["PHONE", "SMS", "EMAIL", "OTHER"]).or(z.literal("")).optional(),
  isPrimary: z.boolean().optional(),
  /** Recorded authority only, chosen by the office. Never set from the contact type or from being next of kin. */
  authorityType: z.enum(["LPA_HEALTH", "LPA_FINANCE", "DEPUTY", "OTHER"]).or(z.literal("")).optional(),
  authorityScope: opt,
});

function contactData(d: z.output<typeof contactSchema>) {
  if (d.authorityScope && !d.authorityType) throw new ValidationError("Choose the type of authority before describing what it covers");
  return {
    kind: d.kind, name: d.name, relationship: d.relationship ?? null, phone: d.phone ?? null, email: d.email || null, isEmergency: d.isEmergency, canReceiveUpdates: d.canReceiveUpdates,
    altPhone: d.altPhone ?? null, preferredContactMethod: d.preferredContactMethod || null, isPrimary: !!d.isPrimary, authorityType: d.authorityType || null, authorityScope: d.authorityType ? d.authorityScope ?? null : null,
  };
}

export async function addContact(ctx: Ctx, serviceUserId: string, input: z.input<typeof contactSchema> | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const r = contactSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the contact");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const data = contactData(r.data);
    // One primary contact per person: marking a new one moves the mark.
    if (data.isPrimary) await tx.serviceUserContact.updateMany({ where: { serviceUserId, organisationId: scope.organisationId, isPrimary: true }, data: { isPrimary: false } });
    const c = await tx.serviceUserContact.create({ data: { organisationId: scope.organisationId, serviceUserId, ...data } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.contact.added", entityType: "ServiceUser", entityId: serviceUserId, data: { kind: c.kind, contactId: c.id } }, tx);
  });
}

/**
 * Changes a contact's current details. Communication already recorded keeps its own copy of the name and number used,
 * so editing a number here never rewrites history.
 */
export async function updateContact(ctx: Ctx, serviceUserId: string, contactId: string, input: z.input<typeof contactSchema> | Record<string, unknown>) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const r = contactSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the contact");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const before = await tx.serviceUserContact.findFirst({ where: { id: contactId, serviceUserId, organisationId: scope.organisationId } });
    if (!before) throw new NotFoundError("Contact");
    const data = contactData(r.data);
    if (data.isPrimary) await tx.serviceUserContact.updateMany({ where: { serviceUserId, organisationId: scope.organisationId, isPrimary: true, id: { not: contactId } }, data: { isPrimary: false } });
    await tx.serviceUserContact.update({ where: { id: contactId }, data });
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => before[k] !== data[k]);
    // Field names only: no numbers or names in the audit entry.
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.contact.updated", entityType: "ServiceUser", entityId: serviceUserId, data: { contactId, changed } }, tx);
  });
}

export async function removeContact(ctx: Ctx, serviceUserId: string, contactId: string) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const c = await tx.serviceUserContact.findFirst({ where: { id: contactId, serviceUserId, organisationId: scope.organisationId } });
    if (!c) throw new NotFoundError("Contact");
    await tx.serviceUserContact.delete({ where: { id: c.id } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.contact.removed", entityType: "ServiceUser", entityId: serviceUserId, data: { kind: c.kind } }, tx);
  });
}

/**
 * Records a hospital stay, respite or holiday. Build Rota skips the dates; visits already built in the period that
 * have not started are cancelled now, in the same transaction, with the absence as the reason.
 */
export async function addAbsence(ctx: Ctx, serviceUserId: string, input: { reason: string; from: string; to?: string; note?: string }) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const reasons = ["HOSPITAL", "RESPITE", "HOLIDAY", "OTHER"] as const;
  const reason = reasons.find((x) => x === input.reason);
  if (!reason) throw new ValidationError("Choose a reason");
  if (!isIsoDate(input.from)) throw new ValidationError("Choose the first day");
  if (input.to && (!isIsoDate(input.to) || input.to < input.from)) throw new ValidationError("The last day must be on or after the first day");
  const startsAt = londonToUtc(input.from, 0);
  const endsAt = input.to ? londonToUtc(input.to, 1440) : null;
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const a = await tx.serviceUserAbsence.create({ data: { organisationId: scope.organisationId, serviceUserId, reason, startsAt, endsAt, note: input.note?.trim() || null, createdById: ctx.userId } });
    const visits = await tx.visit.findMany({ where: { serviceUserId, status: "SCHEDULED", scheduledStart: { gte: new Date(Math.max(startsAt.getTime(), Date.now())), ...(endsAt ? { lt: endsAt } : {}) } }, select: { id: true } });
    for (const v of visits) await cancelVisitInTx(tx, scope, ctx.userId, v.id, `Service user absent (${reason.toLowerCase()})`);
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.absence.added", entityType: "ServiceUser", entityId: serviceUserId, data: { absenceId: a.id, reason, visitsCancelled: visits.length } }, tx);
    return { cancelled: visits.length };
  });
}

/** Ends an absence early. Visits cancelled for it are not brought back automatically; the office reinstates those it needs. */
export async function cancelAbsence(ctx: Ctx, serviceUserId: string, absenceId: string) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const a = await tx.serviceUserAbsence.findFirst({ where: { id: absenceId, serviceUserId, organisationId: scope.organisationId, cancelledAt: null } });
    if (!a) throw new NotFoundError("Absence");
    await tx.serviceUserAbsence.update({ where: { id: a.id }, data: { cancelledAt: new Date(), cancelledById: ctx.userId } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.absence.cancelled", entityType: "ServiceUser", entityId: serviceUserId, data: { absenceId } }, tx);
  });
}

/** A carer the person prefers (rating 1–5) or must not be sent. Future visits with that carer are re-checked. */
export async function setCarerPreference(ctx: Ctx, serviceUserId: string, input: { staffId: string; rating: number | null; blocked: boolean; reason?: string }) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  if (input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) throw new ValidationError("A rating is 1 to 5");
  if (input.blocked && (input.reason?.trim().length ?? 0) < 3) throw new ValidationError("Say why this carer must not visit");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const staff = await tx.staffMember.findFirst({ where: { id: input.staffId, organisationId: scope.organisationId } });
    if (!staff) throw new NotFoundError("Staff member");
    const data = { rating: input.rating, blocked: input.blocked, reason: input.reason?.trim() || null, updatedById: ctx.userId };
    await tx.carerPreference.upsert({ where: { serviceUserId_staffId: { serviceUserId, staffId: staff.id } }, create: { organisationId: scope.organisationId, serviceUserId, staffId: staff.id, ...data }, update: data });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.preference.set", entityType: "ServiceUser", entityId: serviceUserId, data: { staffId: staff.id, rating: input.rating, blocked: input.blocked } }, tx);
    await reviewStaffImpact(tx, scope.organisationId, [staff.id], { source: "carer-preference" });
  });
}

export async function removeCarerPreference(ctx: Ctx, serviceUserId: string, staffId: string) {
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    const { count } = await tx.carerPreference.deleteMany({ where: { serviceUserId, staffId, organisationId: scope.organisationId } });
    if (!count) throw new NotFoundError("Preference");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.preference.removed", entityType: "ServiceUser", entityId: serviceUserId, data: { staffId } }, tx);
    await reviewStaffImpact(tx, scope.organisationId, [staffId], { source: "carer-preference" });
  });
}

export async function setKeySafe(ctx: Ctx, serviceUserId: string, code: string) {
  requireOrgPermission(ctx, "serviceUser.keysafe");
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const clean = code.trim();
  if (clean && !/^[0-9A-Za-z#*\- ]{3,20}$/.test(clean)) throw new ValidationError("A key safe code is 3 to 20 letters or numbers");
  return db.$transaction(async (tx) => {
    await loadSu(tx, scope, serviceUserId);
    await tx.serviceUser.update({ where: { id: serviceUserId }, data: { keySafeCipher: clean ? encryptKeySafe(clean) : null, keySafeUpdatedAt: new Date() } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: clean ? "serviceUser.keysafe.set" : "serviceUser.keysafe.cleared", entityType: "ServiceUser", entityId: serviceUserId }, tx);
  });
}

/** Shows the key safe code to someone allowed to see it, and records that they did. */
export async function revealKeySafe(ctx: Ctx, serviceUserId: string) {
  requireOrgPermission(ctx, "serviceUser.keysafe");
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await loadSu(db, scope, serviceUserId);
  if (!su.keySafeCipher) throw new NotFoundError("Key safe code");
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.keysafe.revealed", entityType: "ServiceUser", entityId: serviceUserId });
  return decryptKeySafe(su.keySafeCipher);
}

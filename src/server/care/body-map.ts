import type { BodyMapView } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dbDate, isIsoDate, londonDate, londonToUtc, parseHhmm } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { reportIncident } from "@/server/care/incidents";
import { serviceUserForRecords, storePrivateFile, type UploadedFile } from "@/server/care/su-documents";
import { storage } from "@/server/storage";

/**
 * Digital Body Map. Office staff and managers record what was observed on a person's body (never a diagnosis), mark
 * where on an outline, and follow it up. The original observation is kept exactly as recorded (database trigger);
 * follow-ups, photos and the incident decision are added on top and audited.
 *
 * An observation is never an incident by itself: a manager (incident.manage) decides whether one is needed, and either
 * links an existing incident about the same person, reports a new one from the observation, or records that none is
 * required, with a reason.
 */

export const BODY_MAP_VIEWS: Record<BodyMapView, string> = { FRONT: "Front", BACK: "Back", LEFT: "Left side", RIGHT: "Right side" };

export const OBSERVATION_CATEGORIES = ["Bruising", "Cuts and scratches", "Pressure sore", "Skin tear", "Wound", "Burn", "Swelling", "Redness", "Rash", "Other skin condition"] as const;

export const PAIN_LEVELS = { NONE: "No pain reported", MILD: "Mild discomfort", MODERATE: "Moderate pain", SEVERE: "Severe pain", NOT_ABLE_TO_SAY: "Not able to say" } as const;
type Pain = keyof typeof PAIN_LEVELS;

/**
 * Named body areas per view, each with the centre of the area on the outline (percent of width and height). A mark is
 * given the nearest area unless the person picks another. Front: the person faces you, so their right is on your left.
 */
export const BODY_REGIONS: Record<BodyMapView, readonly { label: string; x: number; y: number }[]> = {
  FRONT: [
    { label: "Head and face", x: 50, y: 6 }, { label: "Neck", x: 50, y: 13 },
    { label: "Right shoulder", x: 33, y: 17 }, { label: "Left shoulder", x: 67, y: 17 },
    { label: "Chest", x: 50, y: 23 }, { label: "Abdomen", x: 50, y: 34 },
    { label: "Right upper arm", x: 25, y: 26 }, { label: "Left upper arm", x: 75, y: 26 },
    { label: "Right forearm", x: 20, y: 38 }, { label: "Left forearm", x: 80, y: 38 },
    { label: "Right hand", x: 16, y: 48 }, { label: "Left hand", x: 84, y: 48 },
    { label: "Hips and groin", x: 50, y: 45 },
    { label: "Right thigh", x: 42, y: 57 }, { label: "Left thigh", x: 58, y: 57 },
    { label: "Right knee", x: 42, y: 68 }, { label: "Left knee", x: 58, y: 68 },
    { label: "Right shin", x: 42, y: 80 }, { label: "Left shin", x: 58, y: 80 },
    { label: "Right foot", x: 41, y: 95 }, { label: "Left foot", x: 59, y: 95 },
  ],
  BACK: [
    { label: "Back of head", x: 50, y: 6 }, { label: "Back of neck", x: 50, y: 13 },
    { label: "Left shoulder", x: 33, y: 17 }, { label: "Right shoulder", x: 67, y: 17 },
    { label: "Upper back", x: 50, y: 24 }, { label: "Lower back", x: 50, y: 35 },
    { label: "Left upper arm", x: 25, y: 26 }, { label: "Right upper arm", x: 75, y: 26 },
    { label: "Left elbow and forearm", x: 20, y: 38 }, { label: "Right elbow and forearm", x: 80, y: 38 },
    { label: "Left hand", x: 16, y: 48 }, { label: "Right hand", x: 84, y: 48 },
    { label: "Base of spine (sacrum)", x: 50, y: 42 }, { label: "Buttocks", x: 50, y: 48 },
    { label: "Back of left thigh", x: 42, y: 58 }, { label: "Back of right thigh", x: 58, y: 58 },
    { label: "Back of left knee", x: 42, y: 68 }, { label: "Back of right knee", x: 58, y: 68 },
    { label: "Left calf", x: 42, y: 80 }, { label: "Right calf", x: 58, y: 80 },
    { label: "Left heel", x: 41, y: 95 }, { label: "Right heel", x: 59, y: 95 },
  ],
  LEFT: [
    { label: "Left side of head", x: 50, y: 6 }, { label: "Left ear", x: 47, y: 7 }, { label: "Neck (left)", x: 50, y: 13 },
    { label: "Left shoulder", x: 50, y: 18 }, { label: "Left upper arm", x: 50, y: 27 }, { label: "Left elbow", x: 50, y: 35 },
    { label: "Left forearm and wrist", x: 50, y: 41 }, { label: "Left hand", x: 50, y: 48 },
    { label: "Left ribs and side", x: 44, y: 28 }, { label: "Left hip", x: 50, y: 46 },
    { label: "Left thigh (outer)", x: 50, y: 57 }, { label: "Left knee (outer)", x: 50, y: 68 },
    { label: "Left lower leg (outer)", x: 50, y: 80 }, { label: "Left ankle", x: 50, y: 91 }, { label: "Left foot", x: 44, y: 96 },
  ],
  RIGHT: [
    { label: "Right side of head", x: 50, y: 6 }, { label: "Right ear", x: 53, y: 7 }, { label: "Neck (right)", x: 50, y: 13 },
    { label: "Right shoulder", x: 50, y: 18 }, { label: "Right upper arm", x: 50, y: 27 }, { label: "Right elbow", x: 50, y: 35 },
    { label: "Right forearm and wrist", x: 50, y: 41 }, { label: "Right hand", x: 50, y: 48 },
    { label: "Right ribs and side", x: 56, y: 28 }, { label: "Right hip", x: 50, y: 46 },
    { label: "Right thigh (outer)", x: 50, y: 57 }, { label: "Right knee (outer)", x: 50, y: 68 },
    { label: "Right lower leg (outer)", x: 50, y: 80 }, { label: "Right ankle", x: 50, y: 91 }, { label: "Right foot", x: 56, y: 96 },
  ],
};

export function nearestRegion(view: BodyMapView, x: number, y: number) {
  let best = BODY_REGIONS[view][0]!;
  let bestD = Infinity;
  for (const r of BODY_REGIONS[view]) {
    // Height is twice the width on the outline, so vertical distance counts double.
    const d = (r.x - x) ** 2 + (2 * (r.y - y)) ** 2;
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best.label;
}

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const observationSchema = z.object({
  view: z.enum(["FRONT", "BACK", "LEFT", "RIGHT"], { message: "Choose front, back, left or right" }),
  x: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ message: "Mark where on the body the observation is" }).min(0).max(100)),
  y: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ message: "Mark where on the body the observation is" }).min(0).max(100)),
  region: z.string().trim().optional(),
  locationDetail: opt(200),
  category: z.enum(OBSERVATION_CATEGORIES, { message: "Choose what was observed" }),
  date: z.string().refine(isIsoDate, "Choose the date it was observed"),
  time: z.string().refine((t) => parseHhmm(t) !== null, "Times must be like 09:00"),
  description: z.string().trim().min(10, "Describe what was seen (at least a short sentence)").max(4000),
  size: opt(120),
  appearance: opt(300),
  pain: z.enum(["NONE", "MILD", "MODERATE", "SEVERE", "NOT_ABLE_TO_SAY"], { message: "Record any pain or discomfort reported" }),
  actionTaken: opt(2000),
  personNotified: opt(300),
  followUpOn: z.string().trim().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Choose a real follow-up date"),
});
export type ObservationInput = z.input<typeof observationSchema>;

async function managerIds(organisationId: string, except: string) {
  const ms = await db.membership.findMany({ where: { organisationId, roles: { hasSome: ["ORG_ADMIN", "CARE_MANAGER"] } }, select: { userId: true } });
  return [...new Set(ms.map((m) => m.userId))].filter((u) => u !== except);
}

export async function recordObservation(ctx: Ctx, serviceUserId: string, input: ObservationInput | Record<string, unknown>, photo?: UploadedFile & { caption?: string }) {
  const su = await serviceUserForRecords(ctx, serviceUserId, "bodyMap.record");
  const p = observationSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the observation");
  const d = p.data;
  const observedAt = londonToUtc(d.date, parseHhmm(d.time) ?? 0);
  if (observedAt.getTime() > Date.now() + 5 * 60000) throw new ValidationError("An observation cannot be in the future");
  if (d.followUpOn && d.followUpOn < d.date) throw new ValidationError("The follow-up date cannot be before the observation");
  const region = d.region && BODY_REGIONS[d.view].some((r) => r.label === d.region) ? d.region : nearestRegion(d.view, d.x, d.y);
  if (photo && !hasOrgPermission(ctx, "bodyMap.photos")) throw new ForbiddenError("You cannot add body map photographs");
  const stored = photo ? await storePrivateFile(su.organisationId, "body-map", photo, { imagesOnly: true }) : null;
  const obs = await db.$transaction(async (tx) => {
    const o = await tx.bodyMapObservation.create({
      data: {
        organisationId: su.organisationId, serviceUserId: su.id, view: d.view, x: d.x, y: d.y, region, locationDetail: d.locationDetail ?? null,
        category: d.category, observedAt, description: d.description, size: d.size ?? null, appearance: d.appearance ?? null, pain: d.pain,
        actionTaken: d.actionTaken ?? null, personNotified: d.personNotified ?? null, followUpOn: d.followUpOn ? dbDate(d.followUpOn) : null, recordedById: ctx.userId,
      },
    });
    if (stored) await tx.bodyMapPhoto.create({ data: { organisationId: su.organisationId, observationId: o.id, ...stored, caption: photo?.caption?.trim().slice(0, 200) || null, uploadedById: ctx.userId } });
    await audit({ organisationId: su.organisationId, actorId: ctx.userId, action: "bodyMap.recorded", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: su.id, view: d.view, region, category: d.category, followUpOn: d.followUpOn ?? null, photo: Boolean(stored) } }, tx);
    // Managers decide whether an incident is needed; the observation itself is not one.
    const users = await managerIds(su.organisationId, ctx.userId);
    if (users.length) {
      await tx.notification.createMany({
        data: users.map((userId) => ({
          organisationId: su.organisationId, userId, type: "bodyMap.review-needed",
          title: `Body map: ${d.category.toLowerCase()} recorded for ${su.firstName} ${su.lastName}`,
          body: `${region}. Review it and decide whether an incident report is needed.`,
          reason: "You manage incidents for this organisation.",
          actionUrl: `/rota/service-users/${su.id}?tab=bodymap&obs=${o.id}`,
          dedupeKey: `body-map:${o.id}:${userId}`,
        })),
        skipDuplicates: true,
      });
    }
    return o;
  });
  return obs;
}

async function observationFor(ctx: Ctx, observationId: string, perm: "serviceUser.view" | "bodyMap.record" | "incident.manage") {
  const organisationId = requireOrgPermission(ctx, perm);
  const o = await db.bodyMapObservation.findFirst({ where: { id: observationId, organisationId } });
  if (!o) throw new NotFoundError("Observation");
  await serviceUserForRecords(ctx, o.serviceUserId);
  return o;
}

const reviewSchema = z.object({
  outcome: z.string().trim().min(5, "Record what was found at the follow-up").max(4000),
  nextFollowUpOn: z.string().trim().optional().transform((v) => v || undefined).refine((v) => v === undefined || isIsoDate(v), "Choose a real follow-up date"),
  resolved: z.boolean().default(false),
});

/** A follow-up or review: appended, never replacing what came before. Resolving ends the follow-ups. */
export async function reviewObservation(ctx: Ctx, observationId: string, version: number, input: z.input<typeof reviewSchema>) {
  const o = await observationFor(ctx, observationId, "bodyMap.record");
  const p = reviewSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the follow-up");
  const d = p.data;
  if (!d.resolved && !d.nextFollowUpOn) throw new ValidationError("Set the next follow-up date, or mark the observation as resolved");
  if (d.nextFollowUpOn && d.nextFollowUpOn < londonDate()) throw new ValidationError("The next follow-up date cannot be in the past");
  await db.$transaction(async (tx) => {
    const r = await tx.bodyMapObservation.updateMany({ where: { id: o.id, version }, data: { status: d.resolved ? "RESOLVED" : "OPEN", followUpOn: d.resolved ? null : dbDate(d.nextFollowUpOn!), version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("Someone else updated this observation. Reload the page and try again.");
    await tx.bodyMapReview.create({ data: { organisationId: o.organisationId, observationId: o.id, reviewedById: ctx.userId, outcome: d.outcome, nextFollowUpOn: d.resolved ? null : dbDate(d.nextFollowUpOn!), resolved: d.resolved } });
    await audit({ organisationId: o.organisationId, actorId: ctx.userId, action: d.resolved ? "bodyMap.resolved" : "bodyMap.followedUp", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: o.serviceUserId, nextFollowUpOn: d.nextFollowUpOn ?? null, reopened: o.status === "RESOLVED" && !d.resolved } }, tx);
  });
}

export async function addObservationPhoto(ctx: Ctx, observationId: string, photo: UploadedFile, caption?: string) {
  const o = await observationFor(ctx, observationId, "bodyMap.record");
  requireOrgPermission(ctx, "bodyMap.photos");
  const stored = await storePrivateFile(o.organisationId, "body-map", photo, { imagesOnly: true });
  await db.$transaction(async (tx) => {
    const ph = await tx.bodyMapPhoto.create({ data: { organisationId: o.organisationId, observationId: o.id, ...stored, caption: caption?.trim().slice(0, 200) || null, uploadedById: ctx.userId } });
    await audit({ organisationId: o.organisationId, actorId: ctx.userId, action: "bodyMap.photoAdded", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: o.serviceUserId, photoId: ph.id, filename: stored.filename } }, tx);
  });
}

/** Streams a photograph only to people allowed to see body map photos, and records each view. */
export async function readObservationPhoto(ctx: Ctx, photoId: string) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.photos");
  const ph = await db.bodyMapPhoto.findFirst({ where: { id: photoId, organisationId }, include: { observation: { select: { serviceUserId: true } } } });
  if (!ph) throw new NotFoundError("Photo");
  await serviceUserForRecords(ctx, ph.observation.serviceUserId);
  const bytes = await storage().get(ph.storageKey);
  await audit({ organisationId, actorId: ctx.userId, action: "bodyMap.photoViewed", entityType: "BodyMapObservation", entityId: ph.observationId, data: { photoId: ph.id } });
  return { bytes, contentType: ph.contentType, filename: ph.filename };
}

export type IncidentDecision =
  | { kind: "LINK"; incidentId: string; note?: string }
  | { kind: "NOT_REQUIRED"; note: string }
  | { kind: "NEW"; severity: string; category: string; description: string; safeguarding: boolean };

/**
 * A manager's decision on whether the observation needs an incident report. A new report goes through the normal
 * incident service (its own record, reference, alerts and audit), then the observation is linked to it.
 */
export async function decideIncident(ctx: Ctx, observationId: string, version: number, decision: IncidentDecision) {
  const o = await observationFor(ctx, observationId, "incident.manage");
  if (o.version !== version) throw new ConflictError("Someone else updated this observation. Reload the page and try again.");
  let incidentId: string | null = null;
  let note: string | null = null;
  if (decision.kind === "LINK") {
    const inc = await db.incident.findFirst({ where: { id: decision.incidentId, organisationId: o.organisationId, serviceUserId: o.serviceUserId }, select: { id: true } });
    if (!inc) throw new NotFoundError("Incident about this person");
    incidentId = inc.id;
    note = decision.note?.trim().slice(0, 1000) || null;
  } else if (decision.kind === "NOT_REQUIRED") {
    note = decision.note.trim().slice(0, 1000);
    if (note.length < 5) throw new ValidationError("Say why no incident report is needed");
  } else {
    const at = o.observedAt;
    const date = londonDate(at);
    const london = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
    const inc = await reportIncident(ctx, { serviceUserId: o.serviceUserId, date, time: london, category: decision.category, severity: decision.severity, description: decision.description, immediateAction: o.actionTaken ?? undefined, safeguarding: decision.safeguarding });
    incidentId = inc.id;
    note = `Incident ${inc.reference} reported from this observation`;
  }
  await db.$transaction(async (tx) => {
    const r = await tx.bodyMapObservation.updateMany({ where: { id: o.id, version }, data: { incidentDecision: incidentId ? "LINKED" : "NOT_REQUIRED", incidentId, incidentDecisionNote: note, incidentDecidedById: ctx.userId, incidentDecidedAt: new Date(), version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("Someone else updated this observation. Reload the page and try again.");
    await audit({ organisationId: o.organisationId, actorId: ctx.userId, action: incidentId ? "bodyMap.incidentLinked" : "bodyMap.incidentNotRequired", entityType: "BodyMapObservation", entityId: o.id, data: { serviceUserId: o.serviceUserId, incidentId, how: decision.kind, previous: o.incidentId, note } }, tx);
  });
  return incidentId;
}

/** Every observation for one person, newest first, with follow-ups, photo details and the linked incident. */
export async function listObservations(ctx: Ctx, serviceUserId: string) {
  const su = await serviceUserForRecords(ctx, serviceUserId);
  return db.bodyMapObservation.findMany({
    where: { organisationId: su.organisationId, serviceUserId: su.id },
    include: {
      reviews: { orderBy: { reviewedAt: "asc" } },
      photos: { orderBy: { uploadedAt: "asc" }, select: { id: true, caption: true, uploadedAt: true, uploadedById: true, filename: true } },
      incident: { select: { id: true, reference: true, status: true, category: true } },
    },
    orderBy: { observedAt: "desc" },
  });
}

/** Incidents about this person, for the "link to an existing incident" choice. */
export async function linkableIncidents(ctx: Ctx, serviceUserId: string) {
  if (!hasOrgPermission(ctx, "incident.manage")) return [];
  const su = await serviceUserForRecords(ctx, serviceUserId);
  return db.incident.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id }, select: { id: true, reference: true, category: true, occurredAt: true, status: true }, orderBy: { occurredAt: "desc" }, take: 50 });
}

export interface BodyMapCounts {
  /** Open observations with a follow-up date set. */
  outstanding: number;
  /** Of those, follow-ups past their date. */
  overdue: number;
  /** Observations a manager has not yet decided on (incident needed or not). */
  awaitingDecision: number;
  /** Observations reviewed to a final outcome. */
  reviewed: number;
  total: number;
}

/** Figures for the profile's compliance overview. Null when the viewer may not see the person's records. */
export async function bodyMapCounts(ctx: Ctx, serviceUserId: string): Promise<BodyMapCounts | null> {
  if (!ctx.organisationId || !hasOrgPermission(ctx, "serviceUser.view")) return null;
  let su;
  try {
    su = await serviceUserForRecords(ctx, serviceUserId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
  const rows = await db.bodyMapObservation.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id }, select: { status: true, followUpOn: true, incidentDecision: true } });
  const today = dbDate(londonDate());
  const open = rows.filter((r) => r.status === "OPEN" && r.followUpOn);
  return {
    outstanding: open.length,
    overdue: open.filter((r) => r.followUpOn! < today).length,
    awaitingDecision: rows.filter((r) => !r.incidentDecision).length,
    reviewed: rows.filter((r) => r.status === "RESOLVED").length,
    total: rows.length,
  };
}

export const painLabel = (p: string) => PAIN_LEVELS[p as Pain] ?? p;

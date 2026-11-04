import type { BodyMapView } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { BODY_REGIONS, nearestRegion } from "@/server/care/body-map";
import { medicationEnabled } from "@/server/care/medication";
import { serviceUserForRecords } from "@/server/care/su-documents";

/**
 * Documented application sites for topical medicines and patches, shown on the body map as a different marker from
 * skin observations. Recording a site needs medication.manage and the organisation's medication switch to be on (it
 * stays off until a clinical review); only approved (ACTIVE) topical or transdermal medicines can have one.
 *
 * A site is information for staff, never evidence that a dose was given (that is the MAR, recorded on the visit), and
 * nothing here, including an AI suggestion, ever creates a MAR record. A patch has one current site, so a new site ends
 * the previous one; a cream may have several. Sites are ended, never deleted.
 */

export const SITE_ROUTES = ["TOPICAL", "TRANSDERMAL"] as const;

const siteSchema = z.object({
  medicationId: z.string().trim().min(1, "Choose the medicine"),
  view: z.enum(["FRONT", "BACK", "LEFT", "RIGHT"], { message: "Choose front, back, left or right" }),
  x: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ message: "Mark where it is applied" }).min(0).max(100)),
  y: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ message: "Mark where it is applied" }).min(0).max(100)),
  region: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

async function enabledFor(ctx: Ctx, perm: "medication.view" | "medication.manage") {
  const organisationId = requireOrgPermission(ctx, perm);
  if (!(await medicationEnabled(organisationId))) return null;
  return organisationId;
}

export async function recordApplicationSite(ctx: Ctx, serviceUserId: string, input: z.input<typeof siteSchema> | Record<string, unknown>) {
  const organisationId = await enabledFor(ctx, "medication.manage");
  if (!organisationId) throw new ValidationError("Medication records are switched off for your organisation");
  const su = await serviceUserForRecords(ctx, serviceUserId);
  const p = siteSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the application site");
  const d = p.data;
  const med = await db.medication.findFirst({ where: { id: d.medicationId, organisationId, serviceUserId: su.id } });
  if (!med) throw new NotFoundError("Medicine for this person");
  if (med.status !== "ACTIVE") throw new ValidationError("Only an approved, current medicine can have an application site");
  if (!(SITE_ROUTES as readonly string[]).includes(med.route)) throw new ValidationError("Application sites are for creams, ointments and patches only");
  const view = d.view as BodyMapView;
  const region = d.region && BODY_REGIONS[view].some((r) => r.label === d.region) ? d.region : nearestRegion(view, d.x, d.y);
  return db.$transaction(async (tx) => {
    let ended: string[] = [];
    if (med.route === "TRANSDERMAL") {
      const current = await tx.medicationApplicationSite.findMany({ where: { medicationId: med.id, endedAt: null }, select: { id: true } });
      ended = current.map((c) => c.id);
      if (ended.length) await tx.medicationApplicationSite.updateMany({ where: { id: { in: ended } }, data: { endedAt: new Date(), endedById: ctx.userId, endReason: "Patch moved to a new site" } });
    }
    const site = await tx.medicationApplicationSite.create({ data: { organisationId, serviceUserId: su.id, medicationId: med.id, view, x: d.x, y: d.y, region, note: d.note || null, recordedById: ctx.userId } });
    await audit({ organisationId, actorId: ctx.userId, action: "medication.siteRecorded", entityType: "Medication", entityId: med.id, data: { serviceUserId: su.id, siteId: site.id, view, region, ended } }, tx);
    return site;
  });
}

export async function endApplicationSite(ctx: Ctx, siteId: string, reason: string) {
  const organisationId = await enabledFor(ctx, "medication.manage");
  if (!organisationId) throw new ValidationError("Medication records are switched off for your organisation");
  const s = await db.medicationApplicationSite.findFirst({ where: { id: siteId, organisationId } });
  if (!s) throw new NotFoundError("Application site");
  await serviceUserForRecords(ctx, s.serviceUserId);
  const why = reason.trim();
  if (why.length < 3) throw new ValidationError("Say why the site is no longer used");
  await db.$transaction(async (tx) => {
    const r = await tx.medicationApplicationSite.updateMany({ where: { id: s.id, endedAt: null }, data: { endedAt: new Date(), endedById: ctx.userId, endReason: why.slice(0, 300) } });
    if (r.count !== 1) throw new ConflictError("This site has already been ended");
    await audit({ organisationId, actorId: ctx.userId, action: "medication.siteEnded", entityType: "Medication", entityId: s.medicationId, data: { serviceUserId: s.serviceUserId, siteId: s.id, reason: why } }, tx);
  });
}

/**
 * Current sites and the medicines that could have one, for the body map. Empty (with `enabled: false`) when the
 * medication switch is off or the viewer may not see medication.
 */
export async function applicationSites(ctx: Ctx, serviceUserId: string) {
  if (!hasOrgPermission(ctx, "medication.view")) return { enabled: false as const, sites: [], topical: [] };
  const organisationId = await enabledFor(ctx, "medication.view");
  if (!organisationId) return { enabled: false as const, sites: [], topical: [] };
  const su = await serviceUserForRecords(ctx, serviceUserId);
  const [sites, topical] = await Promise.all([
    db.medicationApplicationSite.findMany({
      where: { organisationId, serviceUserId: su.id, endedAt: null },
      include: { medication: { select: { id: true, name: true, strength: true, dose: true, route: true, instructions: true, status: true, records: { where: { supersededAt: null }, orderBy: { at: "desc" }, take: 3, select: { id: true, outcome: true, at: true } } } } },
      orderBy: { recordedAt: "asc" },
    }),
    db.medication.findMany({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE", route: { in: [...SITE_ROUTES] } }, select: { id: true, name: true, strength: true, route: true, sites: { where: { endedAt: null }, select: { id: true } } }, orderBy: { name: "asc" } }),
  ]);
  return { enabled: true as const, sites, topical: topical.map((t) => ({ ...t, hasSite: t.sites.length > 0 })) };
}

import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { applicationSites } from "@/server/care/medication-sites";
import { serviceUserForRecords } from "@/server/care/su-documents";

/**
 * The records an observation relates to, for the Linked Records tab: the linked incident and other open incidents for
 * the person, the current care plan's sections about skin, pressure or personal care, the matching risk assessments,
 * and documented medication application sites on the same body area. Read only, through each record's own permissions.
 */

const SKIN = /\b(skin|pressure|wound|bruis\w*|dressing|cream|reposition\w*|personal care|washing|bathing|continence|mobility|moving|handling|falls?)\b/i;

export async function linkedRecords(ctx: Ctx, observationId: string) {
  const organisationId = requireOrgPermission(ctx, "bodyMap.record");
  const o = await db.bodyMapObservation.findFirst({ where: { id: observationId, organisationId }, select: { id: true, serviceUserId: true, incidentId: true, view: true, region: true } });
  if (!o) throw new NotFoundError("Observation");
  const su = await serviceUserForRecords(ctx, o.serviceUserId);
  const [incidents, plan, risks, meds] = await Promise.all([
    db.incident.findMany({ where: { organisationId, serviceUserId: su.id, OR: [{ id: o.incidentId ?? "-" }, { status: { not: "CLOSED" } }] }, select: { id: true, reference: true, category: true, status: true, safeguarding: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 8 }),
    db.carePlan.findFirst({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" }, select: { id: true, version: true, reviewDue: true, sections: { select: { key: true, title: true, body: true }, orderBy: { position: "asc" } } }, orderBy: { version: "desc" } }),
    db.riskAssessment.findMany({ where: { organisationId, serviceUserId: su.id, status: "ACTIVE" }, select: { id: true, title: true, type: true, level: true, reviewDue: true, hazards: true }, orderBy: { assessedAt: "desc" } }),
    applicationSites(ctx, su.id),
  ]);
  return {
    serviceUserId: su.id,
    incidents: incidents.map((i) => ({ ...i, linked: i.id === o.incidentId })),
    carePlan: plan ? { id: plan.id, version: plan.version, reviewDue: plan.reviewDue, sections: plan.sections.filter((s) => SKIN.test(`${s.title} ${s.body}`)).map((s) => ({ key: s.key, title: s.title })) } : null,
    risks: risks.filter((r) => r.type === "PRESSURE_SKIN" || r.type === "FALLS" || r.type === "MOVING_HANDLING" || SKIN.test(`${r.title} ${r.hazards}`)),
    medication: { enabled: meds.enabled, sameArea: meds.sites.filter((s) => s.view === o.view && s.region === o.region), noSite: meds.topical.filter((t) => !t.hasSite) },
  };
}

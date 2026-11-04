import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { sourcesForBranch } from "./reference";

/**
 * Cross-boundary safeguarding. A branch can support someone who lives, receives care or has an incident in another
 * local authority's area, and the authority that funds the care is not necessarily the one that leads safeguarding.
 * The platform records each location as the office enters it, flags any difference from the branch's own area for a
 * coordinator or manager, shows the verified local procedures for each area involved, and keeps the manager's
 * decision with its reasoning. It never decides the lead authority itself.
 */

export type BoundaryFlag = { kind: "residence" | "care_location" | "incident" | "not_recorded"; text: string; laCodes: string[] };

/** Pure: what differs from the branch's area. Exported for tests. */
export function boundaryFlags(input: { branchLa: string | null; residence: string | null; careLocation: string | null; incidents: { reference: string; la: string | null }[]; names: Map<string, string> }): BoundaryFlag[] {
  const n = (c: string) => input.names.get(c) ?? c;
  const out: BoundaryFlag[] = [];
  if (!input.branchLa) return [{ kind: "not_recorded", text: "The branch's local authority is not recorded, so boundaries cannot be checked.", laCodes: [] }];
  if (!input.residence && !input.careLocation) out.push({ kind: "not_recorded", text: "Where the person lives and receives care has not been recorded.", laCodes: [] });
  if (input.residence && input.residence !== input.branchLa) out.push({ kind: "residence", text: `Lives in ${n(input.residence)}; the branch is in ${n(input.branchLa)}.`, laCodes: [input.residence] });
  if (input.careLocation && input.careLocation !== input.branchLa && input.careLocation !== input.residence) out.push({ kind: "care_location", text: `Receives care in ${n(input.careLocation)}.`, laCodes: [input.careLocation] });
  for (const i of input.incidents) if (i.la && i.la !== input.branchLa) out.push({ kind: "incident", text: `Incident ${i.reference} happened in ${n(i.la)}.`, laCodes: [i.la] });
  return out;
}

export async function crossBoundaryCases(ctx: Ctx, opts: { showAll?: boolean } = {}) {
  const organisationId = requireOrgPermission(ctx, "serviceUser.view");
  const names = new Map((await db.localAuthority.findMany({ select: { code: true, name: true, regionCode: true } })).map((l) => [l.code, l.name]));
  const regions = new Map((await db.localAuthority.findMany({ select: { code: true, regionCode: true } })).map((l) => [l.code, l.regionCode]));
  const branchWhere: Prisma.ServiceUserWhereInput = ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {};
  const since = new Date(Date.now() - 365 * 86400_000);
  const people = await db.serviceUser.findMany({
    where: { organisationId, status: { in: ["ACTIVE", "PAUSED", "ENQUIRY", "ASSESSMENT"] }, ...branchWhere },
    include: {
      branch: { include: { policyProfile: true } },
      incidents: { where: { occurredAt: { gte: since } }, select: { id: true, reference: true, occurredLocalAuthorityCode: true, safeguarding: true, occurredAt: true }, orderBy: { occurredAt: "desc" } },
      safeguardingDecisions: { orderBy: { decidedAt: "desc" }, take: 3 },
    },
    orderBy: [{ lastName: "asc" }],
  });
  const deciders = new Map((await db.user.findMany({ where: { id: { in: [...new Set(people.flatMap((p) => p.safeguardingDecisions.map((d) => d.decidedById)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const rows = people.map((p) => {
    const flags = boundaryFlags({ branchLa: p.branch?.policyProfile?.localAuthorityCode ?? null, residence: p.residenceLocalAuthorityCode, careLocation: p.careLocationLocalAuthorityCode, incidents: p.incidents.map((i) => ({ reference: i.reference, la: i.occurredLocalAuthorityCode })), names });
    const crosses = flags.some((f) => f.kind !== "not_recorded");
    const latest = p.safeguardingDecisions[0] ?? null;
    return { person: p, flags, crosses, decision: latest ? { ...latest, by: deciders.get(latest.decidedById) ?? "Manager" } : null, history: p.safeguardingDecisions };
  });
  const shown = opts.showAll ? rows : rows.filter((r) => r.crosses || r.flags.some((f) => f.kind === "not_recorded"));
  // The verified local procedures that may apply, for each other area involved.
  const areas = [...new Set(shown.flatMap((r) => r.flags.flatMap((f) => f.laCodes)))];
  const procedures = new Map<string, Awaited<ReturnType<typeof sourcesForBranch>>>();
  for (const la of areas) procedures.set(la, (await sourcesForBranch(organisationId, { localAuthorityCode: la, regionCode: regions.get(la) ?? null }, "SAFEGUARDING")).filter((s) => s.geoLevel !== "NATIONAL"));
  return { rows: shown, total: rows.length, crossing: rows.filter((r) => r.crosses).length, notRecorded: rows.filter((r) => r.flags.some((f) => f.kind === "not_recorded")).length, undecided: rows.filter((r) => r.crosses && !r.decision).length, procedures, names };
}

const laOrEmpty = z.string().trim().max(80).optional().transform((v) => (v ? v : null));
const geoSchema = z.object({ residenceLocalAuthorityCode: laOrEmpty, careLocationLocalAuthorityCode: laOrEmpty, fundingAuthority: z.string().trim().max(200).optional().transform((v) => (v ? v : null)) });

async function checkLas(codes: (string | null)[]) {
  const want = codes.filter((c): c is string => !!c);
  if (!want.length) return;
  const found = await db.localAuthority.count({ where: { code: { in: want } } });
  if (found !== new Set(want).size) throw new ValidationError("Choose local authorities from the list");
}

async function loadPerson(ctx: Ctx, organisationId: string, serviceUserId: string) {
  const p = await db.serviceUser.findFirst({ where: { id: serviceUserId, organisationId }, include: { branch: { include: { policyProfile: true } } } });
  if (!p) throw new NotFoundError("Service user");
  if (ctx.branchIds && (!p.branchId || !ctx.branchIds.includes(p.branchId))) throw new NotFoundError("Service user");
  return p;
}

/** The office records where the person lives, where care is delivered and who funds it. */
export async function recordServiceUserGeography(ctx: Ctx, serviceUserId: string, input: z.input<typeof geoSchema>) {
  const organisationId = requireOrgPermission(ctx, "serviceUser.edit");
  const p = geoSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the locations");
  await checkLas([p.data.residenceLocalAuthorityCode, p.data.careLocationLocalAuthorityCode]);
  const su = await loadPerson(ctx, organisationId, serviceUserId);
  await db.$transaction(async (tx) => {
    await tx.serviceUser.update({ where: { id: su.id }, data: { ...p.data, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "service_user.geography_recorded", entityType: "ServiceUser", entityId: su.id, data: { before: { residence: su.residenceLocalAuthorityCode, careLocation: su.careLocationLocalAuthorityCode, funding: su.fundingAuthority }, after: p.data } }, tx);
  });
}

/** The office records where an incident happened. */
export async function recordIncidentLocation(ctx: Ctx, incidentId: string, laCode: string | null) {
  const organisationId = requireOrgPermission(ctx, "incident.manage");
  await checkLas([laCode]);
  const inc = await db.incident.findFirst({ where: { id: incidentId, organisationId } });
  if (!inc) throw new NotFoundError("Incident");
  if (inc.serviceUserId) await loadPerson(ctx, organisationId, inc.serviceUserId);
  await db.$transaction(async (tx) => {
    await tx.incident.update({ where: { id: inc.id }, data: { occurredLocalAuthorityCode: laCode } });
    await audit({ organisationId, actorId: ctx.userId, action: "incident.location_recorded", entityType: "Incident", entityId: inc.id, data: { before: inc.occurredLocalAuthorityCode, after: laCode } }, tx);
  });
}

const decisionSchema = z.object({ safeguardingLocalAuthorityCode: z.string().min(1, "Choose the safeguarding authority"), reasoning: z.string().trim().min(20, "Give the reasons for the decision (at least a sentence)").max(4000), incidentId: z.string().optional() });

/**
 * A manager records which authority's safeguarding procedures apply, with the reasoning and the geography at the time.
 * Decisions are append-only; a later one supersedes, never edits, the earlier one.
 */
export async function recordSafeguardingDecision(ctx: Ctx, serviceUserId: string, input: z.input<typeof decisionSchema>) {
  const organisationId = requireOrgPermission(ctx, "safeguarding.authority");
  const p = decisionSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the decision");
  await checkLas([p.data.safeguardingLocalAuthorityCode]);
  const su = await loadPerson(ctx, organisationId, serviceUserId);
  let incident: { id: string; reference: string; occurredLocalAuthorityCode: string | null } | null = null;
  if (p.data.incidentId) {
    incident = await db.incident.findFirst({ where: { id: p.data.incidentId, organisationId, serviceUserId: su.id }, select: { id: true, reference: true, occurredLocalAuthorityCode: true } });
    if (!incident) throw new NotFoundError("Incident");
  }
  const snapshot = { branch: su.branch?.name ?? null, branchLocalAuthority: su.branch?.policyProfile?.localAuthorityCode ?? null, residence: su.residenceLocalAuthorityCode, careLocation: su.careLocationLocalAuthorityCode, fundingAuthority: su.fundingAuthority, incident: incident ? { reference: incident.reference, location: incident.occurredLocalAuthorityCode } : null };
  return db.$transaction(async (tx) => {
    const d = await tx.safeguardingAuthorityDecision.create({ data: { organisationId, serviceUserId: su.id, incidentId: incident?.id ?? null, safeguardingLocalAuthorityCode: p.data.safeguardingLocalAuthorityCode, reasoning: p.data.reasoning, snapshot, decidedById: ctx.userId } });
    if (!incident) await tx.serviceUser.update({ where: { id: su.id }, data: { safeguardingLocalAuthorityCode: p.data.safeguardingLocalAuthorityCode, version: { increment: 1 } } });
    await audit({ organisationId, actorId: ctx.userId, action: "safeguarding.authority_decided", entityType: "ServiceUser", entityId: su.id, data: { decisionId: d.id, authority: p.data.safeguardingLocalAuthorityCode, incidentId: incident?.id ?? null, previous: su.safeguardingLocalAuthorityCode } }, tx);
    return d;
  });
}

export function canDecideAuthority(ctx: Ctx) {
  return hasOrgPermission(ctx, "safeguarding.authority");
}
export function assertCanView(ctx: Ctx) {
  if (!hasOrgPermission(ctx, "serviceUser.view")) throw new ForbiddenError();
}

import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, isIsoDate, londonDate, mondayOf } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope, visitWhere, type Scope } from "./scope";

/**
 * Run routes, as OnePlan has them: template run routes (a named, coloured round that templates belong to, carried into
 * each built week by Build Rota) and live run routes (one week's round). The coordinator sets the order of stops by
 * hand. Routes group and order work; they never assign a carer, so every assignment still goes through the
 * eligibility checks. Travel times and route optimisation are not built.
 */

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string) {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export const ROUTE_KIND_LABEL = { CARER: "Team member route", AREA: "Area route" } as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be like #1a6b8f");
const routeSchema = z.object({
  name: z.string().trim().min(2, "Give the route a name").max(60),
  kind: z.enum(["CARER", "AREA"]).default("CARER"),
  staffId: z.string().optional(),
  areaId: z.string().optional(),
  weekStart: z.string().optional(),
  colour: hex,
  textColour: hex,
});
export type RouteInput = z.input<typeof routeSchema>;

const inBranches = (scope: Scope) => (scope.branchIds ? { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] } : {});

async function checkOwner(scope: Scope, d: { kind: "CARER" | "AREA"; staffId?: string; areaId?: string }) {
  if (d.kind === "CARER") {
    if (!d.staffId) throw new ValidationError("Choose the team member for this route");
    if (!(await db.staffMember.findFirst({ where: { id: d.staffId, organisationId: scope.organisationId, ...inBranches(scope) }, select: { id: true } }))) throw new NotFoundError("Team member");
    return { staffId: d.staffId, areaId: null };
  }
  if (!d.areaId) throw new ValidationError("Choose the area for this route");
  if (!(await db.area.findFirst({ where: { id: d.areaId, organisationId: scope.organisationId, ...(scope.areaIds ? { id: { in: scope.areaIds } } : {}) }, select: { id: true } }))) throw new NotFoundError("Area");
  return { staffId: null, areaId: d.areaId };
}

function parse(input: RouteInput) {
  const p = routeSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the route");
  if (contrastRatio(p.data.colour, p.data.textColour) < 4.5) throw new ValidationError("The text colour is hard to read on that route colour; choose a darker or lighter one");
  return p.data;
}

/** A member may see a route when its carer or area is within their branches and areas. */
async function liveInScope(scope: Scope, id: string) {
  const r = await db.runRoute.findFirst({ where: { id, organisationId: scope.organisationId } });
  if (!r || !(await ownerVisible(scope, r))) throw new NotFoundError("Run route");
  return r;
}
async function templateInScope(scope: Scope, id: string) {
  const r = await db.runRouteTemplate.findFirst({ where: { id, organisationId: scope.organisationId } });
  if (!r || !(await ownerVisible(scope, r))) throw new NotFoundError("Run route");
  return r;
}
async function ownerVisible(scope: Scope, r: { staffId: string | null; areaId: string | null }) {
  if (r.staffId && scope.branchIds) return !!(await db.staffMember.findFirst({ where: { id: r.staffId, ...inBranches(scope) }, select: { id: true } }));
  if (r.areaId && scope.areaIds) return scope.areaIds.includes(r.areaId);
  return true;
}

export async function createLiveRoute(ctx: Ctx, input: RouteInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  const d = parse(input);
  if (!d.weekStart || !isIsoDate(d.weekStart)) throw new ValidationError("Choose the week the route is for");
  const week = mondayOf(d.weekStart);
  if (week < addDays(mondayOf(londonDate()), -7)) throw new ValidationError("Routes can be added from last week onwards");
  const owner = await checkOwner(scope, d);
  if (await db.runRoute.findFirst({ where: { organisationId: scope.organisationId, weekStart: dbDate(week), name: d.name } })) throw new ConflictError("A route with that name already exists that week");
  return db.$transaction(async (tx) => {
    const r = await tx.runRoute.create({ data: { organisationId: scope.organisationId, name: d.name, kind: d.kind, ...owner, weekStart: dbDate(week), colour: d.colour.toLowerCase(), textColour: d.textColour.toLowerCase(), createdById: ctx.userId } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route.created", entityType: "RunRoute", entityId: r.id, data: { name: r.name, week } }, tx);
    return r;
  });
}

export async function createTemplateRoute(ctx: Ctx, input: RouteInput) {
  const scope = await rotaScope(ctx, "rota.edit");
  const d = parse(input);
  const owner = await checkOwner(scope, d);
  if (await db.runRouteTemplate.findFirst({ where: { organisationId: scope.organisationId, name: d.name } })) throw new ConflictError("A template route with that name already exists");
  return db.$transaction(async (tx) => {
    const r = await tx.runRouteTemplate.create({ data: { organisationId: scope.organisationId, name: d.name, kind: d.kind, ...owner, colour: d.colour.toLowerCase(), textColour: d.textColour.toLowerCase() } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route_template.created", entityType: "RunRouteTemplate", entityId: r.id, data: { name: r.name } }, tx);
    return r;
  });
}

/** Live routes grouped as OnePlan shows them: this week, future weeks and past weeks. */
export async function listLiveRoutes(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.view");
  const rows = await db.runRoute.findMany({ where: { organisationId: scope.organisationId, weekStart: { gte: dbDate(addDays(mondayOf(londonDate()), -56)) } }, include: { _count: { select: { visits: true } } }, orderBy: [{ weekStart: "asc" }, { name: "asc" }] });
  const visible = [];
  for (const r of rows) if (await ownerVisible(scope, r)) visible.push(r);
  const thisWeek = mondayOf(londonDate());
  const week = (r: { weekStart: Date }) => fromDbDate(r.weekStart);
  return { thisWeek, current: visible.filter((r) => week(r) === thisWeek), future: visible.filter((r) => week(r) > thisWeek), past: visible.filter((r) => week(r) < thisWeek).reverse() };
}

export async function listTemplateRoutes(ctx: Ctx) {
  const scope = await rotaScope(ctx, "rota.view");
  const rows = await db.runRouteTemplate.findMany({ where: { organisationId: scope.organisationId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const counts = new Map((await db.visitTemplate.groupBy({ by: ["runRouteTemplateId"], where: { organisationId: scope.organisationId, runRouteTemplateId: { in: rows.map((r) => r.id) } }, _count: true })).map((g) => [g.runRouteTemplateId, g._count]));
  const visible = [];
  for (const r of rows) if (await ownerVisible(scope, r)) visible.push({ ...r, templates: counts.get(r.id) ?? 0 });
  return visible;
}

const suSelect = { select: { firstName: true, lastName: true, preferredName: true, postcode: true, addressLine1: true } } as const;

/** One live route: its visits by day in route order, and the week's visits that could join it. */
export async function getLiveRoute(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const r = await liveInScope(scope, id);
  const start = fromDbDate(r.weekStart);
  const week = { gte: dbDate(start), lte: dbDate(addDays(start, 6)) };
  const [visits, candidates] = await Promise.all([
    db.visit.findMany({ where: { ...visitWhere(scope), runRouteId: r.id }, include: { serviceUser: suSelect, callType: { select: { name: true } }, assignments: { where: { removedAt: null }, select: { staff: { select: { displayName: true } } } } }, orderBy: [{ date: "asc" }, { routeOrder: { sort: "asc", nulls: "last" } }, { scheduledStart: "asc" }] }),
    db.visit.findMany({ where: { ...visitWhere(scope), runRouteId: null, status: { not: "CANCELLED" }, date: week, ...(r.staffId ? { assignments: { some: { staffId: r.staffId, removedAt: null } } } : r.areaId ? { areaId: r.areaId } : {}) }, include: { serviceUser: suSelect }, orderBy: { scheduledStart: "asc" }, take: 300 }),
  ]);
  const owner = r.staffId ? (await db.staffMember.findUnique({ where: { id: r.staffId }, select: { displayName: true } }))?.displayName : r.areaId ? (await db.area.findUnique({ where: { id: r.areaId }, select: { name: true } }))?.name : null;
  return { route: r, owner: owner ?? null, visits, candidates };
}

export async function getTemplateRoute(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const r = await templateInScope(scope, id);
  const areaLimit = scope.areaIds ? { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : {};
  const [templates, candidates] = await Promise.all([
    db.visitTemplate.findMany({ where: { organisationId: scope.organisationId, runRouteTemplateId: r.id }, include: { serviceUser: suSelect, callType: { select: { name: true } } }, orderBy: [{ routeOrder: { sort: "asc", nulls: "last" } }, { startMinute: "asc" }] }),
    db.visitTemplate.findMany({ where: { organisationId: scope.organisationId, runRouteTemplateId: null, enabled: true, ...areaLimit, ...(r.staffId ? { OR: [{ preferredStaff1Id: r.staffId }, { preferredStaff2Id: r.staffId }] } : r.areaId ? { areaId: r.areaId } : {}) }, include: { serviceUser: suSelect }, orderBy: { startMinute: "asc" }, take: 300 }),
  ]);
  const owner = r.staffId ? (await db.staffMember.findUnique({ where: { id: r.staffId }, select: { displayName: true } }))?.displayName : r.areaId ? (await db.area.findUnique({ where: { id: r.areaId }, select: { name: true } }))?.name : null;
  return { route: r, owner: owner ?? null, templates, candidates };
}

/** Adds visits (live) or templates (template route) to the end of the route, in time order. */
export async function addToRoute(ctx: Ctx, kind: "LIVE" | "TEMPLATE", routeId: string, ids: string[]) {
  const scope = await rotaScope(ctx, "rota.edit");
  const unique = [...new Set(ids)];
  if (!unique.length) throw new ValidationError("Choose at least one visit");
  if (kind === "LIVE") {
    const r = await liveInScope(scope, routeId);
    const start = fromDbDate(r.weekStart);
    return db.$transaction(async (tx) => {
      const vs = await tx.visit.findMany({ where: { ...visitWhere(scope), id: { in: unique }, runRouteId: null, date: { gte: dbDate(start), lte: dbDate(addDays(start, 6)) } }, orderBy: { scheduledStart: "asc" } });
      if (vs.length !== unique.length) throw new ConflictError("Some visits are outside this route's week, already on a route or not in your areas");
      const max = (await tx.visit.aggregate({ where: { runRouteId: r.id }, _max: { routeOrder: true } }))._max.routeOrder ?? 0;
      for (const [i, v] of vs.entries()) await tx.visit.update({ where: { id: v.id }, data: { runRouteId: r.id, routeOrder: max + i + 1 } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route.visits_added", entityType: "RunRoute", entityId: r.id, data: { added: vs.length } }, tx);
      return vs.length;
    });
  }
  const r = await templateInScope(scope, routeId);
  return db.$transaction(async (tx) => {
    const ts = await tx.visitTemplate.findMany({ where: { organisationId: scope.organisationId, id: { in: unique }, runRouteTemplateId: null, ...(scope.areaIds ? { OR: [{ areaId: { in: scope.areaIds } }, { areaId: null }] } : {}) }, orderBy: { startMinute: "asc" } });
    if (ts.length !== unique.length) throw new ConflictError("Some templates are already on a route or not in your areas");
    const max = (await tx.visitTemplate.aggregate({ where: { runRouteTemplateId: r.id }, _max: { routeOrder: true } }))._max.routeOrder ?? 0;
    for (const [i, t] of ts.entries()) await tx.visitTemplate.update({ where: { id: t.id }, data: { runRouteTemplateId: r.id, routeOrder: max + i + 1 } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route_template.added", entityType: "RunRouteTemplate", entityId: r.id, data: { added: ts.length } }, tx);
    return ts.length;
  });
}

export async function removeFromRoute(ctx: Ctx, kind: "LIVE" | "TEMPLATE", routeId: string, id: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  const r = kind === "LIVE" ? await liveInScope(scope, routeId) : await templateInScope(scope, routeId);
  await db.$transaction(async (tx) => {
    const done = kind === "LIVE"
      ? await tx.visit.updateMany({ where: { id, runRouteId: r.id }, data: { runRouteId: null, routeOrder: null } })
      : await tx.visitTemplate.updateMany({ where: { id, runRouteTemplateId: r.id }, data: { runRouteTemplateId: null, routeOrder: null } });
    if (!done.count) throw new NotFoundError("Stop on this route");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: kind === "LIVE" ? "rota.route.visit_removed" : "rota.route_template.removed", entityType: kind === "LIVE" ? "RunRoute" : "RunRouteTemplate", entityId: r.id, data: { id } }, tx);
  });
}

/** Moves one stop up or down: within its day on a live route, within the round on a template route. */
export async function moveStop(ctx: Ctx, kind: "LIVE" | "TEMPLATE", routeId: string, id: string, dir: "up" | "down") {
  const scope = await rotaScope(ctx, "rota.edit");
  const r = kind === "LIVE" ? await liveInScope(scope, routeId) : await templateInScope(scope, routeId);
  await db.$transaction(async (tx) => {
    let ids: string[];
    if (kind === "LIVE") {
      const v = await tx.visit.findFirst({ where: { id, runRouteId: r.id } });
      if (!v) throw new NotFoundError("Stop on this route");
      ids = (await tx.visit.findMany({ where: { runRouteId: r.id, date: v.date }, orderBy: [{ routeOrder: { sort: "asc", nulls: "last" } }, { scheduledStart: "asc" }], select: { id: true } })).map((x) => x.id);
    } else {
      ids = (await tx.visitTemplate.findMany({ where: { runRouteTemplateId: r.id }, orderBy: [{ routeOrder: { sort: "asc", nulls: "last" } }, { startMinute: "asc" }], select: { id: true } })).map((x) => x.id);
      if (!ids.includes(id)) throw new NotFoundError("Stop on this route");
    }
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (const [n, x] of ids.entries()) {
      if (kind === "LIVE") await tx.visit.update({ where: { id: x }, data: { routeOrder: n + 1 } });
      else await tx.visitTemplate.update({ where: { id: x }, data: { routeOrder: n + 1 } });
    }
  });
}

/** Removes a live route: its visits stay on the rota, just off the route. A template route is switched off instead. */
export async function removeRoute(ctx: Ctx, kind: "LIVE" | "TEMPLATE", routeId: string) {
  const scope = await rotaScope(ctx, "rota.edit");
  if (kind === "LIVE") {
    const r = await liveInScope(scope, routeId);
    await db.$transaction(async (tx) => {
      const n = await tx.visit.updateMany({ where: { runRouteId: r.id }, data: { runRouteId: null, routeOrder: null } });
      await tx.runRoute.delete({ where: { id: r.id } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route.removed", entityType: "RunRoute", entityId: r.id, data: { name: r.name, week: fromDbDate(r.weekStart), visits: n.count } }, tx);
    });
    return;
  }
  const r = await templateInScope(scope, routeId);
  await db.$transaction(async (tx) => {
    await tx.visitTemplate.updateMany({ where: { runRouteTemplateId: r.id }, data: { runRouteTemplateId: null, routeOrder: null } });
    await tx.runRouteTemplate.update({ where: { id: r.id }, data: { active: false } });
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.route_template.disabled", entityType: "RunRouteTemplate", entityId: r.id }, tx);
  });
}

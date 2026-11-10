import { db } from "@/lib/db";
import { isCarerPlace } from "@/lib/carer-places";
import { dbDate, fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { cleanSearch } from "@/lib/service-user-search";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { serviceUserMatchWhere } from "@/server/care/service-user-search";
import { suName } from "@/server/rota/queries";
import { rotaScope, serviceUserWhere, visitWhere } from "@/server/rota/scope";
import { rotaSearch } from "@/server/rota/search";

/**
 * Record results for the Ctrl+K command bar (approved redesign, 10 Nov 2026): service users, staff and today's
 * visits. People come from the top bar's search (`rotaSearch`), so the command bar finds exactly what that search
 * finds; today's visits use the same visit scope. Everything is limited to the signed-in member's organisation,
 * branches, areas and permissions, and a member without the rota sees no records at all.
 *
 * Pages and actions are not searched here: the app layout lists the ones the member may open (`commandLinks`).
 */

const PER_GROUP = 6;

export interface CommandRow {
  id: string;
  title: string;
  detail: string;
  href: string;
}
export interface CommandServiceUser extends CommandRow {
  /** Present when the member may add a visit (rota.edit). */
  addVisitHref: string | null;
  carePlanHref: string;
}
export interface CommandResults {
  q: string;
  serviceUsers: CommandServiceUser[];
  staff: CommandRow[];
  visitsToday: (CommandRow & { hour: string })[];
  /** Set when the encrypted reference register could not be searched; the other results are still complete. */
  referenceProblem: string | null;
}

const STATUS_WORD: Record<string, string> = { SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", MISSED: "Missed", CANCELLED: "Cancelled", NOT_DELIVERED: "Not delivered" };

export async function commandSearch(ctx: Ctx, raw: string, now: Date = new Date()): Promise<CommandResults> {
  const q = cleanSearch(raw);
  const none: CommandResults = { q, serviceUsers: [], staff: [], visitsToday: [], referenceProblem: null };
  if (!ctx.organisationId || !hasOrgPermission(ctx, "rota.view") || q.length < 2) return none;
  const scope = await rotaScope(ctx, "rota.view");
  const found = await rotaSearch(ctx, q);
  const people = found.serviceUsers.slice(0, PER_GROUP);
  const ids = people.map((s) => s.id);
  const today = londonDate(now);
  const like = { contains: q, mode: "insensitive" as const };
  const [areas, next, visits] = await Promise.all([
    // Scoped again, so nothing is read for a record the search did not return for this member.
    db.serviceUser.findMany({ where: { AND: [serviceUserWhere(scope), { id: { in: ids } }] }, select: { id: true, area: { select: { name: true } } } }),
    Promise.all(ids.map((id) => db.visit.findFirst({ where: { AND: [visitWhere(scope), { serviceUserId: id, status: "SCHEDULED", scheduledStart: { gte: now } }] }, select: { serviceUserId: true, date: true, scheduledStart: true }, orderBy: { scheduledStart: "asc" } }))),
    db.visit.findMany({
      where: { AND: [visitWhere(scope), { date: dbDate(today) }, { OR: [{ reference: like }, { serviceUser: serviceUserMatchWhere(q, { sensitive: false, referenceIds: [] }) }, { assignments: { some: { removedAt: null, staff: { displayName: like } } } }] }] },
      select: { id: true, scheduledStart: true, status: true, carersRequired: true, callType: { select: { name: true } }, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } }, assignments: { where: { removedAt: null }, select: { slot: true } } },
      orderBy: { scheduledStart: "asc" },
      take: PER_GROUP,
    }),
  ]);
  const areaOf = new Map(areas.map((a) => [a.id, a.area?.name ?? null]));
  const nextOf = new Map(next.filter((v) => v !== null).map((v) => [v.serviceUserId, v]));
  const canAdd = hasOrgPermission(ctx, "rota.edit");
  return {
    q,
    referenceProblem: found.referenceProblem,
    serviceUsers: people.map((s) => {
      const n = nextOf.get(s.id);
      const day = n ? fromDbDate(n.date) : null;
      const nextText = n ? `next visit ${day === today ? "" : `${fmtLondonDate(day!, { weekday: "short", day: "numeric", month: "short" })} `}${londonTime(n.scheduledStart)}` : null;
      return {
        id: s.id,
        title: s.name,
        // The search's own detail (reference, postcode, status, matched reference) when there is no area or visit to show.
        detail: [areaOf.get(s.id), nextText].filter(Boolean).join(" · ") || s.detail,
        href: `/rota/service-users/${s.id}`,
        addVisitHref: canAdd ? `/rota/visits/new?serviceUserId=${s.id}` : null,
        carePlanHref: `/rota/service-users/${s.id}?tab=care-plans`,
      };
    }),
    staff: found.staff.slice(0, PER_GROUP).map((s) => ({ id: s.id, title: s.name, detail: s.detail, href: `/rota/staff/${s.id}` })),
    visitsToday: visits.map((v) => {
      const time = londonTime(v.scheduledStart);
      const short = v.status === "SCHEDULED" && v.assignments.filter(isCarerPlace).length < v.carersRequired;
      return { id: v.id, hour: time.slice(0, 2), title: `${suName(v.serviceUser)} · ${v.callType.name} ${time}`, detail: short ? "Needs a carer" : (STATUS_WORD[v.status] ?? v.status), href: `/rota/visits/${v.id}` };
    }),
  };
}

export interface CommandLink {
  label: string;
  href: string;
  /** Shown on the right of the row: the module for a page, the area of work for an action. */
  hint: string;
}

/** The actions the member may take, each a link to the screen that does it (and checks the permission again). */
export function commandActions(ctx: Ctx): CommandLink[] {
  if (!ctx.organisationId) return [];
  const can = (p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);
  const out: CommandLink[] = [];
  if (can("rota.edit")) out.push({ label: "Add a visit", href: "/rota/visits/new", hint: "Rota" });
  if (can("rota.build")) out.push({ label: "Build the rota for a week", href: "/rota/build", hint: "Rota" });
  if (can("rota.view")) out.push({ label: "See visits that need a carer", href: "/rota/visits?view=unassigned", hint: "Rota" });
  if (can("serviceUser.edit")) out.push({ label: "Add a service user", href: "/rota/service-users/new", hint: "Service users" });
  if (can("assistant.use")) out.push({ label: "Ask the AI Assistant", href: "/assistant", hint: "Reporting" });
  out.push({ label: "Open notifications", href: "/notifications", hint: "Alerts" });
  return out;
}

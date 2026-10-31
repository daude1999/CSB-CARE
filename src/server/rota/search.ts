import { db } from "@/lib/db";
import { fromDbDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, staffDirectoryWhere, visitWhere } from "./scope";
import { suName } from "./queries";

const LIMIT = 15;

/**
 * The top bar search on rostering pages: service users, team members and visit references the member may see. Each
 * group is only searched with the permission its page checks, and every query keeps the member's branch and area limits.
 */
export async function rotaSearch(ctx: Ctx, raw: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return { q, serviceUsers: [], staff: [], visits: [] };
  const like = { contains: q, mode: "insensitive" as const };
  const [serviceUsers, staff, visits] = await Promise.all([
    hasOrgPermission(ctx, "serviceUser.view")
      ? db.serviceUser.findMany({ where: { AND: [serviceUserWhere(scope), { OR: [{ firstName: like }, { lastName: like }, { preferredName: like }, { reference: like }, { postcode: like }] }] }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, postcode: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: LIMIT })
      : Promise.resolve([]),
    hasOrgPermission(ctx, "staff.directory")
      ? db.staffMember.findMany({ where: { organisationId: scope.organisationId, ...staffDirectoryWhere(scope, { status: "all", q }) }, select: { id: true, displayName: true, jobTitle: true, employmentStatus: true }, orderBy: { displayName: "asc" }, take: LIMIT })
      : Promise.resolve([]),
    db.visit.findMany({ where: { AND: [visitWhere(scope), { reference: like }] }, select: { id: true, reference: true, date: true, scheduledStart: true, status: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } }, orderBy: { scheduledStart: "desc" }, take: LIMIT }),
  ]);
  return {
    q,
    serviceUsers: serviceUsers.map((s) => ({ id: s.id, name: suName(s), detail: [s.reference, s.postcode, s.status.toLowerCase()].filter(Boolean).join(" · ") })),
    staff: staff.map((s) => ({ id: s.id, name: s.displayName, detail: [s.jobTitle, s.employmentStatus === "ACTIVE" ? null : s.employmentStatus.toLowerCase()].filter(Boolean).join(" · ") })),
    visits: visits.map((v) => ({ id: v.id, reference: v.reference, detail: `${suName(v.serviceUser)} · ${fromDbDate(v.date)} ${londonTime(v.scheduledStart)} · ${v.status.toLowerCase().replace("_", " ")}` })),
  };
}

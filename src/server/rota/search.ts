import { db } from "@/lib/db";
import { fromDbDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, staffDirectoryWhere, visitWhere } from "./scope";
import { suName } from "./queries";
import { lookUpReferences, matchedReferenceLabel, serviceUserMatchWhere } from "@/server/care/service-user-search";
import { cleanSearch } from "@/lib/service-user-search";

const LIMIT = 15;

/**
 * The top bar search on rostering pages: service users, team members and visit references the member may see. Each
 * group is only searched with the permission its page checks, and every query keeps the member's branch and area limits.
 * Service users are found the same way as in the Service Users directory (every status, ended people included). If the
 * encrypted reference lookup fails, the other results are still returned with `referenceProblem` saying why.
 */
export async function rotaSearch(ctx: Ctx, raw: string) {
  const scope = await rotaScope(ctx, "rota.view");
  const q = cleanSearch(raw);
  if (q.length < 2) return { q, serviceUsers: [], staff: [], visits: [], referenceProblem: null };
  const like = { contains: q, mode: "insensitive" as const };
  const canSu = hasOrgPermission(ctx, "serviceUser.view");
  // External references (council, Frameworki, package, NHS for restricted roles) are exact, encrypted lookups.
  const refs = canSu ? await lookUpReferences(ctx, q) : { hits: [], problem: null };
  const match = serviceUserMatchWhere(q, { sensitive: hasOrgPermission(ctx, "serviceUser.sensitive"), referenceIds: [...new Set(refs.hits.map((h) => h.serviceUserId))] });
  const [serviceUsers, staff, visits] = await Promise.all([
    canSu
      ? db.serviceUser.findMany({ where: { AND: [serviceUserWhere(scope), match] }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true, csbReference: true, postcode: true, status: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: LIMIT })
      : Promise.resolve([]),
    hasOrgPermission(ctx, "staff.directory")
      ? db.staffMember.findMany({ where: { organisationId: scope.organisationId, ...staffDirectoryWhere(scope, { status: "all", q }) }, select: { id: true, displayName: true, jobTitle: true, employmentStatus: true }, orderBy: { displayName: "asc" }, take: LIMIT })
      : Promise.resolve([]),
    db.visit.findMany({ where: { AND: [visitWhere(scope), { reference: like }] }, select: { id: true, reference: true, date: true, scheduledStart: true, status: true, serviceUser: { select: { firstName: true, lastName: true, preferredName: true } } }, orderBy: { scheduledStart: "desc" }, take: LIMIT }),
  ]);
  return {
    q,
    referenceProblem: refs.problem,
    serviceUsers: serviceUsers.map((s) => {
      const m = matchedReferenceLabel(refs.hits, s.id);
      const matched = m ? `matched ${m}` : null;
      return { id: s.id, name: suName(s), detail: [s.csbReference ?? s.reference, s.csbReference && s.reference !== s.csbReference ? `legacy ${s.reference}` : null, s.postcode, s.status.toLowerCase(), matched].filter(Boolean).join(" · ") };
    }),
    staff: staff.map((s) => ({ id: s.id, name: s.displayName, detail: [s.jobTitle, s.employmentStatus === "ACTIVE" ? null : s.employmentStatus.toLowerCase()].filter(Boolean).join(" · ") })),
    visits: visits.map((v) => ({ id: v.id, reference: v.reference, detail: `${suName(v.serviceUser)} · ${fromDbDate(v.date)} ${londonTime(v.scheduledStart)} · ${v.status.toLowerCase().replace("_", " ")}` })),
  };
}

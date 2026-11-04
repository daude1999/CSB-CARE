import type { Prisma } from "@prisma/client";
import { fmtLondonDate, fromDbDate, londonTime } from "@/lib/london";

type Tx = Prisma.TransactionClient;

/**
 * Tells the linked carers of published visits, in the app, that a visit they are booked on has changed. Only carers
 * with a login get a notice; unpublished (draft) visits are never announced. Returns how many carers were told. The
 * notice is created, not "seen": the visit history shows read / not yet read from each notice's readAt.
 */
export async function notifyVisitsChanged(tx: Tx, organisationId: string, visitIds: string[], opts: { key: string; extraStaffIds?: Map<string, string[]> }) {
  if (!visitIds.length) return 0;
  const visits = await tx.visit.findMany({
    where: { organisationId, id: { in: visitIds }, publishedAt: { not: null } },
    select: {
      id: true, date: true, scheduledStart: true, scheduledEnd: true, status: true,
      serviceUser: { select: { firstName: true, lastName: true, preferredName: true } },
      assignments: { where: { removedAt: null }, select: { staff: { select: { userId: true } } } },
    },
  });
  const extraIds = [...new Set([...(opts.extraStaffIds?.values() ?? [])].flat())];
  const extraUsers = extraIds.length ? new Map((await tx.staffMember.findMany({ where: { organisationId, id: { in: extraIds } }, select: { id: true, userId: true } })).map((s) => [s.id, s.userId])) : new Map<string, string | null>();
  const rows: Prisma.NotificationCreateManyInput[] = [];
  const told = new Set<string>();
  for (const v of visits) {
    const who = `${v.serviceUser.preferredName || v.serviceUser.firstName} ${v.serviceUser.lastName}`;
    const when = fmtLondonDate(fromDbDate(v.date), { weekday: "short", day: "numeric", month: "short" });
    const users = new Set([...v.assignments.map((a) => a.staff.userId), ...(opts.extraStaffIds?.get(v.id) ?? []).map((id) => extraUsers.get(id) ?? null)].filter((x): x is string => !!x));
    for (const userId of users) {
      told.add(userId);
      rows.push({
        organisationId,
        userId,
        type: "rota.visit.changed",
        title: v.status === "CANCELLED" ? `Your visit for ${who} on ${when} is cancelled` : `Your visit for ${who} on ${when} has changed`,
        body: v.status === "CANCELLED" ? "Open My visits to see your updated rota." : `It is now ${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)}. Open My visits to see the details.`,
        reason: "The office changed a published visit you are booked on.",
        actionUrl: "/carer",
        dedupeKey: `visit-changed:${opts.key}:${v.id}:${userId}`,
      });
    }
  }
  if (rows.length) await tx.notification.createMany({ data: rows, skipDuplicates: true });
  return told.size;
}

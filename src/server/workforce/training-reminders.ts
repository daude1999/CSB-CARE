import type { Prisma, PrismaClient } from "@prisma/client";
import type { ReminderPlan } from "@/hr/lib/training";
import { reminderText } from "@/hr/lib/training";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * HR employee id → the CSB sign-in linked to that person (by an administrator, never by matching e-mail), for the
 * people asked about. Only sign-ins that are active and still members of this organisation count.
 */
export async function linkedSignIns(client: Client, organisationId: string, hrEmployeeIds: string[]): Promise<Map<string, string>> {
  if (!hrEmployeeIds.length) return new Map();
  const rows = await client.staffMember.findMany({
    where: {
      organisationId,
      hrEmployeeId: { in: hrEmployeeIds },
      hrMissing: false,
      userId: { not: null },
    },
    select: { hrEmployeeId: true, userId: true },
  });
  const userIds = rows.map((r) => r.userId).filter((id): id is string => !!id);
  const active = new Set(
    (await client.user.findMany({ where: { id: { in: userIds }, deactivatedAt: null, memberships: { some: { organisationId } } }, select: { id: true } })).map((x) => x.id),
  );
  return new Map(rows.filter((r) => r.userId && active.has(r.userId)).map((r) => [r.hrEmployeeId, r.userId as string]));
}

/**
 * Writes the training reminders as in-app notifications (the bell), inside the HR transaction. No e-mail delivery is
 * created, so nothing leaves CSB. The dedupe key is per person per day, matching the HR rule of one reminder a day.
 */
export async function createTrainingReminders(tx: Prisma.TransactionClient, organisationId: string, plans: ReminderPlan[], senderName: string, today: string) {
  if (!plans.length) return 0;
  const current = await linkedSignIns(tx, organisationId, plans.map((p) => p.employee));
  for (const p of plans) if (current.get(p.employee) !== p.userId) throw new Error("A sign-in link changed while sending. Nothing was sent; please try again.");
  const created = await tx.notification.createMany({
    data: plans.map((p) => {
      const text = reminderText(p.items);
      const due = p.items.map((i) => i.due).filter((d): d is string => !!d && d >= today).sort()[0];
      return {
        organisationId,
        userId: p.userId,
        type: "hr.training_reminder",
        title: text.title,
        body: text.body,
        reason: `${senderName} in HR sent you a training reminder.`,
        links: [],
        dueAt: due ? new Date(due + "T12:00:00Z") : null,
        dedupeKey: `hr-training-reminder:${organisationId}:${p.employee}:${today}:${p.userId}`,
      };
    }),
    skipDuplicates: true,
  });
  return created.count;
}

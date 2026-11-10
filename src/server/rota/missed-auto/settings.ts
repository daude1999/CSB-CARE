import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaSettings } from "../settings";

/**
 * Missed call automation switches. Each stage is off until an organisation admin switches it on, and switching a stage
 * off is the rollback: nothing already recorded is removed, and the existing missed-call workflow never depends on it.
 *  - evidence: collect the system's records into a dated snapshot and timeline for each missed call;
 *  - confirm: ask each booked carer with a linked sign-in what happened (needs evidence);
 *  - summary: a rules-based suggested reason for the coordinator to accept or reject (needs evidence).
 */
export interface AutomationSwitches {
  evidence: boolean;
  confirm: boolean;
  summary: boolean;
  confirmMinutes: number;
  reminders: number;
  reminderMinutes: number;
}

export async function automationSwitches(tx: Tx, organisationId: string): Promise<AutomationSwitches> {
  const s = await rotaSettings(tx, organisationId);
  const evidence = !!s.missedAutoEvidenceAt;
  return {
    evidence,
    confirm: evidence && !!s.missedAutoConfirmAt,
    summary: evidence && !!s.missedAutoSummaryAt,
    confirmMinutes: s.missedConfirmMinutes,
    reminders: s.missedConfirmReminders,
    reminderMinutes: s.missedConfirmReminderMinutes,
  };
}

export const automationSchema = z
  .object({
    evidence: z.boolean(),
    confirm: z.boolean(),
    summary: z.boolean(),
    confirmMinutes: z.coerce.number<number>({ message: "Answer time must be a number of minutes" }).int().min(15, "Give carers at least 15 minutes to answer").max(1440, "Answer time can be at most 24 hours"),
    reminders: z.coerce.number<number>().int().min(0).max(2, "At most 2 reminders"),
    reminderMinutes: z.coerce.number<number>().int().min(5).max(1440),
  })
  .refine((v) => v.reminders === 0 || v.reminderMinutes < v.confirmMinutes, { message: "The first reminder must come before the answer time runs out", path: ["reminderMinutes"] });

export async function setMissedAutomation(ctx: Ctx, input: z.input<typeof automationSchema>) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  const p = automationSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the automation settings");
  const d = p.data;
  if ((d.confirm || d.summary) && !d.evidence) throw new ValidationError("Switch on evidence collection first: carer confirmation and suggestions are built on it");
  await db.$transaction(async (tx) => {
    const s = await rotaSettings(tx, organisationId);
    const stamp = (on: boolean, at: Date | null, by: string | null) => (on ? { at: at ?? new Date(), by: at ? by : ctx.userId } : { at: null, by: null });
    const ev = stamp(d.evidence, s.missedAutoEvidenceAt, s.missedAutoEvidenceById);
    const cf = stamp(d.confirm, s.missedAutoConfirmAt, s.missedAutoConfirmById);
    const su = stamp(d.summary, s.missedAutoSummaryAt, s.missedAutoSummaryById);
    await tx.rotaSettings.update({
      where: { organisationId },
      data: {
        missedAutoEvidenceAt: ev.at, missedAutoEvidenceById: ev.by,
        missedAutoConfirmAt: cf.at, missedAutoConfirmById: cf.by,
        missedAutoSummaryAt: su.at, missedAutoSummaryById: su.by,
        missedConfirmMinutes: d.confirmMinutes, missedConfirmReminders: d.reminders, missedConfirmReminderMinutes: d.reminderMinutes,
        updatedById: ctx.userId,
      },
    });
    // Switching carer confirmation off withdraws open requests, so carers are not left with a form nobody will read.
    if (!d.confirm && s.missedAutoConfirmAt) {
      await tx.missedCallCarerConfirmation.updateMany({ where: { organisationId, status: "REQUESTED" }, data: { status: "WITHDRAWN" } });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "rota.missed.auto.settings", entityType: "Organisation", entityId: organisationId, data: { evidence: d.evidence, confirm: d.confirm, summary: d.summary, confirmMinutes: d.confirmMinutes, reminders: d.reminders, reminderMinutes: d.reminderMinutes } }, tx);
  });
}

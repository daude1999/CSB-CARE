import type { Prisma, RotaSettings } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { dbDate, isIsoDate, isoWeekday, londonDate, mondayOf } from "@/lib/london";
import { ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";

/** Job titles that count as care roles until an administrator changes the list. */
export const DEFAULT_CARE_ROLES = ["Care Support Worker", "Senior Support Worker", "Care Worker", "Senior Care Worker", "Carer", "Home Care Worker", "Support Worker"];

/** The organisation's rota settings, created with documented defaults the first time they are needed. */
export async function rotaSettings(tx: Tx | Prisma.TransactionClient, organisationId: string): Promise<RotaSettings> {
  const found = await tx.rotaSettings.findUnique({ where: { organisationId } });
  if (found) return found;
  return tx.rotaSettings.upsert({
    where: { organisationId },
    create: { organisationId, anchorMonday: dbDate(mondayOf(londonDate())), careRoleTitles: DEFAULT_CARE_ROLES },
    update: {},
  });
}

export function isCareRole(settings: Pick<RotaSettings, "careRoleTitles">, jobTitle: string) {
  const t = jobTitle.trim().toLowerCase();
  return settings.careRoleTitles.some((r) => r.trim().toLowerCase() === t);
}

const rule = z.enum(["BLOCK", "REVIEW", "IGNORE"]);
export const settingsSchema = z
  .object({
    cycleLength: z.coerce.number().int().min(1).max(4),
    anchorMonday: z.string().refine(isIsoDate, "Choose a valid date").refine((d) => isoWeekday(d) === 1, "The Week 1 date must be a Monday"),
    buildAheadWeeks: z.coerce.number().int().min(0).max(8),
    lateAfterMin: z.coerce.number().int().min(1).max(120),
    missedAfterMin: z.coerce.number().int().min(2).max(480),
    earlyBeforeMin: z.coerce.number().int().min(0).max(120),
    blockEarlyClockIn: z.boolean(),
    shortVisitPercent: z.coerce.number().int().min(1).max(100),
    requireNoteOnShortVisit: z.boolean(),
    dbsRule: rule,
    rightToWorkRule: rule,
    trainingRule: rule,
    careRoleTitles: z.array(z.string().trim().min(2).max(100)).max(50),
    minPreferenceRating: z.coerce.number().int().min(1).max(5).nullable(),
    geofenceMetres: z.coerce.number().int().min(25).max(2000),
    carerDaysForward: z.coerce.number().int().min(0).max(28),
    carerDaysBack: z.coerce.number().int().min(0).max(14),
    mandatoryClockOutNote: z.boolean(),
    doorstepCancel: z.boolean(),
    alertLatencyTargetSec: z.coerce.number().int().min(60).max(3600),
    // Missed Calls repeat rules. Optional so older callers keep the stored values.
    repeatOffenderCount: z.coerce.number().int().min(2).max(20).optional(),
    repeatClientCount: z.coerce.number().int().min(2).max(20).optional(),
    repeatWindowDays: z.coerce.number().int().min(7).max(365).optional(),
  })
  .refine((s) => s.missedAfterMin > s.lateAfterMin, { message: "A visit must become late before it becomes missed", path: ["missedAfterMin"] });

export type SettingsInput = z.input<typeof settingsSchema>;

/** Takes raw form values; the schema coerces and validates them. */
export async function updateRotaSettings(ctx: Ctx, input: SettingsInput | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the settings");
  const s = parsed.data;
  if (s.dbsRule === "IGNORE" || s.rightToWorkRule === "IGNORE") throw new ValidationError("DBS and right to work checks cannot be switched off for allocation");
  return db.$transaction(async (tx) => {
    const before = await rotaSettings(tx, organisationId);
    const after = await tx.rotaSettings.update({ where: { organisationId }, data: { ...s, anchorMonday: dbDate(s.anchorMonday), updatedById: ctx.userId } });
    const changed = Object.keys(s).filter((k) => JSON.stringify(before[k as keyof RotaSettings]) !== JSON.stringify(after[k as keyof RotaSettings]));
    await audit({ organisationId, actorId: ctx.userId, action: "rota.settings.updated", entityType: "RotaSettings", entityId: organisationId, data: { changed } }, tx);
    return after;
  });
}

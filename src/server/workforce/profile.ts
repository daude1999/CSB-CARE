import { z } from "zod";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { reviewStaffImpact } from "./impact";

/**
 * Rostering's own facts about a member of staff: whether they take part in the rota, gender for matching people's
 * preferences, driving, weekly hour limit and areas. HR facts (employment, checks, training) are never edited here.
 */
const schema = z.object({
  rotaEnabled: z.boolean().nullable(),
  gender: z.enum(["FEMALE", "MALE", "OTHER", "UNDISCLOSED"]).nullable(),
  drives: z.boolean(),
  maxWeeklyHours: z.coerce.number().min(0).max(80).nullable(),
  areaIds: z.array(z.string()).max(50),
  notes: z.string().max(1000).nullable(),
});

export async function updateRotaProfile(ctx: Ctx, staffId: string, input: z.input<typeof schema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "rota.edit");
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the rota details");
  const d = r.data;
  return db.$transaction(async (tx) => {
    const staff = await tx.staffMember.findFirst({ where: { id: staffId, organisationId }, include: { areas: true } });
    if (!staff) throw new NotFoundError("Staff member");
    if (d.areaIds.length && (await tx.area.count({ where: { organisationId, id: { in: d.areaIds } } })) !== new Set(d.areaIds).size) throw new NotFoundError("Area");
    const data = { rotaEnabled: d.rotaEnabled, gender: d.gender, drives: d.drives, maxWeeklyMinutes: d.maxWeeklyHours === null ? null : Math.round(d.maxWeeklyHours * 60), notes: d.notes?.trim() || null, updatedById: ctx.userId };
    await tx.rotaStaffProfile.upsert({ where: { staffId }, create: { staffId, organisationId, ...data }, update: data });
    await tx.staffArea.deleteMany({ where: { staffId } });
    if (d.areaIds.length) await tx.staffArea.createMany({ data: [...new Set(d.areaIds)].map((areaId) => ({ staffId, areaId, organisationId })) });
    await audit({ organisationId, actorId: ctx.userId, action: "rota.staff.profile.updated", entityType: "StaffMember", entityId: staffId, data: { rotaEnabled: d.rotaEnabled, areas: d.areaIds.length, maxWeeklyHours: d.maxWeeklyHours } }, tx);
    // Switching someone off the rota or changing their limits re-checks their future visits (flags only).
    await reviewStaffImpact(tx, organisationId, [staffId], { source: "rota-profile" });
  });
}

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { requireOrgPermission, type Ctx } from "@/server/auth/rbac";

/** The organisation's rota reference lists: areas, call types and care tasks. Items are switched off, never deleted, so history keeps its labels. */

function unique<T>(p: Promise<T>, what: string) {
  return p.catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(`${what} with that name already exists`);
    throw e;
  });
}

const areaSchema = z.object({ name: z.string().trim().min(2, "Name the area").max(80), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour"), branchId: z.string().nullable() });

export async function saveArea(ctx: Ctx, input: { id?: string; name: string; colour: string; branchId: string | null }) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  const r = areaSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the area");
  return db.$transaction(async (tx) => {
    if (r.data.branchId && !(await tx.branch.findFirst({ where: { id: r.data.branchId, organisationId } }))) throw new NotFoundError("Branch");
    if (input.id) {
      if (!(await tx.area.findFirst({ where: { id: input.id, organisationId } }))) throw new NotFoundError("Area");
      await unique(tx.area.update({ where: { id: input.id }, data: r.data }), "An area");
    } else {
      if (await tx.area.findFirst({ where: { organisationId, name: r.data.name } })) throw new ConflictError("An area with that name already exists");
      await tx.area.create({ data: { organisationId, ...r.data } });
    }
    await audit({ organisationId, actorId: ctx.userId, action: input.id ? "rota.area.updated" : "rota.area.created", entityType: "Area", entityId: input.id ?? r.data.name }, tx);
  });
}

export async function setAreaActive(ctx: Ctx, id: string, active: boolean) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  return db.$transaction(async (tx) => {
    const a = await tx.area.findFirst({ where: { id, organisationId } });
    if (!a) throw new NotFoundError("Area");
    if (!active && (await tx.visitTemplate.count({ where: { areaId: id, enabled: true } }))) throw new ValidationError("Move or switch off this area's templates first");
    await tx.area.update({ where: { id }, data: { active } });
    await audit({ organisationId, actorId: ctx.userId, action: active ? "rota.area.enabled" : "rota.area.disabled", entityType: "Area", entityId: id }, tx);
  });
}

/** Which areas a coordinator works in. None means the whole organisation. */
export async function setMemberAreas(ctx: Ctx, membershipId: string, areaIds: string[]) {
  const organisationId = requireOrgPermission(ctx, "org.manage");
  return db.$transaction(async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, organisationId } });
    if (!m) throw new NotFoundError("Member");
    const ids = [...new Set(areaIds)];
    if (ids.length && (await tx.area.count({ where: { organisationId, id: { in: ids } } })) !== ids.length) throw new NotFoundError("Area");
    await tx.membershipArea.deleteMany({ where: { membershipId } });
    if (ids.length) await tx.membershipArea.createMany({ data: ids.map((areaId) => ({ membershipId, areaId })) });
    await audit({ organisationId, actorId: ctx.userId, action: "rota.member.areas", entityType: "Membership", entityId: membershipId, data: { areas: ids.length } }, tx);
  });
}

const callTypeSchema = z.object({ name: z.string().trim().min(2, "Name the call type").max(60), defaultDurationMin: z.coerce.number().int().min(5).max(1440), monitored: z.boolean(), chargeable: z.boolean() });

export async function createCallType(ctx: Ctx, input: z.input<typeof callTypeSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  const r = callTypeSchema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Check the call type");
  return db.$transaction(async (tx) => {
    const c = await unique(tx.callType.create({ data: { organisationId, ...r.data } }), "A call type");
    await audit({ organisationId, actorId: ctx.userId, action: "rota.calltype.created", entityType: "CallType", entityId: c.id }, tx);
  });
}

export async function setCallTypeActive(ctx: Ctx, id: string, active: boolean) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  return db.$transaction(async (tx) => {
    if (!(await tx.callType.findFirst({ where: { id, organisationId } }))) throw new NotFoundError("Call type");
    await tx.callType.update({ where: { id }, data: { active } });
    await audit({ organisationId, actorId: ctx.userId, action: active ? "rota.calltype.enabled" : "rota.calltype.disabled", entityType: "CallType", entityId: id }, tx);
  });
}

export async function createCareTask(ctx: Ctx, input: { name: string; description?: string }) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new ValidationError("Name the task (2 to 80 characters)");
  return db.$transaction(async (tx) => {
    const t = await unique(tx.careTask.create({ data: { organisationId, name, description: input.description?.trim() || null } }), "A task");
    await audit({ organisationId, actorId: ctx.userId, action: "rota.task.created", entityType: "CareTask", entityId: t.id }, tx);
  });
}

export async function setCareTaskActive(ctx: Ctx, id: string, active: boolean) {
  const organisationId = requireOrgPermission(ctx, "rota.settings");
  return db.$transaction(async (tx) => {
    if (!(await tx.careTask.findFirst({ where: { id, organisationId } }))) throw new NotFoundError("Task");
    await tx.careTask.update({ where: { id }, data: { active } });
    await audit({ organisationId, actorId: ctx.userId, action: active ? "rota.task.enabled" : "rota.task.disabled", entityType: "CareTask", entityId: id }, tx);
  });
}

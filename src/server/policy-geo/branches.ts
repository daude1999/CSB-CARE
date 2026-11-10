import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "../audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "../auth/rbac";
import { ensureGeoReference } from "./reference";
import { LOCAL_AUTHORITIES, REGION_CODES, laCode } from "./regions";

/**
 * Branch & Local Authority Configuration. Each existing Branch has one policy compliance profile; name, address and
 * service types stay on the Branch itself so they are never duplicated. A profile starts empty except for a suggested
 * local authority when the branch's name is exactly a local authority's name; it is then "not verified" until a
 * manager checks and confirms it.
 */

/** Branches the person may configure or generate for: all, or only their granted branches. */
export function allowedBranchIds(ctx: Ctx, all: string[]) {
  return ctx.branchIds ? all.filter((id) => ctx.branchIds!.includes(id)) : all;
}

async function ensureProfiles(organisationId: string) {
  const branches = await db.branch.findMany({ where: { organisationId }, include: { policyProfile: true } });
  const missing = branches.filter((b) => !b.policyProfile);
  if (missing.length) {
    await ensureGeoReference();
    const las = await db.localAuthority.findMany({ select: { code: true, name: true, regionCode: true } });
    for (const b of missing) {
      const la = las.find((l) => l.name.toLowerCase() === b.name.trim().toLowerCase());
      await db.branchPolicyProfile.createMany({ data: [{ branchId: b.id, organisationId, localAuthorityCode: la?.code ?? null, regionCode: la?.regionCode ?? null }], skipDuplicates: true });
    }
  }
}

export async function listBranchProfiles(ctx: Ctx) {
  if (!ctx.organisationId) throw new ForbiddenError();
  await ensureProfiles(ctx.organisationId);
  const branches = await db.branch.findMany({
    where: { organisationId: ctx.organisationId },
    include: { policyProfile: { include: { localAuthority: true } }, services: { include: { serviceType: true } } },
    orderBy: { name: "asc" },
  });
  const ids = allowedBranchIds(ctx, branches.map((b) => b.id));
  return branches.filter((b) => ids.includes(b.id));
}

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const profileSchema = z.object({
  branchReference: optText(60),
  address: optText(400),
  postcode: z.string().trim().max(10).optional().transform((v) => (v ? v.toUpperCase() : null)).refine((v) => !v || /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(v), "Enter a full UK postcode"),
  localAuthorityCode: optText(80),
  regionCode: z.enum(REGION_CODES).optional().or(z.literal("").transform(() => undefined)),
  serviceTypes: z.array(z.string()).default([]),
  safeguardingAdultsBoard: optText(200),
  safeguardingChildrenPartnership: optText(200),
  regionalGuidance: optText(2000),
  localProcedures: optText(6000),
  referralUrl: z.string().trim().max(400).optional().transform((v) => (v ? v : null)).refine((v) => !v || /^https:\/\//.test(v), "The referral web page must be an https:// address"),
  safeguardingContacts: optText(2000),
  outOfHoursContacts: optText(2000),
  integratedCareBoard: optText(200),
  commissioningArrangements: optText(2000),
  extraSourceIds: z.array(z.string()).default([]),
  nextReviewDate: z.coerce.date<Date>().optional(),
  responsibleManagerId: optText(60),
  version: z.coerce.number<number>().int().min(1),
});
export type ProfileInput = z.input<typeof profileSchema>;

/**
 * Saves a branch's profile. Changing anything a policy depends on (local authority, procedures, contacts) clears the
 * verification, so a manager must confirm it again. Concurrent edits are refused (version check).
 */
export async function updateBranchProfile(ctx: Ctx, branchId: string, input: ProfileInput | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  const p = profileSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the branch details");
  const d = p.data;
  const branch = await db.branch.findFirst({ where: { id: branchId, organisationId }, include: { policyProfile: true, services: true } });
  if (!branch) throw new NotFoundError("Branch");
  if (!allowedBranchIds(ctx, [branch.id]).length) throw new ForbiddenError("You can only configure your own branches");
  await ensureProfiles(organisationId);
  const prof = branch.policyProfile ?? (await db.branchPolicyProfile.findUniqueOrThrow({ where: { branchId } }));
  if (d.version !== prof.version) throw new ConflictError("Someone else saved this branch while you were editing. Reload and make your change again.");
  let regionCode: string | null = d.regionCode ?? null;
  if (d.localAuthorityCode) {
    const la = await db.localAuthority.findUnique({ where: { code: d.localAuthorityCode } });
    if (!la) throw new ValidationError("Choose the local authority from the list, or add it first");
    if (regionCode && regionCode !== la.regionCode) throw new ValidationError(`${la.name} is in a different region from the one chosen. A region's procedures are never applied to another region.`);
    regionCode = la.regionCode;
  }
  if (d.responsibleManagerId && !(await db.membership.findFirst({ where: { organisationId, userId: d.responsibleManagerId } }))) throw new ValidationError("Choose the responsible manager from your organisation");
  if (d.extraSourceIds.length && (await db.regulatorySource.count({ where: { id: { in: d.extraSourceIds }, isSimulated: false } })) !== d.extraSourceIds.length) throw new ValidationError("Choose sources from the library");
  const services = await db.serviceType.findMany({ where: { code: { in: d.serviceTypes } } });
  if (services.length !== new Set(d.serviceTypes).size) throw new ValidationError("Choose service types from the list");

  const material = (["localAuthorityCode", "localProcedures", "safeguardingContacts", "outOfHoursContacts", "referralUrl", "safeguardingAdultsBoard"] as const).some((k) => (k === "localAuthorityCode" ? d.localAuthorityCode : d[k]) !== prof[k]);
  const contactsChanged = d.safeguardingContacts !== prof.safeguardingContacts || d.outOfHoursContacts !== prof.outOfHoursContacts;
  return db.$transaction(async (tx) => {
    const { count } = await tx.branchPolicyProfile.updateMany({
      where: { branchId, version: prof.version },
      data: {
        branchReference: d.branchReference,
        postcode: d.postcode,
        localAuthorityCode: d.localAuthorityCode,
        regionCode,
        safeguardingAdultsBoard: d.safeguardingAdultsBoard,
        safeguardingChildrenPartnership: d.safeguardingChildrenPartnership,
        regionalGuidance: d.regionalGuidance,
        localProcedures: d.localProcedures,
        referralUrl: d.referralUrl,
        safeguardingContacts: d.safeguardingContacts,
        outOfHoursContacts: d.outOfHoursContacts,
        integratedCareBoard: d.integratedCareBoard,
        commissioningArrangements: d.commissioningArrangements,
        extraSourceIds: d.extraSourceIds,
        nextReviewDate: d.nextReviewDate ?? prof.nextReviewDate,
        responsibleManagerId: d.responsibleManagerId,
        version: { increment: 1 },
        ...(material ? { lastVerifiedAt: null, lastVerifiedById: null } : {}),
        ...(contactsChanged ? { contactsVerifiedAt: null, contactsVerifiedById: null } : {}),
      },
    });
    if (!count) throw new ConflictError("Someone else saved this branch while you were editing. Reload and make your change again.");
    if (d.address !== branch.address) await tx.branch.update({ where: { id: branch.id }, data: { address: d.address } });
    const had = branch.services.map((s) => s.serviceTypeCode).sort().join(",");
    if (had !== [...new Set(d.serviceTypes)].sort().join(",")) {
      await tx.branchServiceType.deleteMany({ where: { branchId } });
      if (d.serviceTypes.length) await tx.branchServiceType.createMany({ data: [...new Set(d.serviceTypes)].map((serviceTypeCode) => ({ branchId, serviceTypeCode })) });
    }
    await audit({ organisationId, actorId: ctx.userId, action: "branch.policy_profile_updated", entityType: "Branch", entityId: branchId, data: { before: JSON.parse(JSON.stringify({ ...prof, address: branch.address })) as Prisma.InputJsonValue, verificationCleared: material, contactsVerificationCleared: contactsChanged } }, tx);
    return { verificationCleared: material };
  });
}

/**
 * A manager confirms the branch configuration (and, separately, the contact details) has been checked against the
 * official local sources. Contacts cannot be confirmed when none are recorded.
 */
export async function verifyBranchProfile(ctx: Ctx, branchId: string, input: { what: "profile" | "contacts"; nextReviewDate?: Date; note: string }) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  if (!input.note || input.note.trim().length < 10) throw new ValidationError("Say which official sources you checked (at least a short sentence)");
  const branch = await db.branch.findFirst({ where: { id: branchId, organisationId }, include: { policyProfile: true } });
  if (!branch?.policyProfile) throw new NotFoundError("Branch");
  if (!allowedBranchIds(ctx, [branch.id]).length) throw new ForbiddenError("You can only verify your own branches");
  const prof = branch.policyProfile;
  const now = new Date();
  if (input.what === "contacts") {
    if (!prof.safeguardingContacts?.trim() || !prof.outOfHoursContacts?.trim()) throw new ValidationError("Record the local safeguarding and out-of-hours contacts from the official page before confirming them");
  } else {
    if (!prof.localAuthorityCode || !prof.regionCode) throw new ValidationError("Record the branch's local authority and region before verifying");
    if (!input.nextReviewDate || input.nextReviewDate <= now) throw new ValidationError("Set a future date for the next review of this configuration");
  }
  await db.$transaction(async (tx) => {
    await tx.branchPolicyProfile.update({
      where: { branchId },
      data: input.what === "contacts" ? { contactsVerifiedAt: now, contactsVerifiedById: ctx.userId } : { lastVerifiedAt: now, lastVerifiedById: ctx.userId, nextReviewDate: input.nextReviewDate },
    });
    await audit({ organisationId, actorId: ctx.userId, action: input.what === "contacts" ? "branch.contacts_verified" : "branch.policy_profile_verified", entityType: "Branch", entityId: branchId, data: { note: input.note.trim(), nextReviewDate: input.nextReviewDate?.toISOString() ?? null } }, tx);
  });
}

const laSchema = z.object({ name: z.string().trim().min(3, "Give the local authority's name").max(120), regionCode: z.enum(REGION_CODES), subRegion: optText(120) });

/** Adds a local authority so a new branch or service user area can be configured without a code change. */
export async function addLocalAuthority(ctx: Ctx, input: z.input<typeof laSchema> | Record<string, unknown>) {
  const organisationId = requireOrgPermission(ctx, "policy.localConfig");
  const p = laSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the local authority");
  const code = laCode(p.data.name);
  if (await db.localAuthority.findUnique({ where: { code } })) throw new ConflictError(`${p.data.name} is already in the list`);
  const la = await db.localAuthority.create({ data: { code, name: p.data.name, regionCode: p.data.regionCode, subRegion: p.data.subRegion, addedByOrganisationId: organisationId } });
  await audit({ organisationId, actorId: ctx.userId, action: "local_authority.added", entityType: "LocalAuthority", entityId: code, data: { name: la.name, regionCode: la.regionCode } });
  return la;
}

export const STARTER_LOCAL_AUTHORITY_COUNT = LOCAL_AUTHORITIES.length;

export function canConfigure(ctx: Ctx) {
  return hasOrgPermission(ctx, "policy.localConfig");
}

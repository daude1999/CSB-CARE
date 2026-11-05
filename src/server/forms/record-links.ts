import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, staffDirectoryWhere } from "@/server/rota/scope";
import { suName } from "@/server/rota/queries";
import { canComplete, canReview, digitalForms, loadRecord, startForm, STATUS_LABELS, type RecordStatus } from "./records";

/**
 * Forms PR 4: a form record linked to the CRM record it is about. A Subject Access Request log entry can be linked to
 * the service user or staff member whose information was asked for, and then shows on that person's record.
 *
 * Nothing is copied: the link holds ids only, and names are read from the person's own record when shown. Only people
 * who may see both the form record (its author and the form's reviewers) and the person (organisation, branch and
 * area scope) see the link. Removing a link needs a reason and keeps it in the history.
 */

export const LINK_TYPES = ["SERVICE_USER", "STAFF_MEMBER"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const LINK_TYPE_LABELS: Record<LinkType, string> = { SERVICE_USER: "Service user", STAFF_MEMBER: "Staff member" };

const Id = z.string().regex(/^[a-z0-9]{8,40}$/i);
export const LinkTarget = z.object({ entityType: z.enum(LINK_TYPES), entityId: Id });
export type LinkTarget = z.infer<typeof LinkTarget>;

/** Parses a posted "SERVICE_USER:id" / "STAFF_MEMBER:id" choice. */
export function parseLinkChoice(v: string | null | undefined): LinkTarget | null {
  if (!v) return null;
  const [entityType, entityId] = v.split(":");
  const parsed = LinkTarget.safeParse({ entityType, entityId });
  if (!parsed.success) throw new ValidationError("Choose who this form is about");
  return parsed.data;
}

const canSeeServiceUsers = (ctx: Ctx) => hasOrgPermission(ctx, "serviceUser.view");
const canSeeStaff = (ctx: Ctx) => hasOrgPermission(ctx, "staff.directory");

/** The person behind a link target, only if the caller may see them. */
async function visibleTarget(ctx: Ctx, t: LinkTarget) {
  if (t.entityType === "SERVICE_USER") {
    if (!canSeeServiceUsers(ctx)) throw new ForbiddenError("You cannot link forms to service users");
    const scope = await rotaScope(ctx, "serviceUser.view");
    const su = await db.serviceUser.findFirst({ where: { ...serviceUserWhere(scope), id: t.entityId }, select: { id: true, firstName: true, lastName: true, preferredName: true } });
    if (!su) throw new NotFoundError("Service user");
    return { ...t, name: suName(su) };
  }
  if (!canSeeStaff(ctx)) throw new ForbiddenError("You cannot link forms to staff members");
  const scope = await rotaScope(ctx, "staff.directory");
  const s = await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: t.entityId }, select: { id: true, displayName: true } });
  if (!s) throw new NotFoundError("Staff member");
  return { ...t, name: s.displayName };
}

const linkData = (t: LinkTarget) => (t.entityType === "SERVICE_USER" ? { serviceUserId: t.entityId } : { staffMemberId: t.entityId });

/** Writes one link inside a transaction (the caller has already checked permissions and the target). */
export async function createLinkInTx(tx: Tx, ctx: Ctx, rec: { id: string; organisationId: string; reference: string }, t: LinkTarget) {
  const existing = await tx.formRecordLink.findFirst({ where: { recordId: rec.id, removedAt: null, entityType: t.entityType, ...linkData(t) } });
  if (existing) throw new ConflictError("This form is already linked to that person");
  const link = await tx.formRecordLink.create({ data: { organisationId: rec.organisationId, recordId: rec.id, entityType: t.entityType, createdById: ctx.userId, ...linkData(t) } });
  await tx.formRecordEvent.create({ data: { organisationId: rec.organisationId, recordId: rec.id, type: "LINKED", actorId: ctx.userId, data: { entityType: t.entityType } } });
  await audit({ organisationId: rec.organisationId, actorId: ctx.userId, action: "form.record.linked", entityType: "FormRecord", entityId: rec.id, data: { reference: rec.reference, entityType: t.entityType, entityId: t.entityId } }, tx);
  return link;
}

type LoadedRecord = Awaited<ReturnType<typeof loadRecord>>["r"];
function canChangeLinks(ctx: Ctx, r: LoadedRecord) {
  if (r.status === "VOIDED") return false;
  const mine = r.createdById === ctx.userId;
  return (mine && (r.status === "DRAFT" || r.status === "RETURNED")) || canReview(ctx, r.definition);
}


export async function linkRecord(ctx: Ctx, recordId: string, target: unknown) {
  const t = LinkTarget.safeParse(target);
  if (!t.success) throw new ValidationError("Choose who this form is about");
  const { r } = await loadRecord(ctx, recordId);
  if (!canChangeLinks(ctx, r)) throw new ForbiddenError(r.status === "VOIDED" ? "A voided form cannot be linked" : "Only the form's reviewers can change links once it is submitted");
  if (!r.definition.linkTypes.includes(t.data.entityType)) throw new ValidationError("This form cannot be linked to that kind of record");
  await visibleTarget(ctx, t.data);
  return db.$transaction((tx) => createLinkInTx(tx, ctx, r, t.data));
}

const Reason = z.string().trim().min(5, "Give a reason of at least a few words").max(500);

export async function unlinkRecord(ctx: Ctx, recordId: string, linkId: string, reason: string) {
  const why = Reason.safeParse(reason);
  if (!why.success) throw new ValidationError(why.error.issues[0]?.message ?? "Give a reason");
  const { r } = await loadRecord(ctx, recordId);
  if (!canChangeLinks(ctx, r)) throw new ForbiddenError("You cannot change this form's links");
  const id = Id.safeParse(linkId);
  const link = id.success ? await db.formRecordLink.findFirst({ where: { id: id.data, recordId: r.id, removedAt: null } }) : null;
  if (!link) throw new NotFoundError("Link");
  return db.$transaction(async (tx) => {
    const u = await tx.formRecordLink.updateMany({ where: { id: link.id, removedAt: null }, data: { removedAt: new Date(), removedById: ctx.userId, removeReason: why.data } });
    if (!u.count) throw new ConflictError("This link was already removed. Reload the form.");
    await tx.formRecordEvent.create({ data: { organisationId: r.organisationId, recordId: r.id, type: "UNLINKED", actorId: ctx.userId, note: why.data, data: { entityType: link.entityType } } });
    await audit({ organisationId: r.organisationId, actorId: ctx.userId, action: "form.record.unlinked", entityType: "FormRecord", entityId: r.id, data: { reference: r.reference, entityType: link.entityType, entityId: link.serviceUserId ?? link.staffMemberId } }, tx);
    return r.id;
  });
}

/** Names of linked people the caller may see; anyone else is shown without a name. */
async function namesFor(ctx: Ctx, suIds: string[], staffIds: string[]) {
  const [sus, staff] = await Promise.all([
    suIds.length && canSeeServiceUsers(ctx)
      ? rotaScope(ctx, "serviceUser.view").then((scope) => db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), id: { in: suIds } }, select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true } }))
      : Promise.resolve([]),
    staffIds.length && canSeeStaff(ctx)
      ? rotaScope(ctx, "staff.directory").then((scope) => db.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: { in: staffIds } }, select: { id: true, displayName: true, staffNumber: true } }))
      : Promise.resolve([]),
  ]);
  return {
    su: new Map(sus.map((s) => [s.id, { name: suName(s), detail: s.reference }])),
    staff: new Map(staff.map((s) => [s.id, { name: s.displayName, detail: `staff number ${s.staffNumber}` }])),
  };
}

/** A record's links, people it may be linked to, and whether the caller may change them. */
export async function recordLinks(ctx: Ctx, recordId: string) {
  const { r } = await loadRecord(ctx, recordId);
  const types = r.definition.linkTypes.filter((t): t is LinkType => (LINK_TYPES as readonly string[]).includes(t));
  if (!types.length) return null;
  const links = await db.formRecordLink.findMany({ where: { recordId: r.id, removedAt: null }, orderBy: { createdAt: "asc" } });
  const names = await namesFor(ctx, links.flatMap((l) => (l.serviceUserId ? [l.serviceUserId] : [])), links.flatMap((l) => (l.staffMemberId ? [l.staffMemberId] : [])));
  const canChange = canChangeLinks(ctx, r);
  const rows = links.map((l) => {
    const person = l.serviceUserId ? names.su.get(l.serviceUserId) : l.staffMemberId ? names.staff.get(l.staffMemberId) : undefined;
    const href = person ? (l.serviceUserId ? `/rota/service-users/${l.serviceUserId}?tab=documents&section=forms` : `/rota/staff/${l.staffMemberId}#forms`) : null;
    return { id: l.id, entityType: l.entityType as LinkType, name: person?.name ?? "A person outside your access", detail: person?.detail ?? null, href, createdAt: l.createdAt };
  });
  const options = canChange ? await linkOptions(ctx, types) : [];
  return { types, rows, canChange, options };
}

/** People the caller may link a form to, grouped by kind, within their scope. */
export async function linkOptions(ctx: Ctx, types: LinkType[]) {
  const groups: { type: LinkType; label: string; people: { value: string; label: string }[] }[] = [];
  if (types.includes("SERVICE_USER") && canSeeServiceUsers(ctx)) {
    const scope = await rotaScope(ctx, "serviceUser.view");
    const rows = await db.serviceUser.findMany({ where: serviceUserWhere(scope), select: { id: true, firstName: true, lastName: true, preferredName: true, reference: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 });
    groups.push({ type: "SERVICE_USER", label: "Service users", people: rows.map((s) => ({ value: `SERVICE_USER:${s.id}`, label: `${suName(s)} (${s.reference})` })) });
  }
  if (types.includes("STAFF_MEMBER") && canSeeStaff(ctx)) {
    const scope = await rotaScope(ctx, "staff.directory");
    const rows = await db.staffMember.findMany({ where: staffDirectoryWhere(scope, { status: "all" }), select: { id: true, displayName: true, staffNumber: true }, orderBy: { displayName: "asc" }, take: 500 });
    groups.push({ type: "STAFF_MEMBER", label: "Staff", people: rows.map((s) => ({ value: `STAFF_MEMBER:${s.id}`, label: `${s.displayName} (${s.staffNumber})` })) });
  }
  return groups;
}

const rowSelect = { id: true, reference: true, status: true, updatedAt: true, submittedAt: true, createdById: true, definitionId: true, definition: { select: { ref: true, title: true } }, version: { select: { versionNumber: true } } } as const;

/** Which form records the caller may open: their own, and every copy of a form they review. */
async function visibleRecordWhere(ctx: Ctx, orgId: string): Promise<Prisma.FormRecordWhereInput> {
  const defs = await db.formDefinition.findMany({ where: { OR: [{ organisationId: null }, { organisationId: orgId }] }, select: { id: true, reviewRoles: true } });
  const reviewable = defs.filter((d) => canReview(ctx, d)).map((d) => d.id);
  return { organisationId: orgId, OR: [{ createdById: ctx.userId }, ...(reviewable.length ? [{ definitionId: { in: reviewable } }] : [])] };
}

async function withAuthors<T extends { createdById: string; status: string }>(rows: T[]) {
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const names = new Map(people.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, author: names.get(r.createdById) ?? "Unknown", statusLabel: STATUS_LABELS[r.status as RecordStatus] ?? r.status }));
}

/** On-screen forms the caller can start already linked to a person of this kind. */
async function startableFor(ctx: Ctx, type: LinkType) {
  const forms = await digitalForms(ctx);
  const defs = await db.formDefinition.findMany({ where: { id: { in: forms.filter((f) => f.canStart).map((f) => f.id) } }, select: { id: true, ref: true, title: true, linkTypes: true, completeRoles: true } });
  return defs.filter((d) => d.linkTypes.includes(type) && canComplete(ctx, d)).map((d) => ({ id: d.id, ref: d.ref, title: d.title }));
}

/** Form records linked to a service user that the caller may open, for the person's Documents tab. */
export async function formsForServiceUser(ctx: Ctx, serviceUserId: string) {
  const t = await visibleTarget(ctx, { entityType: "SERVICE_USER", entityId: serviceUserId });
  const orgId = ctx.organisationId!;
  const rows = await db.formRecord.findMany({
    where: { AND: [await visibleRecordWhere(ctx, orgId), { links: { some: { serviceUserId: t.entityId, removedAt: null } } }] },
    orderBy: { updatedAt: "desc" }, take: 100, select: rowSelect,
  });
  return { rows: await withAuthors(rows), startable: await startableFor(ctx, "SERVICE_USER") };
}

/**
 * Form records about a staff member that the caller may open: forms linked to them, and their own declarations
 * (forms about the person filling them in, when their sign-in is linked to this staff record).
 */
export async function formsForStaffMember(ctx: Ctx, staffMemberId: string) {
  if (!ctx.organisationId || !canSeeStaff(ctx)) return null;
  const scope = await rotaScope(ctx, "staff.directory");
  const s = await db.staffMember.findFirst({ where: { ...staffDirectoryWhere(scope, { status: "all" }), id: staffMemberId }, select: { id: true, userId: true } });
  if (!s) throw new NotFoundError("Staff member");
  const about: Prisma.FormRecordWhereInput[] = [{ links: { some: { staffMemberId: s.id, removedAt: null } } }];
  if (s.userId) about.push({ subjectType: "USER", subjectId: s.userId });
  const rows = await db.formRecord.findMany({ where: { AND: [await visibleRecordWhere(ctx, scope.organisationId), { OR: about }] }, orderBy: { updatedAt: "desc" }, take: 100, select: rowSelect });
  return { rows: await withAuthors(rows), startable: await startableFor(ctx, "STAFF_MEMBER") };
}

/** Starts a form already linked to the person it is about (from their service user or staff record). */
export async function startFormAbout(ctx: Ctx, definitionId: string, target: unknown) {
  const t = LinkTarget.safeParse(target);
  if (!t.success) throw new ValidationError("Choose who this form is about");
  await visibleTarget(ctx, t.data);
  return startForm(ctx, definitionId, async (tx, record, def) => {
    if (!def.linkTypes.includes(t.data.entityType)) throw new ValidationError("This form cannot be linked to that kind of record");
    await createLinkInTx(tx, ctx, record, t.data);
  });
}

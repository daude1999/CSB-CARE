import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, requireOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere, type Scope } from "@/server/rota/scope";

/**
 * Archive, Restore and Delete for service users (owner's request, 8 Nov 2026).
 *
 * Archive is the everyday option. It hides the person from the active lists and makes the record read-only, and every
 * record about them is kept (care records must be retained after care ends). It is reversible with Restore. Only a
 * person whose care has ended or never started (enquiry, assessment) can be archived, never an active or paused person
 * and never while visits or repeating visits are still booked, so archiving never changes the rota.
 *
 * Delete removes the person permanently. It is for records added by mistake (a duplicate, a test, an enquiry entered
 * twice): organisation admins only, the person must be archived first, the admin types the person's CSB reference to
 * confirm, and it is refused while ANY care record exists (visits, incidents, medicines, notes, documents, approved
 * plans and the rest listed in DELETE_BLOCKERS). Those people stay archived. The audit entry keeps only the reference
 * numbers and the reason, never the person's name or details.
 */

type Tx = Prisma.TransactionClient;

const reasonSchema = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500, "Keep the reason under 500 characters");

/** Statuses a person may be archived from: care has ended, or it never started (enquiry or assessment). */
const ARCHIVABLE = new Set(["ENDED", "ENQUIRY", "ASSESSMENT"]);

async function loadPerson(tx: Tx | typeof db, scope: Scope, id: string) {
  const su = await tx.serviceUser.findFirst({
    where: { ...serviceUserWhere(scope), id },
    select: { id: true, organisationId: true, status: true, reference: true, csbReference: true, archivedAt: true, archivedById: true, archiveReason: true, version: true },
  });
  if (!su) throw new NotFoundError("Service user");
  return su;
}

/** What still stops this person being archived, in plain words. Empty means they can be archived. */
async function archiveBlockers(tx: Tx | typeof db, su: { id: string; organisationId: string; status: string }) {
  const [futureVisits, templates] = await Promise.all([
    tx.visit.count({ where: { organisationId: su.organisationId, serviceUserId: su.id, status: "SCHEDULED", scheduledEnd: { gt: new Date() } } }),
    tx.visitTemplate.count({ where: { organisationId: su.organisationId, serviceUserId: su.id, enabled: true } }),
  ]);
  const out: string[] = [];
  if (!ARCHIVABLE.has(su.status)) out.push(`Their care is ${su.status.toLowerCase()}. End their care first (change the status to Ended), then archive them.`);
  if (futureVisits) out.push(`${futureVisits} future ${futureVisits === 1 ? "visit is" : "visits are"} still booked. Cancel ${futureVisits === 1 ? "it" : "them"} or end their care first.`);
  if (templates) out.push(`${templates} repeating ${templates === 1 ? "visit is" : "visits are"} still switched on. Switch ${templates === 1 ? "it" : "them"} off or end their care first.`);
  return out;
}

/**
 * Care records that must be kept, so a person who has any of them can only be archived, never deleted. Each entry
 * counts rows for this person; the labels are what the admin sees.
 */
const DELETE_BLOCKERS: { label: string; count: (tx: Tx | typeof db, id: string) => Promise<number> }[] = [
  { label: "visits (booked or delivered)", count: (tx, id) => tx.visit.count({ where: { serviceUserId: id } }) },
  { label: "incidents", count: (tx, id) => tx.incident.count({ where: { serviceUserId: id } }) },
  { label: "medicines", count: (tx, id) => tx.medication.count({ where: { serviceUserId: id } }) },
  { label: "medicine application sites", count: (tx, id) => tx.medicationApplicationSite.count({ where: { serviceUserId: id } }) },
  { label: "body map records", count: (tx, id) => tx.bodyMapObservation.count({ where: { serviceUserId: id } }) },
  { label: "body map tasks", count: (tx, id) => tx.bodyMapTask.count({ where: { serviceUserId: id } }) },
  { label: "call notes", count: (tx, id) => tx.callNote.count({ where: { serviceUserId: id } }) },
  { label: "call note tasks", count: (tx, id) => tx.callNoteTask.count({ where: { serviceUserId: id } }) },
  { label: "completed forms", count: (tx, id) => tx.formRecordLink.count({ where: { serviceUserId: id } }) },
  { label: "documents", count: (tx, id) => tx.serviceUserDocument.count({ where: { serviceUserId: id } }) },
  { label: "care plans past draft", count: (tx, id) => tx.carePlan.count({ where: { serviceUserId: id, status: { not: "DRAFT" } } }) },
  { label: "approved risk assessments", count: (tx, id) => tx.riskAssessment.count({ where: { serviceUserId: id, OR: [{ status: { not: "DRAFT" } }, { versions: { some: {} } }] } }) },
  { label: "safeguarding decisions", count: (tx, id) => tx.safeguardingAuthorityDecision.count({ where: { serviceUserId: id } }) },
  { label: "discharge reviews", count: (tx, id) => tx.dischargeReview.count({ where: { serviceUserId: id } }) },
  { label: "carer instructions", count: (tx, id) => tx.careInstructionVersion.count({ where: { serviceUserId: id } }) },
  { label: "missed call cases", count: (tx, id) => tx.missedCallCase.count({ where: { serviceUserId: id } }) },
  { label: "root cause investigations", count: (tx, id) => tx.rcaInvestigation.count({ where: { serviceUserId: id } }) },
  { label: "invoice lines", count: (tx, id) => tx.invoiceLine.count({ where: { serviceUserId: id } }) },
  { label: "carer restrictions", count: (tx, id) => tx.staffRestriction.count({ where: { serviceUserId: id } }) },
  { label: "readiness rules", count: (tx, id) => tx.readinessScope.count({ where: { serviceUserId: id } }) },
];

async function deleteBlockers(tx: Tx | typeof db, id: string) {
  const counts = await Promise.all(DELETE_BLOCKERS.map((b) => b.count(tx, id)));
  return DELETE_BLOCKERS.map((b, i) => ({ label: b.label, count: counts[i]! })).filter((b) => b.count > 0);
}

const referenceOf = (su: { csbReference: string | null; reference: string }) => su.csbReference ?? su.reference;

/**
 * What the Archive / Delete page shows: whether the member may archive or delete, and what stops them. Read-only.
 * Delete details are worked out only for members who may delete.
 */
export async function serviceUserArchiveStatus(ctx: Ctx, id: string) {
  const scope = await rotaScope(ctx, "serviceUser.view");
  const su = await loadPerson(db, scope, id);
  const mayArchive = hasOrgPermission(ctx, "serviceUser.archive");
  const mayDelete = hasOrgPermission(ctx, "serviceUser.delete");
  const [archive, del, archivedBy] = await Promise.all([
    su.archivedAt ? Promise.resolve([]) : archiveBlockers(db, su),
    mayDelete ? deleteBlockers(db, su.id) : Promise.resolve([]),
    su.archivedById ? db.user.findUnique({ where: { id: su.archivedById }, select: { name: true, email: true } }) : Promise.resolve(null),
  ]);
  return {
    archived: su.archivedAt ? { at: su.archivedAt, by: archivedBy?.name ?? archivedBy?.email ?? "Unknown", reason: su.archiveReason } : null,
    reference: referenceOf(su),
    version: su.version,
    mayArchive,
    mayDelete,
    archiveBlockers: archive,
    deleteBlockers: del,
  };
}

/** Archives the person: hidden from the active lists, read-only, every record kept. */
export async function archiveServiceUser(ctx: Ctx, id: string, reasonRaw: string) {
  requireOrgPermission(ctx, "serviceUser.archive");
  const reason = reasonSchema.safeParse(reasonRaw);
  if (!reason.success) throw new ValidationError(reason.error.issues[0]!.message);
  const scope = await rotaScope(ctx, "serviceUser.view");
  return db.$transaction(async (tx) => {
    const su = await loadPerson(tx, scope, id);
    if (su.archivedAt) throw new ConflictError("This person is already archived");
    const blockers = await archiveBlockers(tx, su);
    if (blockers.length) throw new ValidationError(blockers[0]!);
    // The version check makes a second, simultaneous archive or edit fail instead of silently overwriting.
    const r = await tx.serviceUser.updateMany({ where: { id, organisationId: scope.organisationId, version: su.version, archivedAt: null }, data: { archivedAt: new Date(), archivedById: ctx.userId, archiveReason: reason.data, version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("This record was changed by someone else just now. Reload the page and try again.");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.archived", entityType: "ServiceUser", entityId: id, data: { reason: reason.data, status: su.status } }, tx);
  });
}

/** Restores an archived person to the active lists, with the status they had when archived. */
export async function restoreServiceUser(ctx: Ctx, id: string, reasonRaw: string) {
  requireOrgPermission(ctx, "serviceUser.archive");
  const reason = reasonSchema.safeParse(reasonRaw);
  if (!reason.success) throw new ValidationError(reason.error.issues[0]!.message);
  const scope = await rotaScope(ctx, "serviceUser.view");
  return db.$transaction(async (tx) => {
    const su = await loadPerson(tx, scope, id);
    if (!su.archivedAt) throw new ConflictError("This person is not archived");
    const r = await tx.serviceUser.updateMany({ where: { id, organisationId: scope.organisationId, version: su.version }, data: { archivedAt: null, archivedById: null, archiveReason: null, version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictError("This record was changed by someone else just now. Reload the page and try again.");
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.restored", entityType: "ServiceUser", entityId: id, data: { reason: reason.data, archivedAt: su.archivedAt.toISOString() } }, tx);
  });
}

/**
 * Permanently deletes a person added by mistake. Admins only; the person must be archived first, the admin types the
 * CSB reference to confirm, and any care record refuses it (see DELETE_BLOCKERS).
 */
export async function deleteServiceUser(ctx: Ctx, id: string, input: { confirm: string; reason: string }) {
  requireOrgPermission(ctx, "serviceUser.delete");
  const reason = reasonSchema.safeParse(input.reason);
  if (!reason.success) throw new ValidationError(reason.error.issues[0]!.message);
  const scope = await rotaScope(ctx, "serviceUser.view");
  try {
    return await db.$transaction(async (tx) => {
      const su = await loadPerson(tx, scope, id);
      const reference = referenceOf(su);
      if (!su.archivedAt) throw new ValidationError("Archive this person first. Only an archived record can be deleted.");
      if (input.confirm.trim().toUpperCase() !== reference.toUpperCase()) throw new ValidationError(`To confirm, type the CSB reference exactly: ${reference}`);
      const blockers = await deleteBlockers(tx, id);
      if (blockers.length) throw new ValidationError(`This person has care records that must be kept (${blockers.map((b) => `${b.count} ${b.label}`).join(", ")}), so they can't be deleted. Keep them archived.`);
      // Keep the documents a Care Coordinator intake was built from: the intake stays, without the link to the person.
      const intakes = await tx.careIntake.updateMany({ where: { organisationId: scope.organisationId, serviceUserId: id }, data: { serviceUserId: null } });
      await tx.rotaBuild.updateMany({ where: { organisationId: scope.organisationId, serviceUserId: id }, data: { serviceUserId: null } });
      await tx.careSummary.deleteMany({ where: { organisationId: scope.organisationId, serviceUserId: id } });
      // Contacts, absences, packages, carer preferences, draft plans and risks, switched-off templates, reference
      // numbers and intake review items go with the person (cascading keys).
      await tx.serviceUser.delete({ where: { id } });
      await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "serviceUser.deleted", entityType: "ServiceUser", entityId: id, data: { reference, legacyReference: su.reference, reason: reason.data, intakesUnlinked: intakes.count } }, tx);
      return { reference };
    });
  } catch (e) {
    // A database rule protecting a care record (for example a frozen record) refused the delete: nothing was changed.
    if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
      throw new ConflictError("This person has care records that must be kept, so they can't be deleted. Nothing was changed. Keep them archived.");
    }
    throw e;
  }
}

/** Refuses a change to an archived person's record: Restore them first. */
export function assertNotArchived(su: { archivedAt: Date | null }) {
  if (su.archivedAt) throw new ConflictError("This person is archived. Restore them before making changes.");
}

import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { archiveServiceUser, deleteServiceUser, restoreServiceUser, serviceUserArchiveStatus } from "@/server/care/service-user-archive";
import { addContact, createServiceUser, findServiceUsersToUpdate, serviceUserDirectory, setServiceUserStatus, updateServiceUser } from "@/server/care/service-users";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Archive, Restore and Delete for service users, against the real schema. Archive hides a person from the active
 * lists and keeps every record; Delete is admin-only, needs an archived person with no care records and the typed
 * CSB reference. Nothing crosses to another organisation. All data is synthetic.
 */
const admin = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const careManager = () => ctxFor("care.manager@archive.test", BROOKFIELD);
const oakridge = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
let orgId = "";
let activeId = "";

async function newEnquiry(lastName: string) {
  return createServiceUser(await admin(), { firstName: "Testa", lastName, carerGenderPreference: "ANY", postcode: "ZZ1 1ZZ" });
}
const refOf = async (id: string) => {
  const su = await db.serviceUser.findUniqueOrThrow({ where: { id } });
  return su.csbReference ?? su.reference;
};

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  // A care manager who is not an organisation admin: may archive, may not delete.
  const u = await db.user.create({ data: { email: "care.manager@archive.test", name: "Cam Manager", passwordHash: "x" } });
  await db.membership.create({ data: { userId: u.id, organisationId: orgId, roles: ["CARE_MANAGER"] } });
  activeId = (await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", visits: { some: { status: "SCHEDULED", scheduledEnd: { gt: new Date() } } } } })).id;
}, 240_000);

describe("archive", () => {
  it("refuses a person whose care is still active, and says what to do", async () => {
    const st = await serviceUserArchiveStatus(await admin(), activeId);
    expect(st.archiveBlockers.join(" ")).toMatch(/End their care first/);
    expect(st.archiveBlockers.join(" ")).toMatch(/future visits? (is|are) still booked/);
    await expect(archiveServiceUser(await admin(), activeId, "Moved away")).rejects.toBeInstanceOf(ValidationError);
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: activeId } })).archivedAt).toBeNull();
  });

  it("is for care managers and admins only, and needs a reason", async () => {
    const su = await newEnquiry("Permission");
    await expect(archiveServiceUser(await coordinator(), su.id, "Never started")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveServiceUser(await careManager(), su.id, "  ")).rejects.toThrow(/Give a reason/);
    await archiveServiceUser(await careManager(), su.id, "Enquiry did not go ahead");
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).archiveReason).toBe("Enquiry did not go ahead");
  });

  it("hides the person from active lists, keeps the record read-only, and Restore brings them back", async () => {
    const ctx = await admin();
    const su = await newEnquiry("Archivable");
    await addContact(ctx, su.id, { kind: "FAMILY", name: "Sam Archivable", phone: "07000 000000", isEmergency: false, canReceiveUpdates: false });
    await archiveServiceUser(ctx, su.id, "Enquiry did not go ahead");
    // A second archive is refused rather than repeated.
    await expect(archiveServiceUser(ctx, su.id, "Again")).rejects.toBeInstanceOf(ConflictError);

    const current = await serviceUserDirectory(ctx, { q: "Archivable", page: 1 });
    const all = await serviceUserDirectory(ctx, { q: "Archivable", status: "ALL", page: 1 });
    const archived = await serviceUserDirectory(ctx, { q: "Archivable", status: "ARCHIVED", page: 1 });
    expect(current.rows.map((r) => r.id)).not.toContain(su.id);
    expect(all.rows.map((r) => r.id)).not.toContain(su.id);
    expect(all.archivedMatches).toBe(1);
    expect(archived.rows.map((r) => r.id)).toEqual([su.id]);
    expect(archived.rows[0]!.archivedAt).not.toBeNull();
    // The Update Existing picker still finds them, marked as archived.
    expect((await findServiceUsersToUpdate(ctx, "Archivable")).people.find((p) => p.id === su.id)?.archived).toBe(true);

    // Read-only while archived; every record is kept.
    const row = await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } });
    await expect(updateServiceUser(ctx, su.id, row.version, { firstName: "Changed", lastName: "Archivable", carerGenderPreference: "ANY" })).rejects.toThrow(/archived/);
    await expect(setServiceUserStatus(ctx, su.id, "ENDED", "Ending")).rejects.toThrow(/archived/);
    expect(await db.serviceUserContact.count({ where: { serviceUserId: su.id } })).toBe(1);

    await restoreServiceUser(ctx, su.id, "Care is starting after all");
    const back = await serviceUserDirectory(ctx, { q: "Archivable", page: 1 });
    expect(back.rows.map((r) => r.id)).toContain(su.id);
    await setServiceUserStatus(ctx, su.id, "ACTIVE", "Care starting");

    const log = await db.auditLog.findMany({ where: { entityType: "ServiceUser", entityId: su.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["serviceUser.archived", "serviceUser.restored"]));
  });

  it("archives a person once their care has ended, keeping their visits", async () => {
    const ctx = await admin();
    const visitsBefore = await db.visit.count({ where: { serviceUserId: activeId } });
    // Ending care cancels visits that have not reached their start time; a visit whose time has come is left for the
    // office to deal with and still blocks the archive. Whether the seed has such a visit depends on the time of day
    // the suite runs, so any visit of this person that is due right now is put an hour ahead first.
    const soon = new Date(Date.now() + 60 * 60_000);
    for (const v of await db.visit.findMany({ where: { serviceUserId: activeId, status: "SCHEDULED", scheduledStart: { lte: new Date(Date.now() + 60_000) }, scheduledEnd: { gt: new Date() } } })) {
      await db.visit.update({ where: { id: v.id }, data: { scheduledStart: soon, scheduledEnd: new Date(soon.getTime() + (v.scheduledEnd.getTime() - v.scheduledStart.getTime())) } });
    }
    // Care ended yesterday, so no visit is still booked (ending today keeps today's remaining visits).
    await setServiceUserStatus(ctx, activeId, "ENDED", "Moved to a care home", addDays(londonDate(), -1));
    expect((await serviceUserArchiveStatus(ctx, activeId)).archiveBlockers).toEqual([]);
    await archiveServiceUser(ctx, activeId, "Moved to a care home");
    expect(await db.visit.count({ where: { serviceUserId: activeId } })).toBe(visitsBefore);
  });

  it("never reaches another organisation's people", async () => {
    const su = await newEnquiry("OtherOrg");
    await expect(archiveServiceUser(await oakridge(), su.id, "Not ours")).rejects.toThrow();
    await expect(serviceUserArchiveStatus(await oakridge(), su.id)).rejects.toThrow();
    expect((await db.serviceUser.findUniqueOrThrow({ where: { id: su.id } })).archivedAt).toBeNull();
  });
});

describe("delete", () => {
  it("is for organisation admins only", async () => {
    const su = await newEnquiry("AdminOnly");
    await archiveServiceUser(await admin(), su.id, "Duplicate record");
    const ref = await refOf(su.id);
    await expect(deleteServiceUser(await careManager(), su.id, { confirm: ref, reason: "Duplicate" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteServiceUser(await coordinator(), su.id, { confirm: ref, reason: "Duplicate" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await serviceUserArchiveStatus(await careManager(), su.id)).mayDelete).toBe(false);
  });

  it("needs the person archived first and the CSB reference typed exactly", async () => {
    const ctx = await admin();
    const su = await newEnquiry("Confirming");
    const ref = await refOf(su.id);
    await expect(deleteServiceUser(ctx, su.id, { confirm: ref, reason: "Duplicate" })).rejects.toThrow(/Archive this person first/);
    await archiveServiceUser(ctx, su.id, "Duplicate record");
    await expect(deleteServiceUser(ctx, su.id, { confirm: "CSB-WRONG", reason: "Duplicate" })).rejects.toThrow(/type the CSB reference/);
    expect(await db.serviceUser.count({ where: { id: su.id } })).toBe(1);
  });

  it("removes a record added by mistake, and the audit entry keeps no personal details", async () => {
    const ctx = await admin();
    const su = await newEnquiry("Mistaken");
    await addContact(ctx, su.id, { kind: "FAMILY", name: "Sam Mistaken", phone: "07000 000001", isEmergency: false, canReceiveUpdates: false });
    await archiveServiceUser(ctx, su.id, "Duplicate record");
    const ref = await refOf(su.id);
    const r = await deleteServiceUser(ctx, su.id, { confirm: ref.toLowerCase(), reason: "Duplicate of another record" });
    expect(r.reference).toBe(ref);
    expect(await db.serviceUser.count({ where: { id: su.id } })).toBe(0);
    expect(await db.serviceUserContact.count({ where: { serviceUserId: su.id } })).toBe(0);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "serviceUser.deleted", entityId: su.id } });
    expect(entry.organisationId).toBe(orgId);
    expect(JSON.stringify(entry.data)).not.toMatch(/Mistaken|Testa|ZZ1/);
    expect(JSON.stringify(entry.data)).toContain(ref);
  });

  it("is refused for a person with care records, who stays archived", async () => {
    const ctx = await admin();
    const st = await serviceUserArchiveStatus(ctx, activeId);
    expect(st.archived).not.toBeNull();
    expect(st.deleteBlockers.map((b) => b.label)).toContain("visits (booked or delivered)");
    await expect(deleteServiceUser(ctx, activeId, { confirm: st.reference, reason: "Tidy up" })).rejects.toThrow(/care records that must be kept/);
    expect(await db.serviceUser.count({ where: { id: activeId } })).toBe(1);
  });

  it("never deletes another organisation's person", async () => {
    const su = await newEnquiry("Protected");
    await archiveServiceUser(await admin(), su.id, "Duplicate record");
    const ref = await refOf(su.id);
    // Oakridge's manager has no admin role here and no access to the record either way.
    await expect(deleteServiceUser(await oakridge(), su.id, { confirm: ref, reason: "Not ours" })).rejects.toSatisfy((e) => e instanceof ForbiddenError || e instanceof NotFoundError);
    expect(await db.serviceUser.count({ where: { id: su.id } })).toBe(1);
  });
});

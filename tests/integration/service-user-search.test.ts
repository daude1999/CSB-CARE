import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ownerDb } from "../support/owner-db";
import { logger } from "@/lib/logger";
import { addExternalReference } from "@/server/care/external-references";
import { REFERENCE_KEY_MISSING, REFERENCE_REGISTER_FAILED } from "@/server/care/service-user-search";
import { DIRECTORY_PAGE_SIZE, findServiceUsersToUpdate, listServiceUsers, serviceUserActionPerms, serviceUserDirectory } from "@/server/care/service-users";
import { rotaSearch } from "@/server/rota/search";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The two service-user search boxes (top bar on rostering pages, and Rota → Service Users) against a real database:
 * names, postcodes, CSB/SU numbers, encrypted external references, filters, permissions, and what happens when the
 * reference register cannot be used. Every person and number here is fictional.
 */
const coordinator = () => ctxFor("coordinator@care-solution.demo", BROOKFIELD);
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const otherOrg = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
const TH = "Tower Hamlets Council";

let fa = { id: "", csb: "", legacy: "", areaId: "" as string | null, branchId: "" as string | null };
let ended = { id: "" };

const header = async (q: string, ctx?: Awaited<ReturnType<typeof coordinator>>) => (await rotaSearch(ctx ?? (await coordinator()), q)).serviceUsers.map((s) => s.id);
const directory = async (q: string, ctx?: Awaited<ReturnType<typeof coordinator>>) => (await listServiceUsers(ctx ?? (await coordinator()), { q })).map((s) => s.id);
/** Both boxes must agree. */
async function both(q: string, ctx?: Awaited<ReturnType<typeof coordinator>>) {
  const [h, d] = [await header(q, ctx), await directory(q, ctx)];
  return { h, d };
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  const people = await listServiceUsers(await coordinator(), {});
  const [x, y] = people;
  const su = await db.serviceUser.update({ where: { id: x!.id }, data: { firstName: "Fatuma", lastName: "Alibhai", preferredName: "Tuma", postcode: "ZZ9 4QX" } });
  fa = { id: su.id, csb: su.csbReference!, legacy: su.reference, areaId: su.areaId, branchId: su.branchId };
  ended = { id: (await db.serviceUser.update({ where: { id: y!.id }, data: { lastName: "Quillfeather", status: "ENDED" } })).id };
  const m = await manager();
  await addExternalReference(m, fa.id, { type: "COUNCIL_CLIENT", issuer: TH, systemLabel: "Frameworki", value: "1088676" });
  await addExternalReference(m, fa.id, { type: "COUNCIL_PACKAGE", issuer: TH, value: "PKG-77120" });
  await addExternalReference(m, fa.id, { type: "NHS", issuer: "NHS England", value: "999 000 0035" });
}, 180_000);

const afterEachRestore: (() => void)[] = [];
afterEach(() => {
  while (afterEachRestore.length) afterEachRestore.pop()!();
  vi.unstubAllEnvs();
});

describe("names and postcodes", () => {
  it.each([
    ["first name", "Fatuma"],
    ["surname", "Alibhai"],
    ["full name", "Fatuma Alibhai"],
    ["full name, any case and spacing", "  fatuma   ALIBHAI "],
    ["surname first", "Alibhai Fatuma"],
    ["preferred name", "Tuma"],
    ["partial names", "Fat Alib"],
    ["postcode", "ZZ9 4QX"],
    ["postcode without the space", "zz94qx"],
  ])("finds the person by %s in both boxes", async (_label, q) => {
    const { h, d } = await both(q);
    expect(h).toContain(fa.id);
    expect(d).toContain(fa.id);
  });

  it("a full name with a wrong word does not match", async () => {
    const { h, d } = await both("Fatuma Quillfeather");
    expect(h).not.toContain(fa.id);
    expect(d).not.toContain(fa.id);
  });
});

describe("CSB, SU and external references", () => {
  it("finds the permanent CSB number and legacy SU number, including short spellings", async () => {
    const digits = String(Number(fa.csb.slice(4)));
    for (const q of [fa.csb, `csb ${digits}`, `CSB${digits}`, fa.legacy, fa.legacy.replace("-", " ").toLowerCase()]) {
      const { h, d } = await both(q);
      expect(h, q).toContain(fa.id);
      expect(d, q).toContain(fa.id);
    }
  });

  it.each(["1088676", "Frameworki 1088676", "LBTH Frameworki: 1088676", "PKG-77120"])("finds %s and says which reference matched", async (q) => {
    const { h, d } = await both(q);
    expect(h).toEqual([fa.id]);
    expect(d).toEqual([fa.id]);
    const row = (await serviceUserDirectory(await coordinator(), { q })).rows[0]!;
    expect(row.matchedReference).toMatch(/Frameworki|package/i);
  });

  it("does not guess from part of an external number, and says the number must be exact", async () => {
    expect((await both("108867")).h).toEqual([]);
    expect((await both("NOPE-0000001")).d).toEqual([]);
    const r = await rotaSearch(await coordinator(), "0000001");
    expect(r.serviceUsers).toEqual([]);
    expect(r.referenceProblem).toBeNull();
  });

  it("NHS numbers only find the person for restricted access", async () => {
    expect(await header("999 000 0035", await manager())).toEqual([fa.id]);
    expect(await directory("9990000035", await manager())).toEqual([fa.id]);
    expect(await header("999 000 0035")).toEqual([]);
    expect(await directory("9990000035")).toEqual([]);
  });

  it("a person with no reference data is still found by name", async () => {
    const other = (await listServiceUsers(await coordinator(), {})).find((s) => s.id !== fa.id && !s.matchedReference)!;
    expect(await db.serviceUserExternalReference.count({ where: { serviceUserId: other.id } })).toBe(0);
    expect(await header(other.lastName)).toContain(other.id);
  });
});

describe("filters", () => {
  it("ended people are found when asked for, and the directory says when a filter hides a match", async () => {
    expect(await header("Quillfeather")).toContain(ended.id);
    const def = await serviceUserDirectory(await coordinator(), { q: "Quillfeather" });
    expect(def.rows).toEqual([]);
    expect(def.hiddenByFilters).toBe(1);
    const all = await serviceUserDirectory(await coordinator(), { q: "Quillfeather", status: "ALL" });
    expect(all.rows.map((r) => r.id)).toEqual([ended.id]);
    expect(all.hiddenByFilters).toBe(0);
    expect((await serviceUserDirectory(await coordinator(), { q: "Quillfeather", status: "ENDED" })).rows.map((r) => r.id)).toEqual([ended.id]);
  });

  it("an area filter still applies to a name search and the hidden match is counted", async () => {
    const otherArea = await db.area.findFirstOrThrow({ where: { organisation: { slug: BROOKFIELD }, id: { not: fa.areaId ?? "" } } });
    const r = await serviceUserDirectory(await coordinator(), { q: "Fatuma Alibhai", areaId: otherArea.id });
    expect(r.rows).toEqual([]);
    expect(r.hiddenByFilters).toBe(1);
    if (fa.areaId) expect((await serviceUserDirectory(await coordinator(), { q: "Fatuma Alibhai", areaId: fa.areaId })).rows.map((x) => x.id)).toEqual([fa.id]);
  });
});

describe("when the reference register cannot be used", () => {
  it("a missing CSB_REFERENCE_SECRET no longer breaks name, postcode or CSB search, and the problem is shown and logged", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CSB_REFERENCE_SECRET", "");
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    afterEachRestore.push(() => log.mockRestore());
    // A name search never touches the register.
    const byName = await rotaSearch(await coordinator(), "Fatuma Alibhai");
    expect(byName.serviceUsers.map((s) => s.id)).toContain(fa.id);
    expect(byName.referenceProblem).toBeNull();
    // Anything with a digit tries the register; that part fails visibly while the rest still answers.
    const byCsb = await serviceUserDirectory(await coordinator(), { q: fa.csb });
    expect(byCsb.rows.map((r) => r.id)).toContain(fa.id);
    expect(byCsb.referenceProblem).toBe(REFERENCE_KEY_MISSING);
    const byFrameworki = await rotaSearch(await coordinator(), "Frameworki 1088676");
    expect(byFrameworki.serviceUsers).toEqual([]);
    expect(byFrameworki.referenceProblem).toBe(REFERENCE_KEY_MISSING);
    // Logged without the number that was searched.
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("1088676");
    expect(JSON.stringify(log.mock.calls)).toContain("CSB_REFERENCE_SECRET is not configured");
  });

  // Controlled schema mismatch on the local test database only: a column is renamed for the test and put back after.
  async function withRenamedColumn(table: string, column: string, run: () => Promise<void>) {
    await ownerDb.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "${column}_moved"`);
    try {
      await run();
    } finally {
      await ownerDb.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "${column}_moved" TO "${column}"`);
    }
  }

  it("an unreadable register (for example an unmigrated database) is reported, not turned into no results", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    afterEachRestore.push(() => log.mockRestore());
    await withRenamedColumn("ServiceUserExternalReference", "status", async () => {
      const r = await rotaSearch(await coordinator(), fa.legacy);
      expect(r.serviceUsers.map((s) => s.id)).toContain(fa.id);
      expect(r.referenceProblem).toBe(REFERENCE_REGISTER_FAILED);
      const d = await serviceUserDirectory(await coordinator(), { q: "1088676" });
      expect(d.rows).toEqual([]);
      expect(d.referenceProblem).toBe(REFERENCE_REGISTER_FAILED);
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("1088676");
  });

  it("a failure in the main service-user query is not hidden as an empty result", async () => {
    await withRenamedColumn("ServiceUser", "postcode", async () => {
      await expect(rotaSearch(await coordinator(), "Fatuma")).rejects.toThrow();
      await expect(serviceUserDirectory(await coordinator(), { q: "Fatuma" })).rejects.toThrow();
    });
  });
});

describe("permissions and isolation", () => {
  it("another organisation finds nothing by name or reference", async () => {
    const o = await otherOrg();
    for (const q of ["Fatuma Alibhai", "1088676", fa.csb]) {
      expect(await header(q, o)).not.toContain(fa.id);
      expect(await directory(q, o)).not.toContain(fa.id);
    }
  });

  it("a member limited to another branch cannot find the person by name or reference", async () => {
    const c = await coordinator();
    const other = await db.branch.findFirstOrThrow({ where: { organisation: { slug: BROOKFIELD }, id: { not: fa.branchId ?? "" } } });
    const m = await db.membership.findUniqueOrThrow({ where: { userId_organisationId: { userId: c.userId, organisationId: c.organisationId! } } });
    await db.membershipBranch.create({ data: { membershipId: m.id, branchId: other.id } });
    try {
      for (const q of ["Fatuma Alibhai", "Frameworki 1088676", fa.csb, "ZZ9 4QX"]) {
        expect(await header(q, c), q).not.toContain(fa.id);
        expect(await directory(q, c), q).not.toContain(fa.id);
      }
    } finally {
      await db.membershipBranch.deleteMany({ where: { membershipId: m.id } });
    }
  });

  it("searching never changes a service user or reference record", async () => {
    const snap = async () => JSON.stringify([
      await db.serviceUserExternalReference.findMany({ orderBy: { id: "asc" } }),
      await db.serviceUser.findMany({ where: { id: { in: [fa.id, ended.id] } }, orderBy: { id: "asc" } }),
    ]);
    const before = await snap();
    for (const q of ["Fatuma Alibhai", "1088676", "LBTH Frameworki: 1088676", fa.csb, "999 000 0035"]) {
      await both(q, await manager());
    }
    expect(await snap()).toBe(before);
  });
});

describe("All Service Users: count, pages and the Update Existing picker", () => {
  it("the count is every matching person the member may see, and pages never repeat or skip anyone", async () => {
    const ctx = await coordinator();
    const all = await listServiceUsers(ctx, {});
    const extra = Math.max(0, DIRECTORY_PAGE_SIZE + 3 - all.length);
    const tmpl = await db.serviceUser.findUniqueOrThrow({ where: { id: all[0]!.id } });
    for (let i = 0; i < extra; i++) {
      await db.serviceUser.create({ data: { organisationId: tmpl.organisationId, branchId: tmpl.branchId, areaId: tmpl.areaId, reference: `SU-PG${i}`, csbReference: `CSB-PG${String(i).padStart(4, "0")}`, firstName: `Pagetest${i}`, lastName: "Fictional", status: "ACTIVE" } });
    }
    const first = await serviceUserDirectory(ctx, { page: 1 });
    expect(first.total).toBe(all.length + extra);
    expect(first.rows).toHaveLength(DIRECTORY_PAGE_SIZE);
    expect(first.pages).toBe(Math.ceil(first.total / DIRECTORY_PAGE_SIZE));
    const seen = new Set<string>();
    for (let p = 1; p <= first.pages; p++) for (const r of (await serviceUserDirectory(ctx, { page: p })).rows) seen.add(r.id);
    expect(seen.size).toBe(first.total);
    // A page beyond the last shows the last page, not an empty list.
    expect((await serviceUserDirectory(ctx, { page: 999 })).page).toBe(first.pages);
    // The count follows the search and filters.
    const one = await serviceUserDirectory(ctx, { q: "Fatuma Alibhai", page: 1 });
    expect(one.total).toBe(1);
    // Without a page every row is returned as before (other callers are unchanged).
    expect((await listServiceUsers(ctx, {})).length).toBe(first.total);
  });

  it("each row carries the person's own council number (never NHS or a shared framework ID), next visit and DOB only for restricted access", async () => {
    const page = async (ctx: Awaited<ReturnType<typeof coordinator>>) => (await serviceUserDirectory(ctx, { q: "Fatuma Alibhai", page: 1 })).rows[0]!;
    const row = await page(await coordinator());
    expect(row.councilReference?.value).toBe("1088676");
    expect(row.councilReference?.title).toMatch(/Frameworki/);
    expect(JSON.stringify(row)).not.toContain("9990000035");
    expect(row.dateOfBirth).toBeNull();
    const next = await db.visit.findFirst({ where: { serviceUserId: fa.id, status: "SCHEDULED", scheduledStart: { gte: new Date() } }, orderBy: { scheduledStart: "asc" }, select: { scheduledStart: true } });
    expect(row.nextVisit?.toISOString() ?? null).toBe(next?.scheduledStart.toISOString() ?? null);
    const asManager = await page(await manager());
    const su = await db.serviceUser.findUniqueOrThrow({ where: { id: fa.id }, select: { dateOfBirth: true } });
    expect(asManager.dateOfBirth?.toISOString() ?? null).toBe(su.dateOfBirth?.toISOString() ?? null);
  });

  it("the branch filter only narrows, and a branch outside the member's own scope finds nobody", async () => {
    const ctx = await coordinator();
    const inBranch = await serviceUserDirectory(ctx, { branchId: fa.branchId ?? undefined, page: 1, status: "ALL" });
    expect(inBranch.rows.every((r) => r.branchId === fa.branchId)).toBe(true);
    expect(inBranch.total).toBeGreaterThan(0);
    const other = await db.branch.findFirst({ where: { organisation: { slug: OAKRIDGE } }, select: { id: true } });
    expect((await serviceUserDirectory(ctx, { branchId: other!.id, page: 1, status: "ALL" })).total).toBe(0);
  });

  it("finds a person by name, CSB number, legacy SU number and exact Frameworki number, with every status", async () => {
    const ctx = await coordinator();
    for (const q of ["Fatuma", "Fatuma Alibhai", fa.csb, fa.legacy, "1088676"]) {
      const r = await findServiceUsersToUpdate(ctx, q);
      expect(r.people.map((p) => p.id), q).toContain(fa.id);
    }
    const hit = (await findServiceUsersToUpdate(ctx, "1088676")).people.find((p) => p.id === fa.id)!;
    expect(hit.matchedReference).toMatch(/Frameworki/);
    expect(hit.name).toBe("Tuma Alibhai");
    expect((await findServiceUsersToUpdate(ctx, "Quillfeather")).people.map((p) => p.id)).toEqual([ended.id]);
    expect((await findServiceUsersToUpdate(ctx, "a")).people).toEqual([]);
  });

  it("NHS numbers only find the person for restricted access", async () => {
    expect((await findServiceUsersToUpdate(await coordinator(), "9990000035")).people.map((p) => p.id)).not.toContain(fa.id);
    expect((await findServiceUsersToUpdate(await manager(), "9990000035")).people.map((p) => p.id)).toContain(fa.id);
  });

  it("is refused to members who may only view service users, and finds nothing in another organisation", async () => {
    const viewer = { ...(await manager()), orgRoles: ["COMPLIANCE_LEAD" as const] };
    await expect(findServiceUsersToUpdate(viewer, "Fatuma")).rejects.toThrow();
    expect(serviceUserActionPerms(viewer)).toEqual({ create: false, edit: false, upload: false, archive: false, delete: false });
    expect((await findServiceUsersToUpdate(await otherOrg(), "Fatuma")).people).toEqual([]);
    expect((await findServiceUsersToUpdate(await otherOrg(), "1088676")).people).toEqual([]);
  });

  it("coordinators and managers are offered every choice", async () => {
    expect(serviceUserActionPerms(await coordinator())).toEqual({ create: true, edit: true, upload: true, archive: false, delete: false });
    // The CEO login is an organisation admin, so may archive and delete.
    expect(serviceUserActionPerms(await manager())).toEqual({ create: true, edit: true, upload: true, archive: true, delete: true });
  });
});

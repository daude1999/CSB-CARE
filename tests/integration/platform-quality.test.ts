import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getServiceUser } from "@/server/care/service-users";
import { carePlanRegister, carePlansFor } from "@/server/care/care-plans";
import { getIncident, listIncidents, recentIncidentsFor } from "@/server/care/incidents";
import { getRisk, listRisks } from "@/server/care/risks";
import { listMedications } from "@/server/care/medication";
import { getVisit } from "@/server/rota/visits";
import { readEvidence, storeEvidenceFile } from "@/server/compliance/evidence";
import { readCaseEvidence } from "@/server/rota/missed-calls";
import { countRequest, overLimit } from "@/server/security/rate-limit";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Platform quality build (1 Nov 2026): cross-organisation isolation across the care records, the evidence
 * virus-check policy, the shared rate limiter and the read-only summaries added to the service user's record.
 */

const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const outsider = () => ctxFor("manager@oakridge.demo", OAKRIDGE);
let orgId = "";
let otherOrgId = "";

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  otherOrgId = (await db.organisation.findUniqueOrThrow({ where: { slug: OAKRIDGE } })).id;
}, 180_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const textFile = (body = "Supervision notes for the file.") => ({ name: "notes.txt", type: "text/plain", bytes: Buffer.from(body) });

describe("cross-organisation isolation", () => {
  it("another agency's manager cannot open this agency's service users, care plans, risks, incidents, medication or visits", async () => {
    const other = await outsider();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, carePlans: { some: { status: "ACTIVE" } } } });
    await expect(getServiceUser(other, su.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(carePlansFor(other, su.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listRisks(other, { serviceUserId: su.id })).toEqual([]);
    const risk = await db.riskAssessment.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(getRisk(other, risk.id)).rejects.toBeInstanceOf(NotFoundError);
    const incident = await db.incident.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(getIncident(other, incident.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listIncidents(other, { status: "all" })).some((i) => i.organisationId === orgId)).toBe(false);
    expect(await recentIncidentsFor(other, incident.serviceUserId!)).toEqual([]);
    await expect(listMedications(other, su.id)).rejects.toThrow();
    const visit = await db.visit.findFirstOrThrow({ where: { organisationId: orgId } });
    await expect(getVisit(other, visit.id)).rejects.toBeInstanceOf(NotFoundError);
    const register = await carePlanRegister(other, {});
    expect(register.rows.some((r) => r.id === su.id)).toBe(false);
  });

  it("evidence files are served only inside their own organisation, through both download routes", async () => {
    const doc = await storeEvidenceFile(orgId, (await manager()).userId, textFile(), {});
    const other = await outsider();
    await expect(readEvidence(other, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readCaseEvidence(other, doc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await readEvidence(await manager(), doc.id)).bytes.toString()).toContain("Supervision notes");
    expect(otherOrgId).not.toBe(orgId);
  });
});

describe("evidence virus-check policy", () => {
  it("stores a file as not virus-checked when no scanner is set up, and serves it unless the organisation requires scanning", async () => {
    vi.stubEnv("MALWARE_SCAN_URL", "");
    const m = await manager();
    const doc = await storeEvidenceFile(orgId, m.userId, textFile(), {});
    expect(doc.scanStatus).toBe("NOT_SCANNED");
    await expect(readEvidence(m, doc.id)).resolves.toBeTruthy();
    vi.stubEnv("EVIDENCE_REQUIRE_SCAN", "true");
    await expect(readEvidence(m, doc.id)).rejects.toThrow(/has not been virus-checked/);
  });

  it("holds pending, failed and infected files with a reason the person can act on, and never deletes them", async () => {
    const m = await manager();
    for (const [status, words] of [["PENDING", /waiting for its virus check/], ["SCAN_FAILED", /waiting for its virus check/], ["INFECTED", /failed the malware scan/]] as const) {
      const doc = await storeEvidenceFile(orgId, m.userId, textFile(), {});
      await db.evidenceDocument.update({ where: { id: doc.id }, data: { scanStatus: status } });
      const err = await readEvidence(m, doc.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as Error).message).toMatch(words);
      expect(await db.evidenceDocument.count({ where: { id: doc.id } })).toBe(1);
    }
  });

  it("refuses an upload, storing nothing, when the scanner fails or gives an unclear answer; rejects infected files", async () => {
    vi.stubEnv("MALWARE_SCAN_URL", "https://scanner.test/scan");
    const m = await manager();
    const before = await db.evidenceDocument.count();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await expect(storeEvidenceFile(orgId, m.userId, textFile(), {})).rejects.toThrow(/virus check could not run/);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: "ok" })));
    await expect(storeEvidenceFile(orgId, m.userId, textFile(), {})).rejects.toBeInstanceOf(ValidationError);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ infected: true })));
    await expect(storeEvidenceFile(orgId, m.userId, textFile(), {})).rejects.toThrow(/rejected by the virus check/);
    expect(await db.evidenceDocument.count()).toBe(before);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ infected: false })));
    expect((await storeEvidenceFile(orgId, m.userId, textFile(), {})).scanStatus).toBe("CLEAN");
  });

  it("scans an older unchecked file on its first download once a scanner is set up, and records the result", async () => {
    vi.stubEnv("MALWARE_SCAN_URL", "");
    const m = await manager();
    const clean = await storeEvidenceFile(orgId, m.userId, textFile(), {});
    const bad = await storeEvidenceFile(orgId, m.userId, textFile("pretend this is bad"), {});
    vi.stubEnv("MALWARE_SCAN_URL", "https://scanner.test/scan");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => Response.json({ infected: Buffer.from(init.body as Uint8Array).toString().includes("bad") })));
    await readEvidence(m, clean.id);
    expect((await db.evidenceDocument.findUniqueOrThrow({ where: { id: clean.id } })).scanStatus).toBe("CLEAN");
    await expect(readEvidence(m, bad.id)).rejects.toThrow(/failed the malware scan/);
    expect((await db.evidenceDocument.findUniqueOrThrow({ where: { id: bad.id } })).scanStatus).toBe("INFECTED");
    expect(await db.auditLog.count({ where: { action: "evidence.scanned", entityId: { in: [clean.id, bad.id] } } })).toBe(2);
  });
});

describe("shared rate limit", () => {
  it("counts every request for a key in one shared window per minute, separately for each minute", async () => {
    const t = Date.UTC(2026, 10, 1, 12, 0, 5);
    const key = `test:${Math.random()}`;
    expect(await countRequest(key, t)).toBe(1);
    expect(await countRequest(key, t + 1000)).toBe(2);
    expect(await countRequest(key, t + 60_000)).toBe(1); // the next minute starts again
    expect(await overLimit(key, 2, t + 2000)).toBe(true); // third request in the first minute
    expect(await db.rateLimitWindow.count({ where: { key } })).toBe(2);
  });
});

describe("service user record", () => {
  it("labels a person as fictional only in a demonstration organisation", async () => {
    const m = await manager();
    const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId } });
    expect((await getServiceUser(m, su.id)).organisation.isDemo).toBe(true);
    await db.organisation.update({ where: { id: orgId }, data: { isDemo: false } });
    try {
      expect((await getServiceUser(m, su.id)).organisation.isDemo).toBe(false);
    } finally {
      await db.organisation.update({ where: { id: orgId }, data: { isDemo: true } });
    }
  });

  it("shows recent incidents to managers, and a carer only the reports they made themselves", async () => {
    const inc = await db.incident.findFirstOrThrow({ where: { organisationId: orgId, serviceUserId: { not: null } } });
    const mine = await recentIncidentsFor(await manager(), inc.serviceUserId!);
    expect(mine?.some((i) => i.id === inc.id)).toBe(true);
    const carer = await ctxFor("carer@care-solution.demo", BROOKFIELD);
    const theirs = await recentIncidentsFor(carer, inc.serviceUserId!);
    expect(theirs?.every((i) => i.id !== inc.id || inc.reportedById === carer.userId)).toBe(true);
  });

  it("the care plan register reports how many booked carers have read the plan in use, out of all booked", async () => {
    const { rows } = await carePlanRegister(await manager(), {});
    const withPlan = rows.filter((r) => r.active);
    expect(withPlan.length).toBeGreaterThan(0);
    for (const r of withPlan) {
      expect(r.readByVisiting).not.toBeNull();
      expect(r.readByVisiting!.read).toBeLessThanOrEqual(r.readByVisiting!.of);
    }
    for (const r of rows.filter((x) => !x.active)) expect(r.readByVisiting).toBeNull();
  });
});

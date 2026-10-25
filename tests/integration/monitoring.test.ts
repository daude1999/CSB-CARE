import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { checkSource, freshness, scheduleDueSources } from "@/server/sources/engine";
import { claimNext, drain, enqueue, retryJob, runClaimed } from "@/server/jobs/queue";
import { fixtureFetch, fixtureHttp } from "@/server/testing/fixtures";
import { handlers } from "@/worker/handlers";
import { resetDb } from "../helpers";
import { seedBase } from "@/server/seed/base";

const PATH = "/guidance/test-doc";
const URL = `https://www.gov.uk/api/content${PATH}`;
const item = (body: string, updated = "2026-10-01T00:00:00Z", notes: { public_timestamp: string; note: string }[] = []) => ({
  content_id: "test-content-id",
  base_path: PATH,
  title: "Test guidance",
  document_type: "detailed_guide",
  public_updated_at: updated,
  details: { body, change_history: notes },
});

async function makeSource() {
  return db.regulatorySource.create({
    data: { key: `test-${Math.random()}`, name: "Test GOV.UK source", canonicalUrl: "https://www.gov.uk" + PATH, category: "GOVERNMENT_GUIDANCE", monitoringMethod: "GOVUK_CONTENT_API", coverage: "AUTOMATED", config: { basePaths: [PATH] }, serviceTypes: ["RESIDENTIAL"] },
  });
}

describe("source monitoring", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBase();
  });

  it("captures a baseline without raising change items, then detects a genuine change exactly once", async () => {
    const s = await makeSource();
    const v1 = item("<h2>Duties</h2><p>Providers must notify within 48 hours.</p>");
    const r1 = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: v1 } })) });
    expect(r1).toMatchObject({ status: "SUCCEEDED", baseline: true, newDocuments: 1, changeIds: [] });
    expect(await db.sourceVersion.count()).toBeGreaterThan(0);

    // Same content again: no new version, no change.
    const before = await db.sourceVersion.count();
    const r2 = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: v1 } })) });
    expect(r2.changeIds).toEqual([]);
    expect(await db.sourceVersion.count()).toBe(before);

    // Real change.
    const v2 = item("<h2>Duties</h2><p>Providers must notify within 24 hours.</p>", "2026-10-20T00:00:00Z");
    const r3 = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: v2 } })) });
    expect(r3.changeIds).toHaveLength(1);
    const change = await db.regulatoryChange.findUniqueOrThrow({ where: { id: r3.changeIds[0] }, include: { newVersion: true, previousVersion: true, events: true } });
    expect(change.classification).toBe("POTENTIALLY_SUBSTANTIVE");
    expect(change.previousVersion?.versionNumber).toBe(1);
    expect(change.newVersion.versionNumber).toBe(2);
    expect(change.officialDate?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(change.retrievedAt.getTime()).not.toBe(change.officialDate?.getTime());
    expect(change.events.map((e) => e.to)).toEqual(["NEWLY_DETECTED", "POTENTIALLY_SUBSTANTIVE"]);

    // Re-running with the same new content does not duplicate.
    const r4 = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: v2 } })) });
    expect(r4.changeIds).toEqual([]);
    expect(await db.regulatoryChange.count({ where: { sourceId: s.id } })).toBe(1);
    // Analysis job enqueued once (idempotent).
    expect(await db.backgroundJob.count({ where: { type: "change.analyse" } })).toBe(1);
  });

  it("does not treat a changed modified timestamp alone as a change", async () => {
    const s = await makeSource();
    const body = "<h2>Duties</h2><p>Text.</p>";
    await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item(body, "2026-01-01T00:00:00Z") } })) });
    const r = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item(body, "2026-09-09T00:00:00Z") } })) });
    expect(r.changeIds).toEqual([]);
    const ev = await db.processingEvent.findFirst({ where: { runId: r.runId, event: "document.metadata_only" } });
    expect(ev?.message).toMatch(/not treated as a change/);
  });

  it("treats editorial-only edits as editorial", async () => {
    const s = await makeSource();
    await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item("<h2>A</h2><p>Providers must notify the team.</p>") } })) });
    const r = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item("<h2>A</h2><p>Providers must notify the team</p>") } })) });
    const c = await db.regulatoryChange.findUniqueOrThrow({ where: { id: r.changeIds[0] } });
    expect(c.classification).toBe("EDITORIAL");
    expect(c.status).toBe("EDITORIAL_OR_IMMATERIAL");
  });

  it("refuses to record an empty extraction as a new version", async () => {
    const s = await makeSource();
    await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item("<h2>A</h2><p>Real text.</p>") } })) });
    const err = await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: { ...item(""), details: {} } } })) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await db.sourceVersion.count({ where: { document: { sourceId: s.id } } })).toBe(1);
    const run = await db.sourceRetrievalRun.findFirstOrThrow({ where: { sourceId: s.id }, orderBy: { startedAt: "desc" } });
    expect(run.status).toBe("FAILED");
  });

  it("records failures, keeps last success separate, alerts after repeated failures and recovers", async () => {
    await db.user.create({ data: { email: "ops@test", name: "Ops", platformRoles: ["PLATFORM_ADMIN"] } });
    const s = await makeSource();
    await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item("<h2>A</h2><p>x y z.</p>") } })) });
    const okAt = (await db.regulatorySource.findUniqueOrThrow({ where: { id: s.id } })).lastSuccessAt;
    const failing = fixtureHttp(fixtureFetch({ [URL]: { status: 503, body: "down" } }));
    for (let i = 0; i < 3; i++) await expect(checkSource(s.id, { trigger: "TEST", http: failing })).rejects.toThrow(/failed/);
    const after = await db.regulatorySource.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.consecutiveFailures).toBe(3);
    expect(after.lastSuccessAt).toEqual(okAt);
    expect(after.lastAttemptedAt!.getTime()).toBeGreaterThan(okAt!.getTime());
    expect(after.retrievalStatus).toBe("DEGRADED");
    expect(await db.notification.count({ where: { type: "source.failing" } })).toBeGreaterThan(0);
    // One alert per failure streak, not per failure.
    await expect(checkSource(s.id, { trigger: "TEST", http: failing })).rejects.toThrow();
    const admins = await db.user.count({ where: { platformRoles: { has: "PLATFORM_ADMIN" } } });
    expect(await db.notification.count({ where: { type: "source.failing" } })).toBe(admins);
    await checkSource(s.id, { trigger: "TEST", http: fixtureHttp(fixtureFetch({ [URL]: { body: item("<h2>A</h2><p>x y z.</p>") } })) });
    expect((await db.regulatorySource.findUniqueOrThrow({ where: { id: s.id } })).consecutiveFailures).toBe(0);
  });

  it("never fetches manual-review-only sources and reports freshness honestly", async () => {
    const manual = await db.regulatorySource.findUniqueOrThrow({ where: { key: "nice" } });
    await expect(checkSource(manual.id, { trigger: "TEST" })).rejects.toThrow(/manual-review-only/);
    expect(freshness(manual).state).toBe("manual");
    const auto = await db.regulatorySource.findUniqueOrThrow({ where: { key: "govuk-adult-social-care-guidance" } });
    expect(freshness(auto).state).toBe("never");
    expect(freshness({ ...auto, lastSuccessAt: new Date(Date.now() - 100 * 3600_000) }).state).toBe("stale");
  });

  it("schedules due sources idempotently, excluding manual ones", async () => {
    const a = await scheduleDueSources();
    const b = await scheduleDueSources();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toHaveLength(0);
    const jobs = await db.backgroundJob.findMany({ where: { type: "source.check" } });
    const keys = await db.regulatorySource.findMany({ where: { id: { in: jobs.map((j) => (j.payload as { sourceId: string }).sourceId) } } });
    expect(keys.every((k) => k.coverage !== "MANUAL_REVIEW_ONLY")).toBe(true);
  });
});

describe("job queue", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is idempotent, retries with backoff, dead-letters and supports manual retry", async () => {
    const a = await enqueue("test.fail", {}, { idempotencyKey: "k1", maxAttempts: 2 });
    const b = await enqueue("test.fail", {}, { idempotencyKey: "k1", maxAttempts: 2 });
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    let calls = 0;
    const h = { "test.fail": async () => { calls++; throw new Error("boom"); } };
    await drain("w", h);
    let job = await db.backgroundJob.findUniqueOrThrow({ where: { id: a.job.id } });
    expect(job.status).toBe("FAILED");
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
    await db.backgroundJob.update({ where: { id: job.id }, data: { runAfter: new Date() } });
    await drain("w", h);
    job = await db.backgroundJob.findUniqueOrThrow({ where: { id: a.job.id } });
    expect(job.status).toBe("DEAD");
    expect(calls).toBe(2);
    await retryJob(job.id);
    await drain("w", { "test.fail": async () => ({ ok: true }) });
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: a.job.id } })).status).toBe("SUCCEEDED");
  });

  it("recovers jobs whose worker died", async () => {
    const { job } = await enqueue("test.ok", {}, { idempotencyKey: "k2" });
    const claimed = await claimNext("dead-worker");
    expect(claimed?.id).toBe(job.id);
    expect(await claimNext("other")).toBeNull();
    await db.backgroundJob.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const recovered = await claimNext("other");
    expect(recovered?.id).toBe(job.id);
    expect(await runClaimed(recovered!, { "test.ok": async () => ({}) })).toBe("succeeded");
  });

  it("runs the source check handler through the queue", async () => {
    await seedBase();
    const src = await db.regulatorySource.findUniqueOrThrow({ where: { key: "nice" } });
    await enqueue("source.check", { sourceId: src.id, trigger: "MANUAL" }, { idempotencyKey: "manual-nice" });
    const out = await drain("w", handlers);
    expect(out[0]?.outcome).toBe("dead"); // manual-review-only: permanent failure, not retried
  });
});

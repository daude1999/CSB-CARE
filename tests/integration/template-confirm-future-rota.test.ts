import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fromDbDate, londonDate, mondayOf } from "@/lib/london";
import { confirmServiceUserRota, previewServiceUserRota, weekIsBuilt } from "@/server/rota/build";
import { previewTemplateEdit, previewTemplateImpact, saveTemplateEdit } from "@/server/rota/template-impact";
import { notifyVisitsChanged } from "@/server/rota/visit-change-notify";
import { rotaSettings } from "@/server/rota/settings";
import type { TemplateInput } from "@/server/rota/templates";
import { BROOKFIELD, ctxFor, OAKRIDGE, resetDb, seedAll } from "../helpers";

/**
 * Confirm Template Changes and Create Future Rota (brief of 3 Nov 2026, PR B). A template save always needs the
 * confirmation token; Template + Future Rota applies only what the preview showed, in one transaction; Create Future
 * Rota builds one person's weeks with the Build Rota rules and never duplicates a visit.
 */
const manager = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
let orgId = "";
let suId = "";
let templateId = "";
// Far enough ahead that the demo seed has built nothing there.
const W = addDays(mondayOf(londonDate()), 7 * 20);

async function inputOf(id: string): Promise<TemplateInput> {
  const t = await db.visitTemplate.findUniqueOrThrow({ where: { id }, include: { tasks: true } });
  return {
    serviceUserId: t.serviceUserId, callTypeId: t.callTypeId, areaId: t.areaId, cycleWeeks: t.cycleWeeks, weekdays: t.weekdays,
    startMinute: t.startMinute, durationMin: t.durationMin, carersRequired: t.carersRequired, preferredStaff1Id: t.preferredStaff1Id,
    preferredStaff2Id: t.preferredStaff2Id, extraPreferredStaffIds: t.extraPreferredStaffIds, shadowStaffId: t.shadowStaffId, timeLocked: t.timeLocked,
    medicationRequired: t.medicationRequired, alertOnLate: t.alertOnLate, rotaType: t.rotaType, runRouteTemplateId: t.runRouteTemplateId,
    effectiveFrom: fromDbDate(t.effectiveFrom), effectiveTo: t.effectiveTo ? fromDbDate(t.effectiveTo) : null, notes: t.notes, taskIds: t.tasks.map((x) => x.careTaskId),
  };
}
const version = async () => (await db.visitTemplate.findUniqueOrThrow({ where: { id: templateId } })).version;
const ourVisits = () => db.visit.findMany({ where: { templateId, date: { gte: dbDate(W) } }, orderBy: { scheduledStart: "asc" } });

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: orgId, status: "ACTIVE", templates: { some: { enabled: true } } } });
  suId = su.id;
  const cycleLength = (await rotaSettings(db, orgId)).cycleLength;
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: orgId, active: true } });
  // A Monday and Wednesday call with no preferred carer, so carer clashes never decide these tests.
  const t = await db.visitTemplate.create({
    data: { organisationId: orgId, serviceUserId: suId, callTypeId: callType.id, areaId: su.areaId, cycleWeeks: Array.from({ length: cycleLength }, (_, i) => i + 1), weekdays: [1, 3], startMinute: 5 * 60 + 5, durationMin: 30, carersRequired: 1, effectiveFrom: dbDate(londonDate()), createdById: (await db.user.findFirstOrThrow({ where: { email: "manager@care-solution.demo" } })).id },
  });
  templateId = t.id;
}, 180_000);

describe("Create Future Rota for one service user", () => {
  it("previews only this person's visits, and creates them unpublished in one build per week", async () => {
    const ctx = await manager();
    const p = await previewServiceUserRota(ctx, suId, { weekStart: W, weeks: 2 });
    expect(p.plans).toHaveLength(2);
    expect(p.plans.every((w) => w.visits.every((v) => v.serviceUserId === suId))).toBe(true);
    const ours = p.plans.flatMap((w) => w.visits.filter((v) => v.templateId === templateId));
    expect(ours.map((v) => v.date)).toEqual([W, addDays(W, 2), addDays(W, 7), addDays(W, 9)]);
    expect(await weekIsBuilt(ctx, W)).toBe(false);

    const r = await confirmServiceUserRota(ctx, suId, { weekStart: W, weeks: 2, fingerprint: p.fingerprint });
    expect(r.visits).toBe(p.totals.create);
    expect(r.builds).toHaveLength(2);
    const builds = await db.rotaBuild.findMany({ where: { id: { in: r.builds } } });
    expect(builds.every((b) => b.serviceUserId === suId)).toBe(true);
    const visits = await db.visit.findMany({ where: { rotaBuildId: { in: r.builds } } });
    expect(visits).toHaveLength(p.totals.create);
    expect(visits.every((v) => v.serviceUserId === suId && v.publishedAt === null)).toBe(true);
    // A build made for one person does not mark the whole week as built.
    expect(await weekIsBuilt(ctx, W)).toBe(false);
  });

  it("never duplicates: a second preview finds the visits already on the rota and creates nothing", async () => {
    const ctx = await manager();
    const p = await previewServiceUserRota(ctx, suId, { weekStart: W, weeks: 2 });
    expect(p.totals.create).toBe(0);
    expect(p.totals.alreadyBuilt).toBeGreaterThanOrEqual(4);
    await expect(confirmServiceUserRota(ctx, suId, { weekStart: W, weeks: 2, fingerprint: p.fingerprint })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a stale preview, past weeks, too many weeks and another organisation", async () => {
    const ctx = await manager();
    const later = addDays(W, 14);
    const p = await previewServiceUserRota(ctx, suId, { weekStart: later, weeks: 1 });
    expect(p.totals.create).toBeGreaterThan(0);
    await expect(confirmServiceUserRota(ctx, suId, { weekStart: later, weeks: 1, fingerprint: "0".repeat(24) })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.visit.count({ where: { serviceUserId: suId, date: { gte: dbDate(later), lte: dbDate(addDays(later, 6)) } } })).toBe(0);
    await expect(previewServiceUserRota(ctx, suId, { weekStart: addDays(mondayOf(londonDate()), -7), weeks: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(previewServiceUserRota(ctx, suId, { weekStart: W, weeks: 9 })).rejects.toBeInstanceOf(ValidationError);
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    await expect(previewServiceUserRota(oak, suId, { weekStart: W, weeks: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Confirm Template Changes", () => {
  it("lists the changed fields and refuses a save with nothing changed", async () => {
    const ctx = await manager();
    const input = await inputOf(templateId);
    await expect(previewTemplateEdit(ctx, templateId, await version(), input)).rejects.toThrow("No changes to save.");
    const p = await previewTemplateEdit(ctx, templateId, await version(), { ...input, startMinute: 5 * 60 + 35 });
    expect(p.changes.map((c) => c.label)).toContain("Start");
    expect(p.changes.find((c) => c.label === "Start")).toMatchObject({ before: "05:05", after: "05:35" });
    expect(p.futureVisits).toBeGreaterThanOrEqual(4);
  });

  it("needs the confirmation token, and refuses a token for different values or an old version", async () => {
    const ctx = await manager();
    const input = await inputOf(templateId);
    const v = await version();
    const p = await previewTemplateEdit(ctx, templateId, v, { ...input, startMinute: 5 * 60 + 35 });
    await expect(saveTemplateEdit(ctx, templateId, v, { ...input, startMinute: 5 * 60 + 35 }, { token: "", scope: "template" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveTemplateEdit(ctx, templateId, v, { ...input, startMinute: 5 * 60 + 40 }, { token: p.token, scope: "template" })).rejects.toBeInstanceOf(ConflictError);
    await expect(saveTemplateEdit(ctx, templateId, v - 1 || 99, { ...input, startMinute: 5 * 60 + 35 }, { token: p.token, scope: "template" })).rejects.toBeInstanceOf(ConflictError);
    expect(await version()).toBe(v);
  });

  it("Template Only changes the template and leaves every built visit alone", async () => {
    const ctx = await manager();
    const before = await ourVisits();
    const input = await inputOf(templateId);
    const v = await version();
    const next = { ...input, durationMin: 45 };
    const p = await previewTemplateEdit(ctx, templateId, v, next);
    const r = await saveTemplateEdit(ctx, templateId, v, next, { token: p.token, scope: "template" });
    expect(r.applied).toBe(0);
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: templateId } })).durationMin).toBe(45);
    const after = await ourVisits();
    expect(after.map((x) => x.scheduledEnd.getTime())).toEqual(before.map((x) => x.scheduledEnd.getTime()));
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: templateId, action: "template.updated" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ choice: "template only" });
  });

  it("Template + Future Rota updates eligible visits and protects manual, time-locked and started ones", async () => {
    const ctx = await manager();
    const [manual, locked, ...rest] = await ourVisits();
    await db.visit.update({ where: { id: manual!.id }, data: { manuallyChanged: true } });
    await db.visit.update({ where: { id: locked!.id }, data: { timeLocked: true } });
    const input = await inputOf(templateId);
    const v = await version();
    const next = { ...input, startMinute: 6 * 60 };
    const p = await previewTemplateEdit(ctx, templateId, v, next);
    const impact = await previewTemplateImpact(ctx, templateId, v, next);
    const result = new Map(impact.rows.map((r) => [r.visitId, r.result]));
    expect(result.get(manual!.id)).toBe("manual");
    expect(result.get(locked!.id)).toBe("locked");
    expect(rest.every((x) => result.get(x.id) === "update")).toBe(true);

    const r = await saveTemplateEdit(ctx, templateId, v, next, { token: p.token, scope: "future", fingerprint: impact.fingerprint });
    expect(r.applied).toBe(impact.summary.update);
    const after = new Map((await ourVisits()).map((x) => [x.id, x]));
    expect(after.get(manual!.id)!.scheduledStart.getTime()).toBe(manual!.scheduledStart.getTime());
    expect(after.get(locked!.id)!.scheduledStart.getTime()).toBe(locked!.scheduledStart.getTime());
    for (const x of rest) {
      const now = after.get(x.id)!;
      expect(now.scheduledStart.getTime() - x.scheduledStart.getTime()).toBe((6 * 60 - (5 * 60 + 5)) * 60000);
      expect(now.manuallyChanged).toBe(false);
    }
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: templateId, action: "template.updated" }, orderBy: { createdAt: "desc" } });
    expect(log.data).toMatchObject({ choice: "template and future rota", visitsUpdated: r.applied });
  });

  it("saves nothing when the rota changed after the review", async () => {
    const ctx = await manager();
    const input = await inputOf(templateId);
    const v = await version();
    const next = { ...input, startMinute: 6 * 60 + 15 };
    const p = await previewTemplateEdit(ctx, templateId, v, next);
    const impact = await previewTemplateImpact(ctx, templateId, v, next);
    const target = impact.rows.find((r) => r.result === "update")!;
    await db.visit.update({ where: { id: target.visitId }, data: { manuallyChanged: true } });
    await expect(saveTemplateEdit(ctx, templateId, v, next, { token: p.token, scope: "future", fingerprint: impact.fingerprint })).rejects.toThrow("The rota changed since your preview");
    expect(await version()).toBe(v);
    expect((await db.visitTemplate.findUniqueOrThrow({ where: { id: templateId } })).startMinute).toBe(6 * 60);
    await db.visit.update({ where: { id: target.visitId }, data: { manuallyChanged: false } });
  });

  it("keeps visits on a removed day unless ticked to cancel with a reason", async () => {
    const ctx = await manager();
    const input = await inputOf(templateId);
    const v = await version();
    const next = { ...input, weekdays: [1] };
    const p = await previewTemplateEdit(ctx, templateId, v, next);
    const impact = await previewTemplateImpact(ctx, templateId, v, next);
    const removed = impact.rows.filter((r) => r.result === "removed");
    expect(removed.length).toBeGreaterThanOrEqual(2);
    expect(removed.every((r) => new Date(`${r.date}T12:00:00Z`).getUTCDay() === 3)).toBe(true);
    await expect(saveTemplateEdit(ctx, templateId, v, next, { token: p.token, scope: "future", fingerprint: impact.fingerprint, cancelVisitIds: [removed[0]!.visitId], cancelReason: "" })).rejects.toBeInstanceOf(ValidationError);
    const r = await saveTemplateEdit(ctx, templateId, v, next, { token: p.token, scope: "future", fingerprint: impact.fingerprint, cancelVisitIds: [removed[0]!.visitId], cancelReason: "Wednesday visits stopped" });
    expect(r.cancelled).toBe(1);
    expect((await db.visit.findUniqueOrThrow({ where: { id: removed[0]!.visitId } })).status).toBe("CANCELLED");
    expect((await db.visit.findUniqueOrThrow({ where: { id: removed[1]!.visitId } })).status).toBe("SCHEDULED");
  });

  it("refuses another organisation's template", async () => {
    const oak = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const input = await inputOf(templateId);
    await expect(previewTemplateEdit(oak, templateId, await version(), { ...input, durationMin: 50 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Carers are told in the app when a published visit changes", () => {
  it("creates one notice per linked carer of a published visit, and none for drafts", async () => {
    const v = await db.visit.findFirstOrThrow({ where: { organisationId: orgId, publishedAt: { not: null }, status: "SCHEDULED", assignments: { some: { removedAt: null, staff: { userId: { not: null } } } } }, include: { assignments: { where: { removedAt: null }, include: { staff: true } } } });
    const draft = (await ourVisits())[0]!;
    const told = await db.$transaction((tx) => notifyVisitsChanged(tx, orgId, [v.id, draft.id], { key: "test" }));
    const users = new Set(v.assignments.map((a) => a.staff.userId).filter(Boolean));
    expect(told).toBe(users.size);
    expect(await db.notification.count({ where: { type: "rota.visit.changed", dedupeKey: { startsWith: "visit-changed:test:" } } })).toBe(users.size);
    // The same change never notifies twice.
    await db.$transaction((tx) => notifyVisitsChanged(tx, orgId, [v.id], { key: "test" }));
    expect(await db.notification.count({ where: { type: "rota.visit.changed", dedupeKey: { startsWith: "visit-changed:test:" } } })).toBe(users.size);
  });
});

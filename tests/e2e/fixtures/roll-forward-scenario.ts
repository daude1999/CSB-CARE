import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, londonToUtc, mondayOf } from "@/lib/london";
import { ctxForUser } from "@/server/auth/session";
import { confirmRollForward, previewRollForward } from "@/server/rota/roll-forward";
import { visitReference } from "@/server/rota/visits";

/**
 * Builds the owner's Roll Forward scenario from synthetic data: a source week of 1,206 visits, a destination week that
 * already holds 1,204 of them, and 2 visits still to roll forward. The demo rota is topped up with synthetic service
 * users ("Synthetic Person NN", reference SYN-RF-NN) and synthetic visits, carers are booked only where they are free,
 * in weeks well ahead of the ones other tests use,
 * then the week is rolled forward once and two more visits are added to the source week. Prints the weeks as JSON.
 * Run it once on a freshly seeded database (end-to-end or local); it refuses to run twice.
 *
 *   npx tsx tests/e2e/fixtures/roll-forward-scenario.ts                 builds the scenario
 *   npx tsx tests/e2e/fixtures/roll-forward-scenario.ts snapshot <week>  count and digest of that week's visits
 *   npx tsx tests/e2e/fixtures/roll-forward-scenario.ts add <week>       adds one synthetic visit to that week
 */
const SOURCE_TOTAL = 1206;
const NEW_VISITS = 2;
const TIMES = [7 * 60 + 30, 12 * 60, 16 * 60 + 30, 20 * 60];

async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
  if (await db.serviceUser.count({ where: { organisationId: org.id, reference: { startsWith: "SYN-RF-" } } })) throw new Error("The roll forward scenario is already in this database");
  const ctx = await ctxForUser(manager.id, org.id);
  // Far enough ahead that no other browser test works in these weeks: the demo's next week is first rolled forward into
  // the first empty pair of weeks 12 or more weeks ahead, and that copy becomes the source week of the scenario.
  const demoWeek = addDays(mondayOf(londonDate()), 7);
  const empty = async (w: string) => !(await db.visit.count({ where: { organisationId: org.id, date: { gte: dbDate(w), lte: dbDate(addDays(w, 6)) } } }));
  let sourceWeek = addDays(demoWeek, 7 * 12);
  while (!(await empty(sourceWeek)) || !(await empty(addDays(sourceWeek, 7)))) sourceWeek = addDays(sourceWeek, 7);
  const targetWeek = addDays(sourceWeek, 7);
  await confirmRollForward(ctx, { sourceWeek: demoWeek, targetWeek: sourceWeek, weeks: 1 });
  const areas = await db.area.findMany({ where: { organisationId: org.id, active: true }, orderBy: { name: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true }, orderBy: { name: "asc" } });
  const staff = await db.staffMember.findMany({ where: { organisationId: org.id, employmentStatus: "ACTIVE" }, orderBy: { displayName: "asc" }, select: { id: true } });

  const before = await previewRollForward(ctx, { sourceWeek, targetWeek, weeks: 1 });
  const toAdd = SOURCE_TOTAL - NEW_VISITS - before.sourceVisits;
  if (toAdd < 0 || before.existing) throw new Error(`Unexpected starting rota: ${before.sourceVisits} source, ${before.skipped.length} skipped, ${before.existing} existing`);

  const people = Math.ceil((toAdd + NEW_VISITS) / (TIMES.length * 7));
  const sus: { id: string; areaId: string | null }[] = [];
  for (let i = 0; i < people; i++) {
    const area = areas[i % areas.length]!;
    sus.push(await db.serviceUser.create({ data: { organisationId: org.id, branchId: area.branchId, areaId: area.id, reference: `SYN-RF-${String(i + 1).padStart(2, "0")}`, firstName: "Synthetic", lastName: `Person ${String(i + 1).padStart(2, "0")}`, status: "ACTIVE", startDate: dbDate(addDays(sourceWeek, -60)) } }));
  }

  // Carers are booked only where they have nothing else at that time, so nobody is double-booked.
  const booked = new Map<string, [number, number][]>();
  for (const a of await db.visitAssignment.findMany({ where: { organisationId: org.id, blocking: true, removedAt: null, startsAt: { lt: londonToUtc(addDays(sourceWeek, 8), 0) }, endsAt: { gt: londonToUtc(addDays(sourceWeek, -1), 0) } }, select: { staffId: true, startsAt: true, endsAt: true } })) {
    booked.set(a.staffId, [...(booked.get(a.staffId) ?? []), [a.startsAt.getTime(), a.endsAt.getTime()]]);
  }
  const freeCarer = (s: Date, e: Date, from: number) => {
    for (let k = 0; k < staff.length; k++) {
      const id = staff[(from + k) % staff.length]!.id;
      const mine = booked.get(id) ?? [];
      if (mine.length >= 40) continue;
      if (mine.some(([a, b]) => a < e.getTime() + 30 * 60_000 && b > s.getTime() - 30 * 60_000)) continue;
      mine.push([s.getTime(), e.getTime()]);
      booked.set(id, mine);
      return id;
    }
    return null;
  };
  const addVisit = async (n: number, minuteShift = 0) => {
    const su = sus[n % sus.length]!;
    const day = Math.floor(n / sus.length) % 7;
    const minute = TIMES[Math.floor(n / (sus.length * 7)) % TIMES.length]! + (n % 3) * 15 + minuteShift;
    const date = addDays(sourceWeek, day);
    const start = londonToUtc(date, minute);
    const end = new Date(start.getTime() + 30 * 60_000);
    const v = await db.visit.create({ data: { organisationId: org.id, reference: visitReference(date), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(date), scheduledStart: start, scheduledEnd: end, publishedAt: new Date(), notes: "Synthetic test visit", createdById: manager.id } });
    const carer = n % 5 === 4 ? null : freeCarer(start, end, n);
    if (carer) await db.visitAssignment.create({ data: { organisationId: org.id, visitId: v.id, slot: "PRIMARY", staffId: carer, startsAt: start, endsAt: end, eligibility: "ELIGIBLE", assignedById: manager.id } });
  };
  for (let n = 0; n < toAdd; n++) await addVisit(n);

  // The destination week now gets every visit so far, as the office would have rolled it forward before.
  await confirmRollForward(ctx, { sourceWeek, targetWeek, weeks: 1 });
  // Two more visits are added to the source week afterwards: those are the ones the preview should offer to create.
  for (let n = 0; n < NEW_VISITS; n++) await addVisit(toAdd + n, 50);

  const after = await previewRollForward(ctx, { sourceWeek, targetWeek, weeks: 1 });
  process.stdout.write(JSON.stringify({ demoWeek, sourceWeek, targetWeek, source: after.sourceVisits, existing: after.existing, create: after.counts.create, skipped: after.skipped.length }));
  await db.$disconnect();
}

/** The visits of one week as they stand: how many, a digest of every one (id, version, time, carers) and duplicates. */
async function snapshot(week: string) {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const visits = await db.visit.findMany({
    where: { organisationId: org.id, date: { gte: dbDate(week), lte: dbDate(addDays(week, 6)) } },
    select: { id: true, lockVersion: true, serviceUserId: true, scheduledStart: true, scheduledEnd: true, status: true, assignments: { where: { removedAt: null }, select: { staffId: true, slot: true }, orderBy: { slot: "asc" } } },
    orderBy: { id: "asc" },
  });
  const digest = createHash("sha256").update(JSON.stringify(visits.map((v) => [v.id, v.lockVersion, v.scheduledStart.getTime(), v.scheduledEnd.getTime(), v.status, v.assignments.map((a) => `${a.slot}:${a.staffId}`)]))).digest("hex");
  const seen = new Set<string>();
  let duplicates = 0;
  for (const v of visits) {
    const k = `${v.serviceUserId}|${v.scheduledStart.getTime()}`;
    if (seen.has(k)) duplicates++;
    seen.add(k);
  }
  process.stdout.write(JSON.stringify({ count: visits.length, digest, ids: visits.map((v) => v.id), duplicates }));
  await db.$disconnect();
}

/** One more synthetic visit in the given week (an office change made after a preview was worked out). */
async function addOne(week: string) {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const manager = await db.user.findUniqueOrThrow({ where: { email: "manager@care-solution.demo" } });
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, reference: { startsWith: "SYN-RF-" } }, orderBy: { reference: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true }, orderBy: { name: "asc" } });
  const date = addDays(week, 3);
  const start = londonToUtc(date, 14 * 60 + 5);
  const v = await db.visit.create({ data: { organisationId: org.id, reference: visitReference(date), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(date), scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * 60_000), publishedAt: new Date(), notes: "Synthetic test visit", createdById: manager.id } });
  process.stdout.write(JSON.stringify({ id: v.id }));
  await db.$disconnect();
}

const [mode, arg] = process.argv.slice(2);
(mode === "snapshot" ? snapshot(arg!) : mode === "add" ? addOne(arg!) : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});

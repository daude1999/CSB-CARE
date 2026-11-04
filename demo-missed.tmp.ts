import { db } from "@/lib/db";
import { dbDate, hhmm, londonDate, londonMinute } from "@/lib/london";
import { drain } from "@/server/jobs/queue";
import { handlers } from "@/worker/handlers";
import { sweepCalls } from "@/server/rota/monitor";
import { visitReference } from "@/server/rota/visits";
import { ctxForUser } from "@/server/auth/session";
import { myStaff } from "@/server/workforce/link";
import { setMissedAutomation } from "@/server/rota/missed-auto/settings";
import { submitCarerResponse } from "@/server/rota/missed-auto/confirmations";
import { assignCoordinator } from "@/server/rota/missed-calls";
import { catchUpInvestigations } from "@/server/rota/missed-auto/runs";
import { readFileSync, writeFileSync } from "node:fs";
const IDS = "/tmp/claude-0/demo-ids.json";

const MIN = 60_000;
async function ctx(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  return ctxForUser(u.id, org.id);
}
async function main() {
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  await sweepCalls({ organisationId: org.id, now: new Date() });
  if (process.argv[2] === "on") {
    const ids = JSON.parse(readFileSync(IDS, "utf8"));
  await setMissedAutomation(await ctx("manager@care-solution.demo"), { evidence: true, confirm: true, summary: true, confirmMinutes: 60, reminders: 1, reminderMinutes: 30 });
    await catchUpInvestigations(new Date());
    await drain("demo", handlers, { types: ["missed.investigate"], max: 100 });
    const conf = await db.missedCallCarerConfirmation.findFirstOrThrow({ where: { caseId: ids.doubleUp, staffId: ids.amelia } });
    const v = await db.visit.findFirstOrThrow({ where: { missedCallCase: { id: ids.doubleUp } } });
    await submitCarerResponse(await ctx("carer@care-solution.demo"), conf.id, { answer: "ATTENDED_NO_CLOCK", arrival: hhmm(londonMinute(new Date(v.scheduledStart.getTime() + 4 * MIN))), departure: hhmm(londonMinute(new Date(v.scheduledStart.getTime() + 31 * MIN))), careDelivered: "YES", explanation: "My phone battery died just as I arrived, so I could not clock in. I gave breakfast and morning medication prompts and left at the usual time.", submissionKey: `demo-${Date.now()}` });
    await drain("demo", handlers, { types: ["missed.investigate"], max: 100 });
    const bConf = await db.missedCallCarerConfirmation.findFirst({ where: { caseId: ids.awaiting } });
    console.log(JSON.stringify({ ...ids, conf: conf.id, bConf: bConf?.id }));
    return;
  }
  const amelia = await myStaff(await ctx("carer@care-solution.demo"));
  const other = await db.staffMember.findFirstOrThrow({ where: { organisationId: org.id, userId: null, employmentStatus: "ACTIVE", hrMissing: false, id: { not: amelia.id } }, orderBy: { displayName: "asc" } });
  const callType = await db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true, name: { contains: "Morning" } } }).catch(() => db.callType.findFirstOrThrow({ where: { organisationId: org.id, active: true } }));
  const sus = await db.serviceUser.findMany({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null } }, orderBy: { lastName: "asc" }, take: 6 });
  const high = await db.serviceUser.findFirst({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, riskLevel: "HIGH" } });
  async function make(staff: string[], suIdx: number, minutesAgo: number, su = sus[suIdx]!) {
    let start = new Date(Math.floor((Date.now() - minutesAgo * MIN) / MIN) * MIN);
    for (let i = 0; i < 40; i++) {
      const clash = await db.visitAssignment.count({ where: { staffId: { in: staff }, removedAt: null, blocking: true, startsAt: { lt: new Date(start.getTime() + 30 * MIN) }, endsAt: { gt: start } } });
      if (!clash) break;
      start = new Date(start.getTime() - 35 * MIN);
    }
    const v = await db.visit.create({ data: { organisationId: org.id, reference: visitReference(londonDate(start)), serviceUserId: su.id, callTypeId: callType.id, areaId: su.areaId, date: dbDate(londonDate(start)), scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * MIN), carersRequired: Math.max(1, staff.length), publishedAt: new Date() } });
    const slots = ["PRIMARY", "SECOND"] as const;
    for (const [i, s] of staff.entries()) await db.visitAssignment.create({ data: { organisationId: org.id, visitId: v.id, slot: slots[i]!, staffId: s, startsAt: v.scheduledStart, endsAt: v.scheduledEnd, eligibility: "ELIGIBLE", assignedById: "system", acknowledgedAt: new Date(start.getTime() - 86400000) } });
    await sweepCalls({ organisationId: org.id, now: new Date() });
    return { v, c: await db.missedCallCase.findUniqueOrThrow({ where: { visitId: v.id } }) };
  }
  const a = await make([amelia.id, other.id], 0, 70);
  const b = await make([amelia.id], 1, 40);
  const c = high ? await make([amelia.id], 0, 100, high) : null;
  await make([], 2, 50);
  const coord = await ctx("coordinator@care-solution.demo");
  await assignCoordinator(coord, a.c.id, coord.userId);
  const out = { doubleUp: a.c.id, awaiting: b.c.id, high: c?.c.id, amelia: amelia.id };
  writeFileSync(IDS, JSON.stringify(out));
  console.log(JSON.stringify(out));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { closeCandidate, createCandidate, giveScreening, makeOffer, recordOfferResponse, recordScreeningAnswers, reviewScreening, scheduleInterview, updateInterview } from "@/server/recruitment/candidates";
import { startOnboarding } from "@/server/recruitment/onboarding";

/**
 * Fictional demonstration candidates for the demo organisation, created through the real recruitment services so every
 * record, history event and HR employee is exactly what the screens would create. Runs only when the organisation has
 * no candidates yet. Every name is invented; the source field says "Demonstration".
 */
export async function seedRecruitmentDemo(organisationId: string, managerUserId: string) {
  if (await db.candidate.count({ where: { organisationId } })) return 0;
  const m = await db.membership.findFirst({ where: { organisationId, userId: managerUserId }, include: { user: true } });
  if (!m?.hrUserId) return 0;
  const ctx: Ctx = { userId: m.userId, userName: m.user.name, organisationId, branchId: m.branchId, branchIds: null, orgRoles: m.roles, platformRoles: [], hrUserId: m.hrUserId };
  const branches = await db.branch.findMany({ where: { organisationId, hrBranchKey: { not: null } }, orderBy: { name: "asc" } });
  if (!branches.length) return 0;
  const recruiters = await db.membership.findMany({ where: { organisationId, hrUserId: { not: null }, deactivatedAt: null }, select: { userId: true } });
  const pick = <T,>(xs: T[], n: number) => xs[n % xs.length]!;
  const today = londonDate();
  const back = async (id: string, days: number) => {
    const at = new Date(Date.now() - days * 86_400_000);
    await db.candidate.update({ where: { id }, data: { createdAt: at, stageChangedAt: at } });
  };

  const make = async (n: number, first: string, last: string, extra: Record<string, unknown> = {}) =>
    createCandidate(ctx, {
      firstName: first,
      lastName: last,
      email: `${first}.${last}@example.test`.toLowerCase(),
      phone: `07700 900${String(100 + n).slice(-3)}`,
      roleApplied: "Care Support Worker",
      branchId: pick(branches, n).id,
      availability: pick(["Weekdays 7am to 3pm", "Evenings and weekends", "Full time, any shift", "Mornings only, alternate weekends"], n),
      experience: pick(["Two years in a residential home", "Cared for a family member; no paid experience", "Healthcare assistant on a hospital ward for a year", "New to care"], n),
      driving: pick(["DRIVER_WITH_CAR", "DRIVER_WITH_CAR", "NON_DRIVER", "DRIVER_NO_CAR"], n),
      rightToWork: "NOT_CHECKED",
      source: "Demonstration",
      outstandingDocuments: ["Proof of identity", "Right to work document", "Two references", "DBS application"],
      recruiterId: pick(recruiters, n).userId,
      contactConsent: true,
      ...extra,
    });
  const lv = async (id: string) => (await db.candidate.findUniqueOrThrow({ where: { id } })).lockVersion;
  const interviewer = pick(recruiters, 0).userId;

  // Applied.
  const a1 = await make(1, "Priya", "Natarajan", { applicationComplete: false, outstandingDocuments: ["Proof of identity", "Two references"] });
  await back(a1.id, 4);
  const a2 = await make(2, "Tom", "Okafor");
  await back(a2.id, 1);
  const a3 = await make(3, "Bethany", "Shah");

  // Screening: questions given four days ago and not answered; another answered and waiting for review.
  const s1 = await make(4, "Leah", "Brennan");
  await giveScreening(ctx, s1.id, "PHONE");
  await db.candidateScreening.updateMany({ where: { candidateId: s1.id }, data: { sentAt: new Date(Date.now() - 4 * 86_400_000) } });
  await back(s1.id, 6);
  const s2 = await make(5, "Marcus", "Webb");
  await giveScreening(ctx, s2.id, "IN_PERSON");
  const sc2 = await db.candidateScreening.findFirstOrThrow({ where: { candidateId: s2.id } });
  await recordScreeningAnswers(ctx, sc2.id, { experience: "Eighteen months as a home carer with another agency.", availability: "Monday to Friday, some weekends.", travel: "Own car.", start: "Two weeks' notice.", why: "I enjoy helping people stay at home." });

  // Interview: one tomorrow awaiting confirmation, one confirmed in three days.
  const i1 = await make(6, "Sofia", "Marin", { rightToWork: "IN_PROGRESS" });
  await scheduleInterview(ctx, i1.id, { date: addDays(today, 1), time: "11:00", durationMin: 45, location: "Branch office", interviewerId: interviewer });
  const i2 = await make(7, "Daniel", "Hughes", { rightToWork: "VERIFIED" });
  await giveScreening(ctx, i2.id, "PHONE");
  const sc3 = await db.candidateScreening.findFirstOrThrow({ where: { candidateId: i2.id } });
  await recordScreeningAnswers(ctx, sc3.id, { experience: "Support worker in supported living for three years.", availability: "Full time.", travel: "Drives.", start: "Immediately.", why: "Looking for more one-to-one care." });
  await reviewScreening(ctx, sc3.id, "PROCEED", "Good fit for the round.");
  await scheduleInterview(ctx, i2.id, { date: addDays(today, 3), time: "14:30", durationMin: 45, location: "Video call", interviewerId: interviewer });
  await updateInterview(ctx, (await db.candidateInterview.findFirstOrThrow({ where: { candidateId: i2.id } })).id, { action: "confirm" });

  // Passed interviews (held two days ago), then offers.
  const passed = async (id: string, note: string) => {
    await scheduleInterview(ctx, id, { date: addDays(today, 1), time: "09:30", durationMin: 45, location: "Branch office", interviewerId: interviewer });
    const iv = await db.candidateInterview.findFirstOrThrow({ where: { candidateId: id } });
    await db.candidateInterview.update({ where: { id: iv.id }, data: { startsAt: new Date(Date.now() - 2 * 86_400_000), status: "CONFIRMED", confirmedAt: new Date(Date.now() - 3 * 86_400_000) } });
    await updateInterview(ctx, iv.id, { action: "outcome", outcome: "PASSED", notes: note });
  };
  const o1 = await make(8, "Grace", "Adeyemi", { rightToWork: "VERIFIED" });
  await passed(o1.id, "Warm and clear about boundaries. Good answers on safeguarding.");
  await makeOffer(ctx, o1.id, await lv(o1.id));

  const o2 = await make(9, "Ryan", "Patel", { rightToWork: "VERIFIED", outstandingDocuments: ["Two references"] });
  await passed(o2.id, "Experienced; happy to work weekends.");
  await makeOffer(ctx, o2.id, await lv(o2.id));
  await recordOfferResponse(ctx, o2.id, await lv(o2.id), "ACCEPTED");

  // Onboarding: an employee created in HR as a New starter through the real authorisation step.
  const on1 = await make(10, "Ellie", "Carter", { rightToWork: "VERIFIED", outstandingDocuments: ["Two references", "DBS application"], branchId: branches[0]!.id });
  await passed(on1.id, "Strong candidate; completed the Care Certificate last year.");
  await makeOffer(ctx, on1.id, await lv(on1.id));
  await recordOfferResponse(ctx, on1.id, await lv(on1.id), "ACCEPTED");
  await startOnboarding(ctx, on1.id, { mode: "create", staffId: "NS-DEMO-01", start: addDays(today, 10), lockVersion: await lv(on1.id) });
  await db.candidate.update({ where: { id: on1.id }, data: { stageChangedAt: new Date(Date.now() - 6 * 86_400_000) } });

  // Closed.
  const c1 = await make(11, "Hannah", "Moore");
  await closeCandidate(ctx, c1.id, await lv(c1.id), { outcome: "UNSUCCESSFUL", reason: "Could not offer the hours the candidate needed" });
  const c2 = await make(12, "Jack", "Turner");
  await closeCandidate(ctx, c2.id, await lv(c2.id), { outcome: "WITHDRAWN", reason: "Accepted a job elsewhere" });

  void a3;
  return db.candidate.count({ where: { organisationId } });
}

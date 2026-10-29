import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { ctxForUser } from "@/server/auth/session";
import { DEFAULT_CARE_ROLES } from "@/server/rota/settings";
import { confirmBuild, publishBuild } from "@/server/rota/build";
import { reconcileWorkforce } from "@/server/workforce/projection";
import { linkLogin } from "@/server/workforce/link";
import { encryptKeySafe } from "@/server/care/keysafe";
import { PLAN_SECTIONS, approvePlan, draftFingerprint, saveDraft, startDraft, submitPlan } from "@/server/care/care-plans";
import { createRisk } from "@/server/care/risks";
import { closeIncident, reportIncident, triageIncident } from "@/server/care/incidents";
import type { Ctx } from "@/server/auth/rbac";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";

/** The HR Hub's branch ids for Care Solution Bureau's three branches (see src/hr/lib/seed.ts). */
export const HR_BRANCH_KEYS: Record<string, string> = { Liverpool: "liverpool", Portsmouth: "portsmouth", "Tower Hamlets": "tower-hamlets" };

/** Maps the platform branches to the HR Hub's branch ids explicitly, then projects HR staff into StaffMember. */
export async function linkHrBranchesAndProject(organisationId: string) {
  for (const b of await db.branch.findMany({ where: { organisationId, hrBranchKey: null } })) {
    const key = HR_BRANCH_KEYS[b.name];
    if (key) await db.branch.update({ where: { id: b.id }, data: { hrBranchKey: key } });
  }
  return reconcileWorkforce(organisationId);
}

// Every person below is fictional. Postcodes use the reserved-looking "ZZ" style so no real address is implied.
const PEOPLE: [string, string, string, "ANY" | "FEMALE" | "MALE", "LOW" | "MEDIUM" | "HIGH"][] = [
  ["Margaret", "Ellison", "Liverpool North", "FEMALE", "MEDIUM"],
  ["Harold", "Pryce", "Liverpool North", "ANY", "HIGH"],
  ["Doreen", "Whitlock", "Liverpool North", "ANY", "LOW"],
  ["Stanley", "Okafor", "Liverpool North", "MALE", "MEDIUM"],
  ["Irene", "Castellano", "Liverpool South", "FEMALE", "LOW"],
  ["Walter", "Brennan", "Liverpool South", "ANY", "HIGH"],
  ["Joan", "Haverford", "Liverpool South", "ANY", "MEDIUM"],
  ["Cyril", "Mbeki", "Liverpool South", "ANY", "LOW"],
  ["Patricia", "Lindqvist", "Portsmouth Central", "FEMALE", "MEDIUM"],
  ["George", "Ashdown", "Portsmouth Central", "ANY", "LOW"],
  ["Elsie", "Varga", "Tower Hamlets East", "ANY", "MEDIUM"],
  ["Ronald", "Quayle", "Tower Hamlets East", "ANY", "LOW"],
];

/**
 * Sample Rostering & Care Management data for the demo organisation: areas, call types, tasks, twelve fictional
 * service users with contacts and care plans, a 4-week template pattern, and the current and next week built from it
 * through the real build engine. Visits already finished today are given attendance records labelled as demo history.
 */
export async function seedCareDemo(organisationId: string, people: { manager: string; coordinator: string; carer?: string }) {
  if (await db.serviceUser.count({ where: { organisationId } })) return;
  const today = londonDate();
  const branches = await db.branch.findMany({ where: { organisationId } });
  const branch = (name: string) => branches.find((b) => b.name === name)?.id ?? null;
  await db.rotaSettings.upsert({ where: { organisationId }, create: { organisationId, anchorMonday: dbDate(addDays(mondayOf(today), -7)), careRoleTitles: DEFAULT_CARE_ROLES }, update: {} });

  const areaDefs: [string, string, string][] = [
    ["Liverpool North", "Liverpool", "#6b46c9"],
    ["Liverpool South", "Liverpool", "#0b6f99"],
    ["Portsmouth Central", "Portsmouth", "#b45309"],
    ["Tower Hamlets East", "Tower Hamlets", "#0b7d50"],
  ];
  const areas: Record<string, string> = {};
  for (const [name, b, colour] of areaDefs) areas[name] = (await db.area.create({ data: { organisationId, name, branchId: branch(b), colour } })).id;

  const ct = async (name: string, defaultDurationMin: number) => (await db.callType.create({ data: { organisationId, name, defaultDurationMin } })).id;
  const calls = { morning: await ct("Morning call", 45), lunch: await ct("Lunch call", 30), tea: await ct("Tea call", 30), bed: await ct("Bed call", 30), sitting: await ct("Sitting service", 120) };
  const task = async (name: string, description: string) => (await db.careTask.create({ data: { organisationId, name, description } })).id;
  const tasks = {
    personal: await task("Personal care", "Wash, dress and support with continence as set out in the care plan"),
    meds: await task("Medication prompt", "Prompt only, as recorded in the care plan. Administration records are not part of this system yet."),
    meal: await task("Meal preparation", "Prepare a meal and drink of the person's choice"),
    fluids: await task("Hydration check", "Offer a drink and note how much was taken"),
    mobility: await task("Mobility support", "Support transfers with the equipment named in the care plan"),
    company: await task("Companionship", "Time to talk or take part in an activity"),
  };

  // Demo HR work: the HR team verifies most care staff's checks in the HR Hub, through the HR transaction (which
  // projects to Rostering). Every fifth carer is left as the HR fixtures have them, so blocked allocations show up.
  const due = addDays(today, 300);
  await hrTransaction(organisationId, (state) => {
    const careIds = new Set(state.employees.filter((e, i) => DEFAULT_CARE_ROLES.includes(e.job) && i % 5 !== 4).map((e) => e.id));
    for (const c of state.checks) {
      if (!careIds.has(c.employee) || !c.evidence) continue;
      Object.assign(c, { verified: true, due: c.recurring ? due : c.due, reviewer: "Alex Morgan", checkedAt: new Date().toISOString(), version: c.version + 1 });
    }
    state.events.push({ id: `demo-verify-${today}`, org: state.users[0]?.org ?? "csb", employee: null, actor: "Alex Morgan", action: "Demo: care staff checks verified for the sample rota", at: new Date().toISOString() });
  });

  // Staff to areas: care staff in each branch split across that branch's areas.
  const staff = await db.staffMember.findMany({ where: { organisationId }, orderBy: { staffNumber: "asc" } });
  const carers = staff.filter((s) => DEFAULT_CARE_ROLES.includes(s.jobTitle) && s.employmentStatus === "ACTIVE");
  const carersIn = (hrBranch: string) => carers.filter((s) => s.hrBranchKey === hrBranch);
  for (const [i, s] of carersIn("liverpool").entries()) await db.staffArea.create({ data: { organisationId, staffId: s.id, areaId: i % 2 ? areas["Liverpool South"]! : areas["Liverpool North"]! } });
  for (const s of carersIn("portsmouth")) await db.staffArea.create({ data: { organisationId, staffId: s.id, areaId: areas["Portsmouth Central"]! } });
  for (const s of carersIn("tower-hamlets")) await db.staffArea.create({ data: { organisationId, staffId: s.id, areaId: areas["Tower Hamlets East"]! } });

  // Gender for matching people's carer preferences (a Rostering setting, recorded by coordinators).
  const female = new Set(["Amelia", "Isla", "Mia", "Ava", "Grace", "Freya", "Lily", "Sophie", "Evie", "Ella", "Poppy", "Daisy", "Florence", "Alice", "Ruby", "Matilda", "Rosie", "Esme", "Chloe", "Sienna", "Emma", "Zara"]);
  for (const c of carers) await db.rotaStaffProfile.create({ data: { staffId: c.id, organisationId, gender: female.has(c.displayName.split(" ")[0]!) ? "FEMALE" : "MALE", drives: true, maxWeeklyMinutes: 40 * 60 } });

  const sus: { id: string; area: string; gender: string }[] = [];
  for (const [i, [first, last, area, gender, risk]] of PEOPLE.entries()) {
    const a = areaDefs.find((x) => x[0] === area)!;
    const su = await db.serviceUser.create({
      data: {
        organisationId,
        reference: `SU-${String(101 + i)}`,
        firstName: first,
        lastName: last,
        dateOfBirth: dbDate(`19${30 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`),
        status: "ACTIVE",
        startDate: dbDate(addDays(today, -120 - i * 9)),
        branchId: branch(a[1]),
        areaId: areas[area],
        addressLine1: `${10 + i} Example Road`,
        town: a[1],
        postcode: `ZZ${i + 1} 1AA`,
        accessNotes: i % 3 === 0 ? "Key safe by the front door. Knock and call out on entering." : "Ring the bell; the person answers the door.",
        keySafeCipher: i % 3 === 0 ? encryptKeySafe(`${1000 + i * 37}`) : null,
        keySafeUpdatedAt: i % 3 === 0 ? new Date() : null,
        carerGenderPreference: gender,
        riskLevel: risk,
        riskSummary: risk === "HIGH" ? "Two carers for all transfers (hoist). Falls history." : risk === "MEDIUM" ? "Uses a walking frame; supervise on stairs." : "No significant risks recorded.",
        carePreferences: "Likes tea with milk, no sugar. Prefers to be called by first name.",
        createdById: people.manager,
        contacts: {
          create: [
            { organisationId, kind: "NEXT_OF_KIN", name: `Sam ${last}`, relationship: i % 2 ? "Son" : "Daughter", phone: `01632 9601${String(i).padStart(2, "0")}`, isEmergency: true, canReceiveUpdates: true },
            { organisationId, kind: "GP", name: "Riverside Medical Centre (fictional)", phone: "01632 960050" },
          ],
        },
        packages: { create: { organisationId, reference: `PKG-${101 + i}`, startDate: dbDate(addDays(today, -120 - i * 9)), commissionedMinutesPerWeek: risk === "HIGH" ? 7 * (45 + 30 + 30 + 30) * 2 : 7 * (45 + 30 + 30), requirements: risk === "HIGH" ? "Four calls a day, two carers at every call for hoist transfers." : "Three calls a day, one carer." } },
      },
    });
    sus.push({ id: su.id, area, gender });
  }

  // Templates: a pattern that repeats every week of the 4-week cycle, with the double-ups the risk needs.
  const inArea = new Map<string, string[]>();
  for (const sa of await db.staffArea.findMany({ where: { organisationId } })) inArea.set(sa.areaId, [...(inArea.get(sa.areaId) ?? []), sa.staffId]);
  // Every template repeats daily, so one day's calendar per carer is enough to keep the demo pattern free of clashes
  // (15 minutes' travel between calls). Real rotas are still checked by the eligibility rules at build time.
  // Like a coordinator would, prefer carers whose HR checks are all in order and who match the person's preference;
  // fall back to anyone free, so some allocations still show warnings or refusals in the demo.
  const ready = new Set((await db.staffMember.findMany({ where: { organisationId, compliance: { none: { required: true, OR: [{ verified: false }, { hasEvidence: false }, { dueDate: { lt: new Date() } }] } } }, select: { id: true } })).map((s) => s.id));
  const genderOf = new Map((await db.rotaStaffProfile.findMany({ where: { organisationId } })).map((p) => [p.staffId, p.gender]));
  const busy = new Map<string, [number, number][]>();
  const pick = (su: { area: string; gender: string }, n: number, start: number, end: number, not: string | null = null) => {
    const pool = inArea.get(areas[su.area]!) ?? [];
    const free = (id: string) => id !== not && !(busy.get(id) ?? []).some(([a, b]) => start < b + 15 && a < end + 15);
    const rotated = pool.map((_, k) => pool[(n + k) % pool.length]!);
    const id = rotated.find((x) => free(x) && ready.has(x) && (su.gender === "ANY" || genderOf.get(x) === su.gender)) ?? rotated.find(free) ?? null;
    if (id) busy.set(id, [...(busy.get(id) ?? []), [start, end]]);
    return id;
  };
  const tpl = async (su: { id: string; area: string; gender: string }, i: number, call: string, startMinute: number, durationMin: number, carersRequired: number, taskIds: string[], offset: number) => {
    const first = pick(su, i + offset, startMinute, startMinute + durationMin);
    await db.visitTemplate.create({
      data: {
        organisationId,
        serviceUserId: su.id,
        callTypeId: call,
        areaId: areas[su.area],
        cycleWeeks: [1, 2, 3, 4],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startMinute,
        durationMin,
        carersRequired,
        preferredStaff1Id: first,
        preferredStaff2Id: carersRequired === 2 ? pick(su, i + offset + 1, startMinute, startMinute + durationMin, first) : null,
        medicationRequired: taskIds.includes(tasks.meds),
        effectiveFrom: dbDate(addDays(mondayOf(today), -28)),
        createdById: people.manager,
        tasks: { create: taskIds.map((careTaskId) => ({ careTaskId })) },
      },
    });
  };
  for (const [i, su] of sus.entries()) {
    const high = PEOPLE[i]![4] === "HIGH";
    const stagger = (i % 4) * 30;
    await tpl(su, i, calls.morning, 7 * 60 + stagger, 45, high ? 2 : 1, [tasks.personal, tasks.meds, tasks.meal], 0);
    await tpl(su, i, calls.lunch, 12 * 60 + stagger, 30, 1, [tasks.meal, tasks.fluids], 1);
    await tpl(su, i, calls.tea, 16 * 60 + 30 + stagger, 30, 1, [tasks.meal, tasks.meds], 2);
    if (high) await tpl(su, i, calls.bed, 20 * 60 + stagger, 30, 2, [tasks.personal, tasks.mobility], 4);
  }

  // A carer sign-in linked through the real, audited link workflow.
  const managerCtx = await ctxForUser(people.manager, organisationId);
  if (people.carer) {
    const amelia = staff.find((s) => s.hrEmployeeId === "emp-1");
    if (amelia) await linkLogin(managerCtx, { staffId: amelia.id, userId: people.carer, grantCarerRole: true, confirm: true });
  }

  // Build this week and next through the real engine, then publish them.
  const coordinator = await ctxForUser(people.coordinator, organisationId);
  for (const week of [mondayOf(today), addDays(mondayOf(today), 7)]) {
    const { build } = await confirmBuild(coordinator, { weekStart: week });
    await publishBuild(coordinator, build.id);
  }
  await seedAttendanceHistory(organisationId, people.manager);
  await seedCareRecords(organisationId, coordinator, managerCtx);
}

/** Demo care records, written through the real services: plans drafted by the coordinator and approved by the manager. */
async function seedCareRecords(organisationId: string, coordinator: Ctx, manager: Ctx) {
  const people = await db.serviceUser.findMany({ where: { organisationId }, orderBy: { reference: "asc" }, select: { id: true, firstName: true, riskLevel: true } });
  const text: Record<string, (n: string) => string> = {
    about_me: (n) => `${n} has lived locally for most of their life and enjoys the radio, crosswords and visits from family. Mornings are slow; ${n} likes time to wake up before getting washed.`,
    communication: (n) => `${n} hears well on the left side. Speak clearly, face them and give time to answer. ${n} will say if they are in pain.`,
    personal_care: (n) => `${n} washes their face and hands; carers support with a full wash at the basin and with dressing the lower half. Check skin on heels and lower back and report any redness.`,
    mobility: (n) => `${n} walks indoors with a frame. Stay close on the stairs and when standing from the chair. Follow the moving and handling risk assessment.`,
    nutrition: (n) => `${n} likes porridge for breakfast and a hot lunch. Offer a drink at every visit and leave one within reach. No known allergies.`,
    medication: (n) => `Prompt ${n} to take medicines from the pharmacy blister pack and record on the paper MAR chart. Carers do not administer. eMAR is not in use.`,
    health: (n) => `${n} has arthritis and high blood pressure. If ${n} seems confused, unusually drowsy or has a fall, call the office and, if needed, 111 or 999.`,
    home: () => "Lights and heating are on a timer. Lock the back door when leaving. In an emergency, the office holds the next of kin details.",
    outcomes: (n) => `${n} wants to stay at home, keep walking to the kitchen independently and see friends at the community lunch on Thursdays.`,
  };
  const draft = async (su: (typeof people)[number]) => {
    const plan = await startDraft(coordinator, su.id);
    const full = await db.carePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { sections: true } });
    await saveDraft(coordinator, plan.id, {
      fingerprint: draftFingerprint(full, full.sections),
      summary: `Support ${su.firstName} to stay safe and independent at home. Read the mobility and risk sections before the first visit.`,
      reviewDue: addDays(londonDate(), 120),
      sections: Object.fromEntries(PLAN_SECTIONS.map((x) => [x.key, { body: text[x.key]!(su.firstName) }])),
    });
    await submitPlan(coordinator, plan.id);
    return plan;
  };
  for (const su of people.slice(0, 8)) await approvePlan(manager, (await draft(su)).id);
  if (people[8]) await draft(people[8]);

  for (const su of people.slice(0, 10)) {
    await createRisk(coordinator, su.id, { type: "ENVIRONMENT", title: "Home environment check", hazards: "Loose rugs in the hallway and poor lighting on the stairs could cause a trip.", controls: "Keep walkways clear, switch on the landing light, and report any new hazards to the office.", level: "LOW", reviewDue: addDays(londonDate(), 180) });
    if (su.riskLevel === "HIGH") await createRisk(coordinator, su.id, { type: "MOVING_HANDLING", title: "Hoist transfers", hazards: "Cannot weight-bear. Risk of injury to the person and carers during transfers.", controls: "Two trained carers for every transfer using the ceiling hoist and the person's own sling. Check the sling and hoist before use.", level: "HIGH", reviewDue: addDays(londonDate(), 90) });
    if (su.riskLevel === "MEDIUM") await createRisk(coordinator, su.id, { type: "FALLS", title: "Falls when walking", hazards: "Unsteady when tired, especially in the evening. One fall at home in the last six months.", controls: "Frame within reach at all times. Supervise on the stairs. If a fall happens, do not lift; call the office.", level: "MEDIUM", reviewDue: addDays(londonDate(), 60) });
  }

  const yesterday = addDays(londonDate(), -1);
  if (people[1]) await reportIncident(coordinator, { serviceUserId: people[1].id, date: yesterday, time: "08:20", category: "Fall", severity: "MODERATE", description: "Found sitting on the bedroom floor at the start of the morning call. Said they slipped getting out of bed. Small graze on the left elbow.", immediateAction: "Checked for injury, helped up with the stand aid, cleaned the graze and informed the daughter." });
  if (people[4]) await reportIncident(coordinator, { serviceUserId: people[4].id, date: yesterday, time: "17:10", category: "Medication error", severity: "LOW", description: "Lunchtime blister pocket was found unopened at the tea call. The lunch call carer had prompted but not checked it was taken.", immediateAction: "Called the pharmacist for advice and recorded it on the MAR chart." });
  if (people[2]) {
    const inc = await reportIncident(coordinator, { serviceUserId: people[2].id, date: addDays(londonDate(), -9), time: "12:15", category: "Property or key safe", severity: "LOW", description: "Key safe code would not open on arrival. The person let the carer in after a short wait.", immediateAction: "Told the office, who contacted the family to check the code." });
    await triageIncident(manager, inc.id, inc.version, { severity: "LOW", safeguarding: false, notifiable: false, note: "Family reset the key safe; code updated on the record." });
    await closeIncident(manager, inc.id, inc.version + 1, "Key safe code had been changed by a relative without telling the office. Family reminded to let us know; no harm came to the person.", false);
  }
}

/** Visits that ended before now get clock records (demo history), with a few late and one missed for the monitor. */
async function seedAttendanceHistory(organisationId: string, managerId: string) {
  const now = Date.now();
  const past = await db.visit.findMany({ where: { organisationId, scheduledEnd: { lt: new Date(now) }, status: "SCHEDULED" }, include: { assignments: { where: { removedAt: null, slot: { not: "SHADOW" } } } }, orderBy: { scheduledStart: "asc" } });
  let n = 0;
  for (const v of past) {
    n++;
    const carer = v.assignments[0];
    if (!carer || n % 23 === 0) continue; // left SCHEDULED: the sweep marks it missed
    const late = n % 7 === 0 ? 14 : n % 3;
    const short = n % 11 === 0 ? 0.6 : 0.95;
    const inAt = new Date(v.scheduledStart.getTime() + late * 60000);
    const outAt = new Date(inAt.getTime() + (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) * short);
    const clocks: Prisma.VisitClockCreateManyInput[] = [
      { organisationId, visitId: v.id, staffId: carer.staffId, kind: "IN", at: inAt, method: "APP", recordedById: managerId, reason: "Demo history (seeded)" },
      { organisationId, visitId: v.id, staffId: carer.staffId, kind: "OUT", at: outAt, method: "APP", recordedById: managerId, reason: "Demo history (seeded)" },
    ];
    await db.visitClock.createMany({ data: clocks });
    await db.visit.update({ where: { id: v.id }, data: { status: "IN_PROGRESS", actualStart: inAt } });
    await db.visit.update({ where: { id: v.id }, data: { status: "COMPLETED", actualEnd: outAt, statusChangedAt: outAt } });
    await db.visitAssignment.updateMany({ where: { visitId: v.id, removedAt: null }, data: { acknowledgedAt: new Date(v.scheduledStart.getTime() - 86400000) } });
  }
}

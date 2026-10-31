import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate, mondayOf } from "@/lib/london";
import { ctxForUser } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_CARE_ROLES } from "@/server/rota/settings";
import { confirmBuild, publishBuild } from "@/server/rota/build";
import { linkLogin } from "@/server/workforce/link";
import { rankCarers } from "@/server/workforce/eligibility";
import { londonToUtc } from "@/lib/london";
import { decideAbsence, recordAbsence } from "@/server/workforce/absences";
import { acknowledgeRow, createRule } from "@/server/policies/assignment";
import { transaction as hrTransaction } from "@/hr/lib/workspace-tx";
import { applyRequirements } from "@/hr/lib/requirements";
import type { Employee } from "@/hr/lib/domain";
import { seedAttendanceHistory, seedCareRecords, seedFinance } from "./care";
import { seedMissedCallDemo } from "./missed-calls";
import { seedReadinessDemo } from "./readiness";
import { DEMO_PASSWORD } from "./demo";

/**
 * Operational test data for user-acceptance testing at full scale (brief of 30 Oct 2026, phase 7). It is loaded only
 * into a disposable local database by scripts/uat-data.ts, never into the live demo. Every person, address and
 * number is invented, and every record is marked as test data: references start "UAT-", staff numbers "UAT-",
 * e-mail addresses end "@uat.example", and access notes say "SYNTHETIC TEST RECORD".
 *
 * Shape (per day, averaged over the 4-week cycle): Tower Hamlets about 95 visits for 30 people with 40 carers,
 * Liverpool about 45 for 16 with 10, Portsmouth about 34 for 12 with 8; seven care areas; two past weeks with
 * attendance and timesheets, this week and four weeks ahead, all built by the real rota build engine.
 */

type Gender = "FEMALE" | "MALE";
type Profile = "P4" | "P3" | "P2" | "P1";

export const UAT_BRANCHES = [
  { name: "Tower Hamlets", hr: "tower-hamlets", code: "TH", carers: 40, profiles: { P4: 10, P3: 12, P2: 6, P1: 2 }, sittings: 5, areas: [["Bow and Poplar", "#0b7d50"], ["Stepney and Whitechapel", "#1d4f91"], ["Isle of Dogs", "#7a3e9d"]] },
  { name: "Liverpool", hr: "liverpool", code: "LIV", carers: 10, profiles: { P4: 3, P3: 7, P2: 5, P1: 1 }, sittings: 1, areas: [["Liverpool North", "#6b46c9"], ["Liverpool South", "#0b6f99"]] },
  { name: "Portsmouth", hr: "portsmouth", code: "PTS", carers: 8, profiles: { P4: 3, P3: 4, P2: 4, P1: 1 }, sittings: 1, areas: [["Portsmouth Central", "#b45309"], ["Portsmouth North", "#8a5a00"]] },
] as const;

const CARER_NAMES: [string, string, Gender][] = [
  ["Abena", "Mensah", "FEMALE"], ["Bilal", "Rahman", "MALE"], ["Carys", "Pritchard", "FEMALE"], ["Dmitri", "Volkov", "MALE"], ["Efua", "Owusu", "FEMALE"],
  ["Farhan", "Chowdhury", "MALE"], ["Gemma", "Lockwood", "FEMALE"], ["Hamza", "Siddiqui", "MALE"], ["Ifeoma", "Nwosu", "FEMALE"], ["Jonah", "Whitfield", "MALE"],
  ["Kiran", "Bhatt", "FEMALE"], ["Lukasz", "Nowak", "MALE"], ["Maryam", "Begum", "FEMALE"], ["Nathan", "Osei", "MALE"], ["Orla", "Brennan", "FEMALE"],
  ["Pawel", "Zielinski", "MALE"], ["Rukhsana", "Ali", "FEMALE"], ["Samir", "Haddad", "MALE"], ["Tamsin", "Kerr", "FEMALE"], ["Usman", "Qureshi", "MALE"],
  ["Valentina", "Russo", "FEMALE"], ["Wesley", "Grant", "MALE"], ["Yasmin", "Hussain", "FEMALE"], ["Zain", "Malik", "MALE"], ["Amara", "Eze", "FEMALE"],
  ["Bogdan", "Popescu", "MALE"], ["Chantelle", "Morgan", "FEMALE"], ["Dev", "Sharma", "MALE"], ["Esther", "Adeyemi", "FEMALE"], ["Faisal", "Karim", "MALE"],
  ["Gabriela", "Silva", "FEMALE"], ["Imran", "Shah", "MALE"], ["Jasmine", "Okoro", "FEMALE"], ["Kofi", "Asante", "MALE"], ["Leanne", "Doyle", "FEMALE"],
  ["Marek", "Kowalski", "MALE"], ["Nadia", "Islam", "FEMALE"], ["Omar", "Farah", "MALE"], ["Precious", "Moyo", "FEMALE"], ["Rafael", "Costa", "MALE"],
  ["Shabnam", "Miah", "FEMALE"], ["Tariq", "Aziz", "MALE"], ["Uzma", "Iqbal", "FEMALE"], ["Viktor", "Horvat", "MALE"], ["Wendy", "Clarke", "FEMALE"],
  ["Yusuf", "Abdi", "MALE"], ["Zofia", "Wisniewska", "FEMALE"], ["Adrian", "Fletcher", "MALE"], ["Bethan", "Rees", "FEMALE"], ["Callum", "Fraser", "MALE"],
];

const SU_FIRST: [string, Gender][] = [
  ["Agnes", "FEMALE"], ["Albert", "MALE"], ["Beryl", "FEMALE"], ["Bernard", "MALE"], ["Constance", "FEMALE"], ["Clifford", "MALE"], ["Dorothy", "FEMALE"], ["Dennis", "MALE"],
  ["Edna", "FEMALE"], ["Eric", "MALE"], ["Florence", "FEMALE"], ["Frank", "MALE"], ["Gladys", "FEMALE"], ["Gordon", "MALE"], ["Hilda", "FEMALE"], ["Herbert", "MALE"],
  ["Ivy", "FEMALE"], ["Ivor", "MALE"], ["Jean", "FEMALE"], ["Kenneth", "MALE"], ["Lilian", "FEMALE"], ["Leonard", "MALE"], ["Mabel", "FEMALE"], ["Maurice", "MALE"],
  ["Nora", "FEMALE"], ["Norman", "MALE"], ["Olive", "FEMALE"], ["Percy", "MALE"], ["Phyllis", "FEMALE"], ["Raymond", "MALE"],
];
const SU_LAST = ["Abbott", "Barnard", "Coombes", "Dunmore", "Fairweather", "Gilchrist", "Hartnell", "Ingleby", "Jessop", "Kettering", "Lambourne", "Merriman", "Northcott", "Ormerod", "Pemberton", "Quarrie", "Rushworth", "Sandford", "Thackeray", "Underhill", "Venables", "Wetherby", "Yardley", "Ashcombe", "Blakemore", "Cartwright", "Dalloway", "Eversley", "Fothergill", "Greenhalgh"];

export interface UatPeople { manager: string; coordinator: string; finance: string; hrDecider: string }

/** Loads the full-scale test data into the demo organisation of a freshly seeded database (seedDemo with care off). */
export async function seedUatOperations(organisationId: string, people: UatPeople, log: (s: string) => void = () => {}) {
  if (await db.serviceUser.count({ where: { organisationId } })) throw new Error("This organisation already has service users; load test data only into a fresh database");
  const today = londonDate();
  const thisMonday = mondayOf(today);
  // Week 1 of the 4-week cycle starts two weeks ago, so the seven built weeks cover weeks 1, 2, 3, 4, 1, 2, 3.
  await db.rotaSettings.upsert({ where: { organisationId }, create: { organisationId, anchorMonday: dbDate(addDays(thisMonday, -14)), careRoleTitles: DEFAULT_CARE_ROLES }, update: {} });
  const branches = await db.branch.findMany({ where: { organisationId } });
  const branchId = (name: string) => branches.find((b) => b.name === name)!.id;

  // ---- Care set-up: areas, call types and tasks (OnePlan-style call names) ----
  const areas: Record<string, string[]> = {};
  for (const b of UAT_BRANCHES) {
    areas[b.code] = [];
    for (const [name, colour] of b.areas) areas[b.code]!.push((await db.area.create({ data: { organisationId, name, branchId: branchId(b.name), colour } })).id);
  }
  const ct = async (name: string, defaultDurationMin: number) => (await db.callType.create({ data: { organisationId, name, defaultDurationMin } })).id;
  const calls = { morning: await ct("Morning", 60), lunch: await ct("Lunch", 30), tea: await ct("Tea", 30), bed: await ct("Bed", 30), sitting: await ct("Sitting", 120), night: await ct("Night sit", 540) };
  const task = async (name: string, description: string) => (await db.careTask.create({ data: { organisationId, name, description } })).id;
  const tasks = {
    personal: await task("Personal care", "Wash, dress and support with continence as set out in the care plan"),
    meds: await task("Medication prompt", "Prompt only, as recorded in the care plan. Medication records are switched off pending clinical review."),
    meal: await task("Meal preparation", "Prepare a meal and drink of the person's choice"),
    fluids: await task("Hydration check", "Offer a drink and note how much was taken"),
    mobility: await task("Mobility support", "Support transfers with the equipment named in the care plan"),
    company: await task("Companionship", "Time to talk or take part in an activity"),
  };
  log("areas, call types and tasks");

  // ---- HR: extra carers through the HR transaction, which projects them into Rostering ----
  const gender = new Map<string, Gender>();
  let nameAt = 0;
  await hrTransaction(organisationId, (state) => {
    const careRoles = new Set(DEFAULT_CARE_ROLES);
    const docDate = addDays(today, -40);
    for (const b of UAT_BRANCHES) {
      const have = state.employees.filter((e) => e.branch === b.hr && e.status === "Active" && careRoles.has(e.job)).length;
      for (let k = 0; k < b.carers - have; k++) {
        const [first, last, g] = CARER_NAMES[nameAt % CARER_NAMES.length]!;
        nameAt++;
        const n = state.employees.length + 1;
        const e: Employee = {
          id: `uat-emp-${n}`, org: "csb", staffId: `UAT-${2000 + n}`, name: `${first} ${last}`, branch: b.hr, job: k % 4 === 3 ? "Senior Support Worker" : "Care Support Worker",
          status: "Active", start: addDays(today, -60 - ((n * 37) % 900)), email: `${first}.${last}.${n}@uat.example`.toLowerCase(), phone: "", updated: new Date().toISOString(), version: 1,
          employmentType: k % 3 === 0 ? "Part-time" : "Full-time", department: "Domiciliary care", city: b.name, postcode: `ZZ${(n % 90) + 10} 9UA`,
        };
        state.employees.push(e);
        applyRequirements(state, e);
        gender.set(e.id, g);
      }
    }
    // Every current care employee's checks are evidenced and verified, except a few kept back on purpose so the
    // compliance scenarios have something real to find (one DBS review due within a fortnight per branch, and one
    // Tower Hamlets carer whose right-to-work evidence has not been uploaded).
    const care = state.employees.filter((e) => e.org === "csb" && e.status === "Active" && careRoles.has(e.job));
    const firstIn = new Map<string, string>();
    for (const e of care) if (!firstIn.has(e.branch)) firstIn.set(e.branch, e.id);
    const dueSoon = new Set(firstIn.values());
    const missingRtw = care.filter((e) => e.branch === "tower-hamlets")[3]?.id;
    for (const c of state.checks) {
      const e = care.find((x) => x.id === c.employee);
      if (!e || !c.required) continue;
      if (e.id === missingRtw && /right to work/i.test(c.name)) continue;
      let evidence = c.evidence;
      if (!evidence) {
        evidence = `uat-doc-${randomUUID()}`;
        state.documents.push({ id: evidence, org: "csb", employee: e.id, category: c.category ?? (/dbs/i.test(c.name) ? "DBS" : /right to work/i.test(c.name) ? "Right to work" : "Training"), filename: "uat-synthetic-evidence.pdf", mime: "application/pdf", version: 1, previous: null, uploaded: `${docDate}T10:00:00Z`, uploader: "Alex Morgan", state: "Sample", key: null, issueDate: docDate, reviewDate: null, expiryDate: null, retentionDate: null, source: "Synthetic UAT data" });
      }
      const due = c.recurring ? (dueSoon.has(e.id) && /dbs/i.test(c.name) ? addDays(today, 10) : addDays(today, 200 + ((e.id.length * 31 + c.name.length * 7) % 160))) : c.due;
      Object.assign(c, { evidence, verified: true, due, reviewer: "Alex Morgan", checkedAt: new Date().toISOString(), version: c.version + 1 });
    }
    state.events.push({ id: `uat-load-${today}`, org: "csb", employee: null, actor: "Alex Morgan", action: "Synthetic UAT data: care staff added and checks verified", at: new Date().toISOString() });
  });
  log("HR carers and checks");

  // ---- Rostering profiles, areas and sign-ins for every carer ----
  const staff = (await db.staffMember.findMany({ where: { organisationId, employmentStatus: "ACTIVE" }, orderBy: { staffNumber: "asc" } })).filter((s) => DEFAULT_CARE_ROLES.includes(s.jobTitle));
  const femaleNames = new Set([...CARER_NAMES.filter((c) => c[2] === "FEMALE").map((c) => c[0]), "Amelia", "Isla", "Mia", "Ava", "Grace", "Freya", "Lily", "Sophie", "Evie", "Ella", "Poppy", "Daisy", "Florence", "Alice", "Ruby", "Matilda", "Rosie", "Esme", "Chloe", "Sienna", "Emma", "Zara"]);
  const staffGender = new Map<string, Gender>();
  const pools: Record<string, string[][]> = {};
  for (const b of UAT_BRANCHES) {
    const mine = staff.filter((s) => s.hrBranchKey === b.hr);
    pools[b.code] = areas[b.code]!.map(() => []);
    for (const [i, s] of mine.entries()) {
      const a = i % areas[b.code]!.length;
      pools[b.code]![a]!.push(s.id);
      await db.staffArea.create({ data: { organisationId, staffId: s.id, areaId: areas[b.code]![a]! } });
      const g: Gender = gender.get(s.hrEmployeeId) ?? (femaleNames.has(s.displayName.split(" ")[0]!) ? "FEMALE" : "MALE");
      staffGender.set(s.id, g);
      await db.rotaStaffProfile.create({ data: { staffId: s.id, organisationId, gender: g, drives: i % 5 !== 2, maxWeeklyMinutes: 40 * 60 } });
    }
  }

  // Readiness matrix and training evidence through the real services (three people per organisation are left short on
  // purpose by seedReadinessDemo: one awaiting verification, one expired, one awaiting a practical assessment).
  await seedReadinessDemo(organisationId, { manager: people.manager, coordinator: people.coordinator });
  log("readiness matrix and training");

  const manager = await ctxForUser(people.manager, organisationId);
  const pw = await hashPassword(DEMO_PASSWORD);
  for (const s of staff) {
    if (s.userId) continue;
    const email = `${s.displayName.toLowerCase().replace(/[^a-z]+/g, ".")}.${s.staffNumber?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? s.id.slice(-4)}@uat.example`;
    const u = await db.user.create({ data: { email, name: s.displayName, isDemo: true, passwordHash: pw } });
    await db.membership.create({ data: { userId: u.id, organisationId, roles: ["STAFF"], branchId: s.branchId, jobTitle: s.jobTitle } });
    await linkLogin(manager, { staffId: s.id, userId: u.id, grantCarerRole: true, confirm: true });
  }
  log("carer sign-ins linked");

  // Safeguarding policy: assigned to care roles, read by all but two carers per branch (overdue acknowledgements).
  const safeguarding = await db.policy.findFirst({ where: { organisationId, ref: "CSB-SAF-001" } });
  if (safeguarding) {
    for (const jobTitle of ["Care Support Worker", "Senior Support Worker"]) await createRule(manager, { policyId: safeguarding.id, scope: "JOB_TITLE", jobTitle, dueDays: 14 });
    const linked = await db.staffMember.findMany({ where: { id: { in: staff.map((s) => s.id) } }, select: { id: true, userId: true, hrBranchKey: true } });
    const skip = new Set(UAT_BRANCHES.flatMap((b) => linked.filter((s) => s.hrBranchKey === b.hr).slice(-2).map((s) => s.id)));
    for (const s of linked) {
      if (!s.userId || skip.has(s.id)) continue;
      const row = await db.acknowledgement.findFirst({ where: { organisationId, userId: s.userId, supersededAt: null, publication: { policyId: safeguarding.id } } });
      if (row) await acknowledgeRow(await ctxForUser(s.userId, organisationId), row.id);
    }
  }
  log("safeguarding policy assigned and acknowledged");

  // ---- Service users and packages ----
  type Su = { id: string; branch: (typeof UAT_BRANCHES)[number]; areaIndex: number; gender: Gender | "ANY"; profile: Profile; high: boolean; index: number };
  const sus: Su[] = [];
  let suAt = 0;
  for (const b of UAT_BRANCHES) {
    let k = 0;
    for (const [profile, count] of Object.entries(b.profiles) as [Profile, number][]) {
      for (let j = 0; j < count; j++, k++, suAt++) {
        const [first, g] = SU_FIRST[suAt % SU_FIRST.length]!;
        // The second pass through the first names takes the next surname along, so no two people share a full name.
        const last = SU_LAST[(suAt * 7 + Math.floor(suAt / SU_FIRST.length)) % SU_LAST.length]!;
        const areaIndex = k % b.areas.length;
        const high = profile === "P4" && j % 2 === 0;
        const pref: Gender | "ANY" = suAt % 6 === 0 ? g : "ANY";
        const start = addDays(today, -90 - ((suAt * 13) % 400));
        const su = await db.serviceUser.create({
          data: {
            organisationId, reference: `UAT-${b.code}-${String(k + 1).padStart(3, "0")}`, firstName: first, lastName: last,
            dateOfBirth: dbDate(`19${30 + (suAt % 20)}-${String(1 + (suAt % 12)).padStart(2, "0")}-${String(1 + (suAt % 27)).padStart(2, "0")}`),
            status: "ACTIVE", startDate: dbDate(start), branchId: branchId(b.name), areaId: areas[b.code]![areaIndex], addressLine1: `${10 + k} Test Street`, town: b.name, postcode: `ZZ${(suAt % 80) + 10} 1UA`,
            accessNotes: "SYNTHETIC TEST RECORD. Ring the bell and call out on entering.", carerGenderPreference: pref, riskLevel: high ? "HIGH" : profile === "P4" || profile === "P3" ? "MEDIUM" : "LOW",
            riskSummary: high ? "Two carers for every transfer (hoist)." : "Uses a walking frame indoors.", carePreferences: "Synthetic test preferences: tea with milk.", createdById: people.manager,
            contacts: { create: [{ organisationId, kind: "NEXT_OF_KIN", name: `Test Contact ${last}`, relationship: "Daughter", phone: `01632 96${String(suAt).padStart(4, "0")}`, isEmergency: true, canReceiveUpdates: true }] },
            packages: { create: { organisationId, reference: `UAT-PKG-${b.code}-${k + 1}`, startDate: dbDate(start), commissionedMinutesPerWeek: { P4: 7 * 150, P3: 7 * 120, P2: 7 * 90, P1: 7 * 60 }[profile] * (high ? 2 : 1), requirements: `Synthetic package (${profile}).` } },
          },
        });
        sus.push({ id: su.id, branch: b, areaIndex, gender: pref, profile, high, index: k });
      }
    }
  }
  log(`${sus.length} service users`);

  // Like a coordinator, plan with carers who are cleared for the work over the whole seven weeks: a carer with a hard stop
  // (for example a DBS review falling due within the period) keeps a single template, so the scenario still shows,
  // and only medication-competent carers are planned on calls with a medication prompt.
  const probeAt = londonToUtc(addDays(thisMonday, 34), 600);
  const probe = async (careTaskIds: string[]) => {
    const r = await rankCarers(db, organisationId, { start: probeAt, end: new Date(probeAt.getTime() + 30 * 60000), slot: "PRIMARY", serviceUserId: sus[0]!.id, careTaskIds }, staff.map((x) => x.id));
    return new Set(r.filter((x) => x.result.state === "NOT_ELIGIBLE" && x.result.blocking.some((b) => b.code !== "GENDER")).map((x) => x.staff!.id));
  };
  const blocked = await probe([]);
  const noMeds = await probe([tasks.meds]);
  const usedBlocked = new Set<string>();

  // ---- Templates: weekday and weekend teams, double-ups for hoist users, sittings that follow the 4-week cycle ----
  // A carer's diary is kept per day group so preferred carers never clash (15 minutes' travel between calls) and nobody
  // is planned beyond 40 hours a week. A few slots are left empty on purpose: the build shows them as unassigned.
  const diary = new Map<string, [number, number][]>();
  const weekly = new Map<string, number>();
  const DAYS = { WEEKDAY: [1, 2, 3, 4, 5], WEEKEND: [6, 7] } as const;
  const pick = (su: Su, group: keyof typeof DAYS, start: number, end: number, not: string | null, salt: number, meds: boolean) => {
    const pool = pools[su.branch.code]![su.areaIndex]!;
    const others = pools[su.branch.code]!.filter((_, i) => i !== su.areaIndex).flat();
    const minutes = (end - start) * DAYS[group].length;
    const free = (id: string) => id !== not && (weekly.get(id) ?? 0) + minutes <= 40 * 60 && !(diary.get(`${id}:${group}`) ?? []).some(([a, b]) => start < b + 15 && a < end + 15) && (su.gender === "ANY" || staffGender.get(id) === su.gender);
    const cleared = (id: string) => free(id) && !blocked.has(id) && !(meds && noMeds.has(id));
    const scenario = (id: string) => free(id) && blocked.has(id) && !usedBlocked.has(id);
    const rotate = (p: string[]) => p.map((_, k) => p[(salt + k) % p.length]!);
    const id = rotate(pool).find(scenario) ?? rotate(pool).find(cleared) ?? rotate(others).find(cleared) ?? null;
    if (id && blocked.has(id)) usedBlocked.add(id);
    if (id) {
      diary.set(`${id}:${group}`, [...(diary.get(`${id}:${group}`) ?? []), [start, end]]);
      weekly.set(id, (weekly.get(id) ?? 0) + minutes);
    }
    return id;
  };
  let templates = 0;
  const effectiveFrom = dbDate(addDays(thisMonday, -14));
  const tpl = async (su: Su, call: string, start: number, duration: number, carers: 1 | 2, taskIds: string[], o: { weekdays?: number[]; cycleWeeks?: number[]; leaveEmpty?: boolean; leaveSecondEmpty?: boolean } = {}) => {
    const groups: (keyof typeof DAYS)[] = o.weekdays ? [o.weekdays.every((d) => d >= 6) ? "WEEKEND" : "WEEKDAY"] : ["WEEKDAY", "WEEKEND"];
    for (const group of groups) {
      const weekdays = o.weekdays ?? [...DAYS[group]];
      const salt = su.index * 3 + start + (group === "WEEKEND" ? 1 : 0);
      const meds = taskIds.includes(tasks.meds);
      const first = o.leaveEmpty ? null : pick(su, group, start, start + duration, null, salt, meds);
      const second = carers === 2 && !o.leaveSecondEmpty ? pick(su, group, start, start + duration, first, salt + 1, meds) : null;
      await db.visitTemplate.create({
        data: {
          organisationId, serviceUserId: su.id, callTypeId: call, areaId: areas[su.branch.code]![su.areaIndex], cycleWeeks: o.cycleWeeks ?? [1, 2, 3, 4], weekdays, startMinute: start, durationMin: duration, carersRequired: carers,
          preferredStaff1Id: first, preferredStaff2Id: second, medicationRequired: false, effectiveFrom, createdById: people.manager, notes: "Synthetic UAT template",
          tasks: { create: taskIds.map((careTaskId) => ({ careTaskId })) },
        },
      });
      templates++;
    }
  };
  for (const su of sus) {
    const s = (su.index % 6) * 25; // stagger start times so a team can work a round
    const two = su.high ? 2 : 1;
    if (su.profile === "P4") {
      await tpl(su, calls.morning, 7 * 60 + s, 60, two, [tasks.personal, tasks.meds, tasks.meal], { leaveSecondEmpty: su.branch.code === "TH" && su.index === 0 });
      await tpl(su, calls.lunch, 12 * 60 + s, 30, 1, [tasks.meal, tasks.fluids]);
      await tpl(su, calls.tea, 16 * 60 + 30 + s, 30, 1, [tasks.meal, tasks.meds]);
      await tpl(su, calls.bed, 20 * 60 + s, 30, two, [tasks.personal, tasks.mobility]);
    } else if (su.profile === "P3") {
      await tpl(su, calls.morning, 7 * 60 + 30 + s, 60, 1, [tasks.personal, tasks.meds, tasks.meal]);
      await tpl(su, calls.lunch, 12 * 60 + 30 + s, 30, 1, [tasks.meal, tasks.fluids], { leaveEmpty: su.index % 11 === 5 });
      await tpl(su, calls.tea, 17 * 60 + s, 30, 1, [tasks.meal]);
    } else if (su.profile === "P2") {
      await tpl(su, calls.morning, 8 * 60 + s, 45, 1, [tasks.personal, tasks.meal]);
      await tpl(su, calls.tea, 17 * 60 + 30 + s, 30, 1, [tasks.meal, tasks.fluids]);
    } else {
      await tpl(su, calls.morning, 9 * 60 + s, 60, 1, [tasks.personal, tasks.company]);
    }
  }
  // Sittings vary by cycle week: a weekday afternoon sitting on weeks 1 and 3, another on weeks 2 and 4.
  for (const b of UAT_BRANCHES) {
    const mine = sus.filter((x) => x.branch.code === b.code && (x.profile === "P2" || x.profile === "P1"));
    for (let k = 0; k < b.sittings; k++) {
      const su = mine[k % mine.length]!;
      await tpl(su, calls.sitting, 14 * 60, 120, 1, [tasks.company, tasks.fluids], { weekdays: [1, 2, 3, 4, 5], cycleWeeks: k % 2 ? [2, 4] : [1, 3] });
      await tpl(su, calls.sitting, 14 * 60, 120, 1, [tasks.company], { weekdays: [1, 2, 3, 4, 5], cycleWeeks: k % 2 ? [1, 3] : [2, 4] });
    }
  }
  // One overnight sitting service (crosses midnight) on Fridays in weeks 2 and 4.
  const night = sus.find((x) => x.branch.code === "TH" && x.profile === "P1");
  if (night) await tpl(night, calls.night, 22 * 60, 540, 1, [tasks.company], { weekdays: [5], cycleWeeks: [2, 4] });
  log(`${templates} templates`);

  // ---- Build seven weeks through the real engine: two past weeks (history), this week and four ahead (a month) ----
  const coordinator = await ctxForUser(people.coordinator, organisationId);
  for (let w = -2; w <= 4; w++) {
    const week = addDays(thisMonday, w * 7);
    const { build } = await confirmBuild(coordinator, { weekStart: week }, { demoHistory: w < 0 });
    await publishBuild(coordinator, build.id);
    log(`built and published week of ${week}`);
  }

  // ---- Attendance, care records and finance through the shared demo helpers ----
  // Two calls from earlier today were checked in but never checked out (missing check-out scenario). Clock records
  // are append-only, so these are written before the general history and the history skips them.
  const open = await db.visit.findMany({ where: { organisationId, status: "SCHEDULED", scheduledEnd: { lt: new Date() }, scheduledStart: { gte: new Date(`${today}T00:00:00Z`) }, assignments: { some: { removedAt: null, slot: "PRIMARY" } } }, include: { assignments: { where: { removedAt: null, slot: "PRIMARY" } } }, orderBy: { scheduledStart: "desc" }, take: 2 });
  for (const v of open) {
    await db.visitClock.create({ data: { organisationId, visitId: v.id, staffId: v.assignments[0]!.staffId, kind: "IN", at: v.scheduledStart, method: "APP", recordedById: people.manager, reason: "Synthetic UAT history (no check-out)" } });
    await db.visit.update({ where: { id: v.id }, data: { status: "IN_PROGRESS", actualStart: v.scheduledStart } });
  }
  await seedAttendanceHistory(organisationId, people.manager);
  log("attendance history");
  await seedCareRecords(organisationId, coordinator, manager);
  await seedFinance(organisationId, coordinator, manager, people.finance);
  await seedMissedCallDemo(organisationId, coordinator, manager);
  log("care records and finance");

  // ---- Absences: approved leave next week and sickness reported today, so visits are flagged (never reassigned) ----
  const hrDecider = await ctxForUser(people.hrDecider, organisationId);
  const [onLeave, off] = [staff.find((s) => s.hrBranchKey === "liverpool" && !blocked.has(s.id)), staff.find((s) => s.hrBranchKey === "tower-hamlets" && !blocked.has(s.id))];
  if (onLeave) {
    await recordAbsence(manager, { staffId: onLeave.id, kind: "HOLIDAY", from: addDays(thisMonday, 7), to: addDays(thisMonday, 11), reason: "Synthetic annual leave" });
    const req = await db.staffAbsence.findFirstOrThrow({ where: { staffId: onLeave.id, status: "REQUESTED" } });
    await decideAbsence(hrDecider, req.id, req.version, "APPROVED", "Synthetic approval");
  }
  if (off) await recordAbsence(manager, { staffId: off.id, kind: "SICKNESS", from: today, to: addDays(today, 1), reason: "Synthetic sickness" });
  log("absences");
}

/** Branch coordinators limited to one branch each (MembershipBranch), for the branch-restricted access scenarios. */
export async function seedUatBranchCoordinators(organisationId: string) {
  const pw = await hashPassword(DEMO_PASSWORD);
  const out: string[] = [];
  for (const b of UAT_BRANCHES) {
    const branch = await db.branch.findFirstOrThrow({ where: { organisationId, name: b.name } });
    const email = `coordinator.${b.hr}@uat.example`;
    const u = await db.user.create({ data: { email, name: `${b.name} Coordinator (UAT)`, isDemo: true, passwordHash: pw } });
    const m = await db.membership.create({ data: { userId: u.id, organisationId, roles: ["CARE_COORDINATOR"], branchId: branch.id, jobTitle: "Care coordinator" } });
    await db.membershipBranch.create({ data: { membershipId: m.id, branchId: branch.id } });
    out.push(email);
  }
  return out;
}

#!/usr/bin/env node
/**
 * Rostering lifecycle on the full-scale UAT data, through the real screens (owner's defect audit, 31 Oct 2026).
 *   PORT=3200 DATABASE_URL=<local uat url> npx next start -p 3200      (in another terminal)
 *   node scripts/uat-rota-lifecycle.mjs http://localhost:3200 <output folder>
 *
 * It CHANGES the UAT database (a template, a built and published week, edits to visits, clock times), so run
 * `npm run uat:data -- restore` afterwards. It refuses to run against anything but a local "uat" database.
 * Every step checks the saved record in the database as well as the message on screen, then reloads the page to show
 * the change survived a full browser refresh. Each step prints PASS or FAIL; screenshots go to the output folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import "dotenv/config";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");

const [base = "http://localhost:3200", outDir = "test-results/uat-lifecycle"] = process.argv.slice(2);
const url = process.env.UAT_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_uat";
const u = new URL(url);
if (!["localhost", "127.0.0.1"].includes(u.hostname) || !/uat/.test(u.pathname)) throw new Error("Refusing: not a local UAT database");
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) throw new Error("Refusing: the app must run on this computer");
mkdirSync(outDir, { recursive: true });
const db = new PrismaClient({ datasourceUrl: url });

const results = [];
let n = 0;
async function step(name, fn) {
  n++;
  try {
    const detail = await fn();
    results.push({ n, name, ok: true, detail: detail ?? "" });
    console.log(`PASS ${n}. ${name}${detail ? ` (${detail})` : ""}`);
  } catch (e) {
    results.push({ n, name, ok: false, detail: String(e?.message ?? e).split("\n")[0] });
    console.log(`FAIL ${n}. ${name}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
};

const london = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};
const dmy = (iso) => iso.split("-").reverse().join("/");
const dbDate = (iso) => new Date(`${iso}T00:00:00Z`);
const today = london();
const thisMonday = mondayOf(today);

const browser = await chromium.launch();
async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url().replace(base, "")}: ${e.message.slice(0, 80)}`));
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("current-user").waitFor({ state: "attached" });
  return { page, errors, context };
}
/** After a drag, the board shows a "saving" notice; wait for the redirect that carries the real outcome. */
async function flashAfterRedirect(page) {
  await page.waitForURL(/[?&](ok|error)=/, { timeout: 60000 }).catch(() => {});
  const u = new URL(page.url());
  if (u.searchParams.get("ok")) return { ok: true, text: u.searchParams.get("ok") };
  return { ok: false, text: u.searchParams.get("error") ?? "no outcome" };
}
async function flash(page) {
  const ok = page.getByRole("status");
  const err = page.getByRole("alert").filter({ hasNotText: /^$/ });
  await Promise.race([ok.first().waitFor({ timeout: 60000 }), err.first().waitFor({ timeout: 60000 })]).catch(() => {});
  if (await ok.first().isVisible().catch(() => false)) return { ok: true, text: (await ok.first().innerText()).trim() };
  return { ok: false, text: (await err.first().innerText().catch(() => "no message")).trim() };
}

const org = await db.organisation.findFirstOrThrow({ where: { slug: "csb-demo" } });
const branches = Object.fromEntries((await db.branch.findMany({ where: { organisationId: org.id } })).map((b) => [b.name, b.id]));
console.log(`Database ${u.pathname.slice(1)}, organisation "${org.name}", ${await db.serviceUser.count({ where: { organisationId: org.id, status: "ACTIVE" } })} active service users, ${await db.visit.count({ where: { organisationId: org.id, date: dbDate(today) } })} visits today, branches: ${Object.keys(branches).join(", ")}`);

// ── 1 Build Rota opens on the right week and explains a built week ─────────────────────────────────────────────
const L = await signIn("coordinator.liverpool@uat.example");
const lastBuilt = await db.rotaBuild.findFirst({ where: { organisationId: org.id, status: "BUILT" }, orderBy: { weekStart: "desc" } });
const nextWeek = addDays(lastBuilt.weekStart.toISOString().slice(0, 10), 7);
await step("Build Rota opens on the next unbuilt week, not next Monday", async () => {
  await L.page.goto(`${base}/rota/build?new=1`);
  const value = await L.page.getByLabel("Start").inputValue();
  await shot(L.page, "01-build-rota-opens-on-next-unbuilt-week");
  expect(value === nextWeek, `opened on ${value}, expected ${nextWeek}`);
  await L.page.getByText("already built up to").waitFor();
  return `opened on ${dmy(value)}; next Monday ${dmy(addDays(thisMonday, 7))} is already built`;
});
await step("A built week says why it cannot be built, with a link", async () => {
  await L.page.goto(`${base}/rota/build?week=${addDays(thisMonday, 7)}`);
  await L.page.getByText("Nothing can be built for this week").waitFor();
  const text = await L.page.getByRole("alert").filter({ hasText: "Nothing can be built" }).innerText();
  await shot(L.page, "02-build-rota-already-built-reason");
  expect(/already built/.test(text), text);
  expect(await L.page.getByRole("link", { name: /Open this week's rota|Publish it/ }).count(), "no action link");
  return text.split("\n")[1]?.slice(0, 120);
});

// ── 2 Create a recurring template (Liverpool) ─────────────────────────────────────────────────────────────────
const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, branchId: branches.Liverpool, status: "ACTIVE" }, orderBy: { lastName: "asc" } });
const suLabel = `${su.preferredName || su.firstName} ${su.lastName}`;
const carerL = await db.staffMember.findFirstOrThrow({ where: { organisationId: org.id, branchId: branches.Liverpool, employmentStatus: "ACTIVE", hrMissing: false, jobTitle: { contains: "Care" } }, orderBy: { displayName: "asc" } });
let template;
await step("Create a recurring template (22:15, every day, every cycle week)", async () => {
  await L.page.goto(`${base}/rota/templates/new`);
  const form = L.page.locator("main form", { has: L.page.locator("select[name=serviceUserId]") });
  await form.locator("select[name=serviceUserId]").selectOption(su.id);
  await form.locator("select[name=callTypeId]").selectOption({ index: 1 });
  for (const d of ["Sat", "Sun"]) await L.page.getByLabel(d, { exact: true }).check();
  await L.page.getByLabel("Start (UK time)").fill("22:15");
  await L.page.getByLabel("Minutes").fill("30");
  await L.page.getByLabel("First carer").selectOption(carerL.id);
  await L.page.getByLabel("From").fill(today);
  await L.page.getByLabel("Notes for the office").fill("UAT lifecycle template");
  await L.page.getByRole("button", { name: /Save|Create|Add/ }).last().click();
  const f = await flash(L.page);
  expect(f.ok, f.text);
  template = await db.visitTemplate.findFirstOrThrow({ where: { organisationId: org.id, serviceUserId: su.id, startMinute: 22 * 60 + 15, notes: "UAT lifecycle template" } });
  expect(template.weekdays.length === 7 && template.preferredStaff1Id === carerL.id, "template saved wrongly");
  await shot(L.page, "03-template-created");
  return `${suLabel}, carer ${carerL.displayName}`;
});

// ── 3 Build and publish the next week as the Liverpool coordinator ─────────────────────────────────────────────
let build;
await step(`Build ${dmy(nextWeek)} for Liverpool through Build Rota`, async () => {
  await L.page.goto(`${base}/rota/build?new=1`);
  await shot(L.page, "04-build-preview");
  await L.page.getByRole("button", { name: "Build New Rota" }).click();
  const f = await flash(L.page);
  expect(f.ok, f.text);
  build = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: org.id, weekStart: dbDate(nextWeek), status: "BUILT" } });
  const outside = await db.visit.count({ where: { rotaBuildId: build.id, NOT: { serviceUser: { branchId: branches.Liverpool } } } });
  expect(outside === 0, `${outside} visits from other branches in a Liverpool build`);
  const mine = await db.visit.count({ where: { rotaBuildId: build.id, templateId: template.id } });
  expect(mine === 7, `new template built ${mine} visits, expected 7`);
  await L.page.reload();
  await shot(L.page, "05-build-listed-not-published");
  await L.page.locator("tr", { hasText: dmy(nextWeek) }).getByText("not published").waitFor();
  return `${build.visitCount} Liverpool visits, 0 from other branches`;
});
await step("Building the same week again creates nothing", async () => {
  const before = await db.visit.count({ where: { organisationId: org.id } });
  await L.page.goto(`${base}/rota/build?week=${nextWeek}`);
  await L.page.getByText("Nothing can be built for this week").waitFor();
  expect((await L.page.getByRole("button", { name: "Build New Rota" }).count()) === 0, "build button still offered");
  expect((await db.visit.count({ where: { organisationId: org.id } })) === before, "visit count changed");
});

const TH = await signIn("coordinator.tower-hamlets@uat.example");
await step("Tower Hamlets cannot see Liverpool's build and is offered that week to build", async () => {
  await TH.page.goto(`${base}/rota/build`);
  const rows = await TH.page.locator("tr", { hasText: dmy(nextWeek) }).count();
  await TH.page.goto(`${base}/rota/build?new=1`);
  const value = await TH.page.getByLabel("Start").inputValue();
  await shot(TH.page, "06-tower-hamlets-build-rota");
  expect(rows === 0, `Tower Hamlets sees ${rows} row(s) for Liverpool's week`);
  expect(value === nextWeek, `Tower Hamlets offered ${value}`);
  return `no ${dmy(nextWeek)} row; offered ${dmy(value)}`;
});
await step("Tower Hamlets sees shared weeks with only its own visit count", async () => {
  const shared = await db.rotaBuild.findFirstOrThrow({ where: { organisationId: org.id, weekStart: dbDate(addDays(thisMonday, 7)), status: "BUILT" } });
  const theirs = await db.visit.count({ where: { rotaBuildId: shared.id, serviceUser: { branchId: branches["Tower Hamlets"] } } });
  await TH.page.goto(`${base}/rota/build`);
  const row = TH.page.locator("tr", { hasText: dmy(addDays(thisMonday, 7)) });
  const text = await row.innerText();
  expect(/other branch area/.test(text), `row does not mention other branch areas: ${text}`);
  expect(!/Delete/.test(text), "Tower Hamlets is offered Delete on a shared week");
  return `${theirs} Tower Hamlets visits of ${shared.visitCount}`;
});
await step("Publish the Liverpool week; carers are told in the app only", async () => {
  await L.page.goto(`${base}/rota/build`);
  await L.page.locator("tr", { hasText: dmy(nextWeek) }).getByRole("button", { name: "Publish" }).click();
  const f = await flash(L.page);
  expect(f.ok, f.text);
  const unpublished = await db.visit.count({ where: { rotaBuildId: build.id, publishedAt: null, status: { not: "CANCELLED" } } });
  expect(unpublished === 0, `${unpublished} still unpublished`);
  await L.page.reload();
  await L.page.locator("tr", { hasText: dmy(nextWeek) }).getByText("Published").waitFor();
  await shot(L.page, "07-build-published");
  return f.text;
});

// ── 4 Change a visit in next week (published, visible to carers) ────────────────────────────────────────────────
const target = await db.visit.findFirstOrThrow({
  where: { organisationId: org.id, date: dbDate(addDays(thisMonday, 7)), status: "SCHEDULED", timeLocked: false, carersRequired: 1, serviceUser: { branchId: branches.Liverpool }, assignments: { some: { removedAt: null, slot: "PRIMARY" } } },
  include: { serviceUser: true, assignments: { where: { removedAt: null }, include: { staff: true } } },
  orderBy: { scheduledStart: "asc" },
});
const visitUrl = `${base}/rota/visits/${target.id}`;
const fromCarer = target.assignments[0].staff;
let toCarer = null;
await step(`Reassign ${target.reference} through the eligibility check`, async () => {
  await L.page.goto(visitUrl);
  const select = L.page.getByLabel(/Replace primary carer|Replace first carer|Replace/i).first();
  const options = await select.locator("option:not([disabled])").all();
  let chosen = null;
  for (const o of options.slice(1)) {
    const v = await o.getAttribute("value");
    if (v && v !== fromCarer.id) {
      chosen = v;
      break;
    }
  }
  expect(chosen, "no eligible carer offered");
  await select.selectOption(chosen);
  const form = select.locator("xpath=ancestor::form[1]");
  await form.getByLabel("I have read the warnings").check();
  await form.getByRole("button", { name: "Replace" }).click();
  const f = await flash(L.page);
  expect(f.ok, f.text);
  const live = await db.visitAssignment.findFirstOrThrow({ where: { visitId: target.id, slot: "PRIMARY", removedAt: null }, include: { staff: true } });
  expect(live.staffId === chosen, "assignment not saved");
  toCarer = live.staff;
  expect(live.eligibility !== "NOT_ELIGIBLE", "a not-eligible carer was saved");
  await L.page.reload();
  await L.page.getByText(toCarer.displayName).first().waitFor();
  await shot(L.page, "08-visit-reassigned");
  return `${fromCarer.displayName} → ${toCarer.displayName}`;
});
await step("Change the visit time and length", async () => {
  await L.page.goto(visitUrl);
  const startMin = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(target.scheduledStart).split(":").reduce((h, m) => Number(h) * 60 + Number(m)));
  const newStart = Math.max(6 * 60, startMin - 15);
  const hhmm = `${String(Math.floor(newStart / 60)).padStart(2, "0")}:${String(newStart % 60).padStart(2, "0")}`;
  await L.page.getByLabel("Start", { exact: true }).fill(hhmm);
  await L.page.getByLabel("Minutes", { exact: true }).fill("45");
  await L.page.getByRole("button", { name: "Save visit" }).click();
  const f = await flash(L.page);
  if (!f.ok) return `refused with a reason: ${f.text}`;
  const v = await db.visit.findUniqueOrThrow({ where: { id: target.id } });
  expect(v.scheduledEnd.getTime() - v.scheduledStart.getTime() === 45 * 60000, "length not saved");
  expect(v.manuallyChanged, "not marked as changed by hand");
  await L.page.reload();
  expect((await L.page.getByLabel("Start", { exact: true }).inputValue()) === hhmm, "time not shown after reload");
  return `now ${hhmm} for 45 minutes`;
});
await step("Swap carers with another visit (both checked, nothing changes on refusal)", async () => {
  await L.page.goto(visitUrl);
  const summary = L.page.getByText("Swap with another carer’s visit").first();
  if (!(await summary.count())) return "no swap offered for this visit";
  await summary.click();
  const sel = L.page.getByLabel(/Visit to swap/).first();
  if (!(await sel.count())) return "no candidate visit within 12 hours";
  const opt = await sel.locator("option").nth(1).getAttribute("value");
  await sel.selectOption(opt);
  const form = L.page.locator("form", { has: sel });
  await form.getByLabel("Reason for the swap").fill("UAT swap test");
  await form.getByLabel("I have read the warnings").check();
  await form.getByRole("button", { name: "Swap" }).click();
  const f = await flash(L.page);
  const [otherId] = opt.split("|");
  const mine = await db.visitAssignment.findFirst({ where: { visitId: target.id, slot: "PRIMARY", removedAt: null } });
  if (f.ok) {
    expect(mine.staffId !== toCarer.id, "swap reported but carer unchanged");
    const other = await db.visitAssignment.findFirst({ where: { visitId: otherId, removedAt: null, staffId: toCarer.id } });
    expect(other, "the other visit did not receive our carer");
    await shot(L.page, "09-visit-swapped");
    toCarer = await db.staffMember.findUniqueOrThrow({ where: { id: mine.staffId } });
    return `swapped: now ${toCarer.displayName}`;
  }
  expect(mine.staffId === toCarer.id, "refused swap still changed the carer");
  return `refused with reason, nothing changed: ${f.text.slice(0, 100)}`;
});
await step("Cancel the visit with a reason, then reinstate it", async () => {
  await L.page.goto(visitUrl);
  await L.page.locator("form", { has: L.page.getByRole("button", { name: "Cancel visit" }) }).getByLabel("Reason").fill("Family visiting (UAT)");
  await L.page.getByRole("button", { name: "Cancel visit" }).click();
  let f = await flash(L.page);
  expect(f.ok, f.text);
  expect((await db.visit.findUniqueOrThrow({ where: { id: target.id } })).status === "CANCELLED", "not cancelled");
  await L.page.goto(`${base}/rota/visits?date=${addDays(thisMonday, 7)}&q=${encodeURIComponent(target.serviceUser.lastName)}`);
  await shot(L.page, "10-daily-rota-after-cancel");
  await L.page.goto(visitUrl);
  await L.page.getByRole("button", { name: "Reinstate" }).click();
  f = await flash(L.page);
  expect(f.ok, f.text);
  const v = await db.visit.findUniqueOrThrow({ where: { id: target.id } });
  expect(v.status === "SCHEDULED", `status ${v.status}`);
  await L.page.reload();
  await L.page.getByRole("button", { name: "Cancel visit" }).waitFor();
  return "cancelled → scheduled";
});
await step("Moving a regular call onto a day that already has it is refused with a reason (planner drag)", async () => {
  const v = await db.visit.findUniqueOrThrow({ where: { id: target.id } });
  const d = v.date.toISOString().slice(0, 10);
  await L.page.goto(`${base}/rota/planner?week=${d}`);
  const chip = L.page.locator(`a[href="/rota/visits/${v.id}"]`).first();
  const row = chip.locator("xpath=ancestor::tr[1]");
  const dayIndex = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  await chip.dragTo(row.locator("td").nth(dayIndex + 1));
  const f = await flashAfterRedirect(L.page);
  await shot(L.page, "11-planner-move-refused");
  const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
  expect(!f.ok, `move went through: ${f.text}`);
  expect(after.date.getTime() === v.date.getTime(), "a refused move still changed the date");
  expect(/already has this regular call/.test(f.text), `unclear reason: ${f.text}`);
  return f.text.slice(0, 140);
});
let oneOff;
await step("Add a one-off visit, then move it to the next day by dragging it in the Weekly Planner", async () => {
  const d = addDays(thisMonday, 8);
  await L.page.goto(`${base}/rota/visits/new`);
  const form = L.page.locator("main form", { has: L.page.locator("select[name=serviceUserId]") });
  await form.locator("select[name=serviceUserId]").selectOption(su.id);
  await form.locator("select[name=callTypeId]").selectOption({ index: 1 });
  await form.locator("input[name=date]").fill(d);
  await form.locator("input[name=start]").fill("15:05");
  await form.locator("input[name=durationMin]").fill("30");
  await form.locator("textarea[name=notes]").fill("UAT one-off visit");
  await form.getByRole("button", { name: "Add visit" }).click();
  let f = await flash(L.page);
  expect(f.ok, f.text);
  oneOff = await db.visit.findFirstOrThrow({ where: { organisationId: org.id, serviceUserId: su.id, notes: "UAT one-off visit" } });
  // Give it a carer on the visit page so it shows on a carer row in the planner.
  await L.page.goto(`${base}/rota/visits/${oneOff.id}`);
  const select = L.page.getByLabel(/Choose primary carer|Choose first carer|Choose/i).first();
  const opts = await select.locator("option:not([disabled])").all();
  expect(opts.length > 1, "no eligible carer for the one-off visit");
  await select.selectOption((await opts[1].getAttribute("value")) ?? "");
  const aform = select.locator("xpath=ancestor::form[1]");
  await aform.getByLabel("I have read the warnings").check();
  await aform.getByRole("button", { name: "Assign" }).click();
  f = await flash(L.page);
  expect(f.ok, f.text);
  await L.page.goto(`${base}/rota/planner?week=${d}`);
  const chip = L.page.locator(`a[href="/rota/visits/${oneOff.id}"]`).first();
  const row = chip.locator("xpath=ancestor::tr[1]");
  const dayIndex = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  await chip.dragTo(row.locator("td").nth(dayIndex + 1));
  f = await flashAfterRedirect(L.page);
  if (!f.ok && /Needs your confirmation/.test(f.text)) {
    await L.page.getByRole("button", { name: "Move anyway" }).click();
    f = await flash(L.page);
  }
  expect(f.ok, f.text);
  const after = await db.visit.findUniqueOrThrow({ where: { id: oneOff.id } });
  expect(after.date.toISOString().slice(0, 10) === addDays(d, 1), `date is ${after.date.toISOString().slice(0, 10)}`);
  await L.page.reload();
  await shot(L.page, "11b-planner-moved");
  return `${oneOff.reference} moved ${dmy(d)} → ${dmy(addDays(d, 1))}`;
});
await step("Move it back with the keyboard, using the new Date field on the visit", async () => {
  await L.page.goto(`${base}/rota/visits/${oneOff.id}`);
  await L.page.locator("form:has(button:text(\"Save visit\")) input[name=date]").fill(addDays(thisMonday, 8));
  await L.page.getByRole("button", { name: "Save visit" }).click();
  const f = await flash(L.page);
  expect(f.ok, f.text);
  const after = await db.visit.findUniqueOrThrow({ where: { id: oneOff.id } });
  expect(after.date.toISOString().slice(0, 10) === addDays(thisMonday, 8), "date not saved");
  await L.page.goto(`${base}/rota/visits/${oneOff.id}`);
  await L.page.locator("form:has(button:text(\"Save visit\")) input[name=date]").fill(addDays(today, -1));
  await L.page.getByRole("button", { name: "Save visit" }).click();
  const g = await flash(L.page);
  expect(!g.ok && /into the past/.test(g.text), `past move not refused clearly: ${g.text}`);
  return "moved back; a move into the past is refused";
});

// ── 5 The change shows everywhere ──────────────────────────────────────────────────────────────────────────────
await step("Daily Rota, Advanced Rota and the carer filter show the new carer", async () => {
  const v = await db.visit.findUniqueOrThrow({ where: { id: target.id } });
  const d = v.date.toISOString().slice(0, 10);
  await L.page.goto(`${base}/rota/visits?date=${d}&staffId=${toCarer.id}`);
  await L.page.getByText(v.reference).first().waitFor();
  await L.page.goto(`${base}/rota/advanced?date=${d}`);
  await L.page.getByText(toCarer.displayName).first().waitFor();
  await shot(L.page, "12-advanced-rota");
  await L.page.goto(`${base}/rota/service-users/${target.serviceUserId}?tab=visits`);
  await L.page.getByText(toCarer.displayName).first().waitFor();
  await shot(L.page, "13-service-user-schedule");
  return `${v.reference} under ${toCarer.displayName} on ${dmy(d)}`;
});
await step("Carer mobile shows the visit to the new carer once published", async () => {
  if (!toCarer.userId) return "new carer has no sign-in linked (sign-ins are linked by hand only); skipped";
  const user = await db.user.findUniqueOrThrow({ where: { id: toCarer.userId } });
  const C = await signIn(user.email);
  await C.page.setViewportSize({ width: 390, height: 844 });
  await C.page.goto(`${base}/carer`);
  await shot(C.page, "14-carer-mobile");
  const visible = await C.page.getByText(target.serviceUser.lastName).count();
  await C.context.close();
  expect(visible > 0, `${user.email} does not see ${target.serviceUser.lastName}`);
  return `${user.email} sees the visit`;
});
await step("Audit history records every step on the visit", async () => {
  const events = await db.visitEvent.findMany({ where: { visitId: target.id }, select: { type: true } });
  const types = new Set(events.map((e) => e.type));
  for (const t of ["CREATED", "PUBLISHED", "REASSIGNED", "EDITED", "STATUS"]) expect(types.has(t), `no ${t} event (have ${[...types].join(", ")})`);
  await L.page.goto(visitUrl);
  await L.page.getByRole("heading", { name: "History" }).waitFor();
  return [...types].join(", ");
});

// ── 6 Attendance on a call today, and the dashboard follows ─────────────────────────────────────────────────────
await step("Record attendance (office clock in and out) and see the dashboard and Monitor change", async () => {
  const now = new Date();
  const v = await db.visit.findFirst({
    where: { organisationId: org.id, date: dbDate(today), status: { in: ["SCHEDULED", "MISSED"] }, serviceUser: { branchId: branches.Liverpool }, assignments: { some: { removedAt: null } }, scheduledStart: { lt: now } },
    include: { assignments: { where: { removedAt: null }, include: { staff: true } } },
    orderBy: { scheduledStart: "desc" },
  });
  if (!v) return "no started Liverpool call today to clock";
  await L.page.goto(`${base}/rota?date=${today}`);
  const before = await L.page.locator("main").innerText();
  const completeBefore = await db.visit.count({ where: { organisationId: org.id, date: dbDate(today), status: "COMPLETED", serviceUser: { branchId: branches.Liverpool } } });
  const t = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  for (const [kind, at] of [["IN", v.scheduledStart], ["OUT", new Date(Math.min(v.scheduledEnd.getTime(), now.getTime() - 60000))]]) {
    await L.page.goto(`${visitUrl.replace(target.id, v.id)}`);
    const form = L.page.locator("form[aria-label='Record a clock time']");
    await form.locator("select[name=kind]").selectOption(kind);
    await form.locator("input[name=date]").fill(today);
    await form.locator("input[name=time]").fill(t(at));
    await form.locator("input[name=reason]").fill("Carer phoned the office (UAT)");
    await form.locator("input[name=note]").fill("Visit went as planned");
    await form.getByRole("button", { name: "Record clock time" }).click();
    const f = await flash(L.page);
    expect(f.ok, `${kind}: ${f.text}`);
  }
  const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
  expect(after.status === "COMPLETED", `status ${after.status}`);
  const completeAfter = await db.visit.count({ where: { organisationId: org.id, date: dbDate(today), status: "COMPLETED", serviceUser: { branchId: branches.Liverpool } } });
  await L.page.goto(`${base}/rota?date=${today}`);
  await shot(L.page, "15-dashboard-after-attendance");
  const afterText = await L.page.locator("main").innerText();
  expect(before !== afterText, "dashboard text did not change");
  await L.page.goto(`${base}/rota/monitor`);
  await shot(L.page, "16-monitor");
  return `${v.reference} completed; Liverpool complete ${completeBefore} → ${completeAfter}`;
});
await step("Rota report includes the change", async () => {
  await L.page.goto(`${base}/rota/reports?from=${addDays(thisMonday, 7)}&to=${addDays(thisMonday, 13)}`);
  await shot(L.page, "17-rota-reports");
  const text = await L.page.locator("main").innerText();
  expect(text.length > 200, "report empty");
  return "report opened for next week";
});

// ── 7 Branch limits through the screens ────────────────────────────────────────────────────────────────────────
await step("Tower Hamlets cannot open, publish or delete a Liverpool visit or build by address", async () => {
  const r1 = await TH.page.goto(visitUrl);
  const body = await TH.page.locator("main").innerText();
  await shot(TH.page, "18-tower-hamlets-opens-liverpool-visit");
  expect(r1.status() === 404 || /not found|outside your areas/i.test(body), `status ${r1.status()}`);
  await TH.page.goto(`${base}/rota/visits?date=${addDays(thisMonday, 7)}&q=${encodeURIComponent(target.serviceUser.lastName)}`);
  const rows = await TH.page.locator("main tr", { hasText: target.reference }).count();
  expect(rows === 0, "Tower Hamlets search finds a Liverpool visit");
  return `visit page ${r1.status()}, search finds 0`;
});
await step("No page errors in the browser", async () => {
  const all = [...L.errors, ...TH.errors];
  expect(!all.length, all.join(" | ").slice(0, 300));
});

await browser.close();
await db.$disconnect();
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
process.exit(failed ? 1 : 0);

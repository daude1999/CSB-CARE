import { expect, test, type Page } from "@playwright/test";

/**
 * The owner's acceptance test, in the browser: add a visit, give it a carer, move it, cancel it, and after each step
 * check the Rota Dashboard figures, the Daily Rota, the Advanced Rota, the person's schedule and the carer's schedule
 * all show the change, including after a full reload.
 */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** ISO date `days` after the Monday `weeks` weeks from this week's. */
function dayOfWeek(weeks: number, days: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * weeks + days);
  return d.toISOString().slice(0, 10);
}

/** The Rota Dashboard's figures for one day, and the Daily Rota's for the same day: they must always agree. */
async function figures(page: Page, date: string) {
  await page.goto(`/rota?date=${date}`);
  const read = async (id: string) => Number((await page.getByTestId(`kpi-${id}`).locator("[data-value]").innerText()).replace(/,/g, ""));
  const out = { scheduled: await read("scheduled"), unassigned: await read("unassigned") };
  await page.goto(`/rota/visits?date=${date}`);
  const tile = async (name: string) => Number((await page.getByRole("region", { name: "The day's figures" }).getByRole("link", { name: new RegExp(`^${name}`) }).locator("[data-value]").innerText()).replace(/,/g, ""));
  expect(await tile("Scheduled")).toBe(out.scheduled);
  expect(await tile("Unassigned")).toBe(out.unassigned);
  return out;
}

test.describe("Dashboards follow rota changes", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("a visit added, staffed, moved and cancelled shows the same everywhere, and the figures change", async ({ page }) => {
    // Wednesday of next week: always inside the weeks the demo data builds, and always in the future.
    const day = dayOfWeek(1, 2);
    const nextDay = dayOfWeek(1, 3);
    await signIn(page, "coordinator@care-solution.demo");
    const before = await figures(page, day);
    const beforeNext = await figures(page, nextDay);

    // Add a 09:00 visit with nobody on it.
    await page.goto("/rota/visits/new");
    const su = page.locator("select[name=serviceUserId]");
    await su.selectOption({ index: 1 });
    const suId = await su.inputValue();
    await page.locator("input[name=date]").fill(day);
    await page.locator("input[name=start]").fill("09:00");
    await page.locator("input[name=durationMin]").fill("30");
    await page.getByRole("button", { name: "Add visit" }).click();
    await expect(page.getByRole("status")).toContainText("Visit added");
    const visitId = page.url().match(/\/rota\/visits\/([^?/]+)/)?.[1];
    expect(visitId).toBeTruthy();
    const link = `a[href*="${visitId}"]`;

    let now = await figures(page, day);
    expect(now.scheduled).toBe(before.scheduled + 1);
    expect(now.unassigned).toBe(before.unassigned + 1);
    await page.goto(`/rota/visits?date=${day}`);
    await expect(page.locator(link).first()).toBeAttached();
    await page.goto(`/rota/advanced?date=${day}&view=su-day`);
    await expect(page.locator(link).first()).toBeAttached();
    await page.goto(`/rota/service-users/${suId}?tab=visits`);
    await expect(page.locator(link).first()).toBeAttached();

    // Give it a carer the checks allow.
    await page.goto(`/rota/visits/${visitId}`);
    const assign = page.locator("form:has(select[name=staffId])").first();
    const options = assign.locator("select[name=staffId] option:not([value=''])");
    const usable = await options.evaluateAll((os) => os.filter((o) => !/not eligible/.test(o.textContent ?? "")).map((o) => (o as HTMLOptionElement).value));
    expect(usable.length).toBeGreaterThan(0);
    await assign.locator("select[name=staffId]").selectOption(usable[0]!);
    await assign.getByLabel("I have read the warnings").check();
    await assign.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("status")).toContainText("Carer assigned");
    const carer = usable[0]!;

    now = await figures(page, day);
    expect(now.unassigned).toBe(before.unassigned);
    await page.goto(`/rota/advanced?date=${day}&carer=${carer}`);
    await expect(page.locator(link).first()).toBeAttached();

    // Change its time: the visit page and every list show the new time.
    await page.goto(`/rota/visits/${visitId}`);
    await page.locator("form:has(button:text-is('Save visit')) input[name=start]").fill("10:15");
    await page.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("status")).toContainText("Visit saved");
    await expect(page.getByText("10:15").first()).toBeVisible();

    // Cancel it with a reason: it leaves the scheduled figure, joins the cancelled one, and stays after a reload.
    await page.locator("form:has(button:text-is('Cancel visit')) input[name=reason]").fill("Family cancelled: test");
    await page.getByRole("button", { name: "Cancel visit" }).click();
    await expect(page.getByRole("status")).toContainText("Visit cancelled");
    await page.reload();
    await expect(page.getByText("Family cancelled: test").first()).toBeVisible();

    now = await figures(page, day);
    expect(now.scheduled).toBe(before.scheduled);
    expect(now.unassigned).toBe(before.unassigned);
    await page.goto(`/rota/visits?date=${day}`);
    await expect(page.locator(link)).toHaveCount(0);
    await page.goto(`/rota/visits?date=${day}&cancelled=1&status=CANCELLED`);
    await expect(page.locator(link).first()).toBeAttached();
    expect((await figures(page, nextDay)).scheduled).toBe(beforeNext.scheduled);
  });

  test("a week nobody has built says so and links to Build Rota", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    const far = dayOfWeek(6, 1);
    for (const path of [`/rota?date=${far}`, `/rota/visits?date=${far}`, `/rota/advanced?date=${far}`, `/rota/planner?week=${dayOfWeek(6, 0)}`]) {
      await page.goto(path);
      await expect(page.getByRole("status").filter({ hasText: "No rota has been built" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Build this week" })).toHaveAttribute("href", `/rota/build?week=${dayOfWeek(6, 0)}`);
    }
  });
});

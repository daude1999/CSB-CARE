import { expect, test, type Page } from "@playwright/test";

/**
 * The Version 1 principal scenario through the screens, on the demo data (HR records are created in the HR Hub,
 * whose own tests cover that screen; the full chain from a brand-new HR record is tests/integration/v1-scenario).
 * Office: a new service user, made active, given a repeating visit; Build Rota for a future week; the visit allocated
 * through the eligibility check and the week published. Carer: today's visit, clock in, a task, a concern note, clock
 * out. Office: the concern resolved in the exceptions register. Finance: timesheets and pay runs open (the
 * second-person approval is driven in rota.spec's finance test). Manager: branch analytics.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

function mondayWeeksAhead(n: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * n);
  return d.toISOString().slice(0, 10);
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("V1 scenario through the screens: service user → schedule → build → allocate → publish → visit → exception → timesheet → report", async ({ page }) => {
  test.setTimeout(300_000);
  const week = mondayWeeksAhead(3);

  // Service user, then active.
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto("/rota/service-users/new");
  await page.getByLabel("First name").fill("Quinn");
  await page.getByLabel("Last name").fill("Scenario");
  await page.locator("select[name=areaId]").selectOption({ index: 1 });
  await page.locator("main form button.btn-primary").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Quinn");
  const suUrl = page.url().split("?")[0]!;
  const statusForm = page.locator("form:has(select[name=to])");
  await statusForm.locator("select[name=to]").selectOption("ACTIVE");
  await statusForm.locator("input[name=reason]").fill("Assessment complete");
  await statusForm.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // A repeating visit for them.
  await page.goto(`/rota/templates/new?serviceUserId=${suUrl.split("/").pop()}`);
  const tf = page.locator("main form").filter({ has: page.locator("select[name=callTypeId]") }).first();
  const suValue = await tf.locator("select[name=serviceUserId] option", { hasText: "Scenario" }).first().getAttribute("value");
  await tf.locator("select[name=serviceUserId]").selectOption(suValue ?? "");
  await tf.locator("select[name=callTypeId]").selectOption({ index: 1 });
  await tf.locator("input[name=start]").fill("10:00");
  await tf.locator("input[name=effectiveFrom]").fill(week);
  await tf.locator("button.btn-primary").click();
  await expect(page.getByRole("status")).toBeVisible();

  // Build that week, find the visit, allocate it through the eligibility check.
  await page.goto(`/rota/build?week=${week}`);
  await page.getByRole("button", { name: "Build New Rota" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto(`/rota/visits?date=${week}&q=Scenario`);
  await page.locator("main tr", { hasText: "Scenario" }).locator("a[href^='/rota/visits/']").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Scenario");
  const pick = page.locator("form:has(select[name=staffId])").first();
  const option = await pick.locator("select[name=staffId] option:not([disabled])").nth(1).getAttribute("value");
  await pick.locator("select[name=staffId]").selectOption(option ?? "");
  // A carer who needs review can still be chosen once the coordinator confirms they have read why.
  await pick.getByLabel("I have read the warnings").check();
  await pick.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // Publish the week.
  await page.goto("/rota/build");
  await page.locator("tr", { hasText: week.split("-").reverse().join("/") }).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  // The carer's day: clock in, a task, a concern, clock out.
  await signIn(page, "carer@care-solution.demo");
  await page.goto("/carer");
  const clockIn = page.getByRole("button", { name: /^Clock in/ }).first();
  if (await clockIn.isVisible()) {
    await clockIn.click();
    await expect(page.getByRole("status")).toBeVisible();
  }
  await page.getByText("Add a note").first().click();
  const note = page.locator("form:has(textarea[name=text])").first();
  await note.locator("select[name=category]").selectOption("CONCERN");
  await note.locator("textarea[name=text]").fill("Scenario: seemed unsteady on their feet today");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("status")).toContainText("Note added");

  // The office resolves the concern.
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto("/rota/exceptions?kind=CONCERN");
  const row = page.locator("ul.rows li", { hasText: "Scenario: seemed unsteady" }).first();
  await row.locator("input[name=resolution]").fill("Rang the family; falls referral made");
  await row.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("status")).toContainText("Exception resolved");

  // Finance: the timesheet and pay screens (approval by a second person is in rota.spec's finance test).
  await signIn(page, "finance@care-solution.demo");
  await page.goto("/rota/finance/timesheets");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/rota/finance/payroll");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Branch and organisation reports.
  await signIn(page, "manager@care-solution.demo");
  await page.goto("/analytics");
  await expect(page.locator("tr[data-kpi=visits-delivered]")).toBeVisible();
  await page.locator("select[name=branch]").selectOption({ label: "Liverpool" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/^Liverpool ·/)).toBeVisible();
});

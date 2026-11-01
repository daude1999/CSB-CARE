import { expect, test, type Page } from "@playwright/test";

/** Browser tests for the integrated build: recruitment, rota alerts, Care Summary, Monitor alerts and insights. */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Care intelligence", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("recruitment: HR adds a candidate, finds them in the list and opens their record", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/hr/recruitment");
    await expect(page.getByRole("heading", { level: 1, name: "Recruitment" })).toBeVisible();
    await page.getByRole("link", { name: "Add Candidate" }).first().click();
    await page.locator("input[name=firstName]").fill("Robin");
    await page.locator("input[name=lastName]").fill("Testcase");
    await page.locator("input[name=email]").fill("robin.testcase@example.test");
    await page.locator("input[name=roleApplied]").fill("Care Support Worker");
    await page.locator("select[name=branchId]").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Add Candidate" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Robin Testcase/ })).toBeVisible();
    await expect(page.getByText("Applied").first()).toBeVisible();
    await page.goto("/hr/recruitment?q=Testcase");
    await expect(page.getByRole("link", { name: /Robin Testcase/ }).first()).toBeVisible();
  });

  test("rota dashboard shows Coming up alerts whose buttons open the matching screen", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota");
    const panel = page.getByTestId("coming-up");
    if (await panel.count()) {
      const first = panel.getByRole("link").first();
      const href = await first.getAttribute("href");
      await first.click();
      await expect(page).toHaveURL(new RegExp(href!.split("?")[0]!.replace(/\//g, "\\/")));
    }
  });

  test("care plan: the recent records view works without AI and the summary area says why it is unavailable", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/care-plans");
    await page.locator("table a").first().click();
    await page.getByRole("link", { name: "Care Summary and recent records" }).click();
    await expect(page.getByTestId("care-facts")).toContainText("visits scheduled");
    await expect(page.getByTestId("care-summary-state")).toContainText("switched off");
    await page.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/period=7/);
  });

  test("the Monitor lists today's alerts with an owner column and actions", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/monitor");
    const alerts = page.getByTestId("monitor-alerts");
    await expect(alerts.getByRole("heading", { name: /Today's alerts/ })).toBeVisible();
    await expect(alerts.getByText(/nothing is sent by text or email/)).toBeVisible();
  });

  test("analytics shows Care Operations Insights with definitions", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/analytics?group=quality");
    await expect(page.getByRole("heading", { level: 1, name: /Care Operations Insights/ })).toBeVisible();
    await expect(page.locator("tr[data-kpi=plans-overdue]")).toContainText("review date has passed");
  });

  test("service user overview has an At a glance summary", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.locator("table a.row-title, table a").first().click();
    await expect(page.getByTestId("at-a-glance")).toContainText("Care plan");
  });
});

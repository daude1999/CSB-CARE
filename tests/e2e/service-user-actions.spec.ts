import { expect, test, type Page } from "@playwright/test";

/**
 * All Service Users and Service User Management: Add New Service User, Update Existing Service User and each row's
 * View / Update. Every choice must lead into the existing workflow for the right person. Demo people are fictional.
 */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("All Service Users", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("shows the count, both buttons, the search and every row with View and Update", async ({ page }) => {
    await page.goto("/rota/service-users");
    await expect(page.getByRole("heading", { name: "All Service Users" })).toBeVisible();
    const rows = page.getByTestId("su-row");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId("su-count")).toContainText(String(n));
    await expect(page.getByTestId("add-service-user")).toBeVisible();
    await expect(page.getByTestId("update-service-user")).toBeVisible();
    await expect(page.getByRole("region", { name: "Filters" }).getByLabel("Search")).toBeVisible();
    await expect(rows.first().getByTestId("row-view")).toBeVisible();
    await expect(rows.first().getByTestId("row-update")).toBeVisible();
  });

  test("Add New offers Upload Support Plan and Add Manually, into the existing intake and form", async ({ page }) => {
    await page.goto("/rota/service-users");
    await page.getByTestId("add-service-user").click();
    const dialog = page.getByTestId("add-dialog");
    await expect(dialog.getByRole("heading", { name: "Add New Service User" })).toBeVisible();
    await expect(dialog.getByTestId("add-upload")).toHaveAttribute("href", "/rota/coordinator?mode=NEW#start");
    await dialog.getByTestId("add-manual").click();
    await expect(page).toHaveURL(/\/rota\/service-users\/new$/);
    await expect(page.getByRole("button", { name: "Add service user" })).toBeVisible();
  });

  test("Update Existing searches, keeps the chosen person and opens their profile, intake or discharge workflow", async ({ page }) => {
    await page.goto("/rota/service-users");
    const first = page.getByTestId("su-row").first();
    const name = (await first.locator("td").first().locator("a").innerText()).trim();
    const href = (await first.locator("td").first().locator("a").getAttribute("href"))!;
    const id = href.split("/").pop()!;
    await page.getByTestId("update-service-user").click();
    const dialog = page.getByTestId("update-dialog");
    await dialog.getByTestId("update-search").fill(name);
    await dialog.getByTestId("update-results").getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(dialog.getByRole("heading", { name: `Update ${name}` })).toBeVisible();
    await expect(dialog.getByTestId("update-revised")).toHaveAttribute("href", `/rota/coordinator?mode=EXISTING&person=${id}#start`);
    await expect(dialog.getByTestId("update-discharge")).toHaveAttribute("href", `/rota/coordinator?mode=EXISTING&person=${id}&doc=discharge#start`);
    await dialog.getByTestId("update-manual").click();
    await expect(page).toHaveURL(new RegExp(`/rota/service-users/${id}\\?tab=details$`));
  });

  test("a row's Update opens the options for that person without searching, and Discharge links the same profile", async ({ page }) => {
    await page.goto("/rota/service-users");
    const row = page.getByTestId("su-row").nth(1);
    const name = (await row.locator("td").first().locator("a").innerText()).trim();
    const id = (await row.locator("td").first().locator("a").getAttribute("href"))!.split("/").pop()!;
    await row.getByTestId("row-update").click();
    const dialog = page.getByTestId("update-dialog");
    await expect(dialog.getByRole("heading", { name: `Update ${name}` })).toBeVisible();
    await expect(dialog.getByTestId("update-search")).toHaveCount(0);
    await dialog.getByTestId("update-discharge").click();
    await expect(page).toHaveURL(/\/rota\/coordinator\?/);
    await expect(page.getByTestId("intake-person-chosen")).toContainText(name);
    await expect(page.getByTestId("intake-person-chosen")).toContainText("post-discharge review");
    await expect(page.locator('select[name="serviceUserId"]')).toHaveValue(id);
    await expect(page.locator('input[name="mode"][value="EXISTING"]')).toBeChecked();
    await expect(page.locator('input[name="title"]')).toHaveValue(new RegExp(`^Hospital discharge: ${name}`));
  });

  test("a row's View opens that person's profile", async ({ page }) => {
    await page.goto("/rota/service-users");
    const row = page.getByTestId("su-row").first();
    const href = (await row.locator("td").first().locator("a").getAttribute("href"))!;
    await row.getByTestId("row-view").click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test("Service User Management has the same actions and the directory", async ({ page }) => {
    await page.goto("/rota/service-users/manage");
    await expect(page.getByTestId("card-add-upload")).toHaveAttribute("href", "/rota/coordinator?mode=NEW#start");
    await expect(page.getByTestId("card-add-manual")).toHaveAttribute("href", "/rota/service-users/new");
    await expect(page.getByTestId("card-view-all")).toHaveAttribute("href", "/rota/service-users");
    await expect(page.getByTestId("su-directory")).toBeVisible();
    const first = page.getByTestId("su-row").first();
    const name = (await first.locator("td").first().locator("a").innerText()).trim();
    const id = (await first.locator("td").first().locator("a").getAttribute("href"))!.split("/").pop()!;
    await page.getByTestId("card-update-manual").click();
    await page.getByTestId("update-search").fill(name);
    await page.getByTestId("update-results").getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/rota/service-users/${id}\\?tab=details$`));
  });

  test("no horizontal page scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/rota/service-users", "/rota/service-users/manage"]) {
      await page.goto(path);
      await expect(page.getByTestId("su-directory")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
  });
});

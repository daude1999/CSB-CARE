import { expect, test, type Page } from "@playwright/test";

/**
 * All Service Users, the one service-user workspace (approved design, 7 Nov 2026): Add New and Update Existing
 * dropdowns, the toolbar, and View / Update / ⋮ on every row. Every choice must lead into the existing workflow for the
 * right person. Demo people are fictional.
 */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const firstPerson = async (page: Page, n = 0) => {
  const row = page.getByTestId("su-row").nth(n);
  const link = row.locator("td").first().locator("a");
  const name = (await link.innerText()).trim();
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  return { row, name, id };
};

test.describe("All Service Users", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("is the one workspace: four tabs, title, both dropdowns, toolbar, real count and View / Update on every row", async ({ page }) => {
    await page.goto("/rota/service-users");
    const tabs = page.getByTestId("rota-tabs-people").getByRole("link");
    await expect(tabs).toHaveText(["All Service Users", "Care Coordinator", "Incidents", "Visit Notes"]);
    await expect(page.getByRole("heading", { level: 1, name: "All Service Users" })).toBeVisible();
    await expect(page.getByTestId("add-service-user")).toBeVisible();
    await expect(page.getByTestId("update-service-user")).toBeVisible();
    const filters = page.getByRole("region", { name: "Filters" });
    for (const label of ["Search", "Branch", "Area", "Status"]) await expect(filters.getByLabel(label)).toBeVisible();
    const n = await page.getByTestId("su-row").count();
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId("su-count")).toContainText(`Showing 1 to ${n} of`);
    const { row } = await firstPerson(page);
    await expect(row.getByTestId("row-view")).toBeVisible();
    await expect(row.getByTestId("row-update")).toBeVisible();
    await expect(row.getByTestId("status-pill")).toBeVisible();
  });

  test("the old Service User Management address redirects here and keeps the search", async ({ page }) => {
    await page.goto("/rota/service-users/manage?q=zz&status=ALL");
    await expect(page).toHaveURL(/\/rota\/service-users\?q=zz&status=ALL$/);
    await expect(page.getByTestId("card-add")).toHaveCount(0);
    await expect(page.getByTestId("su-directory")).toHaveCount(1);
  });

  test("Add New offers Upload Support Plan and Add Manually, into the existing intake and form", async ({ page }) => {
    await page.goto("/rota/service-users");
    await page.getByTestId("add-service-user").click();
    const menu = page.getByTestId("add-menu");
    await expect(menu.getByTestId("add-upload")).toHaveAttribute("href", "/rota/coordinator?mode=NEW#start");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("add-service-user")).toBeFocused();
    await page.getByTestId("add-service-user").click();
    await page.getByTestId("add-manual").click();
    await expect(page).toHaveURL(/\/rota\/service-users\/new$/);
    await expect(page.getByRole("button", { name: "Add service user" })).toBeVisible();
  });

  test("Update Existing searches, keeps the chosen person and opens their profile, intake or discharge workflow", async ({ page }) => {
    await page.goto("/rota/service-users");
    const { name, id } = await firstPerson(page);
    await page.getByTestId("update-service-user").click();
    const menu = page.getByTestId("update-menu");
    await menu.getByTestId("update-search").fill(name);
    await menu.getByTestId("update-results").getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(menu.getByTestId("update-person")).toContainText(name);
    await expect(menu.getByTestId("update-revised")).toHaveAttribute("href", `/rota/coordinator?mode=EXISTING&person=${id}#start`);
    await expect(menu.getByTestId("update-discharge")).toHaveAttribute("href", `/rota/coordinator?mode=EXISTING&person=${id}&doc=discharge#start`);
    await menu.getByTestId("update-manual").click();
    await expect(page).toHaveURL(new RegExp(`/rota/service-users/${id}\\?tab=details$`));
  });

  test("a row's Update has that person already chosen, and Discharge links the same profile", async ({ page }) => {
    await page.goto("/rota/service-users");
    const { row, name, id } = await firstPerson(page, 1);
    await row.getByTestId("row-update").click();
    const menu = page.getByTestId("update-menu");
    await expect(menu.getByTestId("update-person")).toContainText(name);
    await expect(menu.getByTestId("update-search")).toHaveCount(0);
    await menu.getByTestId("update-discharge").click();
    await expect(page).toHaveURL(/\/rota\/coordinator\?/);
    await expect(page.getByTestId("intake-person-chosen")).toContainText(name);
    await expect(page.locator('select[name="serviceUserId"]')).toHaveValue(id);
    await expect(page.locator('input[name="mode"][value="EXISTING"]')).toBeChecked();
  });

  test("a row's View opens that person's profile and ⋮ shows the rest of their details", async ({ page }) => {
    await page.goto("/rota/service-users");
    const { row, id } = await firstPerson(page);
    await row.getByTestId("row-more").click();
    const details = page.getByTestId("row-details");
    for (const t of ["CSB reference", "Postcode", "Risk", "Repeating visits", "Carer preference"]) await expect(details).toContainText(t);
    await page.keyboard.press("Escape");
    await row.getByTestId("row-view").click();
    await expect(page).toHaveURL(new RegExp(`/rota/service-users/${id}$`));
  });

  test("search by full name and CSB number, and Clear resets the filters", async ({ page }) => {
    await page.goto("/rota/service-users");
    const { row, name } = await firstPerson(page);
    const csb = (await row.locator("td").nth(1).innerText()).split("\n")[0]!.trim();
    const filters = page.getByRole("region", { name: "Filters" });
    for (const q of [name, csb]) {
      await filters.getByLabel("Search").fill(q);
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByTestId("su-row")).toHaveCount(1);
      await expect(page.getByTestId("su-row").first()).toContainText(name);
    }
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/rota\/service-users$/);
    await expect(filters.getByLabel("Search")).toHaveValue("");
  });

  test("no horizontal page scroll on a phone, and the actions stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rota/service-users");
    await expect(page.getByTestId("su-directory")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("update-service-user").click();
    await page.getByTestId("update-search").fill("a");
    await expect(page.getByTestId("update-menu")).toBeVisible();
  });
});

import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Overview", () => {
  test.use({ viewport: { width: 1536, height: 1024 } });

  test("shows a coloured tile for each module the person may open, with planned modules labelled", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Care Solution Bureau");
    // Every figure tile links to the page it was counted from.
    for (const id of ["service-users", "completed", "pending", "missed", "staff", "policies-overdue", "checks-overdue", "branches"]) await expect(page.getByTestId(`stat-${id}`)).toBeVisible();
    for (const id of ["policy", "rota", "hr", "reporting", "admin"]) await expect(page.getByTestId(`tile-${id}`)).toBeVisible();
    // Electronic call monitoring and service users now live inside Rostering & Care Management.
    for (const id of ["ecm", "service-users"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId("tile-rota")).not.toContainText("Not built yet");
    await expect(page.getByTestId("needs-attention")).toBeVisible();

    // The Policy tile and the Policy & Compliance pages share one colour.
    const tileColour = await page.getByTestId("tile-policy").locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByTestId("tile-policy").getByRole("link", { name: "Open Policy & Compliance" }).click();
    await expect(page).toHaveURL(/\/$/);
    // The banner blends from the Overview colour into the module's over a quarter of a second, so wait for it to settle.
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Centre Dashboard" })).toHaveCSS("background-color", tileColour);
  });

  test("every module's page banner uses its Overview tile colour", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const banners: [string, string, string][] = [
      ["reporting", "/reports", "[data-testid=title-bar]"],
      ["reporting", "/analytics", "[data-testid=title-bar]"],
      ["admin", "/settings", "[data-testid=title-bar]"],
      ["rota", "/rota/service-users", "[data-testid=title-bar]"],
      ["hr", "/hr/dashboard", "[data-testid=title-bar]"],
    ];
    for (const [id, path, banner] of banners) {
      await page.goto("/overview");
      const tileColour = await page.getByTestId(`tile-${id}`).locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const bannerColour = await page.locator(banner).first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bannerColour, `${id} banner on ${path}`).toBe(tileColour);
    }
  });

  test("a person can rearrange their module boxes, and the order is kept", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await page.getByTestId("arrange-modules").click();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    // Start from the standard order so the test does not depend on an earlier run.
    await page.getByRole("button", { name: "Standard order" }).click();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    // Move HR to the front with its arrow button (retried until the page is interactive).
    const hr = page.getByTestId("arrange-hr");
    await expect(async () => {
      if (!(await hr.textContent())?.includes("position 1")) await page.getByRole("button", { name: "Move HR & Workforce earlier" }).click();
      await expect(hr).toContainText("position 1", { timeout: 500 });
    }).toPass();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText("Your module order is saved.")).toBeVisible();
    const order = () => page.locator("[data-testid^=tile-]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-rota", "tile-reporting", "tile-admin"]);
    await page.reload();
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-rota", "tile-reporting", "tile-admin"]);
    // Back to the standard order for the other tests.
    await page.goto("/overview?arrange=1");
    await page.getByRole("button", { name: "Standard order" }).click();
    await expect(page.getByText("The module boxes are back in the standard order.")).toBeVisible();
  });

  test("care staff only see the modules they can use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByTestId("tile-policy")).toBeVisible();
    for (const id of ["hr", "admin", "reporting", "rota"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
  });
});

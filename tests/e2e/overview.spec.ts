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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Alex$/);
    for (const id of ["policy", "rota", "hr", "reporting", "admin"]) await expect(page.getByTestId(`tile-${id}`)).toBeVisible();
    // Electronic call monitoring and service users now live inside Rostering & Care Management.
    for (const id of ["ecm", "service-users"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId("tile-rota")).not.toContainText("Not built yet");
    await expect(page.getByTestId("needs-attention")).toBeVisible();

    // The Policy tile and the Policy & Compliance pages share one colour.
    const tileColour = await page.getByTestId("tile-policy").locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByTestId("tile-policy").getByRole("link", { name: "Open Policy & Compliance" }).click();
    await expect(page).toHaveURL(/\/$/);
    const barColour = await page.getByRole("heading", { level: 1, name: "Compliance Centre Dashboard" }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(barColour).toBe(tileColour);
  });

  test("every module's page banner uses its Overview tile colour", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const banners: [string, string, string][] = [
      ["reporting", "/reports", "[data-testid=title-bar]"],
      ["reporting", "/analytics", "[data-testid=title-bar]"],
      ["admin", "/settings", "[data-testid=title-bar]"],
      ["rota", "/rota", "[data-testid=title-bar]"],
      ["rota", "/rota/service-users", "[data-testid=title-bar]"],
      ["hr", "/hr/dashboard", "header.h-top"],
    ];
    for (const [id, path, banner] of banners) {
      await page.goto("/overview");
      const tileColour = await page.getByTestId(`tile-${id}`).locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const bannerColour = await page.locator(banner).first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bannerColour, `${id} banner on ${path}`).toBe(tileColour);
    }
  });

  test("care staff only see the modules they can use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByTestId("tile-policy")).toBeVisible();
    for (const id of ["hr", "admin", "reporting", "rota"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
  });
});

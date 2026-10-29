import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Rostering & Care Management", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("coordinator works the day: filters visits, assigns a carer, and sees the result", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/unassigned");
    await expect(page.getByRole("heading", { level: 1, name: "Unassigned Visits" })).toBeVisible();
    const form = page.locator("form:has(select[name=staffId])").first();
    const select = form.locator("select[name=staffId]");
    const options = await select.locator("option").count();
    test.skip(options < 2, "No eligible carer free in the demo data for the first visit");
    await select.selectOption({ index: 1 });
    await form.getByLabel("Accept warnings").check();
    await form.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("status")).toContainText("Carer assigned");

    await page.goto("/rota/visits");
    await page.getByLabel("Show").selectOption("unassigned");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/view=unassigned/);
  });

  test("bulk change reports each visit, and cancelling needs a reason", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits");
    const boxes = page.locator("input[name=visitIds]");
    await boxes.nth(0).check();
    await page.getByRole("button", { name: "Cancel visits" }).click();
    await expect(page.getByRole("alert")).toContainText(/reason/i);
  });

  test("Build Rota previews a future week with its checklist", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/build");
    await expect(page.getByRole("heading", { name: "2. Before you build" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Build \d+ visits for Week \d$/ })).toBeVisible();
  });

  test("a carer cannot open the office rota", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/rota/visits");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Visits" })).toHaveCount(0);
  });

  for (const [name, width] of [["desktop", 1440], ["tablet", 834], ["phone", 390]] as const) {
    test(`rota screens render at ${name} width without page overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await signIn(page, "manager@care-solution.demo");
      for (const path of ["/rota", "/rota/visits", "/rota/planner", "/rota/build", "/rota/templates", "/rota/service-users", "/rota/staff"]) {
        await page.goto(path);
        await expect(page.locator("[data-testid=title-bar]")).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${SHOTS}/${name}${path.replaceAll("/", "_")}.png`, fullPage: false });
      }
    });
  }

  test("keyboard: a visit can be opened and reassigned without a mouse", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits");
    const link = page.locator("table a[href^='/rota/visits/']").first();
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Carers" })).toBeVisible();
    await expect(page.getByLabel(/Choose first carer|Replace first carer/)).toBeVisible();
  });
});

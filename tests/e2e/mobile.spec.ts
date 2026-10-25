import { devices, expect, test } from "@playwright/test";

// Phones: the menu opens from the hamburger button, and no page scrolls sideways.
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

const PAGES = ["/", "/policies", "/changes", "/queue", "/requirements", "/audits", "/actions", "/staff", "/evidence", "/reports", "/notifications", "/acknowledgements", "/settings"];

test("phone layout: menu works and pages fit the screen", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@brookfield.demo");
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("mobile-menu")).toBeVisible();

  await page.getByTestId("mobile-menu").click();
  const menu = page.getByRole("dialog");
  await menu.getByRole("link", { name: "Policies & Procedures" }).click();
  await expect(page).toHaveURL(/\/policies/);
  await expect(menu).toBeHidden();

  const policy = await page.locator("main a[href^='/policies/c']").first().getAttribute("href");
  for (const href of [...PAGES, policy!]) {
    await page.goto(href);
    await expect(page.locator("h1").first(), href).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${href} scrolls sideways`).toBeLessThanOrEqual(1);
  }
});

import { expect, test, type Page } from "@playwright/test";

/** Browser tests for the Version 1 features: one test per workflow, each from a real sign-in. */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Version 1", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("staff readiness: the manager finds evidence awaiting verification and verifies it", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness" })).toBeVisible();
    await page.getByRole("link", { name: /Pending verification/ }).click();
    await expect(page).toHaveURL(/status=PENDING_VERIFICATION/);
    await page.locator("table a.row-title").first().click();
    await expect(page.getByRole("heading", { name: "Staff readiness" })).toBeVisible();
    const form = page.locator("section[aria-label='Evidence awaiting verification'] form").first();
    await form.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("Evidence verified");

    await page.goto("/admin/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness Matrix" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Safeguarding adults/ }).first()).toBeVisible();
  });
});

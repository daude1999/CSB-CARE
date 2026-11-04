import { expect, test, type Page } from "@playwright/test";

/** The service user's Care Package: a short Overview card, and the full tab with the original text in full. */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

for (const width of [1440, 834, 390]) {
  test(`care package card and full tab at ${width}px`, async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rota/service-users");
    await page.locator("table tbody a").first().click();
    const card = page.getByTestId("care-package-summary");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Care package" })).toBeVisible();
    await expect(card).toContainText("Commissioned care");
    await expect(card).toContainText("Scheduled care");
    // The card never prints the package's free-text requirements.
    await expect(card.getByTestId("requirements-text")).toHaveCount(0);
    // Key contacts stay close below the card.
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.height).toBeLessThan(560);
    // No sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await card.getByRole("link", { name: "View full package" }).click();
    await expect(page).toHaveURL(/tab=package/);
    for (const id of ["package-details", "package-coverage", "package-requirements", "package-review-items", "package-sources", "package-history"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("package-coverage")).toContainText("Planned carer time");
    // Keyboard: the edit control is reachable and opens.
    const edit = page.getByText("Edit package", { exact: true });
    await edit.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("form:has(input[name=packageId]) textarea[name=requirements]")).toBeVisible();
  });
}

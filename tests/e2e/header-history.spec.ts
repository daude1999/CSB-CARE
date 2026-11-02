import { expect, test, type Page } from "@playwright/test";

/** The header's Back and Forward buttons in the browser. */
const SHOTS = process.env.SHOTS_DIR ?? "test-results/screens/header-history";

async function signIn(page: Page, email = "coordinator@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Header Back and Forward", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("follow the platform's own pages, keep filters and never offer what is not there", async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole("navigation", { name: "Page history" });
    const back = nav.getByRole("button", { name: "Back to the previous page" });
    const fwd = nav.getByRole("button", { name: "Forward to the next page" });

    // A direct link: nothing behind it in the platform.
    await page.goto("/rota/visits?view=unassigned");
    await expect(back).toBeDisabled();
    await expect(fwd).toBeDisabled();

    await page.getByRole("link", { name: "Visits Needing Attention" }).first().click();
    await expect(page).toHaveURL(/\/rota\/attention/);
    await expect(back).toBeEnabled();
    await expect(fwd).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/4-header-back-forward.png` });

    await back.click();
    await expect(page).toHaveURL(/\/rota\/visits\?view=unassigned/);
    await expect(fwd).toBeEnabled();
    await expect(back).toBeDisabled();

    await fwd.click();
    await expect(page).toHaveURL(/\/rota\/attention/);
    await expect(fwd).toBeDisabled();

    // A refresh keeps the place.
    await page.reload();
    await expect(back).toBeEnabled();
    await back.click();
    await expect(page).toHaveURL(/\/rota\/visits\?view=unassigned/);
  });
});

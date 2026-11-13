import { followMenu } from "./harbour-menu";
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

/** Back and Forward sit behind the top bar's "Recent" icon (Harbour reference, 13 Nov 2026); open it if it is closed. */
async function openRecent(page: Page) {
  const recent = page.getByTestId("recent-menu");
  if ((await recent.getAttribute("open")) === null) await recent.locator("summary").click();
  await expect(recent).toHaveAttribute("open", "");
}

test.describe("Header Back and Forward", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("follow the platform's own pages, keep filters and never offer what is not there", async ({ page }) => {
    await signIn(page);
    // The buttons are in the DOM while Recent is closed, so their state is read without opening it.
    const nav = page.getByTestId("history-nav");
    const back = nav.locator('button[aria-label="Back to the previous page"]');
    const fwd = nav.locator('button[aria-label="Forward to the next page"]');

    // A direct link: nothing behind it in the platform.
    await page.goto("/rota/visits?view=unassigned");
    await expect(back).toBeDisabled();
    await expect(fwd).toBeDisabled();

    await followMenu(page, "Needs attention");
    await expect(page).toHaveURL(/\/rota\/attention/);
    await expect(back).toBeEnabled();
    await expect(fwd).toBeDisabled();
    await openRecent(page);
    await page.screenshot({ path: `${SHOTS}/4-header-back-forward.png` });

    await openRecent(page);
    await back.click();
    await expect(page).toHaveURL(/\/rota\/visits\?view=unassigned/);
    await expect(fwd).toBeEnabled();
    await expect(back).toBeDisabled();

    await openRecent(page);
    await fwd.click();
    await expect(page).toHaveURL(/\/rota\/attention/);
    await expect(fwd).toBeDisabled();

    // A refresh keeps the place.
    await page.reload();
    await expect(back).toBeEnabled();
    await openRecent(page);
    await back.click();
    await expect(page).toHaveURL(/\/rota\/visits\?view=unassigned/);
  });
});

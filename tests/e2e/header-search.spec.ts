import { expect, test, type Page } from "@playwright/test";

/** The redesigned top bar: a wide centred search pill, no shortcut badge, no sample-workspace badge. */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("Top bar search", () => {
  test("desktop: centred pill, no badges, Ctrl+K and Enter still search", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    await page.goto("/rota");
    const header = page.locator("header.shell-topbar");
    const search = page.getByRole("searchbox", { name: "Search rostering" });
    await expect(search).toHaveAttribute("placeholder", "Search service users, staff, references...");
    await expect(header.locator("kbd")).toHaveCount(0);
    await expect(header).not.toContainText(/sample workspace/i);
    await expect(header).not.toContainText(/ctrl\s*k|⌘/i);

    // Tall, wide and centred between the history arrows and the alerts, help and profile controls.
    const pill = (await header.locator(".shell-search").boundingBox())!;
    expect(pill.height).toBeGreaterThanOrEqual(44);
    expect(pill.width).toBeGreaterThanOrEqual(700);
    const arrows = (await page.getByRole("navigation", { name: "Page history" }).boundingBox())!;
    const bell = (await header.getByTestId("notifications-link").boundingBox())!;
    const gapLeft = pill.x - (arrows.x + arrows.width);
    expect(gapLeft).toBeGreaterThanOrEqual(16);
    expect(bell.x - (pill.x + pill.width)).toBeGreaterThanOrEqual(16);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The keyboard shortcut still works without a visible badge, and Enter runs the rostering search.
    await page.locator("body").click({ position: { x: 900, y: 500 } }).catch(() => undefined);
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    await search.fill("V-2");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search\?q=V-2/);

    // Off the rota, the same box searches the policy library.
    await page.goto("/policies");
    await expect(page.getByRole("searchbox", { name: "Search policies" }).first()).toBeVisible();
    await expect(page.locator("header.shell-topbar")).not.toContainText(/sample workspace/i);
  });

  test("tablet and phone: no overflow, phone opens search from an icon", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await signIn(page);
    await page.goto("/rota");
    await expect(page.locator("#global-search")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rota");
    await expect(page.locator("#global-search")).toBeHidden();
    const header = page.locator("header.shell-topbar");
    await expect(header.getByTestId("notifications-link")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await header.getByRole("link", { name: "Search rostering" }).click();
    await expect(page).toHaveURL(/\/rota\/search/);
    await expect(page.getByRole("heading", { level: 1, name: "Search rostering" })).toBeVisible();
  });
});

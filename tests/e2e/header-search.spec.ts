import { expect, test, type Page } from "@playwright/test";

/** The top bar search: the same search in a compact Harbour field, no shortcut badge, no sample-workspace badge. */
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
  // Harbour reference (owner's decision, 13 Nov 2026): the top bar shows a search icon between the bell and Recent; it
  // opens the existing search in a box under the bar. What it searches and how is unchanged.
  test("desktop: the icon opens the search, which searches as before, and Enter still searches", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    await page.goto("/rota");
    const header = page.locator("header.hb-hd");
    // Bell, search, Recent, Help, in that order, as in the reference.
    const xs = await Promise.all([header.getByTestId("notifications-link"), header.getByTestId("top-search"), header.getByTestId("recent-menu"), header.locator('summary[aria-label="Help and resources"]')].map(async (l) => (await l.boundingBox())!.x));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    await expect(header.getByText(/sample workspace/i)).toBeHidden();
    await expect(header).not.toContainText(/ctrl\s*k|⌘/i);
    await expect(page.locator("#global-search")).toHaveCount(0);
    await header.getByTestId("top-search").click();
    const search = page.getByRole("searchbox", { name: "Search rostering" });
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("placeholder", "Search service users, staff, references...");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Escape closes it and returns to the icon.
    await page.keyboard.press("Escape");
    await expect(page.locator("#global-search")).toHaveCount(0);
    await expect(header.getByTestId("top-search")).toBeFocused();

    // Enter runs the rostering search. Ctrl+K opens the command bar instead (tests/e2e/command-bar.spec.ts).
    await header.getByTestId("top-search").click();
    await search.fill("V-2");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search\?q=V-2/);

    // Off the rota, the same icon searches the policy library.
    await page.goto("/policies");
    await page.locator("header.hb-hd").getByTestId("top-search").click();
    await expect(page.locator("header.hb-hd").getByRole("searchbox", { name: "Search policies" })).toBeVisible();
  });

  test("tablet and phone: no overflow, and the icon opens the same search", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await signIn(page);
    await page.goto("/rota");
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rota");
    const header = page.locator("header.hb-hd");
    await expect(header.getByTestId("notifications-link")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await header.getByTestId("top-search").click();
    const search = page.getByRole("searchbox", { name: "Search rostering" });
    await expect(search).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await search.fill("V-2");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search/);
    await expect(page.getByRole("heading", { level: 1, name: "Search rostering" })).toBeVisible();
  });
});

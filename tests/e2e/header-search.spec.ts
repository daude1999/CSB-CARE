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
  // Harbour (owner's decision, 13 Nov 2026) keeps the existing search in a compact 32px field beside the top bar's
  // controls, replacing the wide centred pill of 4 Nov 2026. What it searches and how is unchanged.
  test("desktop: the field searches as before, with no badges, and Enter still searches", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    await page.goto("/rota");
    const header = page.locator("header.hb-hd");
    const search = page.getByRole("searchbox", { name: "Search rostering" });
    await expect(search).toHaveAttribute("placeholder", "Search service users, staff, references...");
    // No sample-workspace badge on the bar itself (the closed account menu still names the workspace inside it).
    await expect(header.getByText(/sample workspace/i)).toBeHidden();
    await expect(header).not.toContainText(/ctrl\s*k|⌘/i);
    const field = (await header.locator(".hb-search").boundingBox())!;
    expect(field.height).toBe(32);
    expect(field.width).toBeGreaterThanOrEqual(300);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // Enter runs the rostering search. Ctrl+K opens the command bar instead (tests/e2e/command-bar.spec.ts).
    await search.fill("V-2");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search\?q=V-2/);

    // Off the rota, the same field searches the policy library.
    await page.goto("/policies");
    await expect(page.getByRole("searchbox", { name: "Search policies" }).first()).toBeVisible();
    await expect(page.locator("header.hb-hd").getByText(/sample workspace/i)).toBeHidden();
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
    const header = page.locator("header.hb-hd");
    await expect(header.getByTestId("notifications-link")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await header.getByRole("link", { name: "Search rostering" }).click();
    await expect(page).toHaveURL(/\/rota\/search/);
    await expect(page.getByRole("heading", { level: 1, name: "Search rostering" })).toBeVisible();
  });
});
